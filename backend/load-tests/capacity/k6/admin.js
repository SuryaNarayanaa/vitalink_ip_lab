import { loadGuardConfigFromEnv } from '../../lib/guards.js'
import { verifyTargetIdentity } from '../../lib/preflight.js'
import { ADMIN_PLATFORM_OPERATIONS } from '../../scenarios/admin-platform/descriptors.js'
import { executeAdminPlatformOperation } from '../../scenarios/admin-platform/scenario.js'
import { capacityOptions, executeCapacityIteration, capacityHandleSummary } from './common.js'

function parseContext() {
  const contextFile = String(__ENV.LOAD_TEST_CONTEXT_FILE || '').trim()
  const raw = contextFile ? open(contextFile) : String(__ENV.LOAD_TEST_CONTEXT_JSON || '')
  if (!raw) throw new Error('LOAD_TEST_CONTEXT_FILE or LOAD_TEST_CONTEXT_JSON is required')
  try { return JSON.parse(raw) } catch (_) { throw new Error('The supplied capacity context must contain valid JSON') }
}

const guard = loadGuardConfigFromEnv()
const suppliedContext = parseContext()
const operationId = String(__ENV.LOAD_TEST_OPERATION_IDS || '').trim()
const operation = ADMIN_PLATFORM_OPERATIONS.find(candidate => candidate.id === operationId)
if (!operation) throw new Error(`Unknown admin capacity operation: ${operationId}`)
if (operation.destructive) throw new Error(`Valid mutation capacity is disabled: ${operationId}`)
const role = String(__ENV.CAPACITY_ROLE || operation.role || 'appAdmin').trim()
const permissionCase = operation.permissionCases.find(candidate =>
  candidate.role === role && candidate.expectation === 'allowed')
if (!permissionCase) throw new Error(`${role} is not an authorized capacity variant for ${operationId}`)

export const options = capacityOptions
export const handleSummary = capacityHandleSummary
export function setup() {
  verifyTargetIdentity(guard)
  if (suppliedContext.runId && suppliedContext.runId !== guard.runId) {
    throw new Error('Context runId does not match guarded LOAD_TEST_RUN_ID')
  }
  return { ...suppliedContext, baseUrl: guard.baseUrl, runId: guard.runId }
}
export default function capacityAdmin(context) {
  executeCapacityIteration(() => executeAdminPlatformOperation(operation, context, {
    role,
    expectedStatuses: permissionCase.expectedStatuses,
    scenario: 'admin_endpoint_capacity',
  }), context)
}
