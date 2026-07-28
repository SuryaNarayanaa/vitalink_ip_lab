import type {
  AdminCapability,
  AdminCapabilityMap,
  AdminRoleKey,
} from '@alias/constants/admin-capabilities'
import { ADMIN_POLICY_SCHEMA_VERSION, isMutationAdminCapability } from '@alias/constants/admin-capabilities'
import type { Request } from 'express'
import { StatusCodes } from 'http-status-codes'
import { ApiError } from '@alias/utils'

export type AdminAccessScope = 'global' | 'tenant'

export type AdminAccessContext = {
  userId: string
  role: AdminRoleKey
  scope: AdminAccessScope
  hospitalId?: string
  hospitalCode?: string
  permissions: AdminCapabilityMap
  policyVersion: number
  readOnly: boolean
}

export type AdminRolePolicySnapshot = {
  roleKey: AdminRoleKey
  capabilities: AdminCapabilityMap
  protected: boolean
  schemaVersion: typeof ADMIN_POLICY_SCHEMA_VERSION
  policyVersion: number
  updatedBy: string
  changeReason: string
  updatedAt?: Date
}

export type AdminRolePolicyDiff = {
  added: AdminCapability[]
  removed: AdminCapability[]
  unchanged: AdminCapability[]
}

export type AdminRolePolicyPreview = AdminRolePolicyDiff & {
  roleKey: AdminRoleKey
  currentVersion: number
  affectedActiveAccounts: number
  warnings: string[]
}

export function hasAdminCapability(
  context: Pick<AdminAccessContext, 'permissions'>,
  capability: AdminCapability,
): boolean {
  return context.permissions[capability] === true
}

export function hasAnyAdminCapability(
  context: Pick<AdminAccessContext, 'permissions'>,
  capabilities: readonly AdminCapability[],
): boolean {
  return capabilities.some(capability => hasAdminCapability(context, capability))
}

/** Resolve the per-request admin access context or fail closed. */
export function requireAdminAccessContext(req: Request): AdminAccessContext {
  if (!req.adminAccess) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Administrator access context is required.')
  }
  return req.adminAccess
}

export type RequireAdminCapabilityOptions = {
  role?: AdminRoleKey
  scope?: AdminAccessScope
  /** When true, read-only actors may pass even for mutation capabilities. */
  allowWhenReadOnly?: boolean
}

/**
 * Shared authorization guard for service/controller paths that re-check role,
 * scope, read-only status, and a required capability after middleware resolution.
 */
export function requireAdminCapabilityContext(
  access: AdminAccessContext,
  capability: AdminCapability,
  options: RequireAdminCapabilityOptions = {},
): void {
  const allowWhenReadOnly = options.allowWhenReadOnly
    ?? !isMutationAdminCapability(capability)
  if (
    (options.role !== undefined && access.role !== options.role)
    || (options.scope !== undefined && access.scope !== options.scope)
    || (access.readOnly && !allowWhenReadOnly)
    || !hasAdminCapability(access, capability)
  ) {
    const error = new ApiError(StatusCodes.FORBIDDEN, 'Administrator access is not permitted for this operation.')
    Object.assign(error, { requiredCapability: capability })
    throw error
  }
}

declare global {
  namespace Express {
    interface Request {
      /** Current persisted V2 administrator policy snapshot, resolved once per request. */
      adminAccess?: AdminAccessContext
    }
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    adminAccess?: AdminAccessContext
  }
}

export {}
