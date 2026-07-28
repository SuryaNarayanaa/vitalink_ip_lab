import type { Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import {
  ADMIN_ROLE_LABELS,
  isAdminRoleKey,
  type AdminCapability,
  type AdminRoleKey,
} from '@alias/constants/admin-capabilities'
import AdminProfile from '@alias/models/adminprofile.model'
import User from '@alias/models/user.model'
import * as policyService from '@alias/services/admin-role-policy.service'
import type { AdminAccessContext, AdminRolePolicySnapshot } from '@alias/types/admin-access'
import { hasAdminCapability } from '@alias/types/admin-access'
import { ApiError, ApiResponse, asyncHandler } from '@alias/utils'

const ROLE_DESCRIPTIONS: Record<AdminRoleKey, string> = {
  app_admin: 'Protected global platform administration policy.',
  hospital_admin: 'Hospital-scoped operational administration policy.',
  auditor: 'Global, hard read-only system oversight policy.',
}

function forbidden(message: string, requiredCapability?: AdminCapability): ApiError {
  const error = new ApiError(StatusCodes.FORBIDDEN, message)
  if (requiredCapability) Object.assign(error, { requiredCapability })
  return error
}

function accessContext(req: Request): AdminAccessContext {
  if (!req.adminAccess) throw forbidden('Administrator access context is required.')
  return req.adminAccess
}

function requirePolicyRead(req: Request): AdminAccessContext {
  const access = accessContext(req)
  if (access.scope !== 'global' || !hasAdminCapability(access, 'platform.role_policy.read')) {
    throw forbidden('Administrator role-policy read access is required.', 'platform.role_policy.read')
  }
  return access
}

function requirePolicyMutation(req: Request): AdminAccessContext {
  const access = accessContext(req)
  if (
    access.role !== 'app_admin'
    || access.scope !== 'global'
    || access.readOnly
    || !hasAdminCapability(access, 'platform.role_policy.manage')
  ) {
    throw forbidden('Application Admin role-policy management access is required.', 'platform.role_policy.manage')
  }
  return access
}

function roleKey(req: Request): AdminRoleKey {
  const value = req.params.roleKey
  if (!isAdminRoleKey(value)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Unsupported administrator role key.')
  }
  return value
}

async function activeAccountCount(key: AdminRoleKey): Promise<number> {
  const profiles = await AdminProfile.find({ admin_role: key }).select('_id').lean()
  if (!profiles.length) return 0
  return User.countDocuments({
    user_type: 'ADMIN',
    is_active: true,
    profile_id: { $in: profiles.map(profile => profile._id) },
  })
}

async function policyResponse(policy: AdminRolePolicySnapshot) {
  return {
    schema_version: policy.schemaVersion,
    role_key: policy.roleKey,
    label: ADMIN_ROLE_LABELS[policy.roleKey],
    description: ROLE_DESCRIPTIONS[policy.roleKey],
    protected: policy.protected,
    capabilities: policy.capabilities,
    policy_version: policy.policyVersion,
    active_account_count: await activeAccountCount(policy.roleKey),
    updated_at: policy.updatedAt?.toISOString(),
    updated_by: policy.updatedBy,
    change_reason: policy.changeReason,
  }
}

function previewResponse(preview: Awaited<ReturnType<typeof policyService.previewAdminRolePolicyUpdate>>) {
  return {
    role_key: preview.roleKey,
    current_version: preview.currentVersion,
    affected_active_accounts: preview.affectedActiveAccounts,
    added_capabilities: preview.added,
    removed_capabilities: preview.removed,
    unchanged_capabilities: preview.unchanged,
    impacted_portal_areas: preview.impactedPolicyAreas,
    warnings: preview.warnings,
  }
}

/** GET /api/admin/role-policies */
export const listAdminRolePolicies = asyncHandler(async (req: Request, res: Response) => {
  requirePolicyRead(req)
  const policies = await policyService.listAdminRolePolicies()
  const response = await Promise.all(policies.map(policyResponse))
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Administrator role policies retrieved', {
    policies: response,
  }))
})

/** GET /api/admin/role-policies/:roleKey */
export const getAdminRolePolicy = asyncHandler(async (req: Request, res: Response) => {
  requirePolicyRead(req)
  const response = await policyResponse(await policyService.getAdminRolePolicy(roleKey(req)))
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Administrator role policy retrieved', response))
})

/** POST /api/admin/role-policies/:roleKey/preview */
export const previewAdminRolePolicyUpdate = asyncHandler(async (req: Request, res: Response) => {
  requirePolicyMutation(req)
  const preview = await policyService.previewAdminRolePolicyUpdate({
    roleKey: roleKey(req),
    capabilities: req.body.capabilities,
    expectedVersion: req.body.expected_version,
  })
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Administrator role policy preview generated', previewResponse(preview)))
})

/** PUT /api/admin/role-policies/:roleKey */
export const updateAdminRolePolicy = asyncHandler(async (req: Request, res: Response) => {
  const access = requirePolicyMutation(req)
  ;(req as any).transactionallyAuditedRolePolicyWrite = true
  const policy = await policyService.updateAdminRolePolicy({
    roleKey: roleKey(req),
    capabilities: req.body.capabilities,
    expectedVersion: req.body.expected_version,
    changeReason: req.body.change_reason,
    actor: access,
    requestCorrelationId: req.requestId || '',
    ipAddress: req.ip || req.socket?.remoteAddress,
    userAgent: req.headers['user-agent'],
  })
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Administrator role policy updated', await policyResponse(policy)))
})

/** GET /api/admin/role-policies/:roleKey/history */
export const getAdminRolePolicyHistory = asyncHandler(async (req: Request, res: Response) => {
  requirePolicyRead(req)
  const { limit, before_version } = (req.validatedQuery ?? req.query) as any
  const history = await policyService.getAdminRolePolicyHistory({
    roleKey: roleKey(req),
    limit: limit === undefined ? undefined : Number(limit),
    beforeVersion: before_version === undefined ? undefined : Number(before_version),
  })
  const revisions = history.map((revision: any) => ({
    id: String(revision._id),
    role_key: revision.role_key,
    previous_capabilities: revision.previous_capabilities,
    new_capabilities: revision.new_capabilities,
    previous_policy_version: revision.previous_policy_version,
    new_policy_version: revision.new_policy_version,
    actor_user_id: String(revision.actor_user_id),
    actor_role: revision.actor_role,
    change_reason: revision.change_reason,
    affected_active_account_count: revision.affected_active_account_count,
    request_correlation_id: revision.request_correlation_id,
    restored_from_revision_id: revision.restored_from_revision_id
      ? String(revision.restored_from_revision_id)
      : undefined,
    created_at: revision.createdAt instanceof Date
      ? revision.createdAt.toISOString()
      : revision.createdAt,
  }))
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Administrator role policy history retrieved', {
    revisions,
  }))
})

/** POST /api/admin/role-policies/:roleKey/restore-preview */
export const previewAdminRolePolicyRestore = asyncHandler(async (req: Request, res: Response) => {
  requirePolicyMutation(req)
  const preview = await policyService.previewAdminRolePolicyRestore({
    roleKey: roleKey(req),
    revisionId: req.body.revision_id,
    expectedVersion: req.body.expected_version,
  })
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Administrator role policy restore preview generated', {
    ...previewResponse(preview),
    source_revision_id: preview.sourceRevisionId,
    source_policy_version: preview.sourcePolicyVersion,
  }))
})

/** POST /api/admin/role-policies/:roleKey/restore */
export const restoreAdminRolePolicy = asyncHandler(async (req: Request, res: Response) => {
  const access = requirePolicyMutation(req)
  ;(req as any).transactionallyAuditedRolePolicyWrite = true
  const policy = await policyService.restoreAdminRolePolicy({
    roleKey: roleKey(req),
    revisionId: req.body.revision_id,
    expectedVersion: req.body.expected_version,
    changeReason: req.body.change_reason,
    actor: access,
    requestCorrelationId: req.requestId || '',
    ipAddress: req.ip || req.socket?.remoteAddress,
    userAgent: req.headers['user-agent'],
  })
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Administrator role policy restored', await policyResponse(policy)))
})
