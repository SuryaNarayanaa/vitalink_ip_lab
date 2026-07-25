import { createProfileConfig } from '../../profiles/profile-config.js';
import { loadLegacyDescriptors, executeLegacyReachability } from './scenario.js';
import { verifyTargetIdentity } from '../../lib/preflight.js';

const TRUE = 'true';

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

function selectOperations(env, descriptors) {
  const requestedIds = operationIds(env);
  if (!requestedIds.length) return descriptors;
  const requested = new Set(requestedIds);
  const selected = descriptors.filter((operation) => requested.has(operation.id));
  const missing = requestedIds.filter((id) => !selected.some((operation) => operation.id === id));
  if (missing.length) throw new Error(`Unknown legacy operation IDs: ${missing.join(', ')}`);
  return selected;
}

const profileConfig = createProfileConfig({ scenarioName: 'legacy_reachability', exec: 'runProfile' });
if (profileConfig.guard.profile.name !== 'smoke') {
  throw new Error('Legacy reachability is a one-pass smoke only; LOAD_TEST_PROFILE must be smoke');
}
if (flag(__ENV, 'LOAD_TEST_PERMISSION_PROBES')) {
  throw new Error('Legacy reachability does not support permission probes');
}

function flag(env, name) {
  return String(env[name] || '').trim().toLowerCase() === TRUE;
}

const suppliedContext = parseContext(__ENV);
const descriptors = loadLegacyDescriptors();
const selected = Object.freeze(selectOperations(__ENV, descriptors));
if (!selected.length) throw new Error('No legacy operations selected');

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

/** Exactly one request per selected legacy operation; never a capacity loop. */
export function runProfile(context) {
  for (const operation of selected) executeLegacyReachability(operation, context);
}

export const handleSummary = profileConfig.handleSummary;
