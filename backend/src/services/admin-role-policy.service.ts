import mongoose, { type ClientSession } from 'mongoose'
import { StatusCodes } from 'http-status-codes'
import {
  ADMIN_CAPABILITY_METADATA,
  ADMIN_POLICY_SCHEMA_VERSION,
  ADMIN_ROLE_CAPABILITY_ALLOWLISTS,
  ADMIN_ROLE_KEYS,
  EDITABLE_ADMIN_ROLE_KEYS,
  type AdminCapability,
  type AdminCapabilityMap,
  type AdminRoleKey,
  normalizeAdminCapabilityMap,
} from '@alias/constants/admin-capabilities'
import AdminRolePolicy from '@alias/models/adminrolepolicy.model'
import AdminRolePolicyRevision from '@alias/models/adminrolepolicyrevision.model'
import AdminProfile from '@alias/models/adminprofile.model'
import AuditLog, { AuditAction } from '@alias/models/auditlog.model'
import User from '@alias/models/user.model'
import { ApiError } from '@alias/utils'
import type {
  AdminAccessContext,
  AdminRolePolicyDiff,
  AdminRolePolicyPreview,
  AdminRolePolicySnapshot,
} from '@alias/types/admin-access'
import { hasAdminCapability } from '@alias/types/admin-access'

export type PolicyMutationActor = Pick<AdminAccessContext, 'userId' | 'role' | 'scope' | 'readOnly' | 'permissions'>

export type PolicyMutationInput = {
  roleKey: AdminRoleKey
  capabilities: unknown
  expectedVersion: number
  changeReason: string
  actor: PolicyMutationActor
  requestCorrelationId: string
  ipAddress?: string
  userAgent?: string
}

export type PolicyRestoreInput = Omit<PolicyMutationInput, 'capabilities'> & {
  revisionId: string
}

/**
 * Short process-local TTL for role-policy snapshots.
 * Mutations invalidate this process's cache immediately, but invalidation is not
 * fleet-wide: other backend instances may keep serving a previously loaded
 * snapshot (including revoked capabilities) for up to this TTL unless a shared
 * invalidation mechanism (pub/sub, policy-version stamp check, etc.) is added.
 */
/** Aggressive TTL limits post-revoke privilege retention in multi-instance deploys. */
export const ADMIN_ROLE_POLICY_CACHE_TTL_MS = 5_000

type CachedAdminRolePolicy = {
  snapshot: AdminRolePolicySnapshot
  expiresAt: number
}

const policyCache = new Map<AdminRoleKey, CachedAdminRolePolicy>()
const policyLoads = new Map<AdminRoleKey, Promise<AdminRolePolicySnapshot>>()
/** Bumped on invalidate so an in-flight load cannot repopulate a stale snapshot. */
const policyCacheGeneration = new Map<AdminRoleKey, number>()

export class AdminRolePolicyConflictError extends ApiError {
  currentPolicy: AdminRolePolicySnapshot

  constructor(currentPolicy: AdminRolePolicySnapshot) {
    super(StatusCodes.CONFLICT, 'Role policy has changed. Refresh and retry with the current policy version.')
    this.currentPolicy = currentPolicy
  }
}

function policyUnavailable(): ApiError {
  return new ApiError(StatusCodes.FORBIDDEN, 'Administrative role policy is unavailable')
}

function currentPolicyCacheGeneration(roleKey: AdminRoleKey): number {
  return policyCacheGeneration.get(roleKey) ?? 0
}

/**
 * Clears the process-local role-policy cache (all roles or one). Used by tests
 * and after policy mutations so updates/restores are immediately visible.
 */
export function clearAdminRolePolicyCacheForTests(roleKey?: AdminRoleKey): void {
  if (roleKey) {
    invalidateAdminRolePolicyCache(roleKey)
    return
  }
  for (const key of ADMIN_ROLE_KEYS) {
    policyCacheGeneration.set(key, currentPolicyCacheGeneration(key) + 1)
  }
  policyCache.clear()
  policyLoads.clear()
}

function invalidateAdminRolePolicyCache(roleKey: AdminRoleKey): void {
  policyCacheGeneration.set(roleKey, currentPolicyCacheGeneration(roleKey) + 1)
  policyCache.delete(roleKey)
  policyLoads.delete(roleKey)
}

/**
 * Re-validates a cached snapshot before serving. Fail closed on any mismatch
 * with the expected role, schema, or version shape.
 */
function snapshotFromCache(roleKey: AdminRoleKey, snapshot: AdminRolePolicySnapshot): AdminRolePolicySnapshot {
  try {
    if (snapshot.roleKey !== roleKey) throw new Error('Role key mismatch')
    if (snapshot.schemaVersion !== ADMIN_POLICY_SCHEMA_VERSION) throw new Error('Unsupported schema version')
    if (!Number.isSafeInteger(snapshot.policyVersion) || snapshot.policyVersion < 1) {
      throw new Error('Invalid policy version')
    }
    if (typeof snapshot.protected !== 'boolean') throw new Error('Invalid protected flag')
    if (roleKey === 'app_admin' && snapshot.protected !== true) {
      throw new Error('Application Admin policy is not protected')
    }
    if (!snapshot.updatedBy) throw new Error('Missing policy actor')
    if (typeof snapshot.changeReason !== 'string' || !snapshot.changeReason.trim()) {
      throw new Error('Missing change reason')
    }
    return {
      roleKey,
      capabilities: normalizeAdminCapabilityMap(roleKey, snapshot.capabilities),
      protected: snapshot.protected,
      schemaVersion: ADMIN_POLICY_SCHEMA_VERSION,
      policyVersion: snapshot.policyVersion,
      updatedBy: String(snapshot.updatedBy),
      changeReason: snapshot.changeReason,
      updatedAt: snapshot.updatedAt ? new Date(snapshot.updatedAt) : undefined,
    }
  } catch {
    throw policyUnavailable()
  }
}

function cachePolicySnapshot(roleKey: AdminRoleKey, snapshot: AdminRolePolicySnapshot): void {
  policyCache.set(roleKey, {
    snapshot,
    expiresAt: Date.now() + ADMIN_ROLE_POLICY_CACHE_TTL_MS,
  })
}

function assertEditableRole(role: AdminRoleKey): asserts role is 'hospital_admin' | 'auditor' {
  if (!EDITABLE_ADMIN_ROLE_KEYS.includes(role as 'hospital_admin' | 'auditor')) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Application Admin policy is protected and cannot be edited')
  }
}

function assertMutationActor(actor: PolicyMutationActor): void {
  if (
    actor.role !== 'app_admin'
    || actor.scope !== 'global'
    || actor.readOnly
    || !hasAdminCapability(actor, 'platform.role_policy.manage')
  ) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Application Admin policy-management access is required')
  }
}

function validateMutationMetadata(input: {
  expectedVersion: number
  changeReason: string
  requestCorrelationId: string
}): void {
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'expected_version must be a positive integer')
  }
  if (typeof input.changeReason !== 'string' || input.changeReason.trim().length < 3 || input.changeReason.trim().length > 500) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'change_reason must contain between 3 and 500 characters')
  }
  if (typeof input.requestCorrelationId !== 'string' || !input.requestCorrelationId.trim() || input.requestCorrelationId.length > 200) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'A valid request correlation ID is required')
  }
}

function toSnapshot(document: any): AdminRolePolicySnapshot {
  try {
    const roleKey = document?.role_key as AdminRoleKey
    if (!ADMIN_ROLE_KEYS.includes(roleKey)) throw new Error('Unsupported role key')
    if (Number(document?.schema_version) !== ADMIN_POLICY_SCHEMA_VERSION) throw new Error('Unsupported schema version')
    if (!Number.isSafeInteger(document?.policy_version) || Number(document.policy_version) < 1) {
      throw new Error('Invalid policy version')
    }
    if (typeof document?.protected !== 'boolean') throw new Error('Invalid protected flag')
    if (roleKey === 'app_admin' && document.protected !== true) throw new Error('Application Admin policy is not protected')
    if (!document?.updated_by) throw new Error('Missing policy actor')
    if (typeof document?.change_reason !== 'string' || !document.change_reason.trim()) throw new Error('Missing change reason')

    return {
      roleKey,
      capabilities: normalizeAdminCapabilityMap(roleKey, document.capabilities),
      protected: document.protected,
      schemaVersion: ADMIN_POLICY_SCHEMA_VERSION,
      policyVersion: Number(document.policy_version),
      updatedBy: String(document.updated_by),
      changeReason: document.change_reason,
      updatedAt: document.updatedAt ? new Date(document.updatedAt) : undefined,
    }
  } catch {
    throw policyUnavailable()
  }
}

async function loadPolicyDocument(roleKey: AdminRoleKey, session?: ClientSession): Promise<any> {
  if (!ADMIN_ROLE_KEYS.includes(roleKey)) throw policyUnavailable()
  let query = AdminRolePolicy.findOne({ role_key: roleKey })
  if (session) query = query.session(session)
  const policy = await query
  if (!policy) throw policyUnavailable()
  // Parse before returning so callers cannot accidentally use a malformed document.
  toSnapshot(policy)
  return policy
}

async function countAffectedActiveAccounts(roleKey: AdminRoleKey, session?: ClientSession): Promise<number> {
  let profilesQuery = AdminProfile.find({ admin_role: roleKey }).select('_id')
  if (session) profilesQuery = profilesQuery.session(session)
  const profiles = await profilesQuery.lean()
  const profileIds = profiles.map(profile => profile._id)
  if (!profileIds.length) return 0
  let countQuery = User.countDocuments({
    user_type: 'ADMIN',
    is_active: true,
    profile_id: { $in: profileIds },
  })
  if (session) countQuery = countQuery.session(session)
  return countQuery
}

export function diffAdminCapabilityMaps(
  roleKey: AdminRoleKey,
  currentValue: unknown,
  proposedValue: unknown,
): AdminRolePolicyDiff {
  const current = normalizeAdminCapabilityMap(roleKey, currentValue)
  const proposed = normalizeAdminCapabilityMap(roleKey, proposedValue)
  const added: AdminCapability[] = []
  const removed: AdminCapability[] = []
  const unchanged: AdminCapability[] = []

  for (const capability of ADMIN_ROLE_CAPABILITY_ALLOWLISTS[roleKey]) {
    if (current[capability] === proposed[capability]) unchanged.push(capability)
    else if (proposed[capability]) added.push(capability)
    else removed.push(capability)
  }
  return { added, removed, unchanged }
}

function previewWarnings(roleKey: AdminRoleKey, diff: AdminRolePolicyDiff): string[] {
  const warnings: string[] = []
  if (diff.removed.length) warnings.push('Removed capabilities take effect on the next backend request for all active accounts in this role.')
  if (roleKey === 'auditor') warnings.push('System Auditors remain hard read-only regardless of stored policy data.')
  return warnings
}

function impactedPolicyAreas(diff: AdminRolePolicyDiff) {
  return [...diff.added, ...diff.removed].map(capability => ({
    capability,
    label: ADMIN_CAPABILITY_METADATA[capability].label,
    classification: ADMIN_CAPABILITY_METADATA[capability].classification,
  }))
}

export async function getAdminRolePolicy(roleKey: AdminRoleKey): Promise<AdminRolePolicySnapshot> {
  if (!ADMIN_ROLE_KEYS.includes(roleKey)) throw policyUnavailable()

  const cached = policyCache.get(roleKey)
  if (cached && cached.expiresAt > Date.now()) {
    try {
      return snapshotFromCache(roleKey, cached.snapshot)
    } catch {
      // Stale or corrupted entry — drop and reload from the store.
      invalidateAdminRolePolicyCache(roleKey)
    }
  }

  const inflight = policyLoads.get(roleKey)
  if (inflight) return inflight

  const generation = currentPolicyCacheGeneration(roleKey)
  const load = (async () => {
    try {
      const snapshot = toSnapshot(await loadPolicyDocument(roleKey))
      // A mutation may have completed while this read was in flight. Never let
      // the older snapshot replace the post-write cache entry.
      if (currentPolicyCacheGeneration(roleKey) === generation) {
        cachePolicySnapshot(roleKey, snapshot)
      }
      return snapshot
    } finally {
      if (policyLoads.get(roleKey) === load) policyLoads.delete(roleKey)
    }
  })()

  policyLoads.set(roleKey, load)
  return load
}

export async function listAdminRolePolicies(): Promise<AdminRolePolicySnapshot[]> {
  // A partial role-policy set is not a valid authorization state.
  return Promise.all(ADMIN_ROLE_KEYS.map(roleKey => getAdminRolePolicy(roleKey)))
}

export async function previewAdminRolePolicyUpdate(input: {
  roleKey: AdminRoleKey
  capabilities: unknown
  expectedVersion?: number
}): Promise<AdminRolePolicyPreview & { impactedPolicyAreas: ReturnType<typeof impactedPolicyAreas> }> {
  assertEditableRole(input.roleKey)
  const current = await getAdminRolePolicy(input.roleKey)
  if (input.expectedVersion !== undefined && input.expectedVersion !== current.policyVersion) {
    throw new AdminRolePolicyConflictError(current)
  }
  let proposed: AdminCapabilityMap
  try {
    proposed = normalizeAdminCapabilityMap(input.roleKey, input.capabilities)
  } catch (error) {
    throw new ApiError(StatusCodes.BAD_REQUEST, error instanceof Error ? error.message : 'Invalid capability map')
  }
  const diff = diffAdminCapabilityMaps(input.roleKey, current.capabilities, proposed)
  return {
    roleKey: input.roleKey,
    currentVersion: current.policyVersion,
    affectedActiveAccounts: await countAffectedActiveAccounts(input.roleKey),
    warnings: previewWarnings(input.roleKey, diff),
    impactedPolicyAreas: impactedPolicyAreas(diff),
    ...diff,
  }
}

async function performPolicyMutation(
  input: PolicyMutationInput,
  options: { restoredFromRevisionId?: mongoose.Types.ObjectId } = {},
): Promise<AdminRolePolicySnapshot> {
  assertEditableRole(input.roleKey)
  assertMutationActor(input.actor)
  validateMutationMetadata(input)

  let normalized: AdminCapabilityMap
  try {
    normalized = normalizeAdminCapabilityMap(input.roleKey, input.capabilities)
  } catch (error) {
    throw new ApiError(StatusCodes.BAD_REQUEST, error instanceof Error ? error.message : 'Invalid capability map')
  }

  const session = await mongoose.startSession()
  let result: AdminRolePolicySnapshot | undefined
  try {
    await session.withTransaction(async () => {
      const currentDocument = await loadPolicyDocument(input.roleKey, session)
      const current = toSnapshot(currentDocument)
      if (current.policyVersion !== input.expectedVersion) throw new AdminRolePolicyConflictError(current)

      const nextVersion = current.policyVersion + 1
      if (!Number.isSafeInteger(nextVersion)) {
        throw new ApiError(StatusCodes.CONFLICT, 'Role policy version limit has been reached')
      }
      const affectedActiveAccountCount = await countAffectedActiveAccounts(input.roleKey, session)
      const reason = input.changeReason.trim()
      const updated = await AdminRolePolicy.findOneAndUpdate(
        { role_key: input.roleKey, policy_version: input.expectedVersion },
        {
          $set: {
            capabilities: normalized,
            policy_version: nextVersion,
            updated_by: input.actor.userId,
            change_reason: reason,
          },
        },
        { new: true, runValidators: true, session },
      )
      if (!updated) {
        const latest = toSnapshot(await loadPolicyDocument(input.roleKey, session))
        throw new AdminRolePolicyConflictError(latest)
      }

      await AdminRolePolicyRevision.create([{
        role_key: input.roleKey,
        previous_capabilities: current.capabilities,
        new_capabilities: normalized,
        previous_policy_version: current.policyVersion,
        new_policy_version: nextVersion,
        actor_user_id: input.actor.userId,
        actor_role: input.actor.role,
        change_reason: reason,
        affected_active_account_count: affectedActiveAccountCount,
        request_correlation_id: input.requestCorrelationId.trim(),
        restored_from_revision_id: options.restoredFromRevisionId,
      }], { session })

      await AuditLog.create([{
        user_id: input.actor.userId,
        user_type: 'ADMIN',
        action: AuditAction.ROLE_POLICY_UPDATE,
        description: `Updated ${input.roleKey} administrative role policy to version ${nextVersion}`,
        resource_type: 'AdminRolePolicy',
        resource_id: String(updated._id),
        previous_data: { capabilities: current.capabilities, policy_version: current.policyVersion },
        new_data: { capabilities: normalized, policy_version: nextVersion },
        ip_address: input.ipAddress,
        user_agent: input.userAgent,
        success: true,
        metadata: {
          event_type: 'ROLE_POLICY_UPDATE',
          request_correlation_id: input.requestCorrelationId.trim(),
          affected_active_account_count: affectedActiveAccountCount,
          restored_from_revision_id: options.restoredFromRevisionId
            ? String(options.restoredFromRevisionId)
            : undefined,
        },
      }], { session })

      result = toSnapshot(updated)
    })
  } finally {
    await session.endSession()
  }
  if (!result) throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Role policy update did not complete')
  // Mutations must be visible on the next authorization check in this process.
  invalidateAdminRolePolicyCache(input.roleKey)
  cachePolicySnapshot(input.roleKey, result)
  return result
}

export async function updateAdminRolePolicy(input: PolicyMutationInput): Promise<AdminRolePolicySnapshot> {
  return performPolicyMutation(input)
}

export async function getAdminRolePolicyHistory(input: {
  roleKey: AdminRoleKey
  limit?: number
  beforeVersion?: number
}) {
  if (!ADMIN_ROLE_KEYS.includes(input.roleKey)) throw policyUnavailable()
  // History is not a fallback authorization source: the current policy must
  // exist and validate before any revision data is returned.
  await getAdminRolePolicy(input.roleKey)
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)
  const filter: Record<string, unknown> = { role_key: input.roleKey }
  if (input.beforeVersion !== undefined) {
    if (!Number.isSafeInteger(input.beforeVersion) || input.beforeVersion < 2) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'before_version must be an integer greater than one')
    }
    filter.new_policy_version = { $lt: input.beforeVersion }
  }
  return AdminRolePolicyRevision.find(filter)
    .sort({ new_policy_version: -1 })
    .limit(limit)
    .lean()
}

async function loadRestoreRevision(roleKey: AdminRoleKey, revisionId: string) {
  if (!mongoose.Types.ObjectId.isValid(revisionId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'revision_id must be a valid ObjectId')
  }
  const revision = await AdminRolePolicyRevision.findOne({ _id: revisionId, role_key: roleKey }).lean()
  if (!revision) throw new ApiError(StatusCodes.NOT_FOUND, 'Role policy revision not found')
  try {
    return {
      id: new mongoose.Types.ObjectId(revisionId),
      policyVersion: Number(revision.new_policy_version),
      capabilities: normalizeAdminCapabilityMap(roleKey, revision.new_capabilities),
    }
  } catch {
    throw policyUnavailable()
  }
}

export async function previewAdminRolePolicyRestore(input: {
  roleKey: AdminRoleKey
  revisionId: string
  expectedVersion?: number
}) {
  assertEditableRole(input.roleKey)
  const current = await getAdminRolePolicy(input.roleKey)
  if (input.expectedVersion !== undefined && current.policyVersion !== input.expectedVersion) {
    throw new AdminRolePolicyConflictError(current)
  }
  const revision = await loadRestoreRevision(input.roleKey, input.revisionId)
  if (revision.policyVersion >= current.policyVersion) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Restore must select a prior policy revision')
  }
  const preview = await previewAdminRolePolicyUpdate({
    roleKey: input.roleKey,
    capabilities: revision.capabilities,
    expectedVersion: current.policyVersion,
  })
  return { ...preview, sourceRevisionId: input.revisionId, sourcePolicyVersion: revision.policyVersion }
}

export async function restoreAdminRolePolicy(input: PolicyRestoreInput): Promise<AdminRolePolicySnapshot> {
  assertEditableRole(input.roleKey)
  assertMutationActor(input.actor)
  validateMutationMetadata(input)
  const current = await getAdminRolePolicy(input.roleKey)
  if (current.policyVersion !== input.expectedVersion) throw new AdminRolePolicyConflictError(current)
  const revision = await loadRestoreRevision(input.roleKey, input.revisionId)
  if (revision.policyVersion >= current.policyVersion) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Restore must select a prior policy revision')
  }
  return performPolicyMutation({ ...input, capabilities: revision.capabilities }, {
    restoredFromRevisionId: revision.id,
  })
}
