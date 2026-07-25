import type { NextFunction, Request, Response } from 'express'
import { monitorEventLoopDelay } from 'node:perf_hooks'

const DURATION_BUCKETS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
const durationBucketCounts = new Array<number>(DURATION_BUCKETS_SECONDS.length).fill(0)
const statusCounts = new Map<string, number>()
const startedAt = process.hrtime.bigint()
const startedCpu = process.cpuUsage()
const eventLoop = monitorEventLoopDelay({ resolution: 20 })

let activeRequests = 0
let peakActiveRequests = 0
let requestCount = 0
let durationSecondsSum = 0
let enabled = false

function exactTrue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function loadTestMetricsEnabled(): boolean {
  return process.env.NODE_ENV !== 'production'
    && exactTrue(process.env.LOAD_TEST_IDENTITY_ENABLED)
    && exactTrue(process.env.LOAD_TEST_METRICS_ENABLED)
    && Boolean(process.env.LOAD_TEST_RUN_ID?.trim())
}

export function initializeLoadTestMetrics(): void {
  if (!loadTestMetricsEnabled() || enabled) return
  eventLoop.enable()
  enabled = true
}

function incrementStatus(statusCode: number): void {
  const status = String(statusCode)
  statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1)
}

export function observeLoadTestRequest(req: Request, res: Response, next: NextFunction): void {
  if (!enabled || req.path === '/load-test/metrics') {
    next()
    return
  }

  const started = process.hrtime.bigint()
  activeRequests += 1
  peakActiveRequests = Math.max(peakActiveRequests, activeRequests)
  let recorded = false
  const record = () => {
    if (recorded) return
    recorded = true
    activeRequests = Math.max(0, activeRequests - 1)
    requestCount += 1
    incrementStatus(res.statusCode)
    const durationSeconds = Number(process.hrtime.bigint() - started) / 1_000_000_000
    durationSecondsSum += durationSeconds
    for (let index = 0; index < DURATION_BUCKETS_SECONDS.length; index += 1) {
      if (durationSeconds <= DURATION_BUCKETS_SECONDS[index]) durationBucketCounts[index] += 1
    }
  }
  res.once('finish', record)
  res.once('close', record)
  next()
}

function metric(name: string, type: string, help: string, samples: string[]): string[] {
  return [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} ${type}`,
    ...samples,
  ]
}

export function renderLoadTestMetrics(): string {
  if (!enabled) return ''
  const memory = process.memoryUsage()
  const cpu = process.cpuUsage(startedCpu)
  const uptimeSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000
  const eventLoopP95Seconds = Number(eventLoop.percentile(95)) / 1_000_000_000
  const eventLoopMaxSeconds = Number(eventLoop.max) / 1_000_000_000
  const lines: string[] = []

  lines.push(...metric('vitalink_load_active_requests', 'gauge', 'Requests currently active in this isolated API process.', [
    `vitalink_load_active_requests ${activeRequests}`,
  ]))
  lines.push(...metric('vitalink_load_peak_active_requests', 'gauge', 'Peak active requests since the process started.', [
    `vitalink_load_peak_active_requests ${peakActiveRequests}`,
  ]))
  lines.push(...metric('vitalink_load_http_requests_total', 'counter', 'Completed HTTP requests by response status.', [
    ...[...statusCounts.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([status, count]) => `vitalink_load_http_requests_total{status="${status}"} ${count}`),
  ]))
  lines.push(...metric('vitalink_load_http_request_duration_seconds', 'histogram', 'Observed server-side HTTP request duration.', [
    ...DURATION_BUCKETS_SECONDS.map((bucket, index) => (
      `vitalink_load_http_request_duration_seconds_bucket{le="${bucket}"} ${durationBucketCounts[index]}`
    )),
    `vitalink_load_http_request_duration_seconds_bucket{le="+Inf"} ${requestCount}`,
    `vitalink_load_http_request_duration_seconds_sum ${durationSecondsSum}`,
    `vitalink_load_http_request_duration_seconds_count ${requestCount}`,
  ]))
  lines.push(...metric('vitalink_load_process_cpu_seconds_total', 'counter', 'CPU time consumed by the isolated API process.', [
    `vitalink_load_process_cpu_seconds_total ${(cpu.user + cpu.system) / 1_000_000}`,
  ]))
  lines.push(...metric('vitalink_load_process_resident_memory_bytes', 'gauge', 'Resident memory used by the isolated API process.', [
    `vitalink_load_process_resident_memory_bytes ${memory.rss}`,
  ]))
  lines.push(...metric('vitalink_load_process_heap_used_bytes', 'gauge', 'V8 heap bytes used by the isolated API process.', [
    `vitalink_load_process_heap_used_bytes ${memory.heapUsed}`,
  ]))
  lines.push(...metric('vitalink_load_event_loop_delay_seconds', 'gauge', 'Node.js event-loop delay measured in the isolated API process.', [
    `vitalink_load_event_loop_delay_seconds{quantile="0.95"} ${eventLoopP95Seconds}`,
    `vitalink_load_event_loop_delay_seconds{quantile="max"} ${eventLoopMaxSeconds}`,
  ]))
  lines.push(...metric('vitalink_load_process_uptime_seconds', 'gauge', 'Isolated API process uptime.', [
    `vitalink_load_process_uptime_seconds ${uptimeSeconds}`,
  ]))
  lines.push(...metric('vitalink_load_process_active_handles', 'gauge', 'Active Node.js handles in the isolated API process.', [
    `vitalink_load_process_active_handles ${(process as any)._getActiveHandles?.().length ?? 0}`,
  ]))
  eventLoop.reset()
  return `${lines.join('\n')}\n`
}
