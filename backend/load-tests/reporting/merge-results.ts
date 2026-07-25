import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

type InventoryEndpoint = {
  id: string
  method: string
  path: string
  scope?: string
  condition?: string
  kind?: string
}

type Inventory = {
  schemaVersion: number
  sourceDigest: string
  counts: { mandatoryExplicit: number }
  explicitEndpoints: InventoryEndpoint[]
  conditionalEndpoints: InventoryEndpoint[]
}

type EndpointStats = {
  attempts: number
  durations: number[]
  semanticTotal: number
  semanticPassed: number
  expectedTotal: number
  expectedPassed: number
  statuses: Record<string, number>
  responseBytes: number
  requestBytes: number
  evidenceClasses: Record<string, number>
  sse?: Record<string, number>
}

type Args = {
  inventory: string
  k6Json?: string | string[]
  sseJson?: string | string[]
  environment?: string
  cleanupJournal?: string
  output: string
  includeDocs: boolean
}

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>()
  const repeated = new Map<string, string[]>()
  const flags = new Set<string>()
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) throw new Error(`Unexpected argument: ${item}`)
    if (item === '--include-docs') {
      flags.add(item)
      continue
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${item}`)
    values.set(item, value)
    repeated.set(item, [...(repeated.get(item) ?? []), value])
    index += 1
  }
  return {
    inventory: values.get('--inventory') ?? path.resolve('load-tests/generated/endpoints.json'),
    k6Json: repeated.get('--k6-json'),
    sseJson: repeated.get('--sse-json'),
    environment: values.get('--environment'),
    cleanupJournal: values.get('--cleanup-journal'),
    output: values.get('--output') ?? path.resolve('load-tests/reports/latest'),
    includeDocs: flags.has('--include-docs'),
  }
}

function emptyStats(): EndpointStats {
  return {
    attempts: 0,
    durations: [],
    semanticTotal: 0,
    semanticPassed: 0,
    expectedTotal: 0,
    expectedPassed: 0,
    statuses: {},
    responseBytes: 0,
    requestBytes: 0,
    evidenceClasses: {},
  }
}

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

async function readK6Points(file: string, stats: Map<string, EndpointStats>, aliases: Map<string, string>, evidenceRunIds: Set<string>): Promise<void> {
  if (!fs.existsSync(file)) throw new Error(`k6 JSON output does not exist: ${file}`)
  const input = fs.createReadStream(file, 'utf8')
  const lines = readline.createInterface({ input, crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line.trim()) continue
    let point: any
    try {
      point = JSON.parse(line)
    } catch {
      throw new Error(`Invalid JSON line in k6 output: ${line.slice(0, 120)}`)
    }
    if (point?.type !== 'Point') continue
    const evidenceRunId = point?.data?.tags?.load_run_id
    if (evidenceRunId) evidenceRunIds.add(String(evidenceRunId))
    const rawEndpointId = point?.data?.tags?.endpoint_id
    const endpointId = aliases.get(String(rawEndpointId)) ?? rawEndpointId
    if (!endpointId || !stats.has(endpointId)) continue
    const row = stats.get(endpointId)!
    const value = finiteNumber(point?.data?.value)
    if (value === undefined) continue
    switch (point.metric) {
      case 'load_request_attempts': {
        row.attempts += value
        const evidenceClass = String(point?.data?.tags?.response_class ?? 'unknown')
        row.evidenceClasses[evidenceClass] = (row.evidenceClasses[evidenceClass] ?? 0) + value
        break
      }
      case 'load_request_duration': row.durations.push(value); break
      case 'load_semantic_success_rate':
        row.semanticTotal += 1
        row.semanticPassed += value > 0 ? 1 : 0
        break
      case 'load_expected_status_rate':
        row.expectedTotal += 1
        row.expectedPassed += value > 0 ? 1 : 0
        break
      case 'load_response_statuses': {
        const status = String(point?.data?.tags?.status ?? 'unknown')
        row.statuses[status] = (row.statuses[status] ?? 0) + value
        break
      }
      case 'load_response_bytes': row.responseBytes += value; break
      case 'load_request_bytes': row.requestBytes += value; break
      default: break
    }
  }
}

function numberList(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : []
}

function files(value?: string | string[]): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function recordSseAttempt(row: EndpointStats, status: number, passed: boolean, latencyMs?: number): void {
  row.attempts += 1
  row.evidenceClasses.protocol = (row.evidenceClasses.protocol ?? 0) + 1
  row.expectedTotal += 1
  row.expectedPassed += passed ? 1 : 0
  row.semanticTotal += 1
  row.semanticPassed += passed ? 1 : 0
  row.statuses[String(status)] = (row.statuses[String(status)] ?? 0) + 1
  if (Number.isFinite(latencyMs)) row.durations.push(Number(latencyMs))
}

function readSse(file: string, stats: Map<string, EndpointStats>, aliases: Map<string, string>, evidenceRunIds: Set<string>, protocolFailures: string[]): void {
  if (!fs.existsSync(file)) throw new Error(`SSE summary does not exist: ${file}`)
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (parsed?.runId) evidenceRunIds.add(String(parsed.runId))
  if (parsed?.verdict?.passed === false) protocolFailures.push(...(parsed.verdict.failures ?? ['SSE runner verdict failed']).map(String))
  const rows = Array.isArray(parsed) ? parsed : parsed.endpoints
  if (!Array.isArray(rows) && parsed?.results && typeof parsed.results === 'object') {
    for (const [role, roleResult] of Object.entries(parsed.results as Record<string, any>)) {
      const endpointId = role === 'doctor'
        ? 'GET /api/v1/doctors/notifications/stream'
        : role === 'patient' ? 'GET /api/v1/patient/notifications/stream' : undefined
      if (!endpointId || !stats.has(endpointId)) continue
      const row = stats.get(endpointId)!
      let disconnects = 0
      let reconnectFailures = 0
      let heartbeatTimeouts = 0
      const firstEvents: number[] = []
      for (const modeResult of Object.values((roleResult as any)?.modes ?? {}) as any[]) {
        const baseline = modeResult?.baseline ?? {}
        const baselinePassed = baseline.status === 200 && baseline.headersValid === true && Number(baseline.unexpectedDisconnects ?? 0) === 0
        recordSseAttempt(row, Number(baseline.status ?? 0), baselinePassed, finiteNumber(baseline.timeToHeadersMs))
        if (Number.isFinite(Number(baseline.timeToFirstEventMs))) firstEvents.push(Number(baseline.timeToFirstEventMs))
        disconnects += Number(baseline.unexpectedDisconnects ?? 0)
        if (parsed?.config?.requireHeartbeat === true && Number(baseline.heartbeatCount ?? 0) < 1) heartbeatTimeouts += 1

        const reconnect = modeResult?.reconnect
        if (reconnect) {
          recordSseAttempt(row, Number(reconnect.status ?? 0), reconnect.passed === true, finiteNumber(reconnect.timeToFirstEventMs))
          if (reconnect.passed !== true) reconnectFailures += 1
        }
        const replay = modeResult?.ticketReplay
        if (replay) recordSseAttempt(row, Number(replay.status ?? 0), replay.passed === true)
        if (modeResult?.trigger?.configured === true && (modeResult.trigger.error || !modeResult.trigger.expectedStatuses?.includes(modeResult.trigger.status))) {
          row.semanticTotal += 1
          protocolFailures.push(`${role} SSE trigger delivery failed`)
        }
      }
      const connectionCapFailed = (roleResult as any)?.connectionCap && (roleResult as any).connectionCap.passed !== true ? 1 : 0
      if (connectionCapFailed) protocolFailures.push(`${role} SSE connection cap failed`)
      row.sse = {
        timeToFirstEventP95Ms: percentile(firstEvents, 95),
        eventDeliveryP95Ms: 0,
        disconnects,
        reconnectFailures,
        heartbeatTimeouts,
        connectionCapFailures: connectionCapFailed,
      }
    }
    return
  }
  if (!Array.isArray(rows)) throw new Error('SSE summary must contain an endpoints array or the guarded SSE runner result shape')
  for (const result of rows) {
    const endpointId = aliases.get(String(result?.endpointId)) ?? result?.endpointId
    if (!endpointId || !stats.has(endpointId)) continue
    const row = stats.get(endpointId)!
    const attempts = finiteNumber(result.attempts) ?? 0
    row.attempts += attempts
    row.expectedTotal += attempts
    row.expectedPassed += finiteNumber(result.successes) ?? 0
    row.semanticTotal += attempts
    row.semanticPassed += finiteNumber(result.successes) ?? 0
    row.durations.push(...numberList(result.connectionLatenciesMs))
    row.sse = {
      timeToFirstEventP95Ms: percentile(numberList(result.firstEventLatenciesMs), 95),
      eventDeliveryP95Ms: percentile(numberList(result.eventLatenciesMs), 95),
      disconnects: finiteNumber(result.unexpectedDisconnects) ?? 0,
      reconnectFailures: finiteNumber(result.reconnectFailures) ?? 0,
      heartbeatTimeouts: finiteNumber(result.heartbeatTimeouts) ?? 0,
    }
  }
}

function percentile(values: number[], value: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const rank = Math.ceil((value / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))]
}

function latency(values: number[]) {
  if (!values.length) return { p50: 0, p90: 0, p95: 0, p99: 0, max: 0 }
  return {
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max: Math.max(...values),
  }
}

function rate(passed: number, total: number): number | null {
  return total ? passed / total : null
}

function escapeCsv(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]!))
}

function readOptionalJson(file?: string): unknown {
  return file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined
}

function safeEnvironmentMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const allowed = ['name', 'fingerprint', 'gitSha', 'applicationVersion', 'region']
  return Object.fromEntries(allowed.filter(key => source[key] !== undefined).map(key => [key, source[key]]))
}

function metricEndpointId(endpoint: InventoryEndpoint): string {
  const route = endpoint.path
    .split('?')[0]
    .replace(/\{([^}]+)\}/g, ':$1')
    .replace(/^\//, '')
    .replace(/:([a-zA-Z0-9_]+)/g, 'by_$1')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
  return `${endpoint.method.toLowerCase()}_${route || 'root'}`
}

export async function mergeResults(args: Args): Promise<any> {
  const inventory = JSON.parse(fs.readFileSync(args.inventory, 'utf8')) as Inventory
  const requiredEndpoints = [
    ...inventory.explicitEndpoints,
    ...(args.includeDocs ? inventory.conditionalEndpoints : []),
  ]
  const stats = new Map(requiredEndpoints.map(endpoint => [endpoint.id, emptyStats()]))
  const aliases = new Map<string, string>()
  const evidenceRunIds = new Set<string>()
  const protocolFailures: string[] = []
  requiredEndpoints.forEach(endpoint => {
    aliases.set(endpoint.id, endpoint.id)
    aliases.set(metricEndpointId(endpoint), endpoint.id)
  })
  for (const file of files(args.k6Json)) await readK6Points(file, stats, aliases, evidenceRunIds)
  for (const file of files(args.sseJson)) readSse(file, stats, aliases, evidenceRunIds, protocolFailures)

  const endpoints = requiredEndpoints.map(endpoint => {
    const row = stats.get(endpoint.id)!
    const semanticRate = rate(row.semanticPassed, row.semanticTotal)
    const expectedStatusRate = rate(row.expectedPassed, row.expectedTotal)
    const failed = row.attempts > 0 && (semanticRate !== 1 || expectedStatusRate !== 1 || (row.sse?.disconnects ?? 0) > 0 || (row.sse?.reconnectFailures ?? 0) > 0 || (row.sse?.heartbeatTimeouts ?? 0) > 0 || (row.sse?.connectionCapFailures ?? 0) > 0)
    return {
      id: endpoint.id,
      method: endpoint.method,
      path: endpoint.path,
      scope: endpoint.scope ?? 'conditional',
      condition: endpoint.condition,
      attempts: row.attempts,
      status: row.attempts === 0 ? 'missing' : failed ? 'failed' : 'passed',
      semanticSuccessRate: semanticRate,
      expectedStatusRate,
      responseStatuses: row.statuses,
      latencyMs: latency(row.durations),
      requestBytes: row.requestBytes,
      responseBytes: row.responseBytes,
      evidenceClasses: row.evidenceClasses,
      sse: row.sse,
    }
  })

  const missing = endpoints.filter(row => row.status === 'missing').map(row => row.id)
  const failed = endpoints.filter(row => row.status === 'failed').map(row => row.id)
  const rejectionOnly = endpoints.filter(row => row.attempts > 0 && Object.keys(row.evidenceClasses).every(key => key === 'expected_rejection')).map(row => row.id)
  const cleanup = readOptionalJson(args.cleanupJournal) as any
  const cleanupClean = cleanup?.state === 'clean'
  const identityMatches = evidenceRunIds.size === 1 && Boolean(cleanup?.runId) && evidenceRunIds.has(String(cleanup.runId))
  const hasInputs = files(args.k6Json).length > 0 || files(args.sseJson).length > 0
  const status = !hasInputs || missing.length || !cleanupClean || !identityMatches
    ? 'incomplete'
    : failed.length || protocolFailures.length ? 'failed' : 'passed'
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status,
    inventory: { sourceDigest: inventory.sourceDigest, mandatoryExplicit: inventory.counts.mandatoryExplicit },
    evidence: { runIds: [...evidenceRunIds].sort(), identityMatches, protocolFailures: [...new Set(protocolFailures)] },
    environment: safeEnvironmentMetadata(readOptionalJson(args.environment)),
    cleanup: cleanup ? { state: cleanup.state, runId: cleanup.runId } : { state: 'missing' },
    coverage: {
      required: endpoints.length,
      attempted: endpoints.length - missing.length,
      missing,
      failed,
      rejectionOnly,
    },
    endpoints,
  }
  fs.mkdirSync(args.output, { recursive: true })
  fs.writeFileSync(path.join(args.output, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`)
  fs.writeFileSync(path.join(args.output, 'endpoints.csv'), renderCsv(endpoints))
  fs.writeFileSync(path.join(args.output, 'report.md'), renderMarkdown(report))
  fs.writeFileSync(path.join(args.output, 'report.html'), renderHtml(report))
  return report
}

function renderCsv(rows: any[]): string {
  const headers = ['id', 'method', 'path', 'scope', 'attempts', 'status', 'evidenceClasses', 'semanticSuccessRate', 'expectedStatusRate', 'p50Ms', 'p90Ms', 'p95Ms', 'p99Ms', 'maxMs', 'responseStatuses', 'requestBytes', 'responseBytes']
  const body = rows.map(row => [
    row.id, row.method, row.path, row.scope, row.attempts, row.status, row.evidenceClasses,
    row.semanticSuccessRate, row.expectedStatusRate,
    row.latencyMs.p50, row.latencyMs.p90, row.latencyMs.p95, row.latencyMs.p99, row.latencyMs.max,
    row.responseStatuses, row.requestBytes, row.responseBytes,
  ].map(escapeCsv).join(','))
  return `${headers.join(',')}\n${body.join('\n')}\n`
}

function renderMarkdown(report: any): string {
  const lines = [
    '# VitaLink full-system stress-test report', '',
    `- Result: **${report.status}**`,
    `- Coverage: **${report.coverage.attempted}/${report.coverage.required}**`,
    `- Cleanup: **${report.cleanup.state}**`,
    `- Rejection-only operations: **${report.coverage.rejectionOnly.length}**`,
    `- Inventory: \`${report.inventory.sourceDigest}\``, '',
    '| Endpoint | Attempts | Evidence | Result | p50 | p95 | p99 | Statuses |',
    '|---|---:|---|---|---:|---:|---:|---|',
  ]
  for (const row of report.endpoints) {
    lines.push(`| \`${row.id.replace(/\|/g, '\\|')}\` | ${row.attempts} | \`${JSON.stringify(row.evidenceClasses)}\` | ${row.status} | ${row.latencyMs.p50.toFixed(2)} | ${row.latencyMs.p95.toFixed(2)} | ${row.latencyMs.p99.toFixed(2)} | \`${JSON.stringify(row.responseStatuses)}\` |`)
  }
  lines.push('', '## Missing operations', '', ...(report.coverage.missing.length ? report.coverage.missing.map((id: string) => `- \`${id}\``) : ['None.']), '')
  return lines.join('\n')
}

function renderHtml(report: any): string {
  const rows = report.endpoints.map((row: any) => `<tr><td><code>${escapeHtml(row.id)}</code></td><td>${row.attempts}</td><td><code>${escapeHtml(JSON.stringify(row.evidenceClasses))}</code></td><td>${escapeHtml(row.status)}</td><td>${row.latencyMs.p50.toFixed(2)}</td><td>${row.latencyMs.p95.toFixed(2)}</td><td>${row.latencyMs.p99.toFixed(2)}</td><td><code>${escapeHtml(JSON.stringify(row.responseStatuses))}</code></td></tr>`).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VitaLink load-test report</title><style>body{font-family:system-ui,sans-serif;margin:2rem;color:#17202a}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ddd;padding:.45rem;text-align:left}th{position:sticky;top:0;background:#fff}code{overflow-wrap:anywhere}.passed{color:#176b32}.failed,.incomplete{color:#a12020}</style></head><body><h1>VitaLink full-system stress-test report</h1><p class="${escapeHtml(report.status)}">Result: <strong>${escapeHtml(report.status)}</strong></p><p>Coverage: ${report.coverage.attempted}/${report.coverage.required}; rejection-only: ${report.coverage.rejectionOnly.length}; cleanup: ${escapeHtml(report.cleanup.state)}</p><table><thead><tr><th>Endpoint</th><th>Attempts</th><th>Evidence</th><th>Result</th><th>p50 ms</th><th>p95 ms</th><th>p99 ms</th><th>Statuses</th></tr></thead><tbody>${rows}</tbody></table></body></html>\n`
}

if (require.main === module) {
  mergeResults(parseArgs(process.argv.slice(2))).then(report => {
    process.stdout.write(`${JSON.stringify({ status: report.status, coverage: report.coverage }, null, 2)}\n`)
    if (report.status !== 'passed') process.exitCode = 2
  }).catch(error => {
    process.stderr.write(`Report merge failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
