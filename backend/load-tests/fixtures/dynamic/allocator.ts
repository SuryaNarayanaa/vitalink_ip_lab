import crypto from 'node:crypto'
import type { DynamicAllocation } from './types'

const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/
const SAFE_ENDPOINT_ID = /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \/[^\r\n]{1,240}$/

function positiveInteger(name: string, value: number, allowZero = false): void {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`${name} must be a ${allowZero ? 'non-negative' : 'positive'} safe integer`)
  }
}

export function allocateDynamicMutation(
  runId: string,
  endpointId: string,
  vuId: number,
  iteration: number,
  secret: string,
): DynamicAllocation {
  if (!SAFE_RUN_ID.test(runId)) throw new Error('Unsafe dynamic mutation run ID')
  if (!SAFE_ENDPOINT_ID.test(endpointId)) throw new Error('Unsafe or malformed endpoint ID')
  positiveInteger('vuId', vuId)
  positiveInteger('iteration', iteration, true)
  if (secret.length < 32) throw new Error('Dynamic mutation allocator secret must be at least 32 characters')

  const seed = `${runId}\0${endpointId}\0${vuId}\0${iteration}`
  const digest = crypto.createHmac('sha256', secret).update(seed).digest('hex')
  const requestSuffix = `v${vuId.toString(36)}i${iteration.toString(36)}_${digest.slice(0, 16)}`
  return Object.freeze({
    runId,
    endpointId,
    vuId,
    iteration,
    requestId: `mut_${digest.slice(0, 32)}`,
    requestSuffix,
    ownershipToken: `load:${runId}:${requestSuffix}`,
  })
}

export function leaseToken(allocation: DynamicAllocation, secret: string): string {
  if (secret.length < 32) throw new Error('Dynamic mutation allocator secret must be at least 32 characters')
  return crypto.createHmac('sha256', secret)
    .update(`${allocation.requestId}\0${allocation.ownershipToken}`)
    .digest('base64url')
}

export function verifyLeaseToken(allocation: DynamicAllocation, candidate: string, secret: string): boolean {
  const expected = Buffer.from(leaseToken(allocation, secret))
  const actual = Buffer.from(candidate)
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
}
