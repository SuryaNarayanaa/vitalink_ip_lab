import { OPERATION_DESCRIPTORS } from '../scenarios/public-auth-devices/descriptors.js'
import { CLINICAL_OPERATIONS } from '../scenarios/clinical/descriptors.js'
import { ADMIN_PLATFORM_OPERATIONS } from '../scenarios/admin-platform/descriptors.js'

const families = Object.freeze([
  ['public', OPERATION_DESCRIPTORS, 'load-tests/capacity/k6/public.js'],
  ['clinical', CLINICAL_OPERATIONS, 'load-tests/capacity/k6/clinical.js'],
  ['admin', ADMIN_PLATFORM_OPERATIONS, 'load-tests/capacity/k6/admin.js'],
])

export function descriptorIndex() {
  const index = new Map()
  for (const [family, descriptors, runner] of families) {
    for (const descriptor of descriptors) {
      if (index.has(descriptor.id)) throw new Error(`Duplicate capacity descriptor: ${descriptor.id}`)
      index.set(descriptor.id, { descriptor, family, runner })
    }
  }
  return index
}

function legacyEntry(endpoint, canonical) {
  return {
    id: endpoint.id,
    canonicalId: endpoint.canonicalId,
    method: endpoint.method,
    path: endpoint.path,
    scope: endpoint.scope,
    family: canonical?.family || 'unknown',
    evidenceClass: 'legacy_alias',
    executionClass: 'not_independently_loaded',
    eligible: false,
    inheritsCapacityFrom: endpoint.canonicalId,
    reason: 'Legacy aliases share the canonical handler and are checked for compatibility, not independently saturated.',
  }
}

function classifiedEntry(endpoint, indexed) {
  const descriptor = indexed.descriptor
  const variants = indexed.family === 'admin'
    ? (descriptor.permissionCases || [])
      .filter(permissionCase => permissionCase.expectation === 'allowed')
      .map(permissionCase => ({
        id: permissionCase.role,
        role: permissionCase.role,
        tenantMode: permissionCase.role === 'hospitalAdmin' ? 'fixture_tenant' : 'global',
      }))
    : [{
        id: descriptor.role || 'anonymous',
        role: descriptor.role || 'anonymous',
        tenantMode: ['anonymous', 'none'].includes(descriptor.role) ? 'none' : 'fixture_tenant',
      }]
  const base = {
    id: endpoint.id,
    canonicalId: endpoint.canonicalId,
    method: endpoint.method,
    path: endpoint.path,
    scope: endpoint.scope,
    family: indexed.family,
    runner: indexed.runner,
    thresholdClass: descriptor.thresholdClass || (
      descriptor.transport === 'multipart' ? 'upload'
        : descriptor.method === 'GET' ? 'authenticated_read'
          : 'operational_read'
    ),
    destructive: descriptor.destructive === true,
    protocol: descriptor.protocol || 'http',
    transport: descriptor.transport || 'json',
    variants,
  }

  if (descriptor.protocol === 'sse') {
    return {
      ...base,
      evidenceClass: 'sse_specialized',
      executionClass: 'specialized_runner_required',
      eligible: false,
      reason: 'Long-lived streams need distinct-user connection fixtures and the specialized SSE capacity runner.',
    }
  }
  if (descriptor.transport === 'multipart') {
    return {
      ...base,
      evidenceClass: 'upload',
      executionClass: 'valid_mutation_unavailable',
      eligible: false,
      reason: 'Upload capacity is not claimed until run-owned object storage and FileAsset cleanup are durable.',
    }
  }
  if (descriptor.destructive === true) {
    return {
      ...base,
      evidenceClass: 'rejection_only',
      executionClass: 'valid_mutation_unavailable',
      eligible: false,
      reason: 'Only rejection-path evidence exists; valid mutation capacity is intentionally not claimed.',
    }
  }
  return {
    ...base,
    evidenceClass: descriptor.method === 'GET' ? 'valid_read' : 'valid_bounded_side_effect',
    executionClass: 'closed_model_constant_vus',
    eligible: true,
    capacityAggregation: 'minimum_across_authorized_variants',
    reason: descriptor.method === 'GET'
      ? 'Valid read-only endpoint with deterministic fixtures.'
      : 'Descriptor declares the operation non-destructive and its effects bounded or expiring.',
  }
}

export function buildCapacityManifest(inventory) {
  if (!inventory || !Array.isArray(inventory.explicitEndpoints)) {
    throw new Error('Capacity inventory must contain explicitEndpoints')
  }
  const index = descriptorIndex()
  const manifest = inventory.explicitEndpoints.map((endpoint) => {
    const indexed = index.get(endpoint.id)
    if (endpoint.scope === 'legacy') return legacyEntry(endpoint, index.get(endpoint.canonicalId))
    if (!indexed) {
      return {
        id: endpoint.id,
        canonicalId: endpoint.canonicalId,
        method: endpoint.method,
        path: endpoint.path,
        scope: endpoint.scope,
        family: 'unknown',
        evidenceClass: 'unmapped',
        executionClass: 'harness_gap',
        eligible: false,
        reason: 'No capacity descriptor maps this mandatory endpoint.',
      }
    }
    return classifiedEntry(endpoint, indexed)
  })

  const duplicateIds = manifest.map(entry => entry.id).filter((id, position, ids) => ids.indexOf(id) !== position)
  if (duplicateIds.length) throw new Error(`Duplicate inventory endpoints: ${[...new Set(duplicateIds)].join(', ')}`)
  return manifest
}

export function manifestCounts(manifest) {
  const byEvidenceClass = {}
  const byExecutionClass = {}
  for (const entry of manifest) {
    byEvidenceClass[entry.evidenceClass] = (byEvidenceClass[entry.evidenceClass] || 0) + 1
    byExecutionClass[entry.executionClass] = (byExecutionClass[entry.executionClass] || 0) + 1
  }
  return {
    total: manifest.length,
    eligible: manifest.filter(entry => entry.eligible).length,
    byEvidenceClass,
    byExecutionClass,
  }
}
