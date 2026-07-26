export const PLATFORM_ADMIN_CAPABILITIES = [
  'platform.hospitals.read',
  'platform.hospitals.manage',
  'platform.admin_accounts.read',
  'platform.admin_accounts.manage',
  'platform.role_policy.read',
  'platform.role_policy.manage',
  'platform.audit.read',
  'platform.analytics.read',
  'platform.billing.read',
  'platform.billing.manage',
  'platform.system_config.read',
  'platform.system_config.manage',
  'platform.system_health.read',
  'platform.notifications.broadcast',
] as const

export const TENANT_ADMIN_CAPABILITIES = [
  'tenant.dashboard.read',
  'tenant.doctors.read',
  'tenant.doctors.manage',
  'tenant.patients.read',
  'tenant.patients.manage',
  'tenant.patients.assign',
  'tenant.accounts.status.manage',
  'tenant.credentials.reset',
  'tenant.audit.read',
  'tenant.analytics.read',
  'tenant.billing.read',
  'tenant.billing.checkout',
  'tenant.notifications.broadcast',
  'tenant.operations_health.read',
] as const

export const ADMIN_CAPABILITIES = [
  ...PLATFORM_ADMIN_CAPABILITIES,
  ...TENANT_ADMIN_CAPABILITIES,
] as const

export type AdminCapability = typeof ADMIN_CAPABILITIES[number]
export type PlatformAdminCapability = typeof PLATFORM_ADMIN_CAPABILITIES[number]
export type TenantAdminCapability = typeof TENANT_ADMIN_CAPABILITIES[number]
export type AdminRoleKey = 'app_admin' | 'hospital_admin' | 'auditor'
export type AdminCapabilityMap = Partial<Record<AdminCapability, boolean>>
export type CompleteAdminCapabilityMap = Record<AdminCapability, boolean>
export type LegacyAdminPermission =
  | 'manage_hospitals'
  | 'manage_users'
  | 'manage_roles'
  | 'view_audit'
  | 'manage_doctors'
  | 'manage_patients'
  | 'export_data'
  | 'manage_billing'
  | 'manage_system'

export const ADMIN_ROLE_KEYS = ['app_admin', 'hospital_admin', 'auditor'] as const
export const EDITABLE_ADMIN_ROLE_KEYS = ['hospital_admin', 'auditor'] as const
export const ADMIN_POLICY_SCHEMA_VERSION = 2 as const
export const APP_ADMIN_RECOVERY_CAPABILITY: AdminCapability = 'platform.role_policy.manage'

export const ADMIN_ROLE_LABELS: Record<AdminRoleKey, string> = {
  app_admin: 'Application Admin',
  hospital_admin: 'Hospital Admin',
  auditor: 'System Auditor',
}

export const ADMIN_ROLE_CAPABILITY_ALLOWLISTS: Record<AdminRoleKey, readonly AdminCapability[]> = {
  app_admin: PLATFORM_ADMIN_CAPABILITIES,
  hospital_admin: TENANT_ADMIN_CAPABILITIES,
  auditor: [
    'platform.hospitals.read',
    'platform.role_policy.read',
    'platform.audit.read',
    'platform.analytics.read',
    'platform.billing.read',
    'platform.system_health.read',
  ],
}

export type AdminCapabilityMetadata = {
  label: string
  description: string
  classification: 'read' | 'mutation'
  scope: 'global' | 'tenant'
}

export const ADMIN_CAPABILITY_METADATA: Record<AdminCapability, AdminCapabilityMetadata> = {
  'platform.hospitals.read': { label: 'View hospitals', description: 'Read the hospital directory and operational metadata.', classification: 'read', scope: 'global' },
  'platform.hospitals.manage': { label: 'Manage hospitals', description: 'Create, update, suspend, or reactivate hospitals.', classification: 'mutation', scope: 'global' },
  'platform.admin_accounts.read': { label: 'View administrator accounts', description: 'Read Hospital Admin and System Auditor accounts.', classification: 'read', scope: 'global' },
  'platform.admin_accounts.manage': { label: 'Manage administrator accounts', description: 'Invite, update, suspend, restore, or reset MFA for Hospital Admins and System Auditors.', classification: 'mutation', scope: 'global' },
  'platform.role_policy.read': { label: 'View access policies', description: 'Read fixed administrator role policies and their history.', classification: 'read', scope: 'global' },
  'platform.role_policy.manage': { label: 'Manage access policies', description: 'Update or restore editable fixed administrator role policies.', classification: 'mutation', scope: 'global' },
  'platform.audit.read': { label: 'View global audit', description: 'Read global operational audit events.', classification: 'read', scope: 'global' },
  'platform.analytics.read': { label: 'View global analytics', description: 'Read global non-clinical operational analytics.', classification: 'read', scope: 'global' },
  'platform.billing.read': { label: 'View platform billing', description: 'Read platform billing and invoices.', classification: 'read', scope: 'global' },
  'platform.billing.manage': { label: 'Manage platform billing', description: 'Generate invoices and initiate supported platform billing operations.', classification: 'mutation', scope: 'global' },
  'platform.system_config.read': { label: 'View platform configuration', description: 'Read global runtime configuration.', classification: 'read', scope: 'global' },
  'platform.system_config.manage': { label: 'Manage platform configuration', description: 'Change global runtime configuration.', classification: 'mutation', scope: 'global' },
  'platform.system_health.read': { label: 'View platform health', description: 'Read global service and dependency health.', classification: 'read', scope: 'global' },
  'platform.notifications.broadcast': { label: 'Broadcast globally', description: 'Send a global administrative notification broadcast.', classification: 'mutation', scope: 'global' },
  'tenant.dashboard.read': { label: 'View hospital dashboard', description: 'Read the hospital-scoped operational dashboard.', classification: 'read', scope: 'tenant' },
  'tenant.doctors.read': { label: 'View doctors', description: 'List and inspect Doctor accounts in the assigned hospital.', classification: 'read', scope: 'tenant' },
  'tenant.doctors.manage': { label: 'Manage doctors', description: 'Create and update non-clinical Doctor account and profile data in the assigned hospital.', classification: 'mutation', scope: 'tenant' },
  'tenant.patients.read': { label: 'View patients', description: 'List and inspect Patient accounts in the assigned hospital.', classification: 'read', scope: 'tenant' },
  'tenant.patients.manage': { label: 'Manage patients', description: 'Create and update non-clinical Patient account and profile data in the assigned hospital.', classification: 'mutation', scope: 'tenant' },
  'tenant.patients.assign': { label: 'Assign patients', description: 'Assign or reassign a Patient to an eligible Doctor in the same hospital.', classification: 'mutation', scope: 'tenant' },
  'tenant.accounts.status.manage': { label: 'Manage account status', description: 'Suspend or restore eligible Doctor and Patient accounts in the assigned hospital.', classification: 'mutation', scope: 'tenant' },
  'tenant.credentials.reset': { label: 'Reset credentials', description: 'Reset Doctor or Patient credentials in the assigned hospital.', classification: 'mutation', scope: 'tenant' },
  'tenant.audit.read': { label: 'View hospital audit', description: 'Read audit events scoped to the assigned hospital.', classification: 'read', scope: 'tenant' },
  'tenant.analytics.read': { label: 'View hospital analytics', description: 'Read non-clinical operational analytics scoped to the assigned hospital.', classification: 'read', scope: 'tenant' },
  'tenant.billing.read': { label: 'View hospital billing', description: 'Read invoices belonging to the assigned hospital.', classification: 'read', scope: 'tenant' },
  'tenant.billing.checkout': { label: 'Start invoice checkout', description: 'Initiate checkout for an eligible invoice belonging to the assigned hospital.', classification: 'mutation', scope: 'tenant' },
  'tenant.notifications.broadcast': { label: 'Broadcast within hospital', description: 'Broadcast notifications only to eligible users in the assigned hospital.', classification: 'mutation', scope: 'tenant' },
  'tenant.operations_health.read': { label: 'View hospital operations health', description: 'Read hospital-scoped reminder and delivery health.', classification: 'read', scope: 'tenant' },
}

const ADMIN_CAPABILITY_SET = new Set<string>(ADMIN_CAPABILITIES)
const ADMIN_ROLE_KEY_SET = new Set<string>(ADMIN_ROLE_KEYS)
const LEGACY_ADMIN_PERMISSION_SET = new Set<string>([
  'manage_hospitals',
  'manage_users',
  'manage_roles',
  'view_audit',
  'manage_doctors',
  'manage_patients',
  'export_data',
  'manage_billing',
  'manage_system',
])

export function isAdminCapability(value: unknown): value is AdminCapability {
  return typeof value === 'string' && ADMIN_CAPABILITY_SET.has(value)
}

export function isAdminRoleKey(value: unknown): value is AdminRoleKey {
  return typeof value === 'string' && ADMIN_ROLE_KEY_SET.has(value)
}

export function isLegacyAdminPermission(value: unknown): value is LegacyAdminPermission {
  return typeof value === 'string' && LEGACY_ADMIN_PERMISSION_SET.has(value)
}

export function isReadAdminCapability(capability: AdminCapability): boolean {
  return ADMIN_CAPABILITY_METADATA[capability].classification === 'read'
}

export function isMutationAdminCapability(capability: AdminCapability): boolean {
  return ADMIN_CAPABILITY_METADATA[capability].classification === 'mutation'
}

export function adminCapabilityScope(capability: AdminCapability): 'global' | 'tenant' {
  return ADMIN_CAPABILITY_METADATA[capability].scope
}

export function toPlainCapabilityMap(value: unknown): Record<string, unknown> {
  if (value instanceof Map) return Object.fromEntries(value.entries())
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>))
  }
  return {}
}

export function createRoleCapabilityMap(
  role: AdminRoleKey,
  enabledCapabilities: Iterable<AdminCapability> = [],
): AdminCapabilityMap {
  const enabled = new Set(enabledCapabilities)
  return Object.fromEntries(
    ADMIN_ROLE_CAPABILITY_ALLOWLISTS[role].map(capability => [capability, enabled.has(capability)]),
  ) as AdminCapabilityMap
}

export function normalizeAdminCapabilityMap(role: AdminRoleKey, value: unknown): AdminCapabilityMap {
  const input = toPlainCapabilityMap(value)
  const allowlist = ADMIN_ROLE_CAPABILITY_ALLOWLISTS[role]
  const allowed = new Set<string>(allowlist)
  const unknown = Object.keys(input).filter(key => !allowed.has(key))
  const missing = allowlist.filter(capability => !Object.prototype.hasOwnProperty.call(input, capability))

  if (unknown.length) throw new Error(`Unsupported capabilities for ${role}: ${unknown.sort().join(', ')}`)
  if (missing.length) throw new Error(`Missing capabilities for ${role}: ${missing.join(', ')}`)

  const normalized: AdminCapabilityMap = {}
  for (const capability of allowlist) {
    const valueForCapability = input[capability]
    if (typeof valueForCapability !== 'boolean') {
      throw new Error(`Capability ${capability} must be boolean`)
    }
    normalized[capability] = valueForCapability
  }

  if (role === 'app_admin') {
    const disabled = allowlist.filter(capability => normalized[capability] !== true)
    if (disabled.length) throw new Error(`Application Admin capabilities cannot be disabled: ${disabled.join(', ')}`)
    if (normalized[APP_ADMIN_RECOVERY_CAPABILITY] !== true) {
      throw new Error('Application Admin policy recovery capability cannot be disabled')
    }
  }

  return normalized
}

export function getEnabledAdminCapabilities(role: AdminRoleKey, value: unknown): AdminCapability[] {
  const normalized = normalizeAdminCapabilityMap(role, value)
  return ADMIN_ROLE_CAPABILITY_ALLOWLISTS[role].filter(capability => normalized[capability] === true)
}

export const DEFAULT_ADMIN_ROLE_POLICIES: Record<AdminRoleKey, AdminCapabilityMap> = {
  app_admin: createRoleCapabilityMap('app_admin', PLATFORM_ADMIN_CAPABILITIES),
  hospital_admin: createRoleCapabilityMap('hospital_admin', TENANT_ADMIN_CAPABILITIES),
  auditor: createRoleCapabilityMap('auditor', ADMIN_ROLE_CAPABILITY_ALLOWLISTS.auditor),
}

export function translateLegacyAdminPermissions(
  role: AdminRoleKey,
  legacyValue: unknown,
): AdminCapabilityMap {
  if (role === 'app_admin') return { ...DEFAULT_ADMIN_ROLE_POLICIES.app_admin }

  const legacy = toPlainCapabilityMap(legacyValue)
  const enabled = new Set<AdminCapability>()
  const has = (permission: LegacyAdminPermission) => legacy[permission] === true

  if (role === 'hospital_admin') {
    if (has('manage_doctors')) {
      enabled.add('tenant.doctors.read')
      enabled.add('tenant.doctors.manage')
    }
    if (has('manage_patients')) {
      enabled.add('tenant.patients.read')
      enabled.add('tenant.patients.manage')
    }
    if (has('view_audit')) enabled.add('tenant.audit.read')
    if (has('manage_billing')) {
      enabled.add('tenant.billing.read')
      enabled.add('tenant.billing.checkout')
    }
    if (has('manage_users')) enabled.add('tenant.credentials.reset')
    if (has('manage_system')) {
      enabled.add('tenant.notifications.broadcast')
      enabled.add('tenant.operations_health.read')
    }
  } else {
    if (has('manage_hospitals')) enabled.add('platform.hospitals.read')
    if (has('manage_roles')) enabled.add('platform.role_policy.read')
    if (has('view_audit')) enabled.add('platform.audit.read')
    if (has('manage_billing')) enabled.add('platform.billing.read')
    if (has('manage_system')) enabled.add('platform.system_health.read')
    // export_data deliberately has no V2 mapping until an export endpoint exists.
  }

  return createRoleCapabilityMap(role, enabled)
}

export function translateLegacyPermissionForRole(
  role: AdminRoleKey,
  permission: LegacyAdminPermission,
): readonly AdminCapability[] {
  const translated = translateLegacyAdminPermissions(role, { [permission]: true })
  return ADMIN_ROLE_CAPABILITY_ALLOWLISTS[role].filter(capability => translated[capability] === true)
}
