import fs from 'fs'
import path from 'path'
import mongoose from 'mongoose'
import {
  ADMIN_POLICY_SCHEMA_VERSION,
  ADMIN_ROLE_KEYS,
  DEFAULT_ADMIN_ROLE_POLICIES,
  PLATFORM_ADMIN_CAPABILITIES,
  TENANT_ADMIN_CAPABILITIES,
  type AdminRoleKey,
} from '@alias/constants/admin-capabilities'
import AdminProfile, { AdminRole } from '@alias/models/adminprofile.model'
import DoctorProfile from '@alias/models/doctorprofile.model'
import Hospital from '@alias/models/hospital.model'
import PatientProfile from '@alias/models/patientprofile.model'
import User from '@alias/models/user.model'

export const PLATFORM_CAPABILITIES = PLATFORM_ADMIN_CAPABILITIES
export const TENANT_CAPABILITIES = TENANT_ADMIN_CAPABILITIES

export type AdminRbacRole = AdminRoleKey
export type CapabilityMap = Record<string, boolean>

type CreatableModel = {
  create(input: Record<string, unknown>): Promise<any>
}

export type AdminRbacPolicyModels = {
  policy: CreatableModel
  revision: CreatableModel
}

export type AdminRbacFixtureModels = {
  Hospital: CreatableModel
  AdminProfile: CreatableModel
  DoctorProfile: CreatableModel
  PatientProfile: CreatableModel
  User: CreatableModel
  AdminRolePolicy?: CreatableModel
  AdminRolePolicyRevision?: CreatableModel
}

const defaultModels: AdminRbacFixtureModels = {
  Hospital,
  AdminProfile,
  DoctorProfile,
  PatientProfile,
  User,
}

export const DEFAULT_POLICY_CAPABILITIES = Object.fromEntries(
  ADMIN_ROLE_KEYS.map(role => [role, { ...DEFAULT_ADMIN_ROLE_POLICIES[role] }]),
) as Record<AdminRbacRole, CapabilityMap>

let fixtureSequence = 0

function nextNamespace(requested?: string) {
  fixtureSequence += 1
  const value = requested ?? `rbac${fixtureSequence}`
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, '_')
}

function optionalModel(moduleBaseName: string, mongooseModelName: string): CreatableModel | undefined {
  const sourcePath = path.resolve(__dirname, '../../src/models', moduleBaseName)
  const exists = ['.ts', '.js', ''].some(extension => fs.existsSync(`${sourcePath}${extension}`))
  if (!exists) return undefined

  // A computed require keeps Wave 1 validation compilable before the additive
  // policy models land. Once present, Jest/Node resolves the source/build file.
  const loaded = require(sourcePath)
  return (loaded.default ?? loaded[mongooseModelName] ?? mongoose.models[mongooseModelName]) as CreatableModel | undefined
}

/**
 * Loads the additive policy models without forcing them to exist during the
 * parallel foundation wave. Callers that need persisted policies must treat an
 * undefined result as an unmet integration dependency, not as a passing test.
 */
export function loadAdminRbacPolicyModels(): AdminRbacPolicyModels | undefined {
  const policy = optionalModel('adminrolepolicy.model', 'AdminRolePolicy')
  const revision = optionalModel('adminrolepolicyrevision.model', 'AdminRolePolicyRevision')
  return policy && revision ? { policy, revision } : undefined
}

export function buildPolicyFixture(input: {
  role: AdminRbacRole
  updatedBy: unknown
  capabilities?: CapabilityMap
  version?: number
  overrides?: Record<string, unknown>
}) {
  return {
    role_key: input.role,
    capabilities: input.capabilities ?? { ...DEFAULT_POLICY_CAPABILITIES[input.role] },
    protected: input.role === AdminRole.APP_ADMIN,
    schema_version: ADMIN_POLICY_SCHEMA_VERSION,
    policy_version: input.version ?? 1,
    updated_by: input.updatedBy,
    change_reason: 'Wave 1 RBAC validation fixture',
    ...input.overrides,
  }
}

export function buildPolicyRevisionFixture(input: {
  role: AdminRbacRole
  actorId: unknown
  actorRole?: AdminRbacRole
  previousCapabilities?: CapabilityMap
  newCapabilities?: CapabilityMap
  previousVersion?: number
  newVersion?: number
  overrides?: Record<string, unknown>
}) {
  const previous = input.previousCapabilities ?? DEFAULT_POLICY_CAPABILITIES[input.role]
  const next = input.newCapabilities ?? DEFAULT_POLICY_CAPABILITIES[input.role]
  return {
    role_key: input.role,
    previous_capabilities: { ...previous },
    new_capabilities: { ...next },
    previous_policy_version: input.previousVersion ?? 1,
    new_policy_version: input.newVersion ?? 2,
    actor_user_id: input.actorId,
    actor_role: input.actorRole ?? AdminRole.APP_ADMIN,
    change_reason: 'Initial Wave 1 RBAC policy fixture',
    affected_active_account_count: 1,
    request_correlation_id: 'wave1-fixture-correlation-id',
    ...input.overrides,
  }
}

export type CreateAdminRbacFixturesOptions = {
  namespace?: string
  models?: Partial<AdminRbacFixtureModels>
  persistPolicies?: boolean
  policyOverrides?: Partial<Record<AdminRbacRole, Record<string, unknown>>>
  revisionOverrides?: Partial<Record<AdminRbacRole, Record<string, unknown>>>
}

/**
 * Creates two tenants, all three fixed admin roles, a doctor and patient in
 * each tenant, and policy/revision inputs for every admin role.
 */
export async function createAdminRbacFixtures(options: CreateAdminRbacFixturesOptions = {}) {
  const namespace = nextNamespace(options.namespace)
  const discoveredPolicyModels = options.persistPolicies ? loadAdminRbacPolicyModels() : undefined
  const models: AdminRbacFixtureModels = {
    ...defaultModels,
    ...options.models,
    AdminRolePolicy: options.models?.AdminRolePolicy ?? discoveredPolicyModels?.policy,
    AdminRolePolicyRevision: options.models?.AdminRolePolicyRevision ?? discoveredPolicyModels?.revision,
  }

  if (options.persistPolicies && (!models.AdminRolePolicy || !models.AdminRolePolicyRevision)) {
    throw new Error(
      'Admin RBAC fixture integration requires import-safe AdminRolePolicy and AdminRolePolicyRevision model exports.',
    )
  }

  const primaryHospital = await models.Hospital.create({
    code: `${namespace}_a`.toUpperCase(),
    name: `${namespace} Primary Hospital`,
    location: 'Coimbatore',
    admin_email: `${namespace}-primary@example.test`,
  })
  const secondaryHospital = await models.Hospital.create({
    code: `${namespace}_b`.toUpperCase(),
    name: `${namespace} Secondary Hospital`,
    location: 'Chennai',
    admin_email: `${namespace}-secondary@example.test`,
  })

  const createAdmin = async (role: AdminRole, hospitalId?: unknown) => {
    const profile = await models.AdminProfile.create({
      name: `${namespace} ${role}`,
      admin_role: role,
      ...(hospitalId ? { hospital_id: hospitalId } : {}),
    })
    const user = await models.User.create({
      login_id: `${namespace}_${role}`,
      password: 'Wave1-Test-Password-123!',
      user_type: 'ADMIN',
      profile_id: profile._id,
      is_active: true,
    })
    return { user, profile }
  }

  const appAdmin = await createAdmin(AdminRole.APP_ADMIN)
  const hospitalAdmin = await createAdmin(AdminRole.HOSPITAL_ADMIN, primaryHospital._id)
  const auditor = await createAdmin(AdminRole.AUDITOR)

  const createClinicalPair = async (suffix: string, hospitalId: unknown) => {
    const doctorProfile = await models.DoctorProfile.create({
      name: `Dr ${namespace} ${suffix}`,
      department: 'Cardiology',
      contact_number: suffix === 'a' ? '9000000001' : '9000000002',
      hospital_id: hospitalId,
    })
    const doctor = await models.User.create({
      login_id: `${namespace}_doctor_${suffix}`,
      password: 'Wave1-Test-Password-123!',
      user_type: 'DOCTOR',
      profile_id: doctorProfile._id,
      is_active: true,
    })
    const patientProfile = await models.PatientProfile.create({
      assigned_doctor_id: doctor._id,
      hospital_id: hospitalId,
      demographics: {
        name: `${namespace} Patient ${suffix.toUpperCase()}`,
        age: 50,
        gender: 'Other',
        phone: suffix === 'a' ? '9111111111' : '9222222222',
      },
    })
    const patient = await models.User.create({
      login_id: `${namespace}_patient_${suffix}`,
      password: 'Wave1-Test-Password-123!',
      user_type: 'PATIENT',
      profile_id: patientProfile._id,
      is_active: true,
    })
    return { doctor, doctorProfile, patient, patientProfile }
  }

  const primaryClinical = await createClinicalPair('a', primaryHospital._id)
  const secondaryClinical = await createClinicalPair('b', secondaryHospital._id)

  // Keep fixture builders on ADMIN_ROLE_KEYS so they stay aligned with
  // DEFAULT_POLICY_CAPABILITIES and the production role allowlist.
  const policyInputs = ADMIN_ROLE_KEYS.map(role => buildPolicyFixture({
    role,
    updatedBy: appAdmin.user._id,
    overrides: options.policyOverrides?.[role],
  }))
  const revisionInputs = ADMIN_ROLE_KEYS.map(role => buildPolicyRevisionFixture({
    role,
    actorId: appAdmin.user._id,
    overrides: options.revisionOverrides?.[role],
  }))

  const policies = options.persistPolicies
    ? await Promise.all(policyInputs.map(input => models.AdminRolePolicy!.create(input)))
    : []
  const revisions = options.persistPolicies
    ? await Promise.all(revisionInputs.map(input => models.AdminRolePolicyRevision!.create(input)))
    : []

  return {
    namespace,
    hospitals: { primary: primaryHospital, secondary: secondaryHospital },
    admins: { appAdmin, hospitalAdmin, auditor },
    clinical: { primary: primaryClinical, secondary: secondaryClinical },
    policyInputs,
    revisionInputs,
    policies,
    revisions,
  }
}
