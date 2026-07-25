import { createProfileConfig } from '../../profiles/profile-config.js';
import execution from 'k6/execution';
import { ADMIN_PLATFORM_OPERATIONS, assertAdminPlatformCoverage } from './descriptors.js';
import { executeAdminPlatformOperation, runAdminPermissionProbe } from './scenario.js';
import { verifyTargetIdentity } from '../../lib/preflight.js';

const TRUE = 'true';
const INVENTORY_PATH = '../../generated/endpoints.json';
const inventory = JSON.parse(open(INVENTORY_PATH));

function flag(env, name) {
  return String(env[name] || '').trim().toLowerCase() === TRUE;
}

function parseContext(env) {
  let source;
  if (String(env.LOAD_TEST_CONTEXT_FILE || '').trim()) {
    source = open(String(env.LOAD_TEST_CONTEXT_FILE).trim());
  } else if (String(env.LOAD_TEST_CONTEXT_JSON || '').trim()) {
    source = env.LOAD_TEST_CONTEXT_JSON;
  } else {
    throw new Error('LOAD_TEST_CONTEXT_FILE or LOAD_TEST_CONTEXT_JSON is required');
  }

  let context;
  try {
    context = JSON.parse(source);
  } catch (_) {
    throw new Error('The supplied load-test context must contain valid JSON');
  }
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    throw new Error('The supplied load-test context must be a JSON object');
  }
  return context;
}

function operationIds(env) {
  const raw = String(env.LOAD_TEST_OPERATION_IDS || '').trim();
  if (!raw) return [];
  const ids = raw.split(',').map((value) => value.trim()).filter(Boolean);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) throw new Error(`Duplicate LOAD_TEST_OPERATION_IDS: ${duplicates.join(', ')}`);
  return ids;
}

function selectOperations(env) {
  const requestedIds = operationIds(env);
  const operationMode = String(env.LOAD_TEST_OPERATION_MODE || 'safe').trim().toLowerCase();
  if (!['safe', 'contract'].includes(operationMode)) throw new Error('LOAD_TEST_OPERATION_MODE must be safe or contract');
  if (operationMode === 'contract' && profileConfig.guard.profile.name !== 'smoke') {
    throw new Error('Admin/platform contract mode is smoke-only');
  }
  const validMutations = flag(env, 'LOAD_TEST_VALID_MUTATIONS');
  if (validMutations) {
    throw new Error('Valid admin/platform mutations are disabled until the durable dynamic cleanup ledger is implemented');
  }
  if (!requestedIds.length) {
    return operationMode === 'contract' ? ADMIN_PLATFORM_OPERATIONS : ADMIN_PLATFORM_OPERATIONS.filter((operation) => operation.destructive !== true);
  }

  const requested = new Set(requestedIds);
  const selected = ADMIN_PLATFORM_OPERATIONS.filter((operation) => requested.has(operation.id));
  const missing = requestedIds.filter((id) => !selected.some((operation) => operation.id === id));
  if (missing.length) throw new Error(`Unknown admin/platform operation IDs: ${missing.join(', ')}`);

  const destructive = selected.filter((operation) => operation.destructive === true).map((operation) => operation.id);
  if (destructive.length && operationMode !== 'contract') {
    throw new Error(`Destructive admin/platform operations require smoke contract mode for safe rejection coverage: ${destructive.join(', ')}`);
  }
  return selected;
}

const profileConfig = createProfileConfig({ scenarioName: 'admin_platform', exec: 'runProfile' });
const suppliedContext = parseContext(__ENV);
const selected = Object.freeze(selectOperations(__ENV));
const permissionProbes = flag(__ENV, 'LOAD_TEST_PERMISSION_PROBES');
const contractMode = String(__ENV.LOAD_TEST_OPERATION_MODE || 'safe').trim().toLowerCase() === 'contract';
const tenantProbes = flag(__ENV, 'LOAD_TEST_TENANT_PROBES') || contractMode;

assertAdminPlatformCoverage(inventory);
if (!selected.length) throw new Error('No admin/platform operations selected');

export const options = {
  ...profileConfig.options,
  discardResponseBodies: false,
};

export function setup() {
  verifyTargetIdentity(profileConfig.guard);
  if (suppliedContext.baseUrl && String(suppliedContext.baseUrl).replace(/\/$/, '') !== profileConfig.guard.baseUrl) {
    throw new Error('Context baseUrl does not match guarded LOAD_TEST_BASE_URL');
  }
  if (suppliedContext.runId && suppliedContext.runId !== profileConfig.guard.runId) {
    throw new Error('Context runId does not match guarded LOAD_TEST_RUN_ID');
  }
  return {
    ...suppliedContext,
    baseUrl: profileConfig.guard.baseUrl,
    runId: profileConfig.guard.runId,
  };
}

function runPermissionProbes(context, operation) {
  if (!permissionProbes) return;
  const operationIndex = ADMIN_PLATFORM_OPERATIONS.findIndex((candidate) => candidate.id === operation.id);
  const deniedCount = operation.permissionCases.filter((entry) => entry.expectation === 'permission-denied').length;
  for (let probeIndex = 0; probeIndex < deniedCount; probeIndex += 1) {
    runAdminPermissionProbe(context, operationIndex, probeIndex);
  }
}

function runTenantProbe(context, operation) {
  if (!tenantProbes || !operation.semanticChecks.includes('tenant-scoped')) return;
  const allowed = operation.permissionCases.find((entry) => entry.role === 'hospitalAdmin' && entry.expectation === 'allowed');
  if (!allowed) return;
  executeAdminPlatformOperation(operation, context, {
    role: 'hospitalAdmin',
    expectedStatuses: allowed.expectedStatuses,
    scenario: 'admin_tenant_probe',
    safetyKind: 'tenant',
  });
}

export function runProfile(context) {
  if (profileConfig.guard.profile.name === 'smoke') {
    for (const operation of selected) {
      executeAdminPlatformOperation(operation, context, {
        expectedRejection: contractMode && operation.destructive,
      });
      if (!(contractMode && operation.destructive)) runPermissionProbes(context, operation);
      if (!(contractMode && operation.destructive)) runTenantProbe(context, operation);
    }
    return;
  }

  const index = Number(execution.scenario.iterationInTest || 0) % selected.length;
  const operation = selected[index];
  executeAdminPlatformOperation(operation, context);
  runPermissionProbes(context, operation);
}

export const handleSummary = profileConfig.handleSummary;
