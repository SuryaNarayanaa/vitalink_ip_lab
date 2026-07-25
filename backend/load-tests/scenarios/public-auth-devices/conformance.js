/* Pure configurable descriptors for environment-dependent HTTP surfaces. */

function cleanDocsPath(value) {
  const path = String(value || '/docs').trim();
  if (!path.startsWith('/') || path.includes('?') || path.includes('#')) {
    throw new Error('Documentation path must be an absolute URL path without query or fragment');
  }
  return path.replace(/\/+$/, '') || '/docs';
}

function protocolDescriptor(method, path, kind, options = {}) {
  return Object.freeze({
    id: options.id || `${method} ${path} [derived]`, method, pathTemplate: path,
    metricEndpointId: options.metricEndpointId,
    role: 'anonymous', routeFamily: options.routeFamily || 'protocol',
    expectedStatuses: options.expectedStatuses || [method === 'OPTIONS' ? 204 : 200],
    destructive: false, fixtureKeys: [],
    cleanup: Object.freeze({ required: false, strategy: 'none' }),
    postcondition: Object.freeze({ kind }),
    semanticChecks: Object.freeze(options.semanticChecks || (method === 'OPTIONS' ? ['cors_preflight'] : ['head_conformance'])),
    verifyRequestId: options.verifyRequestId !== false,
    contentType: options.contentType,
    headers: options.headers || {},
    buildPath: () => path, buildBody: () => null,
  });
}

export function buildDocumentationDescriptors(config = {}) {
  if (config.enabled !== true) return Object.freeze([]);
  const root = cleanDocsPath(config.path);
  const spec = `${root}/openapi.yaml`;
  const rows = [
    protocolDescriptor('GET', root, 'documentation_index', {
      id: `GET ${root}`, metricEndpointId: 'get_docs', routeFamily: 'documentation', contentType: 'text/html', semanticChecks: ['docs_html'],
    }),
    protocolDescriptor('HEAD', root, 'documentation_head', {
      id: `HEAD ${root}`, metricEndpointId: 'head_docs', routeFamily: 'documentation', contentType: 'text/html', semanticChecks: ['head_conformance'],
    }),
    protocolDescriptor('GET', spec, 'documentation_spec', {
      id: `GET ${spec}`, metricEndpointId: 'get_docs_openapi_yaml', routeFamily: 'documentation', contentType: ['application/yaml', 'text/yaml', 'text/plain'], semanticChecks: ['openapi_document'],
    }),
    protocolDescriptor('HEAD', spec, 'documentation_spec_head', {
      id: `HEAD ${spec}`, metricEndpointId: 'head_docs_openapi_yaml', routeFamily: 'documentation', semanticChecks: ['head_conformance'],
    }),
  ];
  if (config.asset) {
    const asset = `${root}/${String(config.asset).replace(/^\/+/, '')}`;
    rows.push(protocolDescriptor('GET', asset, 'documentation_asset', {
      id: `GET ${root}/{swaggerAsset}`, metricEndpointId: 'get_docs_by_swaggerasset', routeFamily: 'documentation', semanticChecks: ['nonempty_response'],
    }));
  }
  return Object.freeze(rows);
}

export function buildHeadDescriptors(targets = []) {
  return Object.freeze(targets
    .filter((target) => String(target.method).toUpperCase() === 'GET' && target.deriveHead !== false)
    .map((target) => protocolDescriptor('HEAD', target.pathTemplate, 'express_head', {
      routeFamily: target.routeFamily, expectedStatuses: target.expectedStatuses,
      verifyRequestId: target.verifyRequestId,
    })).map((head, index) => {
      const source = targets.filter((target) => String(target.method).toUpperCase() === 'GET' && target.deriveHead !== false)[index];
      return Object.freeze({
        ...head,
        role: source.role,
        fixtureKeys: source.fixtureKeys,
        expectedRejectionStatuses: source.expectedRejectionStatuses,
        selectToken: source.selectToken,
      });
    }));
}

export function buildOptionsDescriptors(targets = [], corsOrigin = '') {
  const uniquePaths = [];
  targets.forEach((target) => {
    if (target.deriveOptions !== false && !uniquePaths.includes(target.pathTemplate)) uniquePaths.push(target.pathTemplate);
  });
  return Object.freeze(uniquePaths.map((path) => protocolDescriptor('OPTIONS', path, 'cors_preflight', {
    expectedStatuses: [204],
    headers: {
      ...(corsOrigin ? { Origin: corsOrigin } : {}),
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,content-type,x-request-id',
    },
  })));
}

export function buildConformanceDescriptors(config = {}) {
  const targets = Array.isArray(config.targets) ? config.targets : [];
  return Object.freeze([
    ...buildDocumentationDescriptors(config.docs || {}),
    ...(config.includeHead === true ? buildHeadDescriptors(targets) : []),
    ...(config.includeOptions === true ? buildOptionsDescriptors(targets, config.corsOrigin) : []),
  ]);
}
