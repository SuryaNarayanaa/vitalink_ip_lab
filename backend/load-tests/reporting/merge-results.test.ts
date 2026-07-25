import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { mergeResults } from './merge-results'

test('maps normalized k6 endpoint tags back to stable inventory IDs', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalink-load-report-'))
  try {
    const inventory = path.resolve('load-tests/generated/endpoints.json')
    const k6Json = path.join(directory, 'points.json')
    const cleanupJournal = path.join(directory, 'cleanup.json')
    const output = path.join(directory, 'report')
    const points = [
      { type: 'Point', metric: 'load_request_attempts', data: { value: 1, tags: { endpoint_id: 'get_api_v1', load_run_id: 'report_test_run', response_class: 'success' } } },
      { type: 'Point', metric: 'load_request_duration', data: { value: 25, tags: { endpoint_id: 'get_api_v1', load_run_id: 'report_test_run' } } },
      { type: 'Point', metric: 'load_semantic_success_rate', data: { value: 1, tags: { endpoint_id: 'get_api_v1', load_run_id: 'report_test_run' } } },
      { type: 'Point', metric: 'load_expected_status_rate', data: { value: 1, tags: { endpoint_id: 'get_api_v1', load_run_id: 'report_test_run' } } },
      { type: 'Point', metric: 'load_response_statuses', data: { value: 1, tags: { endpoint_id: 'get_api_v1', load_run_id: 'report_test_run', status: '200' } } },
    ]
    fs.writeFileSync(k6Json, `${points.map(point => JSON.stringify(point)).join('\n')}\n`)
    fs.writeFileSync(cleanupJournal, JSON.stringify({ state: 'clean', runId: 'report_test_run' }))
    const report = await mergeResults({ inventory, k6Json, cleanupJournal, output, includeDocs: false })
    const endpoint = report.endpoints.find((row: any) => row.id === 'GET /api/v1')
    assert.equal(endpoint.attempts, 1)
    assert.equal(endpoint.status, 'passed')
    assert.equal(endpoint.latencyMs.p95, 25)
    assert.deepEqual(endpoint.responseStatuses, { 200: 1 })
    assert.equal(report.evidence.identityMatches, true)
    assert.equal(report.status, 'incomplete')
    assert.equal(report.coverage.attempted, 1)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('merges repeated k6 files and guarded SSE runner output', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalink-load-report-multi-'))
  try {
    const inventory = path.resolve('load-tests/generated/endpoints.json')
    const first = path.join(directory, 'first.json')
    const second = path.join(directory, 'second.json')
    const sseJson = path.join(directory, 'sse.json')
    const cleanupJournal = path.join(directory, 'cleanup.json')
    const output = path.join(directory, 'report')
    const points = (endpoint: string) => [
      { type: 'Point', metric: 'load_request_attempts', data: { value: 1, tags: { endpoint_id: endpoint, load_run_id: 'report_test_run', response_class: 'success' } } },
      { type: 'Point', metric: 'load_semantic_success_rate', data: { value: 1, tags: { endpoint_id: endpoint, load_run_id: 'report_test_run' } } },
      { type: 'Point', metric: 'load_expected_status_rate', data: { value: 1, tags: { endpoint_id: endpoint, load_run_id: 'report_test_run' } } },
    ]
    fs.writeFileSync(first, `${points('get_api_v1').map(point => JSON.stringify(point)).join('\n')}\n`)
    fs.writeFileSync(second, `${points('get_health_live').map(point => JSON.stringify(point)).join('\n')}\n`)
    fs.writeFileSync(sseJson, JSON.stringify({
      runId: 'report_test_run', config: { requireHeartbeat: true },
      results: {
        doctor: { modes: { bearer: {
          baseline: { status: 200, headersValid: true, unexpectedDisconnects: 0, heartbeatCount: 1, timeToHeadersMs: 10, timeToFirstEventMs: 12 },
          reconnect: { status: 200, passed: true, timeToFirstEventMs: 9 },
          ticketReplay: null,
        } } },
      },
    }))
    fs.writeFileSync(cleanupJournal, JSON.stringify({ state: 'clean', runId: 'report_test_run' }))

    const report = await mergeResults({ inventory, k6Json: [first, second], sseJson, cleanupJournal, output, includeDocs: false })
    assert.equal(report.coverage.attempted, 3)
    assert.equal(report.evidence.identityMatches, true)
    assert.equal(report.endpoints.find((row: any) => row.id === 'GET /api/v1/doctors/notifications/stream').attempts, 2)
    assert.equal(report.endpoints.find((row: any) => row.id === 'GET /api/v1/doctors/notifications/stream').status, 'passed')
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
