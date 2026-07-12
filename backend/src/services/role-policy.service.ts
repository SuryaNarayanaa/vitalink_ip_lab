import { RoleDefinition } from '@alias/models'

export const DEFAULT_ROLE_DEFINITIONS: Record<string, {
  label: string
  color: string
  permissions: Record<string, boolean>
}> = {
  app_admin: {
    label: 'App Admin', color: 'admin',
    permissions: { manage_hospitals: true, manage_users: true, manage_roles: true, view_audit: true, manage_doctors: true, manage_patients: true, export_data: true, manage_billing: true, manage_system: true },
  },
  hospital_admin: {
    label: 'Hospital Admin', color: 'doctor',
    // manage_hospitals is true so tenant admins can list their hospital for console pickers;
    // create/update/delete remain App Admin-only in the service layer.
    permissions: { manage_hospitals: true, manage_users: true, manage_roles: false, view_audit: true, manage_doctors: true, manage_patients: true, export_data: false, manage_billing: true, manage_system: true },
  },
  doctor: {
    label: 'Doctor', color: 'doctor',
    permissions: { manage_hospitals: false, manage_users: false, manage_roles: false, view_audit: false, manage_doctors: false, manage_patients: true, export_data: false, manage_billing: false, manage_system: false },
  },
  patient: {
    label: 'Patient', color: 'patient',
    permissions: { manage_hospitals: false, manage_users: false, manage_roles: false, view_audit: false, manage_doctors: false, manage_patients: false, export_data: false, manage_billing: false, manage_system: false },
  },
  auditor: {
    label: 'System Auditor', color: 'auditor',
    permissions: { manage_hospitals: false, manage_users: false, manage_roles: false, view_audit: true, manage_doctors: false, manage_patients: false, export_data: true, manage_billing: true, manage_system: false },
  },
}

function normalizePermissions(value: unknown): Record<string, boolean> {
  if (value instanceof Map) return Object.fromEntries(value) as Record<string, boolean>
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, boolean>))
  return {}
}

/** Fill missing permission keys from defaults without overwriting saved values. */
function mergeWithDefaultPermissions(roleKey: string, stored: Record<string, boolean>): Record<string, boolean> {
  const defaults = DEFAULT_ROLE_DEFINITIONS[roleKey]?.permissions || {}
  const merged: Record<string, boolean> = { ...defaults }
  for (const [key, value] of Object.entries(stored)) {
    if (Object.prototype.hasOwnProperty.call(defaults, key) && typeof value === 'boolean') {
      merged[key] = value
    }
  }
  if (roleKey === 'app_admin') merged.manage_roles = true
  return merged
}

let ensurePromise: Promise<void> | null = null

async function ensureRoleDefinitionsOnce() {
  // Insert only missing role documents — never overwrite saved permission edits.
  await RoleDefinition.bulkWrite(Object.entries(DEFAULT_ROLE_DEFINITIONS).map(([role_key, role]) => ({
    updateOne: {
      filter: { role_key },
      update: { $setOnInsert: { role_key, ...role } },
      upsert: true,
    },
  })) as any)

  // Backfill newly introduced permission keys on existing documents without clobbering edits.
  const existing = await RoleDefinition.find().select('role_key permissions')
  for (const doc of existing) {
    const defaults = DEFAULT_ROLE_DEFINITIONS[doc.role_key]?.permissions
    if (!defaults) continue
    const current = normalizePermissions(doc.permissions)
    let changed = false
    for (const [key, value] of Object.entries(defaults)) {
      if (!(key in current)) {
        current[key] = value
        changed = true
      }
    }
    if (doc.role_key === 'app_admin' && current.manage_roles !== true) {
      current.manage_roles = true
      changed = true
    }
    if (changed) {
      doc.permissions = current as any
      await doc.save()
    }
  }
}

/** Seed/backfill role documents. Cached after success; re-runs if the collection is empty (e.g. test DB reset). */
async function ensureRoleDefinitions() {
  if (ensurePromise) {
    const count = await RoleDefinition.estimatedDocumentCount()
    if (count > 0) {
      await ensurePromise
      return
    }
    ensurePromise = null
  }
  ensurePromise = ensureRoleDefinitionsOnce().catch(error => {
    ensurePromise = null
    throw error
  })
  await ensurePromise
}

export async function getRoleDefinitions() {
  await ensureRoleDefinitions()
  const roles = await RoleDefinition.find().lean()
  return Object.fromEntries(roles.map(role => [role.role_key, {
    label: role.label,
    color: role.color,
    permissions: mergeWithDefaultPermissions(role.role_key, normalizePermissions(role.permissions)),
  }]))
}

export async function getRolePermissions(roleKey: string) {
  await ensureRoleDefinitions()
  const role = await RoleDefinition.findOne({ role_key: roleKey }).lean()
  return mergeWithDefaultPermissions(roleKey, normalizePermissions(role?.permissions))
}

export async function updateRolePermissions(roleKey: string, permissions: Record<string, boolean>) {
  await ensureRoleDefinitions()
  const role = await RoleDefinition.findOne({ role_key: roleKey })
  if (!role) return null

  const current = mergeWithDefaultPermissions(roleKey, normalizePermissions(role.permissions))
  const allowedKeys = Object.keys(DEFAULT_ROLE_DEFINITIONS[roleKey]?.permissions || {})
  for (const [key, value] of Object.entries(permissions)) {
    if (allowedKeys.includes(key) && typeof value === 'boolean') current[key] = value
  }
  // Retain a recovery path for the only role allowed to administer role policy.
  if (roleKey === 'app_admin') current.manage_roles = true
  role.permissions = current as any
  await role.save()
  return { label: role.label, color: role.color, permissions: current }
}
