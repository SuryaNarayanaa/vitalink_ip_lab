/**
 * Lightweight in-process delivery counters for ops and tests.
 * Resetable for unit tests; not a substitute for Prometheus.
 */

export type DeliveryMetricName =
  | 'enqueued'
  | 'enqueue_failed'
  | 'duplicate_suppressed'
  | 'processed'
  | 'succeeded'
  | 'skipped'
  | 'retryable'
  | 'dead_letter'
  | 'stale_lease'
  | 'queue_publish'
  | 'queue_publish_failed'
  | 'recovery_claimed'

type MetricStore = Record<DeliveryMetricName, number>

const metrics: MetricStore = {
  enqueued: 0,
  enqueue_failed: 0,
  duplicate_suppressed: 0,
  processed: 0,
  succeeded: 0,
  skipped: 0,
  retryable: 0,
  dead_letter: 0,
  stale_lease: 0,
  queue_publish: 0,
  queue_publish_failed: 0,
  recovery_claimed: 0,
}

export function incrementDeliveryMetric(name: DeliveryMetricName, by = 1): void {
  metrics[name] = (metrics[name] ?? 0) + by
}

export function getDeliveryMetrics(): Readonly<MetricStore> {
  return { ...metrics }
}

export function resetDeliveryMetrics(): void {
  for (const key of Object.keys(metrics) as DeliveryMetricName[]) {
    metrics[key] = 0
  }
}
