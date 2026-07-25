const ALLOWED_TAG_VALUE = /^[a-z0-9][a-z0-9_.-]{0,95}$/;

export const REQUIRED_ENDPOINT_TAGS = Object.freeze([
  'endpoint_id',
  'method',
  'route_family',
  'scenario',
  'role',
  'tenant_mode',
  'response_class',
  'dependency_mode',
  'threshold_class',
]);

export function normalizeRouteTemplate(path) {
  let value = String(path || '').trim().split('?')[0];
  if (!value.startsWith('/')) value = `/${value}`;
  return value
    .replace(/\/+/g, '/')
    .replace(/\{([^}]+)\}/g, ':$1')
    .replace(/\/[0-9a-f]{24}(?=\/|$)/gi, '/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, '/:id')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

export function endpointId(method, routeTemplate) {
  const route = normalizeRouteTemplate(routeTemplate)
    .replace(/^\//, '')
    .replace(/:([a-zA-Z0-9_]+)/g, 'by_$1')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return `${String(method || 'get').toLowerCase()}_${route || 'root'}`;
}

function normalizeTagValue(key, value, fallback) {
  const normalized = String(value === undefined || value === null || value === '' ? fallback : value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (!ALLOWED_TAG_VALUE.test(normalized)) {
    throw new Error(`Invalid or high-cardinality ${key} tag: "${normalized}"`);
  }
  return normalized;
}

export function normalizeEndpointTags(input = {}) {
  const method = normalizeTagValue('method', input.method, 'get');
  const routeTemplate = normalizeRouteTemplate(input.routeTemplate || input.path || '/');
  const tags = {
    endpoint_id: normalizeTagValue('endpoint_id', input.endpointId || endpointId(method, routeTemplate), 'unknown'),
    method,
    route_family: normalizeTagValue('route_family', input.routeFamily, 'unknown'),
    scenario: normalizeTagValue('scenario', input.scenario, 'unknown'),
    role: normalizeTagValue('role', input.role, 'anonymous'),
    tenant_mode: normalizeTagValue('tenant_mode', input.tenantMode, 'none'),
    response_class: normalizeTagValue('response_class', input.responseClass, 'expected'),
    dependency_mode: normalizeTagValue('dependency_mode', input.dependencyMode, 'normal'),
    threshold_class: normalizeTagValue('threshold_class', input.thresholdClass, 'authenticated_read'),
  };
  // k6's special `name` tag prevents dynamic resource IDs from fragmenting URL metrics.
  tags.name = `${method.toUpperCase()} ${routeTemplate}`;
  return tags;
}

