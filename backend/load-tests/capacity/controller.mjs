#!/usr/bin/env node
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { assertAllowedTarget, parseDurationSeconds } from '../lib/guards.js'
import { THRESHOLD_CLASSES } from '../config/thresholds.js'
import { buildCapacityManifest, manifestCounts } from './model.mjs'
import { discoverCapacity, normalizeSteps } from './search.mjs'
import { buildCapacityReport, renderCsv, renderHtml, renderMarkdown } from './report.mjs'

const TRUE = 'true'
const K6_IMAGE = 'grafana/k6:2.1.0'
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
let activeChild = null
let interrupted = false

function flag(name, fallback = false) {
  const raw = process.env[name]
  return raw === undefined ? fallback : String(raw).trim().toLowerCase() === TRUE
}

function required(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function boundedInteger(name, value, fallback, minimum, maximum) {
  const parsed = value === undefined || value === '' ? fallback : Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be a whole number from ${minimum} to ${maximum}`)
  }
  return parsed
}

function boundedNumber(name, value, fallback, minimum, maximum) {
  const parsed = value === undefined || value === '' ? fallback : Number(value)
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be a number from ${minimum} to ${maximum}`)
  }
  return parsed
}

function safeRunId(value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{5,79}$/.test(value)) {
    throw new Error('LOAD_TEST_RUN_ID must be 6-80 safe characters')
  }
  return value
}

function safeOutputPath(value, fallback) {
  const resolved = path.resolve(backendRoot, value || fallback)
  const relative = path.relative(backendRoot, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('CAPACITY_OUTPUT_DIR must stay inside the backend directory')
  }
  return { absolute: resolved, relative: relative.replaceAll('\\', '/') }
}

function parseSteps(raw, cap) {
  const values = String(raw || '1,2,5,10,20,40,80,160,250')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  return normalizeSteps(values, cap)
}

function parseEndpointSelection(raw) {
  return new Set(String(raw || '').split(',').map(value => value.trim()).filter(Boolean))
}

function localMetricsUrl(name, raw, allowedHosts) {
  const value = String(raw || '').trim()
  if (!value) return null
  let parsed
  try { parsed = new URL(value) } catch (_) { throw new Error(`${name} must be an absolute URL`) }
  if (parsed.protocol !== 'http:') throw new Error(`${name} must use http in the isolated local stack`)
  if (!allowedHosts.includes(parsed.hostname.toLowerCase())) {
    throw new Error(`${name} host must be one of: ${allowedHosts.join(', ')}`)
  }
  return parsed.toString().replace(/\/$/, '')
}

function configFromEnvironment() {
  const runId = safeRunId(required('LOAD_TEST_RUN_ID'))
  const execute = flag('CAPACITY_EXECUTE')
  if (execute && !flag('ALLOW_LOAD_TESTS')) throw new Error('ALLOW_LOAD_TESTS=true is required')
  if (execute && !flag('ALLOW_CAPACITY_DISCOVERY')) throw new Error('ALLOW_CAPACITY_DISCOVERY=true is required')
  if (flag('LOAD_TEST_VALID_MUTATIONS')) {
    throw new Error('Capacity controller refuses LOAD_TEST_VALID_MUTATIONS=true; valid write capacity is not implemented')
  }

  const cap = boundedInteger('CAPACITY_MAX_VUS', process.env.CAPACITY_MAX_VUS, 100, 1, 250)
  const durationSeconds = parseDurationSeconds(process.env.CAPACITY_STEP_DURATION || '30s')
  const warmupSeconds = parseDurationSeconds(process.env.CAPACITY_WARMUP_DURATION || '10s')
  if (durationSeconds > 3600 || warmupSeconds > 600) throw new Error('Capacity durations exceed hard safety ceilings')
  const allowedErrorRate = boundedNumber('CAPACITY_ALLOWED_ERROR_RATE', process.env.CAPACITY_ALLOWED_ERROR_RATE, 0.01, 0, 0.2)
  const confirmations = boundedInteger('CAPACITY_CONFIRMATIONS', process.env.CAPACITY_CONFIRMATIONS, 3, 1, 10)
  const maxRefinements = boundedInteger('CAPACITY_MAX_REFINEMENTS', process.env.CAPACITY_MAX_REFINEMENTS, 16, 8, 32)
  const thinkTimeMs = boundedInteger('CAPACITY_THINK_TIME_MS', process.env.CAPACITY_THINK_TIME_MS, 0, 0, 60000)
  const maxEndpoints = boundedInteger('CAPACITY_MAX_ENDPOINTS', process.env.CAPACITY_MAX_ENDPOINTS, 194, 1, 194)
  const output = safeOutputPath(process.env.CAPACITY_OUTPUT_DIR, `load-tests/reports/capacity-${runId}`)

  let target = null
  let context = null
  if (execute) {
    const baseUrl = required('LOAD_TEST_BASE_URL')
    const allowedHosts = required('LOAD_TEST_ALLOWED_HOSTS')
    target = assertAllowedTarget({
      baseUrl,
      allowedHosts,
      productionHosts: process.env.LOAD_TEST_PRODUCTION_HOSTS,
      allowInsecureRemote: flag('ALLOW_INSECURE_REMOTE_LOAD'),
    })
    const contextAbsolute = path.resolve(required('LOAD_TEST_CONTEXT_FILE'))
    const contextRelative = path.relative(backendRoot, contextAbsolute)
    if (contextRelative.startsWith('..') || path.isAbsolute(contextRelative)) {
      throw new Error('LOAD_TEST_CONTEXT_FILE must stay inside backend for the read-only Docker mount')
    }
    if (!fs.existsSync(contextAbsolute)) throw new Error(`Capacity context does not exist: ${contextAbsolute}`)
    context = { absolute: contextAbsolute, container: `/work/${contextRelative.replaceAll('\\', '/')}` }
    required('LOAD_TEST_ENV_FINGERPRINT')
  }

  return {
    runId,
    execute,
    resume: flag('CAPACITY_RESUME'),
    cap,
    steps: parseSteps(process.env.CAPACITY_STEPS, cap),
    durationSeconds,
    warmupSeconds,
    allowedErrorRate,
    confirmations,
    maxRefinements,
    thinkTimeMs,
    maxEndpoints,
    selectedIds: parseEndpointSelection(process.env.CAPACITY_ENDPOINT_IDS),
    output,
    target,
    context,
    metricsUrl: String(process.env.CAPACITY_METRICS_URL || '').trim() || null,
    dashboardUrl: String(process.env.CAPACITY_DASHBOARD_URL || '').trim() || null,
    prometheusRwUrl: localMetricsUrl(
      'CAPACITY_PROMETHEUS_RW_URL',
      process.env.CAPACITY_PROMETHEUS_RW_URL,
      ['127.0.0.1', 'localhost', 'host.docker.internal', 'prometheus'],
    ),
    pushgatewayUrl: localMetricsUrl(
      'CAPACITY_PUSHGATEWAY_URL',
      process.env.CAPACITY_PUSHGATEWAY_URL,
      ['127.0.0.1', 'localhost'],
    ),
    gitSha: String(process.env.LOAD_TEST_GIT_SHA || 'unknown').trim(),
  }
}

function configFingerprint(config, selectedIds) {
  const stable = JSON.stringify({
    runId: config.runId,
    targetHost: config.target?.hostname || 'plan-only',
    cap: config.cap,
    steps: config.steps,
    durationSeconds: config.durationSeconds,
    warmupSeconds: config.warmupSeconds,
    allowedErrorRate: config.allowedErrorRate,
    confirmations: config.confirmations,
    maxRefinements: config.maxRefinements,
    thinkTimeMs: config.thinkTimeMs,
    selectedIds,
  })
  return crypto.createHash('sha256').update(stable).digest('hex')
}

async function writeAtomic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`)
  await fsp.rename(temporary, file)
}

async function spawnCapture(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    activeChild = child
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', code => {
      activeChild = null
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

function slug(value) {
  const label = value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70)
  const digest = crypto.createHash('sha1').update(value).digest('hex').slice(0, 10)
  return `${label || 'endpoint'}-${digest}`
}

function prometheusLabel(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"')
}

function completedEndpointMetrics(config, entry, result) {
  const labels = `load_run_id="${prometheusLabel(config.runId)}",endpoint_id="${prometheusLabel(entry.id)}",method="${prometheusLabel(entry.method.toLowerCase())}",route_family="${prometheusLabel(entry.family)}"`
  const safeVus = Number(result.lastPassingVus || 0)
  const firstFail = result.firstFailingVus === null ? 0 : Number(result.firstFailingVus)
  const safeRps = Number(result.achievedRpsAtSafeConcurrency || 0)
  const safeP95 = Number(result.p95MsAtSafeConcurrency || 0)
  const safeP99 = Number(result.p99MsAtSafeConcurrency || 0)
  const pass = ['capacity_found', 'censored_at_cap'].includes(result.status) ? 1 : 0
  return [
    '# TYPE vitalink_endpoint_safe_max_vus gauge',
    `vitalink_endpoint_safe_max_vus{${labels}} ${safeVus}`,
    '# TYPE vitalink_endpoint_first_failed_vus gauge',
    `vitalink_endpoint_first_failed_vus{${labels}} ${firstFail}`,
    '# TYPE vitalink_endpoint_safe_max_rps gauge',
    `vitalink_endpoint_safe_max_rps{${labels}} ${safeRps}`,
    '# TYPE vitalink_endpoint_safe_p95_ms gauge',
    `vitalink_endpoint_safe_p95_ms{${labels}} ${safeP95}`,
    '# TYPE vitalink_endpoint_safe_p99_ms gauge',
    `vitalink_endpoint_safe_p99_ms{${labels}} ${safeP99}`,
    '# TYPE vitalink_endpoint_capacity_pass gauge',
    `vitalink_endpoint_capacity_pass{${labels}} ${pass}`,
    '',
  ].join('\n')
}

async function publishCompletedEndpoint(config, entry, result) {
  if (!config.pushgatewayUrl) return
  const endpointId = Buffer.from(entry.id, 'utf8').toString('base64url')
  const url = `${config.pushgatewayUrl}/metrics/job/vitalink_capacity/run_id/${encodeURIComponent(config.runId)}/endpoint_id@base64/${endpointId}`
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' },
    body: completedEndpointMetrics(config, entry, result),
  })
  if (!response.ok) {
    throw new Error(`Pushgateway rejected ${entry.id}: HTTP ${response.status}`)
  }
}

function thresholdFailures(summary) {
  const failures = []
  for (const [name, metric] of Object.entries(summary?.metrics || {})) {
    for (const [threshold, outcome] of Object.entries(metric?.thresholds || {})) {
      if (outcome?.ok !== true) failures.push(`${name}: ${threshold}`)
    }
  }
  return failures
}

function metricValue(summary, metric, key) {
  const value = summary?.metrics?.[metric]?.values?.[key]
  return Number.isFinite(Number(value)) ? Number(value) : null
}

async function targetReadinessError(config) {
  let lastError = 'target readiness was not checked'
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    try {
      const readinessUrl = new URL(`${config.target.input}/health/ready`)
      if (readinessUrl.hostname === 'host.docker.internal') readinessUrl.hostname = '127.0.0.1'
      const response = await fetch(readinessUrl, {
        headers: { 'user-agent': `VitaLink-Capacity-Controller/${config.runId}` },
        signal: AbortSignal.timeout(5_000),
      })
      if (response.status !== 200) {
        lastError = `target readiness returned HTTP ${response.status}`
      } else if (response.headers.get('x-load-test-environment-fingerprint') !== process.env.LOAD_TEST_ENV_FINGERPRINT) {
        return 'target readiness fingerprint changed'
      } else if (response.headers.get('x-load-test-run-id') !== config.runId) {
        return 'target readiness run ID changed'
      } else {
        return null
      }
    } catch (error) {
      lastError = `target readiness failed: ${error instanceof Error ? error.message : String(error)}`
    }
    if (attempt < 15) await new Promise(resolve => setTimeout(resolve, 1_000))
  }
  return `${lastError} after a 15-second recovery window`
}

function evaluateSummary({ summary, processResult, vus, variant, phase, durationSeconds }) {
  const failures = thresholdFailures(summary)
  const passed = processResult.code === 0 && failures.length === 0
  return {
    passed,
    vus,
    role: variant.role,
    tenantMode: variant.tenantMode,
    variantId: variant.id,
    phase,
    durationSeconds,
    achievedRps: metricValue(summary, 'load_request_attempts', 'rate') || 0,
    requestCount: metricValue(summary, 'load_request_attempts', 'count') || 0,
    errorRate: metricValue(summary, 'http_req_failed', 'rate'),
    checkRate: metricValue(summary, 'checks', 'rate'),
    p95Ms: metricValue(summary, 'load_request_duration', 'p(95)'),
    p99Ms: metricValue(summary, 'load_request_duration', 'p(99)'),
    droppedIterations: metricValue(summary, 'dropped_iterations', 'count') || 0,
    thresholdFailures: failures,
    processExitCode: processResult.code,
    error: passed ? null : (processResult.stderr.trim().slice(-2000) || `k6 exited ${processResult.code}`),
  }
}

function thresholdFor(entry) {
  const defaults = THRESHOLD_CLASSES[entry.thresholdClass] || THRESHOLD_CLASSES.authenticated_read
  return {
    p95: boundedNumber('CAPACITY_P95_MS', process.env.CAPACITY_P95_MS, defaults.p95, 1, 120000),
    p99: boundedNumber('CAPACITY_P99_MS', process.env.CAPACITY_P99_MS, defaults.p99, defaults.p95, 180000),
  }
}

async function runVariantStep({ config, entry, variant, vus, phase, attempt, checkpoint, checkpointFile }) {
  const cacheKey = `${entry.id}|${variant.id}|${phase}|${vus}|${attempt}`
  if (checkpoint.inFlight?.[cacheKey]) return checkpoint.inFlight[cacheKey]
  if (interrupted) throw new Error('Capacity run interrupted')
  const readinessBefore = await targetReadinessError(config)
  if (readinessBefore) throw new Error(`Refusing capacity step: ${readinessBefore}`)

  const endpointDirRelative = `${config.output.relative}/steps/${slug(entry.id)}`
  const endpointDir = path.join(backendRoot, endpointDirRelative)
  await fsp.mkdir(endpointDir, { recursive: true })
  const summaryName = `${phase}-vus-${vus}-attempt-${attempt}-${slug(variant.id)}.json`
  const summaryAbsolute = path.join(endpointDir, summaryName)
  const summaryContainer = `/work/${path.relative(backendRoot, summaryAbsolute).replaceAll('\\', '/')}`
  const thresholds = thresholdFor(entry)
  const durationSeconds = phase === 'warmup' ? config.warmupSeconds : config.durationSeconds
  const args = [
    'run', '--rm',
    '--add-host', 'host.docker.internal:host-gateway',
    '-v', `${backendRoot}:/work:ro`,
    '-v', `${endpointDir}:/capacity-output`,
    '-w', '/work',
    ...(config.prometheusRwUrl ? [
      '-e', `K6_PROMETHEUS_RW_SERVER_URL=${config.prometheusRwUrl}`,
      '-e', 'K6_PROMETHEUS_RW_TREND_STATS=p(50),p(90),p(95),p(99),min,max',
      '-e', 'K6_PROMETHEUS_RW_STALE_MARKERS=true',
    ] : []),
    K6_IMAGE,
    'run', '--no-color',
    '--summary-trend-stats', 'avg,min,med,max,p(90),p(95),p(99)',
    '-e', 'ALLOW_LOAD_TESTS=true',
    '-e', 'ALLOW_DESTRUCTIVE_LOAD=true',
    '-e', `LOAD_TEST_RUN_ID=${config.runId}`,
    '-e', 'LOAD_TEST_PROFILE=stress',
    '-e', `LOAD_TEST_VUS=${vus}`,
    '-e', `LOAD_TEST_RPS=${Math.min(vus, 250)}`,
    '-e', `LOAD_TEST_DURATION=${durationSeconds}s`,
    '-e', `LOAD_TEST_BASE_URL=${config.target.input}`,
    '-e', `LOAD_TEST_ALLOWED_HOSTS=${process.env.LOAD_TEST_ALLOWED_HOSTS}`,
    '-e', `LOAD_TEST_ENV_FINGERPRINT=${process.env.LOAD_TEST_ENV_FINGERPRINT}`,
    '-e', `LOAD_TEST_CONTEXT_FILE=${config.context.container}`,
    '-e', `LOAD_TEST_OPERATION_IDS=${entry.id}`,
    '-e', `LOAD_TEST_OPERATION_MODE=${entry.family === 'public' ? 'auto' : 'safe'}`,
    '-e', `CAPACITY_ROLE=${variant.role}`,
    '-e', `CAPACITY_VUS=${vus}`,
    '-e', `CAPACITY_DURATION_SECONDS=${durationSeconds}`,
    '-e', `CAPACITY_PHASE=${phase}`,
    '-e', `CAPACITY_ALLOWED_ERROR_RATE=${config.allowedErrorRate}`,
    '-e', `CAPACITY_P95_MS=${thresholds.p95}`,
    '-e', `CAPACITY_P99_MS=${thresholds.p99}`,
    '-e', `CAPACITY_THINK_TIME_MS=${config.thinkTimeMs}`,
    '-e', `CAPACITY_SUMMARY_FILE=/capacity-output/${summaryName}`,
    ...(config.prometheusRwUrl ? [
      '-o', 'experimental-prometheus-rw',
    ] : []),
    entry.runner,
  ]

  const processResult = await spawnCapture('docker', args, backendRoot)
  let summary = null
  try { summary = JSON.parse(await fsp.readFile(summaryAbsolute, 'utf8')) } catch (_) { /* captured below */ }
  let result = summary
    ? evaluateSummary({ summary, processResult, vus, variant, phase, durationSeconds })
    : {
        passed: false,
        vus,
        role: variant.role,
        tenantMode: variant.tenantMode,
        variantId: variant.id,
        phase,
        durationSeconds,
        achievedRps: 0,
        requestCount: 0,
        thresholdFailures: ['capacity summary missing'],
        processExitCode: processResult.code,
        error: processResult.stderr.trim().slice(-2000) || 'k6 did not write a summary',
      }
  const readinessAfter = await targetReadinessError(config)
  if (readinessAfter) {
    result = {
      ...result,
      passed: false,
      thresholdFailures: [...(result.thresholdFailures || []), readinessAfter],
      error: result.error || readinessAfter,
    }
  }
  checkpoint.inFlight ||= {}
  checkpoint.inFlight[cacheKey] = result
  checkpoint.updatedAt = new Date().toISOString()
  await writeAtomic(checkpointFile, checkpoint)
  return result
}

async function runEndpointStep(args) {
  const variantResults = []
  for (const variant of args.entry.variants) {
    variantResults.push(await runVariantStep({ ...args, variant }))
  }
  const achievedRps = variantResults.length ? Math.min(...variantResults.map(result => result.achievedRps)) : 0
  return {
    passed: variantResults.length > 0 && variantResults.every(result => result.passed),
    achievedRps,
    p95Ms: variantResults.length ? Math.max(...variantResults.map(result => Number(result.p95Ms || 0))) : null,
    p99Ms: variantResults.length ? Math.max(...variantResults.map(result => Number(result.p99Ms || 0))) : null,
    variantResults,
  }
}

async function writeReports(config, manifest, checkpoint) {
  const report = buildCapacityReport({
    run: {
      id: config.runId,
      targetHost: config.target?.hostname || 'plan-only',
      gitSha: config.gitSha,
      interrupted,
      checkpointFile: path.join(config.output.absolute, 'checkpoint.json'),
      metricsUrl: config.metricsUrl,
      dashboardUrl: config.dashboardUrl,
    },
    config: {
      model: 'closed_constant_vus',
      cap: config.cap,
      steps: config.steps,
      stepDurationSeconds: config.durationSeconds,
      warmupDurationSeconds: config.warmupSeconds,
      confirmations: config.confirmations,
      allowedErrorRate: config.allowedErrorRate,
      thinkTimeMs: config.thinkTimeMs,
      capacityAggregation: 'minimum_across_authorized_variants',
    },
    manifest,
    results: checkpoint.results || {},
  })
  await fsp.writeFile(path.join(config.output.absolute, 'capacity.json'), `${JSON.stringify(report, null, 2)}\n`)
  await fsp.writeFile(path.join(config.output.absolute, 'capacity.csv'), renderCsv(report))
  await fsp.writeFile(path.join(config.output.absolute, 'capacity.md'), renderMarkdown(report))
  await fsp.writeFile(path.join(config.output.absolute, 'capacity.html'), renderHtml(report))
  return report
}

async function main() {
  const config = configFromEnvironment()
  const inventory = JSON.parse(await fsp.readFile(path.join(backendRoot, 'load-tests', 'generated', 'endpoints.json'), 'utf8'))
  const manifest = buildCapacityManifest(inventory)
  const selected = manifest.filter(entry =>
    entry.eligible && (config.selectedIds.size === 0 || config.selectedIds.has(entry.id)))
  const unknown = [...config.selectedIds].filter(id => !manifest.some(entry => entry.id === id))
  if (unknown.length) throw new Error(`Unknown CAPACITY_ENDPOINT_IDS: ${unknown.join(', ')}`)
  const ineligibleRequested = [...config.selectedIds].filter(id => manifest.some(entry => entry.id === id && !entry.eligible))
  if (ineligibleRequested.length) {
    throw new Error(`Requested endpoints do not support valid capacity evidence: ${ineligibleRequested.join(', ')}`)
  }
  const boundedSelection = selected.slice(0, config.maxEndpoints)
  const selectedIds = boundedSelection.map(entry => entry.id)
  const fingerprint = configFingerprint(config, selectedIds)
  const checkpointFile = path.join(config.output.absolute, 'checkpoint.json')

  if (fs.existsSync(config.output.absolute) && !config.resume) {
    throw new Error(`Refusing to overwrite capacity output; use CAPACITY_RESUME=true: ${config.output.absolute}`)
  }
  await fsp.mkdir(config.output.absolute, { recursive: true })
  let checkpoint = {
    schemaVersion: 1,
    runId: config.runId,
    configFingerprint: fingerprint,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: config.execute ? 'running' : 'plan_only',
    fixtureFinalizationRequired: config.execute,
    fixtureFinalizationPerformedByController: false,
    manifestCounts: manifestCounts(manifest),
    selectedEndpointIds: selectedIds,
    completedEndpointIds: [],
    results: {},
    inFlight: {},
  }
  if (config.resume && fs.existsSync(checkpointFile)) {
    checkpoint = JSON.parse(await fsp.readFile(checkpointFile, 'utf8'))
    if (checkpoint.runId !== config.runId || checkpoint.configFingerprint !== fingerprint) {
      throw new Error('Checkpoint does not match this run/configuration; use a new output directory')
    }
    checkpoint.status = config.execute ? 'running' : checkpoint.status
  }
  await writeAtomic(checkpointFile, checkpoint)
  await fsp.writeFile(path.join(config.output.absolute, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    counts: manifestCounts(manifest),
    endpoints: manifest,
  }, null, 2)}\n`)

  if (!config.execute) {
    await writeReports(config, manifest, checkpoint)
    process.stdout.write(`Capacity plan written to ${config.output.absolute}\n`)
    return
  }

  try {
    for (const entry of boundedSelection) {
      if (checkpoint.completedEndpointIds.includes(entry.id)) continue
      process.stdout.write(`Capacity discovery: ${entry.id} (${entry.variants.map(item => item.id).join(', ')})\n`)
      const existingSamples = checkpoint.results[entry.id]?.samples || []
      const result = await discoverCapacity({
        cap: config.cap,
        steps: config.steps,
        confirmations: config.confirmations,
        maxRefinements: config.maxRefinements,
        warmupVus: 1,
        existingSamples,
        runStep: ({ vus, phase, attempt }) => runEndpointStep({
          config, entry, vus, phase, attempt, checkpoint, checkpointFile,
        }),
        onSample: async (_sample, samples) => {
          checkpoint.results[entry.id] = { status: 'in_progress', samples }
          checkpoint.updatedAt = new Date().toISOString()
          await writeAtomic(checkpointFile, checkpoint)
        },
      })
      checkpoint.results[entry.id] = result
      checkpoint.completedEndpointIds.push(entry.id)
      checkpoint.inFlight = Object.fromEntries(Object.entries(checkpoint.inFlight || {})
        .filter(([key]) => !key.startsWith(`${entry.id}|`)))
      checkpoint.updatedAt = new Date().toISOString()
      await writeAtomic(checkpointFile, checkpoint)
      await writeReports(config, manifest, checkpoint)
      await publishCompletedEndpoint(config, entry, result)
    }
    checkpoint.status = 'completed'
  } catch (error) {
    checkpoint.status = interrupted ? 'interrupted' : 'failed'
    checkpoint.error = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    checkpoint.updatedAt = new Date().toISOString()
    await writeAtomic(checkpointFile, checkpoint)
    await writeReports(config, manifest, checkpoint)
  }

  process.stdout.write(`Capacity report complete: ${path.join(config.output.absolute, 'capacity.html')}\n`)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    interrupted = true
    if (activeChild) activeChild.kill(signal)
  })
}

main().catch(error => {
  process.stderr.write(`Capacity discovery failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
