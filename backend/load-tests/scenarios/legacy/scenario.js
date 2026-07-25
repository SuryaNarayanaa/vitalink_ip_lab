import { loadRequest } from '../../lib/client.js';
import { responseHeader } from '../../lib/checks.js';
import { assertLegacyCoverage, createLegacyDescriptors } from './descriptors.js';

const INVENTORY_PATH = '../../generated/endpoints.json';
const inventory = JSON.parse(open(INVENTORY_PATH));
const descriptorCache = createLegacyDescriptors(inventory);
assertLegacyCoverage(inventory, descriptorCache);

function descriptorsFromInventory() {
  return descriptorCache;
}

function endpointTag(id) {
  return id.toLowerCase()
    .replace(/[{}]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
}

function legacySemanticChecks(descriptor, context) {
  return [
    {
      name: 'legacy version headers identify v1',
      validate: (response) => responseHeader(response, 'X-API-Version') === 'v1' && responseHeader(response, 'X-API-Supported-Versions').split(',').map((item) => item.trim()).includes('v1'),
    },
    {
      name: 'legacy deprecation headers are complete',
      validate: (response) => responseHeader(response, 'Deprecation').toLowerCase() === 'true' && Boolean(responseHeader(response, 'Sunset')) && responseHeader(response, 'Link').includes('</api/v1>') && responseHeader(response, 'Link').includes('rel="successor-version"'),
    },
    {
      name: 'legacy status matches captured canonical baseline when provided',
      validate: (response) => {
        const baseline = context.legacyParityBaseline && context.legacyParityBaseline[descriptor.canonicalId];
        return baseline === undefined || Number(baseline) === response.status;
      },
    },
  ];
}

export function executeLegacyReachability(descriptor, context) {
  return loadRequest({
    baseUrl: context.baseUrl,
    runId: context.runId,
    method: descriptor.method,
    path: descriptor.buildPath(context),
    routeTemplate: descriptor.pathTemplate,
    body: descriptor.buildBody(context),
    expectedStatuses: descriptor.expectedStatuses,
    tags: {
      routeFamily: 'legacy',
      scenario: 'legacy_reachability',
      role: 'anonymous',
      tenantMode: 'none',
      responseClass: 'expected_rejection',
      dependencyMode: context.dependencyMode || 'normal',
      thresholdClass: 'legacy_smoke',
    },
    semanticChecks: legacySemanticChecks(descriptor, context),
  });
}

/** Intended for a 95-iteration shared-iterations smoke scenario, never capacity load. */
export function runLegacyReachabilityScenario(context, index) {
  const descriptors = descriptorsFromInventory();
  const position = Math.abs(Number(index) || 0) % descriptors.length;
  return executeLegacyReachability(descriptors[position], context);
}

export { descriptorsFromInventory as loadLegacyDescriptors };
