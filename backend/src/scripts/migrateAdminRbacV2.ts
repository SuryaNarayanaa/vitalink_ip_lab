import 'dotenv/config'
import { createHash } from 'crypto'
import mongoose from 'mongoose'
import connectDB from '@alias/config/db'
import {
  ADMIN_POLICY_SCHEMA_VERSION,
  ADMIN_ROLE_KEYS,
  DEFAULT_ADMIN_ROLE_POLICIES,
  type AdminCapabilityMap,
  type AdminRoleKey,
  createRoleCapabilityMap,
  isLegacyAdminPermission,
  normalizeAdminCapabilityMap,
  toPlainCapabilityMap,
  translateLegacyAdminPermissions,
} from '@alias/constants/admin-capabilities'
import AdminRolePolicy from '@alias/models/adminrolepolicy.model'
import AdminRolePolicyRevision from '@alias/models/adminrolepolicyrevision.model'
import AdminProfile from '@alias/models/adminprofile.model'
import Hospital, { HospitalStatus } from '@alias/models/hospital.model'
import RoleDefinition from '@alias/models/roledefinition.model'
import User from '@alias/models/user.model'

export const ADMIN_RBAC_V2_MIGRATION_ID = 'admin-rbac-v2'

export type LegacyRoleDefinitionRecord = {
  role_key: string
  permissions?: unknown
}

export type AdminAccountMigrationRecord = {
  userId: string
  role?: string
  hospitalId?: string
  active: boolean
}

export type HospitalMigrationRecord = {
  id: string
  status?: string
}

export type ExistingPolicyMigrationRecord = {
  roleKey: string
  capabilities?: unknown
  protected?: unknown
  schemaVersion?: unknown
  policyVersion?: unknown
}

export type NewPolicyMigrationRecord = {
  role_key: AdminRoleKey
  capabilities: AdminCapabilityMap
  protected: boolean
  schema_version: 2
  policy_version: 1
  updated_by: string
  change_reason: string
}

export type AdminRbacV2MigrationAdapter = {
  listLegacyRoleDefinitions(): Promise<LegacyRoleDefinitionRecord[]>
  listAdminAccounts(): Promise<AdminAccountMigrationRecord[]>
  listHospitals(): Promise<HospitalMigrationRecord[]>
  listExistingPolicies(): Promise<ExistingPolicyMigrationRecord[]>
  insertPolicies(policies: NewPolicyMigrationRecord[]): Promise<void>
}

export type AdminRbacV2MigrationReport = {
  migrationId: string
  sourceSnapshotHash: string
  mode: 'dry-run' | 'execute' | 'verify'
  legacyRoles: string[]
  unsupportedLegacyKeys: Record<string, string[]>
  activeAccountsByRole: Record<string, number>
  tenantlessHospitalAdmins: string[]
  auditorsWithHospital: string[]
  applicationAdminsWithHospital: string[]
  missingOrInactiveHospitalAssignments: string[]
  invalidRoleAccounts: string[]
  activeApplicationAdminCount: number
  applicationAdminRecoveryReady: boolean
  proposedPolicies: Record<AdminRoleKey, AdminCapabilityMap>
  invalidExistingPolicies: string[]
  documents: {
    wouldAdd: AdminRoleKey[]
    added: AdminRoleKey[]
    retainedForCompatibility: string[]
    wouldChange: string[]
    laterRemovalCandidates: string[]
  }
  blockers: string[]
  verificationPassed?: boolean
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value instanceof Map) return stableValue(Object.fromEntries(value.entries()))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    )
  }
  return value
}

function snapshotHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

function proposedPolicyForRole(
  roleKey: AdminRoleKey,
  legacyRoles: LegacyRoleDefinitionRecord[],
): AdminCapabilityMap {
  if (roleKey === 'app_admin') return { ...DEFAULT_ADMIN_ROLE_POLICIES.app_admin }
  const legacy = legacyRoles.find(role => role.role_key === roleKey)
  // Missing legacy policy grants nothing. An Application Admin can explicitly
  // enable the approved allowlist after migration review.
  return legacy
    ? translateLegacyAdminPermissions(roleKey, legacy.permissions)
    : createRoleCapabilityMap(roleKey)
}

function validateExistingPolicy(policy: ExistingPolicyMigrationRecord): boolean {
  if (!ADMIN_ROLE_KEYS.includes(policy.roleKey as AdminRoleKey)) return false
  const roleKey = policy.roleKey as AdminRoleKey
  if (policy.schemaVersion !== ADMIN_POLICY_SCHEMA_VERSION) return false
  if (!Number.isSafeInteger(policy.policyVersion) || Number(policy.policyVersion) < 1) return false
  if (typeof policy.protected !== 'boolean') return false
  if (roleKey === 'app_admin' && policy.protected !== true) return false
  try {
    normalizeAdminCapabilityMap(roleKey, policy.capabilities)
    return true
  } catch {
    return false
  }
}

const productionAdapter: AdminRbacV2MigrationAdapter = {
  async listLegacyRoleDefinitions() {
    const roles = await RoleDefinition.find().select('role_key permissions').lean()
    return roles.map(role => ({ role_key: role.role_key, permissions: role.permissions }))
  },
  async listAdminAccounts() {
    const profiles = await AdminProfile.find().select('_id admin_role hospital_id').lean()
    const profileById = new Map(profiles.map(profile => [String(profile._id), profile]))
    const users = await User.find({ user_type: 'ADMIN' }).select('_id profile_id is_active').lean()
    return users.map(user => {
      const profile = profileById.get(String(user.profile_id))
      return {
        userId: String(user._id),
        role: profile?.admin_role,
        hospitalId: profile?.hospital_id ? String(profile.hospital_id) : undefined,
        active: user.is_active === true,
      }
    })
  },
  async listHospitals() {
    const hospitals = await Hospital.find().select('_id status').lean()
    return hospitals.map(hospital => ({ id: String(hospital._id), status: hospital.status }))
  },
  async listExistingPolicies() {
    const policies = await AdminRolePolicy.find().lean()
    return policies.map(policy => ({
      roleKey: policy.role_key,
      capabilities: policy.capabilities,
      protected: policy.protected,
      schemaVersion: policy.schema_version,
      policyVersion: policy.policy_version,
    }))
  },
  async insertPolicies(policies) {
    if (!policies.length) return
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        // Mongoose 9 requires ordered:true when create() is called with a
        // session and multiple documents.
        await AdminRolePolicy.create(policies, { session, ordered: true })
      })
    } finally {
      await session.endSession()
    }
  },
}

export async function runAdminRbacV2Migration(input: {
  execute?: boolean
  verify?: boolean
  migrationId?: string
  adapter?: AdminRbacV2MigrationAdapter
} = {}): Promise<AdminRbacV2MigrationReport> {
  if (input.execute && input.verify) throw new Error('Use --execute and --verify as separate reviewed operations')
  const adapter = input.adapter ?? productionAdapter
  const migrationId = input.migrationId?.trim() || ADMIN_RBAC_V2_MIGRATION_ID
  const [legacyRoles, accounts, hospitals, existingPolicies] = await Promise.all([
    adapter.listLegacyRoleDefinitions(),
    adapter.listAdminAccounts(),
    adapter.listHospitals(),
    adapter.listExistingPolicies(),
  ])
  const sourceSnapshotHash = snapshotHash({ legacyRoles, accounts, hospitals, existingPolicies })
  const hospitalById = new Map(hospitals.map(hospital => [hospital.id, hospital]))
  const activeAccounts = accounts.filter(account => account.active)
  const activeApplicationAdmins = activeAccounts.filter(account => account.role === 'app_admin')
  const unsupportedLegacyKeys = Object.fromEntries(legacyRoles.map(role => [
    role.role_key,
    Object.keys(toPlainCapabilityMap(role.permissions)).filter(key => !isLegacyAdminPermission(key)).sort(),
  ]))
  const activeAccountsByRole: Record<string, number> = {}
  for (const account of activeAccounts) {
    const key = account.role || 'invalid_or_missing_role'
    activeAccountsByRole[key] = (activeAccountsByRole[key] || 0) + 1
  }

  const tenantlessHospitalAdmins = activeAccounts
    .filter(account => account.role === 'hospital_admin' && !account.hospitalId)
    .map(account => account.userId)
  const auditorsWithHospital = activeAccounts
    .filter(account => account.role === 'auditor' && account.hospitalId)
    .map(account => account.userId)
  const applicationAdminsWithHospital = activeAccounts
    .filter(account => account.role === 'app_admin' && account.hospitalId)
    .map(account => account.userId)
  const missingOrInactiveHospitalAssignments = activeAccounts
    .filter(account => account.role === 'hospital_admin' && account.hospitalId)
    .filter(account => hospitalById.get(account.hospitalId!)?.status !== HospitalStatus.ACTIVE)
    .map(account => account.userId)
  const invalidRoleAccounts = activeAccounts
    .filter(account => !ADMIN_ROLE_KEYS.includes(account.role as AdminRoleKey))
    .map(account => account.userId)

  const proposedPolicies = Object.fromEntries(ADMIN_ROLE_KEYS.map(roleKey => [
    roleKey,
    proposedPolicyForRole(roleKey, legacyRoles),
  ])) as Record<AdminRoleKey, AdminCapabilityMap>
  const existingRoles = new Set(existingPolicies.map(policy => policy.roleKey))
  const wouldAdd = ADMIN_ROLE_KEYS.filter(roleKey => !existingRoles.has(roleKey))
  const invalidExistingPolicies = existingPolicies
    .filter(policy => !validateExistingPolicy(policy))
    .map(policy => policy.roleKey)
  const blockers: string[] = []
  const blockerCodes = new Set<string>()
  const pushBlocker = (code: string, message: string) => {
    if (blockerCodes.has(code)) return
    blockerCodes.add(code)
    blockers.push(message)
  }
  if (!activeApplicationAdmins.length) {
    pushBlocker('missing_active_app_admin', 'At least one active Application Admin is required as the migration actor and recovery principal.')
  }
  if (tenantlessHospitalAdmins.length) {
    pushBlocker('tenantless_hospital_admin', 'Active Hospital Admin accounts without a hospital must be resolved.')
  }
  if (auditorsWithHospital.length) {
    pushBlocker('auditor_with_hospital', 'Hospital-scoped System Auditors require explicit Application Admin review; migration will not globalize them.')
  }
  if (applicationAdminsWithHospital.length) {
    pushBlocker('app_admin_with_hospital', 'Application Admin accounts must not carry a hospital assignment.')
  }
  if (missingOrInactiveHospitalAssignments.length) {
    pushBlocker('inactive_hospital_assignment', 'Hospital Admin accounts assigned to missing or inactive hospitals must be resolved.')
  }
  if (invalidRoleAccounts.length) {
    pushBlocker('invalid_admin_role', 'Active administrator accounts with missing or unsupported fixed roles must be resolved.')
  }
  if (invalidExistingPolicies.length) {
    pushBlocker('invalid_existing_policy', 'Existing V2 policy documents are invalid and will not be overwritten automatically.')
  }

  const appPolicy = existingPolicies.find(policy => policy.roleKey === 'app_admin')
  const applicationAdminRecoveryReady = activeApplicationAdmins.length > 0
    && (!appPolicy || validateExistingPolicy(appPolicy))
  if (!applicationAdminRecoveryReady && !blockerCodes.has('missing_active_app_admin') && !blockerCodes.has('invalid_existing_policy')) {
    pushBlocker('app_admin_recovery', 'Application Admin recovery invariant is not satisfied.')
  }

  const report: AdminRbacV2MigrationReport = {
    migrationId,
    sourceSnapshotHash,
    mode: input.execute ? 'execute' : input.verify ? 'verify' : 'dry-run',
    legacyRoles: legacyRoles.map(role => role.role_key).sort(),
    unsupportedLegacyKeys,
    activeAccountsByRole,
    tenantlessHospitalAdmins,
    auditorsWithHospital,
    applicationAdminsWithHospital,
    missingOrInactiveHospitalAssignments,
    invalidRoleAccounts,
    activeApplicationAdminCount: activeApplicationAdmins.length,
    applicationAdminRecoveryReady,
    proposedPolicies,
    invalidExistingPolicies,
    documents: {
      wouldAdd,
      added: [],
      retainedForCompatibility: legacyRoles.map(role => role.role_key).sort(),
      wouldChange: [],
      laterRemovalCandidates: legacyRoles
        .filter(role => role.role_key === 'doctor' || role.role_key === 'patient')
        .map(role => role.role_key)
        .sort(),
    },
    blockers,
  }

  if (input.verify) {
    report.verificationPassed = blockers.length === 0 && wouldAdd.length === 0
    return report
  }
  if (!input.execute) return report
  if (blockers.length) throw new Error(`Migration preflight blocked: ${blockers.join(' ')}`)

  const actorUserId = activeApplicationAdmins[0].userId
  const policies = wouldAdd.map(roleKey => ({
    role_key: roleKey,
    capabilities: proposedPolicies[roleKey],
    protected: roleKey === 'app_admin',
    schema_version: ADMIN_POLICY_SCHEMA_VERSION,
    policy_version: 1 as const,
    updated_by: actorUserId,
    change_reason: `Additive ${migrationId} migration from source snapshot ${sourceSnapshotHash}`,
  }))
  await adapter.insertPolicies(policies)
  report.documents.added = [...wouldAdd]
  return report
}

export function parseAdminRbacV2MigrationArgs(args: string[]) {
  if (args.includes('--help') || args.includes('-h')) {
    return { help: true, execute: false, verify: false, migrationId: ADMIN_RBAC_V2_MIGRATION_ID }
  }
  const execute = args.includes('--execute')
  const verify = args.includes('--verify')
  const dryRun = args.includes('--dry-run')
  const migrationIdArgument = args.find(argument => argument.startsWith('--migration-id='))
  const known = args.filter(argument => (
    argument === '--execute'
    || argument === '--verify'
    || argument === '--dry-run'
    || argument.startsWith('--migration-id=')
  ))
  if (known.length !== args.length) {
    const unknown = args.filter(argument => !known.includes(argument))
    throw new Error(`Unknown argument(s): ${unknown.join(', ')}`)
  }
  if ([execute, verify, dryRun].filter(Boolean).length > 1) {
    throw new Error('Choose only one mode: --dry-run, --execute, or --verify')
  }
  const migrationId = migrationIdArgument?.slice('--migration-id='.length).trim() || ADMIN_RBAC_V2_MIGRATION_ID
  return { help: false, execute, verify, migrationId }
}

async function main() {
  const options = parseAdminRbacV2MigrationArgs(process.argv.slice(2))
  if (options.help) {
    console.log('Usage: ts-node src/scripts/migrateAdminRbacV2.ts [--dry-run|--execute|--verify] [--migration-id=<id>]')
    console.log('Defaults to dry-run. Review and archive the report before a separate --execute operation.')
    return
  }
  mongoose.set('autoIndex', false)
  await connectDB()
  // autoIndex is off for migration processes; ensure declared indexes (including
  // unique role_key and revision history uniqueness) exist before execute-path
  // inserts. Use createIndexes() so we only ensure schema-declared indexes and
  // never prune unrelated ones.
  if (options.execute) {
    await Promise.all([
      AdminRolePolicy.createIndexes(),
      AdminRolePolicyRevision.createIndexes(),
    ])
  }
  const report = await runAdminRbacV2Migration(options)
  console.log('--- Admin RBAC V2 Migration ---')
  console.log(JSON.stringify(report, null, 2))
  await mongoose.disconnect()
  if (options.verify && report.verificationPassed !== true) process.exitCode = 2
}

if (require.main === module) {
  main().catch(async error => {
    console.error(`Admin RBAC V2 migration failed: ${error instanceof Error ? error.message : String(error)}`)
    await mongoose.disconnect().catch(() => undefined)
    process.exit(1)
  })
}
