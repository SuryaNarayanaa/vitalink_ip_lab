import http from 'k6/http'
import encoding from 'k6/encoding'
import execution from 'k6/execution'
import { loadGuardConfigFromEnv } from '../../lib/guards.js'
import { loadJsonRequest, loadRequest } from '../../lib/client.js'
import { createProfileConfig } from '../../profiles/profile-config.js'
import { verifyTargetIdentity } from '../../lib/preflight.js'
import { CLINICAL_OPERATIONS, assertClinicalCoverage } from './descriptors.js'

const profileConfig = createProfileConfig({ scenarioName: 'clinical_contract', exec: 'runProfile' })
export const options = profileConfig.options
export const handleSummary = profileConfig.handleSummary

function parseJson(name, value) {
  if (!value) throw new Error(`${name} is required`)
  try { return JSON.parse(value) } catch (_) { throw new Error(`${name} must contain valid JSON`) }
}

const contextFile = String(__ENV.LOAD_TEST_CONTEXT_FILE || '').trim()
let contextFromFile = null
if (contextFile) {
  try { contextFromFile = JSON.parse(open(contextFile)) }
  catch (_) { throw new Error('LOAD_TEST_CONTEXT_FILE must reference valid JSON readable by k6') }
}

function roleContext(context, role) {
  const override = context && context[role] && typeof context[role] === 'object' ? context[role] : {}
  return {
    ...context,
    ...override,
    tokens: { ...(context.tokens || {}), ...(override.tokens || {}) },
    ids: { ...(context.ids || {}), ...(override.ids || {}) },
    payloads: { ...(context.payloads || {}), ...(override.payloads || {}) },
    files: { ...(context.files || {}), ...(override.files || {}) },
  }
}

function nested(context, path) {
  return path.split('.').reduce((current, key) => current && current[key], context)
}

function fixtureFile(value, fallbackName, fallbackType) {
  if (!value) return value
  if (typeof value === 'object' && value.data !== undefined && !value.base64) return value
  const definition = typeof value === 'string' ? { base64: value } : value
  if (!definition.base64) throw new Error(`${fallbackName} needs base64 data`)
  const bytes = encoding.b64decode(definition.base64, 'std')
  return http.file(bytes, definition.filename || fallbackName, definition.contentType || fallbackType)
}

function materializeFiles(context) {
  return {
    ...context,
    files: {
      ...(context.files || {}),
      profilePicture: fixtureFile(context.files && context.files.profilePicture, 'profile.png', 'image/png'),
      report: fixtureFile(context.files && context.files.report, 'report.pdf', 'application/pdf'),
    },
  }
}

export function loadClinicalContext(env = __ENV) {
  const guarded = loadGuardConfigFromEnv(env)
  const supplied = contextFromFile || parseJson('LOAD_TEST_CONTEXT_JSON', env.LOAD_TEST_CONTEXT_JSON)
  if (supplied.baseUrl && String(supplied.baseUrl).replace(/\/$/, '') !== guarded.baseUrl) {
    throw new Error('Context baseUrl does not match guarded LOAD_TEST_BASE_URL')
  }
  if (supplied.runId && supplied.runId !== guarded.runId) {
    throw new Error('Context runId does not match guarded LOAD_TEST_RUN_ID')
  }
  return materializeFiles({ ...supplied, baseUrl: guarded.baseUrl, runId: guarded.runId })
}

function selectedOperations(env = __ENV) {
  const role = String(env.LOAD_TEST_ROLE || 'all').toLowerCase()
  if (!['all', 'doctor', 'patient'].includes(role)) throw new Error('LOAD_TEST_ROLE must be all, doctor, or patient')
  const requestedIds = String(env.LOAD_TEST_OPERATION_IDS || '').split(',').map(value => value.trim()).filter(Boolean)
  const requested = new Set(requestedIds)
  const operationMode = String(env.LOAD_TEST_OPERATION_MODE || 'safe').trim().toLowerCase()
  if (!['safe', 'contract'].includes(operationMode)) throw new Error('LOAD_TEST_OPERATION_MODE must be safe or contract')
  if (operationMode === 'contract' && profileConfig.guard.profile.name !== 'smoke') {
    throw new Error('Clinical contract mode is smoke-only')
  }
  const allowMutations = String(env.LOAD_TEST_VALID_MUTATIONS || '').toLowerCase() === 'true'
  if (allowMutations) throw new Error('Valid clinical mutations are disabled until the durable dynamic cleanup ledger is implemented')
  const operations = CLINICAL_OPERATIONS.filter(operation =>
    operation.protocol !== 'sse' &&
    (role === 'all' || operation.role === role) &&
    (requested.size === 0 || requested.has(operation.id)) &&
    (operationMode === 'contract' || !operation.destructive))
  if (requested.size) {
    const blocked = CLINICAL_OPERATIONS.filter(operation => requested.has(operation.id) && operation.destructive && operationMode !== 'contract')
    if (blocked.length) throw new Error(`Clinical mutations require smoke contract mode for safe rejection coverage: ${blocked.map(item => item.id).join(', ')}`)
    const missing = [...requested].filter(id => !operations.some(operation => operation.id === id))
    if (missing.length) throw new Error(`Unknown or non-HTTP clinical operation IDs: ${missing.join(', ')}`)
  }
  // Reassignment changes ownership and must be the final doctor mutation in a
  // full contract pass. Individual baselines remain selectable by ID.
  return operations.sort((left, right) => Number(left.id.includes('/reassign')) - Number(right.id.includes('/reassign')))
}

function rejectionEnvelope(response) {
  try {
    const body = response.json()
    return [401, 403].includes(response.status)
      && body
      && body.success === false
      && (body.statusCode === undefined || Number(body.statusCode) === response.status)
  } catch (_) {
    return false
  }
}

function crossTenantRejectionEnvelope(response) {
  try {
    const body = response.json()
    return [403, 404].includes(response.status) && body && body.success === false
  } catch (_) {
    return false
  }
}

function tenantMarkerCheck(context) {
  return {
    name: 'tenant response excludes other-tenant fixture markers',
    validate: response => {
      const markers = Array.isArray(context.crossTenantMarkers) ? context.crossTenantMarkers : []
      return markers.every(marker => !String(response.body || '').includes(String(marker)))
    },
  }
}

export function runClinicalOperation(operation, suppliedContext, options = {}) {
  if (operation.protocol === 'sse') throw new Error(`${operation.id} must be run by load-tests/sse/runner.mjs`)
  const context = roleContext(suppliedContext, operation.role)
  const expectedRejection = options.mode === 'expected_rejection'
  const crossTenantRejection = options.mode === 'cross_tenant_rejection'
  const requiredFixtures = expectedRejection ? operation.fixtureKeys.filter(key => key.startsWith('ids.')) : operation.fixtureKeys
  const missing = requiredFixtures.filter(key => nested(context, key) === undefined || nested(context, key) === null || nested(context, key) === '')
  if (missing.length) throw new Error(`${operation.id} missing fixtures: ${missing.join(', ')}`)
  const request = {
    method: operation.method,
    baseUrl: context.baseUrl,
    path: operation.buildPath(context),
    routeTemplate: operation.pathTemplate,
    runId: context.runId,
    token: expectedRejection ? undefined : context.tokens[operation.role],
    expectedStatuses: expectedRejection ? [401, 403] : crossTenantRejection ? [403, 404] : operation.expectedStatuses,
    body: expectedRejection || crossTenantRejection ? undefined : operation.buildBody ? operation.buildBody(context) : undefined,
    semanticChecks: expectedRejection
      ? [{ name: 'authentication rejection envelope', validate: rejectionEnvelope }]
      : crossTenantRejection
        ? [{ name: 'cross-tenant access is rejected', validate: crossTenantRejectionEnvelope }]
        : [...operation.semanticChecks, tenantMarkerCheck(context)],
    contentType: 'application/json',
    tags: {
      route_family: operation.role,
      routeFamily: operation.role,
      scenario: 'clinical_contract',
      role: expectedRejection ? 'anonymous' : operation.role,
      tenantMode: crossTenantRejection ? 'cross_tenant' : 'hospital',
      responseClass: expectedRejection || crossTenantRejection ? 'expected_rejection' : 'expected',
      dependencyMode: 'normal',
      thresholdClass: operation.transport === 'multipart' ? 'upload' : operation.destructive ? 'clinical_write' : 'authenticated_read',
    },
    safetyKind: crossTenantRejection ? 'tenant' : undefined,
  }
  return operation.transport === 'multipart'
    ? loadRequest({ ...request, json: false })
    : loadJsonRequest(request)
}

export function runDoctorOperation(id, context) {
  const operation = CLINICAL_OPERATIONS.find(item => item.role === 'doctor' && item.id === id)
  if (!operation) throw new Error(`Unknown doctor operation: ${id}`)
  return runClinicalOperation(operation, context)
}

export function runPatientOperation(id, context) {
  const operation = CLINICAL_OPERATIONS.find(item => item.role === 'patient' && item.id === id)
  if (!operation) throw new Error(`Unknown patient operation: ${id}`)
  return runClinicalOperation(operation, context)
}

export function setup() {
  verifyTargetIdentity(profileConfig.guard)
  return loadClinicalContext(__ENV)
}

export function runProfile(setupContext) {
  assertClinicalCoverage()
  const context = setupContext || loadClinicalContext(__ENV)
  const operations = selectedOperations(__ENV)
  const contractMode = String(__ENV.LOAD_TEST_OPERATION_MODE || 'safe').trim().toLowerCase() === 'contract'
  if (profileConfig.guard.profile.name === 'smoke') {
    for (const operation of operations) {
      runClinicalOperation(operation, context, {
        mode: contractMode && operation.destructive ? 'expected_rejection' : 'valid',
      })
      if (contractMode && operation.role === 'doctor' && !operation.destructive && operation.pathTemplate.includes('{op_num}')) {
        runClinicalOperation(operation, {
          ...context,
          doctor: {
            ...(context.doctor || {}),
            ids: {
              ...((context.doctor && context.doctor.ids) || {}),
              patientOpNum: context.ids.patientOtherTenantOpNum,
              reportId: context.ids.patientOtherTenantReportId,
            },
          },
        }, { mode: 'cross_tenant_rejection' })
      }
    }
    return
  }
  const operation = operations[Number(execution.scenario.iterationInTest || 0) % operations.length]
  runClinicalOperation(operation, context)
}

export default runProfile
