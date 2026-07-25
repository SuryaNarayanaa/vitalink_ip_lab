import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildCapacityManifest, manifestCounts } from './model.mjs'
import { buildCapacityReport, renderCsv, renderHtml, renderMarkdown } from './report.mjs'
import { discoverCapacity, normalizeSteps } from './search.mjs'

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const inventory = JSON.parse(fs.readFileSync(path.join(backendRoot, 'load-tests/generated/endpoints.json'), 'utf8'))

test('manifest classifies every mandatory explicit endpoint exactly once', () => {
  const manifest = buildCapacityManifest(inventory)
  const counts = manifestCounts(manifest)
  assert.equal(counts.total, inventory.counts.mandatoryExplicit)
  assert.equal(new Set(manifest.map(entry => entry.id)).size, counts.total)
  assert.equal(counts.byEvidenceClass.legacy_alias, inventory.counts.legacy)
  assert.equal(counts.byEvidenceClass.unmapped || 0, 0)
  assert.ok(counts.eligible > 0)

  const mutation = manifest.find(entry => entry.id === 'POST /api/v1/doctors/patients')
  assert.equal(mutation.eligible, false)
  assert.equal(mutation.evidenceClass, 'rejection_only')
  const upload = manifest.find(entry => entry.id === 'POST /api/v1/patient/reports')
  assert.equal(upload.evidenceClass, 'upload')
  const sse = manifest.find(entry => entry.id === 'GET /api/v1/patient/notifications/stream')
  assert.equal(sse.evidenceClass, 'sse_specialized')
  const legacy = manifest.find(entry => entry.id === 'GET /api/doctors/profile')
  assert.equal(legacy.inheritsCapacityFrom, 'GET /api/v1/doctors/profile')
})

test('staircase and binary refinement find the final repeatable passing VU count', async () => {
  const calls = []
  const result = await discoverCapacity({
    cap: 20,
    steps: [1, 5, 10, 20],
    confirmations: 3,
    warmup: false,
    runStep: async ({ vus, phase, attempt }) => {
      calls.push({ vus, phase, attempt })
      return { passed: vus <= 13, achievedRps: vus * 2 }
    },
  })
  assert.equal(result.status, 'capacity_found')
  assert.equal(result.lastPassingVus, 13)
  assert.equal(result.firstFailingVus, 14)
  assert.equal(result.achievedRpsAtSafeConcurrency, 26)
  assert.equal(calls.filter(call => call.phase === 'confirmation' && call.vus === 13).length, 3)
})

test('a ceiling pass is reported as a censored lower bound', async () => {
  const result = await discoverCapacity({
    cap: 8,
    steps: [1, 2, 4, 8],
    confirmations: 2,
    warmup: false,
    runStep: async ({ vus }) => ({ passed: true, achievedRps: vus * 3 }),
  })
  assert.equal(result.status, 'censored_at_cap')
  assert.equal(result.capacityLabel, '>=8')
  assert.equal(result.firstFailingVus, null)
})

test('a flaky ceiling confirmation creates a failure bound and is binary-refined', async () => {
  let capAttempts = 0
  const result = await discoverCapacity({
    cap: 20,
    steps: [1, 10, 20],
    confirmations: 2,
    warmup: false,
    runStep: async ({ vus, phase }) => {
      if (vus === 20 && phase === 'confirmation') {
        capAttempts += 1
        return { passed: capAttempts === 1, achievedRps: 20 }
      }
      return { passed: vus <= 17 || vus === 20, achievedRps: vus }
    },
  })
  assert.equal(result.status, 'capacity_found')
  assert.equal(result.lastPassingVus, 17)
  assert.equal(result.firstFailingVus, 18)
})

test('normalizing staircase always includes one and the cap', () => {
  assert.deepEqual(normalizeSteps(['2', '5', '1000'], 9), [1, 2, 5, 9])
  assert.throws(() => normalizeSteps(['0'], 10), /positive whole numbers/)
})

test('report renders JSON inputs, CSV, Markdown, and escaped HTML', () => {
  const manifest = [{
    id: 'GET /safe?<x>',
    canonicalId: 'GET /safe?<x>',
    scope: 'canonical',
    family: 'public',
    evidenceClass: 'valid_read',
    executionClass: 'closed_model_constant_vus',
    eligible: true,
    reason: 'test',
  }]
  const report = buildCapacityReport({
    run: { id: 'test-run', targetHost: 'localhost' },
    config: { cap: 10 },
    manifest,
    results: {
      'GET /safe?<x>': {
        status: 'censored_at_cap',
        lastPassingVus: 10,
        firstFailingVus: null,
        capacityLabel: '>=10',
        achievedRpsAtSafeConcurrency: 42,
        samples: [],
      },
    },
  })
  assert.match(renderCsv(report), /GET \/safe\?<x>/)
  assert.match(renderMarkdown(report), />=10/)
  const html = renderHtml(report)
  assert.doesNotMatch(html, /GET \/safe\?<x>/)
  assert.match(html, /GET \/safe\?&lt;x&gt;/)
})
