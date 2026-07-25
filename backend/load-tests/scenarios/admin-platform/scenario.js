import { jsonBody } from '../../lib/checks.js';
import { loadJsonRequest } from '../../lib/client.js';
import { ADMIN_PLATFORM_OPERATIONS } from './descriptors.js';
import { signPaymentWebhook } from './webhook-signing.js';

function tokenForRole(context, role) {
  if (role === 'none') return undefined;
  const token = context && context.tokens ? context.tokens[role] : undefined;
  if (!token) throw new Error(`Admin/platform scenario requires context.tokens.${role}`);
  return token;
}

function endpointTag(id) {
  return id.toLowerCase()
    .replace(/[{}]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
}

function responseData(response) {
  const envelope = jsonBody(response);
  return envelope && typeof envelope === 'object' ? envelope.data : undefined;
}

function semanticValidator(name, context) {
  if (name === 'api-envelope') return (response) => {
    const body = jsonBody(response);
    return Boolean(body && typeof body === 'object' && typeof body.success === 'boolean' && Number(body.statusCode) === response.status);
  };
  if (name === 'error-envelope') return (response) => {
    const body = jsonBody(response);
    return Boolean(body && typeof body === 'object' && body.success === false && response.status >= 400 && response.status < 500);
  };
  if (name === 'failure-envelope') return (response) => {
    const body = jsonBody(response);
    return Boolean(body && typeof body === 'object' && body.success === false && response.status >= 400 && response.status < 600);
  };
  if (name === 'success-true') return (response) => jsonBody(response)?.success === true;
  if (name === 'data-present') return (response) => responseData(response) !== undefined && responseData(response) !== null;
  if (name === 'data.roles-object') return (response) => {
    const roles = responseData(response)?.roles;
    return Boolean(roles && typeof roles === 'object' && !Array.isArray(roles));
  };
  if (name === 'tenant-scoped') return (response) => {
    if (context.activeRole === 'appAdmin') return true;
    const markers = Array.isArray(context.crossTenantMarkers)
      ? context.crossTenantMarkers
      : context.crossTenantMarker ? [context.crossTenantMarker] : [];
    return markers.every((marker) => !String(response.body || '').includes(String(marker)));
  };
  if (name === 'data.workload-array') return (response) => Array.isArray(responseData(response));
  if (name.endsWith('-array')) {
    const key = name.slice('data.'.length, -'-array'.length);
    return (response) => Array.isArray(responseData(response)?.[key]);
  }
  if (name === 'data.hospital') return (response) => Boolean(responseData(response)?.hospital);
  if (name === 'data.patient') return (response) => Boolean(responseData(response)?.patient);
  if (name === 'data.doctor') return (response) => Boolean(responseData(response)?.doctor);
  if (name === 'data.checkout_url-https') return (response) => /^https:\/\//i.test(String(responseData(response)?.checkout_url || ''));
  if (name === 'data.setup-secret-present') return (response) => Boolean(responseData(response)?.setup?.secret);
  if (name === 'data.factor_type-authenticator') return (response) => responseData(response)?.factor_type === 'AUTHENTICATOR_APP';
  if (name === 'data.batch-counts-consistent') return (response) => {
    const data = responseData(response);
    return Boolean(data && Number(data.total) === Number(data.successful) + Number(data.failed) && Array.isArray(data.results) && data.results.length === Number(data.total));
  };
  if (name === 'data.database-state') return (response) => typeof responseData(response)?.database?.state === 'string';
  if (name === 'data.reminder-health') return (response) => {
    const data = responseData(response);
    return Boolean(data && Number.isFinite(Number(data.totalReminders)) && Number.isFinite(Number(data.overdueDeliveries)) && data.deliveriesByStatus && typeof data.deliveriesByStatus === 'object');
  };
  if (name === 'data.statistics-counts-nonnegative') return (response) => {
    const data = responseData(response);
    return Boolean(data && Number(data.doctors?.total) >= 0 && Number(data.patients?.total) >= 0 && Number(data.audit_logs) >= 0);
  };
  if (name === 'data.trends-arrays') return (response) => Array.isArray(responseData(response)?.doctors) && Array.isArray(responseData(response)?.patients);
  if (name === 'data.compliance-total-consistent') return (response) => {
    const data = responseData(response);
    if (!data) return false;
    return Number(data.total_patients) === Number(data.in_range) + Number(data.below_range) + Number(data.above_range) + Number(data.no_data);
  };
  if (name === 'data.period-valid') return (response) => {
    const data = responseData(response);
    return Boolean(data?.period && !Number.isNaN(Date.parse(data.period.start)) && !Number.isNaN(Date.parse(data.period.end)) && Date.parse(data.period.end) >= Date.parse(data.period.start));
  };
  if (name === 'data.invoice-paid') return (response) => responseData(response)?.status === 'Paid';
  if (name === 'data.already_paid-boolean') return (response) => typeof responseData(response)?.already_paid === 'boolean';
  throw new Error(`No semantic validator registered for ${name}`);
}

function signedBody(descriptor, context, body) {
  if (descriptor.id !== 'POST /api/v1/webhooks/payment') return body;
  const webhook = context.webhook || {};
  return signPaymentWebhook(webhook.secret, {
    ...body,
    provider_event_id: body.provider_event_id || webhook.eventId,
    timestamp: body.timestamp || webhook.timestamp || Date.now(),
  });
}

export function executeAdminPlatformOperation(descriptor, context, options = {}) {
  const role = options.role || descriptor.role;
  const expectedRejection = options.expectedRejection === true;
  const body = expectedRejection ? undefined : signedBody(descriptor, context, descriptor.buildBody(context));
  const rejectionStatuses = role === 'none' ? [400, 401, 403, 503] : [401];
  return loadJsonRequest({
    baseUrl: context.baseUrl,
    runId: context.runId,
    method: descriptor.method,
    path: descriptor.buildPath(context),
    routeTemplate: descriptor.pathTemplate,
    body,
    token: expectedRejection ? undefined : tokenForRole(context, role),
    expectedStatuses: options.expectedStatuses || (expectedRejection ? rejectionStatuses : descriptor.expectedStatuses),
    tags: {
      routeFamily: descriptor.id.includes('/statistics/') ? 'statistics' : descriptor.id.includes('/webhooks/') ? 'webhook' : 'admin',
      scenario: options.scenario || 'admin_platform',
      role: expectedRejection || role === 'none' ? 'anonymous' : role,
      tenantMode: role === 'appAdmin' ? 'global' : role === 'none' ? 'hmac_bound' : 'tenant_scoped',
      responseClass: options.responseClass || (expectedRejection ? 'expected_rejection' : 'expected'),
      dependencyMode: context.dependencyMode || 'normal',
      thresholdClass: descriptor.method === 'GET' ? 'authenticated_read' : descriptor.id.includes('/webhooks/') ? 'external_provider' : 'admin_write',
    },
    semanticChecks: (options.semanticChecks || (expectedRejection ? ['failure-envelope'] : descriptor.semanticChecks)).map((name) => ({
      name,
      validate: semanticValidator(name, { ...context, activeRole: role }),
    })),
    safetyKind: options.safetyKind,
  });
}

export function runAdminPlatformScenario(context, index) {
  const position = Math.abs(Number(index) || 0) % ADMIN_PLATFORM_OPERATIONS.length;
  return executeAdminPlatformOperation(ADMIN_PLATFORM_OPERATIONS[position], context);
}

/** Execute one denied role probe without repeating successful capacity traffic. */
export function runAdminPermissionProbe(context, operationIndex, probeIndex = 0) {
  const descriptor = ADMIN_PLATFORM_OPERATIONS[Math.abs(Number(operationIndex) || 0) % ADMIN_PLATFORM_OPERATIONS.length];
  const denied = descriptor.permissionCases.filter((entry) => entry.expectation === 'permission-denied');
  if (!denied.length) return null;
  const probe = denied[Math.abs(Number(probeIndex) || 0) % denied.length];
  return executeAdminPlatformOperation(descriptor, context, {
    role: probe.role,
    expectedStatuses: probe.expectedStatuses,
    scenario: 'admin_permission_probe',
    responseClass: 'expected_rejection',
    semanticChecks: ['error-envelope'],
  });
}
