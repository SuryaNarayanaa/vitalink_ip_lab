import type { AdminCapability, AdminCapabilityMap, AdminRoleKey } from '@alias/constants/admin-capabilities'

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
  schemaVersion: 2
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
