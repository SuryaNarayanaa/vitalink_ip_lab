import crypto from 'crypto'
import { StatusCodes } from 'http-status-codes'
import { User, DoctorProfile, PatientProfile, AuditLog, AdminProfile, Hospital, Invoice } from '@alias/models'
import { ApiError } from '@alias/utils'
import { UserType } from '@alias/validators'
import { adminResetPassword, generateTemporaryPassword, setUserPasswordWithPolicy } from './password.service'
import { bestEffortRevokeSessionsAfterSecurityVersionBump, revokeActiveAuthSessionsForUsers } from './auth-session.service'
import { AuthSessionRevocationReason } from '@alias/models/authsession.model'
import mongoose from 'mongoose'
import { AdminRole } from '@alias/models/adminprofile.model'
import { HospitalStatus } from '@alias/models/hospital.model'
import { InvoiceStatus } from '@alias/models/invoice.model'
import { DEFAULT_ROLE_DEFINITIONS, getRoleDefinitions, getRolePermissions, updateRolePermissions } from './role-policy.service'
import type { AdminAccessContext } from '@alias/types/admin-access'
import {
  createAdminAccount,
  listAdminAccounts,
  resetAdminAccountMfa,
  updateAdminAccount,
} from './admin-account.service'
import { createDoctorUpdateNotification } from './doctor-update-notification.service'
import { acquireDoctorAssignmentGuard, acquireDoctorMoveGuard, acquireHospitalMembershipGuard, acquireHospitalMembershipGuards, acquireHospitalTransitionGuard, deactivateDoctorWithAssignmentGuard, stampDoctorProfileFence, terminalizePatientAssignment } from './doctor-assignment.service'
import logger from '@alias/utils/logger'
import { hasActiveHospitalAccess } from './hospital-access.service'
import { acquirePatientFileOperationLease } from './patient-file-purge.service'

/** @deprecated Prefer DEFAULT_ROLE_DEFINITIONS / persisted role policy. Kept as a re-export for callers. */
export const ROLE_DEFINITIONS = DEFAULT_ROLE_DEFINITIONS

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const paginationResult = (total: number, page: number, limit: number) => ({
  total,
  page,
  limit,
  pages: Math.ceil(total / limit),
  hasNext: page * limit < total,
  hasPrev: page > 1,
})

const emptyPaginatedResult = (key: 'doctors' | 'patients', page: number, limit: number) => ({
  [key]: [],
  pagination: paginationResult(0, page, limit),
})

const ADMIN_ROLES = Object.values(AdminRole) as string[]

type AdminActorInput = string | AdminAccessContext | undefined

const OPERATIONAL_SECURITY_FIELDS = new Set([
  'password', 'new_password', 'credential', 'credentials', 'is_active', 'status',
  'account_status', 'lifecycle_status', 'admin_mfa', 'mfa', 'totp', 'security_version',
  'must_change_password', 'password_history', 'password_changed_at', 'salt',
  'failed_login_attempts', 'locked_until', 'last_failed_login_at',
])

const PATIENT_CLINICAL_FIELDS = new Set([
  'medical_config', 'diagnosis', 'therapy_drug', 'therapy_start_date', 'target_inr',
  'dosage', 'dosage_schedule', 'instructions', 'clinical_instructions', 'inr',
  'inr_value', 'inr_log', 'inr_logs', 'inr_result', 'inr_results', 'treatment',
  'treatment_data', 'treatment_decision', 'treatment_decisions', 'health_log', 'health_logs',
])

function findForbiddenOperationalField(
  value: unknown,
  forbidden: ReadonlySet<string>,
  path = '',
): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const nested = findForbiddenOperationalField(value[index], forbidden, `${path}[${index}]`)
      if (nested) return nested
    }
    return undefined
  }
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.trim().toLowerCase().replace(/[\s-]+/g, '_')
    const fieldPath = path ? `${path}.${key}` : key
    if (
      forbidden.has(normalized)
      || normalized.includes('password')
      || normalized.includes('credential')
      || normalized.includes('security_')
      || normalized.startsWith('mfa_')
      || normalized.startsWith('totp_')
    ) {
      return fieldPath
    }
    const nested = findForbiddenOperationalField(nestedValue, forbidden, fieldPath)
    if (nested) return nested
  }
  return undefined
}

/**
 * Defense in depth for direct service callers. HTTP validators reject the same
 * payloads before controller invocation, while this guard guarantees that no
 * generic Doctor/Patient service can partially apply an unsafe request.
 */
export function assertOperationalAccountPayloadSafe(
  data: unknown,
  options: { patient?: boolean; forbidAssignment?: boolean } = {},
) {
  const forbidden = new Set(OPERATIONAL_SECURITY_FIELDS)
  if (options.patient) {
    for (const field of PATIENT_CLINICAL_FIELDS) forbidden.add(field)
  }
  if (options.forbidAssignment) forbidden.add('assigned_doctor_id')
  const field = findForbiddenOperationalField(data, forbidden)
  if (field) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Field ${field} is not allowed in generic administrative account payloads`,
    )
  }
}

/**
 * Create a profile and its owning user as one unit.  MongoDB transactions need
 * a replica set; the compensation path keeps local standalone deployments from
 * leaving an orphan profile when user creation fails.
 */
async function createProfileAndUser<T extends mongoose.Document>(
  createProfile: (session?: mongoose.ClientSession) => Promise<T>,
  createUser: (profileId: mongoose.Types.ObjectId, session?: mongoose.ClientSession) => Promise<any>,
) {
  const session = await mongoose.startSession()
  let profile: T | undefined
  let user: any
  try {
    await session.withTransaction(async () => {
      profile = await createProfile(session)
      user = await createUser(profile!._id, session)
    })
    return { profile: profile!, user }
  } catch (error: any) {
    // A standalone MongoDB cannot run transactions. Preserve the same
    // no-orphan guarantee for local development while production uses the
    // transaction above.
    if (!/Transaction numbers are only allowed|replica set member|Transaction support/i.test(String(error?.message))) {
      throw error
    }
    profile = undefined
    try {
      profile = await createProfile()
      user = await createUser(profile._id)
      return { profile, user }
    } catch (fallbackError) {
      if (profile?._id) await profile.deleteOne()
      throw fallbackError
    }
  } finally {
    await session.endSession()
  }
}

/**
 * A linked User/Profile pair is externally visible once standalone fallback
 * creation completes. A later lease loss must never split it with independent
 * deletes. Preserve a successor-valid membership; otherwise fail closed by
 * deactivating the owning User while retaining the link for reconciliation.
 */
async function terminalizePublishedUserProfile(created: { user: any; profile: any }) {
  const currentUser = await User.findOne({
    _id: created.user._id,
    profile_id: created.profile._id,
  }).select('is_active user_type profile_id').lean()
  if (!currentUser) return false
  if (currentUser.is_active && await hasActiveHospitalAccess(currentUser)) return true
  await User.updateOne(
    { _id: currentUser._id, profile_id: created.profile._id },
    { $set: { is_active: false } },
  )
  return false
}

async function findDoctorByIdentifier(identifier: string) {
  let doctor = null
  if (mongoose.Types.ObjectId.isValid(identifier)) {
    doctor = await User.findById(identifier)
  }
  if (!doctor || doctor.user_type !== UserType.DOCTOR) {
    doctor = await User.findOne({ login_id: identifier, user_type: UserType.DOCTOR })
  }
  if (!doctor || doctor.user_type !== UserType.DOCTOR) {
    return null
  }
  return doctor
}

async function findDoctorByAssignment(assignedDoctorId: unknown) {
  if (!assignedDoctorId) return null
  return User.findOne({
    user_type: UserType.DOCTOR,
    $or: [
      { _id: assignedDoctorId },
      { profile_id: assignedDoctorId },
    ],
  })
}

export async function getAdminContext(actor?: AdminActorInput) {
  if (!actor) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Valid admin profile is required')
  }
  if (typeof actor === 'object') {
    const hospitalAdminScope = actor.role === AdminRole.HOSPITAL_ADMIN
      && actor.scope === 'tenant'
      && Boolean(actor.hospitalId && actor.hospitalCode)
    const globalAdminScope = actor.role !== AdminRole.HOSPITAL_ADMIN
      && actor.scope === 'global'
      && !actor.hospitalId
    if (!hospitalAdminScope && !globalAdminScope) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'Valid administrator scope is required')
    }
    return {
      role: actor.role as AdminRole,
      hospitalId: actor.hospitalId,
      hospitalCode: actor.hospitalCode,
      isAppAdmin: actor.role === AdminRole.APP_ADMIN,
      isHospitalAdmin: actor.role === AdminRole.HOSPITAL_ADMIN,
      isAuditor: actor.role === AdminRole.AUDITOR,
      permissions: actor.permissions,
    }
  }
  const userId = actor
  const user = await User.findById(userId).populate({
    path: 'profile_id',
    populate: { path: 'hospital_id' },
  })
  const profile: any = user?.profile_id
  const role = profile?.admin_role
  if (!user || !user.is_active || user.user_type !== UserType.ADMIN || !profile || !ADMIN_ROLES.includes(role)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Valid active admin profile is required')
  }
  const hospitalId = profile?.hospital_id?._id || profile?.hospital_id
  if (role === AdminRole.HOSPITAL_ADMIN) {
    if (!hospitalId || profile?.hospital_id?.status !== HospitalStatus.ACTIVE) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'Hospital Admin must be assigned to one active hospital')
    }
  } else if (hospitalId) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      `${role === AdminRole.AUDITOR ? 'System Auditor' : 'Application Admin'} must not be assigned to a hospital`,
    )
  }
  const permissions = await getRolePermissions(role)
  return {
    role,
    hospitalId: hospitalId ? String(hospitalId) : undefined,
    hospitalCode: profile?.hospital_id?.code,
    isAppAdmin: role === AdminRole.APP_ADMIN,
    isHospitalAdmin: role === AdminRole.HOSPITAL_ADMIN,
    isAuditor: role === AdminRole.AUDITOR,
    permissions,
  }
}

export function requireCanMutate(ctx: Awaited<ReturnType<typeof getAdminContext>>) {
  if (ctx.isAuditor) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Auditors have read-only access')
  }
}

export function requirePermission(ctx: Awaited<ReturnType<typeof getAdminContext>>, permission: string) {
  if (!ctx.permissions[permission]) {
    throw new ApiError(StatusCodes.FORBIDDEN, `Role does not have the ${permission} permission`)
  }
}

function requireAppAdmin(ctx: Awaited<ReturnType<typeof getAdminContext>>) {
  if (!ctx.isAppAdmin) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'App Admin access is required')
  }
}

function requireHospitalAdmin(ctx: Awaited<ReturnType<typeof getAdminContext>>) {
  if (!ctx.isHospitalAdmin || !ctx.hospitalId) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Hospital Admin tenant access is required')
  }
}

/** App Admin (global) or Hospital Admin (tenant) may mutate operational doctor/patient records. */
function requireHospitalAdminOrAppAdmin(ctx: Awaited<ReturnType<typeof getAdminContext>>) {
  if (ctx.isAppAdmin) return
  if (ctx.isHospitalAdmin && ctx.hospitalId) return
  throw new ApiError(StatusCodes.FORBIDDEN, 'Hospital Admin or Application Admin access is required')
}

function actorUserId(actor?: AdminActorInput) {
  return typeof actor === 'object' && actor ? actor.userId : actor
}

function ensureTenantAccess(ctx: Awaited<ReturnType<typeof getAdminContext>>, hospitalId?: unknown) {
  // App admins and explicitly global auditors have cross-tenant read access.
  // An auditor carrying a hospital assignment is tenant-scoped just like a
  // hospital admin; treating every auditor as global leaks billing/clinical data.
  if (ctx.isAppAdmin || (ctx.isAuditor && !ctx.hospitalId)) return
  const value = String(hospitalId || '')
  if (!ctx.hospitalId || (value !== ctx.hospitalId && value !== ctx.hospitalCode)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Cross-tenant access is not allowed')
  }
}

async function resolveHospitalId(input?: string, ctx?: Awaited<ReturnType<typeof getAdminContext>>) {
  if (ctx?.isHospitalAdmin) {
    const requested = input?.trim()
    const matchesTenantId = requested === ctx.hospitalId
    const matchesTenantCode = Boolean(
      requested && ctx.hospitalCode && requested.toUpperCase() === ctx.hospitalCode.toUpperCase(),
    )
    if (requested && !matchesTenantId && !matchesTenantCode) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        'Patient and assigned doctor must remain in the same hospital tenant',
      )
    }
    const hospital = ctx.hospitalId ? await Hospital.findOne({
      _id: ctx.hospitalId,
      status: HospitalStatus.ACTIVE,
      accepting_assignments: { $ne: false },
      lifecycle_state: { $in: ['STABLE', null] },
    }).select('_id').lean() : null
    if (!hospital) throw new ApiError(StatusCodes.CONFLICT, 'Hospital is not accepting members')
    return ctx.hospitalId
  }
  if (!input) return undefined
  if (mongoose.Types.ObjectId.isValid(input)) {
    const byId = await Hospital.findById(input)
    if (byId) {
      if (byId.status !== HospitalStatus.ACTIVE || byId.accepting_assignments === false || !['STABLE', undefined, null].includes(byId.lifecycle_state as any)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Hospital must be active and accepting members')
      }
      return String(byId._id)
    }
  }
  const byCode = await Hospital.findOne({ code: input.toUpperCase() })
  if (!byCode) throw new ApiError(StatusCodes.BAD_REQUEST, 'Hospital not found')
  if (byCode.status !== HospitalStatus.ACTIVE || byCode.accepting_assignments === false || !['STABLE', undefined, null].includes(byCode.lifecycle_state as any)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Hospital must be active and accepting members')
  }
  return String(byCode._id)
}

function formatHospital(hospital: any, counts: { doctors?: number; patients?: number } = {}) {
  return {
    id: hospital.code,
    _id: String(hospital._id),
    name: hospital.name,
    location: hospital.location,
    admin: hospital.admin_email,
    status: hospital.status,
    doctors: counts.doctors || 0,
    patients: counts.patients || 0,
    created: hospital.createdAt,
  }
}

function formatUserForAdmin(user: any) {
  const profile = user.profile_id || {}
  const adminRole = profile.admin_role
  const role = user.user_type === UserType.ADMIN
    ? (adminRole || 'app_admin')
    : user.user_type === UserType.DOCTOR ? 'doctor' : 'patient'
  const hospital = profile.hospital_id?.code || profile.hospital_id || 'ALL'
  const name = profile.name || profile.demographics?.name || user.login_id
  return {
    id: String(user._id),
    name,
    email: user.login_id,
    loginId: user.login_id,
    role,
    hospital: role === 'app_admin' || (role === 'auditor' && !profile.hospital_id) ? 'ALL' : String(hospital),
    status: user.is_active ? 'active' : 'inactive',
    lastLogin: user.updatedAt,
  }
}

function getProfileHospitalId(user: any): string | undefined {
  const profile = user?.profile_id
  const hospital = profile?.hospital_id?._id || profile?.hospital_id
  return hospital ? String(hospital) : undefined
}

async function ensureUserTenantAccess(ctx: Awaited<ReturnType<typeof getAdminContext>>, userId: string) {
  const user = await User.findById(userId).populate('profile_id')
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'User not found')
  ensureTenantAccess(ctx, getProfileHospitalId(user))
  return user
}

async function ensureOperationalUserTenantAccess(
  ctx: Awaited<ReturnType<typeof getAdminContext>>,
  userId: string,
) {
  const user = await ensureUserTenantAccess(ctx, userId)
  if (![UserType.DOCTOR, UserType.PATIENT].includes(user.user_type as UserType)) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Administrator-class accounts cannot be managed through operational account services',
    )
  }
  return user
}

function isUserVisibleToAdmin(ctx: Awaited<ReturnType<typeof getAdminContext>>, user: any) {
  if (ctx.isAppAdmin || (ctx.isAuditor && !ctx.hospitalId)) return true
  const hospitalId = getProfileHospitalId(user)
  return Boolean(ctx.hospitalId && hospitalId === ctx.hospitalId)
}

export async function getTenantUserIdsForAdmin(actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  if (ctx.isAppAdmin || (ctx.isAuditor && !ctx.hospitalId)) return undefined
  if (!ctx.hospitalId) return []

  const [doctorProfiles, patientProfiles, adminProfiles] = await Promise.all([
    DoctorProfile.find({ hospital_id: ctx.hospitalId }).select('_id').lean(),
    PatientProfile.find({ hospital_id: ctx.hospitalId }).select('_id').lean(),
    AdminProfile.find({ hospital_id: ctx.hospitalId }).select('_id').lean(),
  ])

  const profileIds = [
    ...doctorProfiles.map(p => p._id),
    ...patientProfiles.map(p => p._id),
    ...adminProfiles.map(p => p._id),
  ]
  const users = await User.find({ profile_id: { $in: profileIds } }).select('_id').lean()
  return users.map(user => user._id)
}

async function revokeSessionsIfAccountDisabled(user: any, wasActive: boolean) {
  if (Boolean(wasActive) === Boolean(user.is_active)) return 0

  const expectedSecurityVersion = Number(user.security_version || 0)
  const bumped = await User.updateOne(
    { _id: user._id, security_version: expectedSecurityVersion },
    { $inc: { security_version: 1 } },
  )
  if (bumped.matchedCount === 0) {
    const current = await User.findById(user._id).select('security_version').lean()
    if (!current || Number(current.security_version || 0) <= expectedSecurityVersion) {
      throw new ApiError(StatusCodes.CONFLICT, 'Account security state changed concurrently')
    }
  } else {
    user.security_version = expectedSecurityVersion + 1
  }

  const result = await bestEffortRevokeSessionsAfterSecurityVersionBump(
    user._id.toString(),
    user.is_active
      ? AuthSessionRevocationReason.USER_REVOKED
      : AuthSessionRevocationReason.ACCOUNT_DISABLED,
  )
  return result.modifiedCount || 0
}

export async function getRoles() {
  return { roles: await getRoleDefinitions() }
}

export async function updateRoleDefinition(roleKey: string, data: any, actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  requirePermission(ctx, 'manage_roles')
  if (!ctx.isAppAdmin) throw new ApiError(StatusCodes.FORBIDDEN, 'App Admin access is required')
  const allowedPermissions = DEFAULT_ROLE_DEFINITIONS[roleKey]?.permissions
  if (!allowedPermissions) throw new ApiError(StatusCodes.NOT_FOUND, 'Role not found')
  const permissions = data?.permissions
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions) || Object.keys(permissions).length === 0 ||
    Object.entries(permissions).some(([key, value]) => !Object.prototype.hasOwnProperty.call(allowedPermissions, key) || typeof value !== 'boolean')) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Role permissions must contain only supported boolean permission values')
  }
  const role = await updateRolePermissions(roleKey, permissions)
  return { role }
}

function valueAtPath(source: any, path: string) {
  return path.split('.').reduce((value, key) => value?.[key], source)
}

async function restoreFieldsWithCas(
  model: any,
  id: unknown,
  original: any,
  expected: any,
  pathGroups: string[][],
) {
  let restored = true
  for (const paths of pathGroups) {
    const filter: any = { _id: id }
    const $set: Record<string, unknown> = {}
    const $unset: Record<string, 1> = {}
    for (const path of [...new Set(paths)]) {
      const expectedValue = valueAtPath(expected, path)
      const originalValue = valueAtPath(original, path)
      filter[path] = expectedValue === undefined ? { $exists: false } : expectedValue
      if (originalValue === undefined) $unset[path] = 1
      else $set[path] = originalValue
    }
    const result = await model.updateOne(filter, {
      ...(Object.keys($set).length ? { $set } : {}),
      ...(Object.keys($unset).length ? { $unset } : {}),
    })
    if (result.matchedCount === 0) {
      restored = false
      logger.error('admin_update.compensation_conflict', {
        model: model.modelName,
        document_id: String(id),
        invariant_paths: paths,
      })
    }
  }
  return restored
}

function compensationGroups(paths: string[]) {
  const remaining = new Set(paths)
  const groups: string[][] = []
  const take = (members: string[]) => {
    const present = members.filter(path => remaining.delete(path))
    if (present.length) groups.push(present)
  }
  take(['password', 'salt', 'password_history', 'password_changed_at', 'must_change_password', 'security_version'])
  take(['contact_number', 'phone_verification'])
  take(['demographics.phone', 'demographics.phone_verification'])
  take(['hospital_id', 'doctor_operation_fence'])
  for (const path of remaining) groups.push([path])
  return groups
}

export async function listHospitals(filters: { status?: string; search?: string } = {}, actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  const tenantScoped = !ctx.isAppAdmin && Boolean(ctx.hospitalId)
  if (tenantScoped) {
    if (!ctx.hospitalId) return { hospitals: [] }
    filters = { ...filters }
  }
  const query: any = {}
  if (filters.status) query.status = filters.status
  if (tenantScoped) query._id = ctx.hospitalId
  if (filters.search) {
    const searchPattern = new RegExp(escapeRegex(filters.search), 'i')
    query.$or = [
      { name: searchPattern },
      { location: searchPattern },
      { admin_email: searchPattern },
      { code: searchPattern },
    ]
  }
  const hospitals = await Hospital.aggregate([
    { $match: query },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: DoctorProfile.collection.name,
        let: { hospitalId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$hospital_id', '$$hospitalId'] } } },
          { $count: 'count' },
        ],
        as: 'doctorCounts',
      },
    },
    {
      $lookup: {
        from: PatientProfile.collection.name,
        let: { hospitalId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$hospital_id', '$$hospitalId'] } } },
          { $count: 'count' },
        ],
        as: 'patientCounts',
      },
    },
  ])
  const formatted = hospitals.map(h => formatHospital(h, {
    doctors: h.doctorCounts[0]?.count ?? 0,
    patients: h.patientCounts[0]?.count ?? 0,
  }))
  return { hospitals: formatted }
}

async function allocateHospitalCodeSequence(): Promise<number> {
  const [existing] = await Hospital.aggregate<{ maxSequence: number }>([
    { $match: { code: /^H\d+$/ } },
    { $project: { sequence: { $toInt: { $substrBytes: ['$code', 1, { $subtract: [{ $strLenBytes: '$code' }, 1] }] } } } },
    { $group: { _id: null, maxSequence: { $max: '$sequence' } } },
  ])
  const counter = mongoose.connection.collection<{ _id: string; value: number }>('system_counters')
  const minimum = existing?.maxSequence ?? 0
  try {
    await counter.updateOne(
      { _id: 'hospital_code' },
      { $setOnInsert: { value: minimum } },
      { upsert: true },
    )
  } catch (error: any) {
    // Concurrent first use can race the upsert; the counter's _id index makes
    // exactly one initializer win.
    if (error?.code !== 11000) throw error
  }
  await counter.updateOne({ _id: 'hospital_code' }, { $max: { value: minimum } })
  const allocated = await counter.findOneAndUpdate(
    { _id: 'hospital_code' },
    { $inc: { value: 1 } },
    { returnDocument: 'after' },
  )
  if (!allocated) throw new Error('Hospital code counter could not be allocated')
  return allocated.value
}

export async function createHospital(data: any, actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  requireAppAdmin(ctx)
  // The retry allocator is only race-safe when the unique code index exists.
  // Await index readiness before serving hospital creation requests.
  await Hospital.init()
  const base = {
    name: data.name,
    location: data.location,
    admin_email: data.admin_email || data.admin,
    status: data.status || HospitalStatus.ACTIVE,
    metadata: data.metadata,
  }
  let hospital
  if (data.code) {
    hospital = await Hospital.create({ ...base, code: data.code })
  } else {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const sequence = await allocateHospitalCodeSequence()
      try {
        hospital = await Hospital.create({ ...base, code: `H${String(sequence).padStart(3, '0')}` })
        break
      } catch (error: any) {
        if (error?.code !== 11000) throw error
      }
    }
    if (!hospital) {
      throw new ApiError(StatusCodes.CONFLICT, 'A unique hospital code could not be allocated')
    }
  }
  return { hospital: formatHospital(hospital.toObject()) }
}

export async function updateHospital(id: string, data: any, actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  requireAppAdmin(ctx)
  const identity = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { code: id.toUpperCase() }
  const currentHospital = await Hospital.findOne(identity)
  if (!currentHospital) throw new ApiError(StatusCodes.NOT_FOUND, 'Hospital not found')
  const targetStatus = data.status ?? currentHospital.status
  const suspending = targetStatus !== HospitalStatus.ACTIVE
  // Bind the transition to the status observed before lock acquisition. A
  // metadata-only request must not reinterpret a successor activation or
  // suspension using stale lifecycle state.
  const transitionGuard = await acquireHospitalTransitionGuard(
    currentHospital._id,
    !suspending,
    currentHospital.status as HospitalStatus,
  )
  const doctorGuards: Array<Awaited<ReturnType<typeof acquireDoctorMoveGuard>>> = []
  let usersDeactivated = 0
  let invalidatedSessions = 0
  let hospital: any
  try {
    const [doctorProfiles, patientProfiles, adminProfiles] = await Promise.all([
      DoctorProfile.find({ hospital_id: currentHospital._id }).select('_id').lean(),
      PatientProfile.find({ hospital_id: currentHospital._id }).select('_id').lean(),
      AdminProfile.find({ hospital_id: currentHospital._id }).select('_id').lean(),
    ])
    if (suspending && doctorProfiles.length) {
      const doctorUsers = await User.find({
        user_type: UserType.DOCTOR,
        profile_id: { $in: doctorProfiles.map(profile => profile._id) },
      }).select('_id profile_id').lean()
      for (const doctor of doctorUsers) {
        let guard: Awaited<ReturnType<typeof acquireDoctorMoveGuard>> | undefined
        for (let attempt = 0; attempt < 200 && !guard; attempt += 1) {
          try {
            guard = await acquireDoctorMoveGuard(doctor._id)
          } catch (error) {
            if (!(error instanceof ApiError) || error.statusCode !== StatusCodes.CONFLICT) throw error
            await new Promise(resolve => setTimeout(resolve, 25))
          }
        }
        if (!guard) throw new ApiError(StatusCodes.CONFLICT, 'Hospital suspension could not drain active doctor operations')
        await stampDoctorProfileFence(doctor.profile_id, guard)
        doctorGuards.push(guard)
      }
    }
    await transitionGuard.assertOwned()

    // Re-read after doctor operations have drained. An operation that acquired
    // before the barrier may have created a patient while suspension waited.
    const [finalDoctorProfiles, finalPatientProfiles, finalAdminProfiles] = suspending
      ? await Promise.all([
          DoctorProfile.find({ hospital_id: currentHospital._id }).select('_id').lean(),
          PatientProfile.find({ hospital_id: currentHospital._id }).select('_id').lean(),
          AdminProfile.find({ hospital_id: currentHospital._id }).select('_id').lean(),
        ])
      : [doctorProfiles, patientProfiles, adminProfiles]
    const profileIds = [...finalDoctorProfiles, ...finalPatientProfiles, ...finalAdminProfiles].map(profile => profile._id)
    const users = profileIds.length
      ? await User.find({ profile_id: { $in: profileIds } }).select('_id profile_id user_type is_active').lean()
      : []
    if (suspending) {
      // Doctors are terminalized one at a time with the exact suspension-owned
      // lease and fence. A stale suspender cannot bulk overwrite a successor.
      const guardedDoctorIds = new Set(doctorGuards.map(guard => String(guard.doctor._id)))
      for (const guard of doctorGuards) {
        await transitionGuard.assertOwned()
        await guard.assertOwned()
        if (!await DoctorProfile.exists({
          _id: guard.doctor.profile_id,
          hospital_id: currentHospital._id,
          doctor_operation_fence: guard.fenceToken,
        })) continue
        await transitionGuard.assertOwned()
        await guard.assertOwned()
        const result = await User.updateOne({
          _id: guard.doctor._id,
          doctor_operation_fence: guard.fenceToken,
          'doctor_operation_lock.lease_id': guard.leaseId,
          'doctor_operation_lock.expires_at': { $gt: new Date() },
        }, { $set: { is_active: false }, $inc: { security_version: 1 } })
        if (result.matchedCount !== 1) {
          throw new ApiError(StatusCodes.CONFLICT, 'Hospital suspension lost a doctor lifecycle fence')
        }
        usersDeactivated += result.modifiedCount || 0
      }
      const otherActiveUsers = users.filter(user => user.is_active && !guardedDoctorIds.has(String(user._id)))
      for (const member of otherActiveUsers) {
        await transitionGuard.assertOwned()
        const stillMember = member.user_type === UserType.PATIENT
          ? await PatientProfile.exists({ _id: member.profile_id, hospital_id: currentHospital._id })
          : member.user_type === UserType.ADMIN
            ? await AdminProfile.exists({ _id: member.profile_id, hospital_id: currentHospital._id })
            : null
        if (!stillMember) continue
        await transitionGuard.assertOwned()
        const updateResult = await User.updateOne(
          { _id: member._id, is_active: true },
          { $set: { is_active: false }, $inc: { security_version: 1 } },
        )
        usersDeactivated += updateResult.modifiedCount || 0
      }
    }
    if (suspending) {
      await transitionGuard.assertOwned()
      const revocationResult = await revokeActiveAuthSessionsForUsers(
        users.map(user => user._id),
        AuthSessionRevocationReason.ACCOUNT_DISABLED,
      )
      invalidatedSessions = revocationResult.modifiedCount || 0
    }

    await transitionGuard.assertOwned()
    for (const guard of doctorGuards) await guard.assertOwned()
    hospital = await Hospital.findOneAndUpdate(
      {
        _id: currentHospital._id,
        lifecycle_generation: transitionGuard.generation,
        'lifecycle_lock.lease_id': transitionGuard.leaseId,
        'lifecycle_lock.expires_at': { $gt: new Date() },
      },
      {
        $set: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.location !== undefined ? { location: data.location } : {}),
          ...(data.admin_email !== undefined || data.admin !== undefined ? { admin_email: data.admin_email || data.admin } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
          accepting_assignments: targetStatus === HospitalStatus.ACTIVE,
          lifecycle_state: 'STABLE',
        },
        $unset: { lifecycle_lock: 1 },
      },
      { new: true, runValidators: true },
    )
    if (!hospital) throw new ApiError(StatusCodes.CONFLICT, 'Hospital lifecycle transition was superseded')
  } finally {
    for (const guard of doctorGuards.reverse()) await guard.release()
    await transitionGuard.release()
  }
  return {
    hospital: formatHospital(hospital.toObject()),
    users_deactivated: usersDeactivated,
    invalidated_sessions: invalidatedSessions,
  }
}

export async function setHospitalStatus(id: string, status: string, actorUserId?: string) {
  return updateHospital(id, { status }, actorUserId)
}

export async function deleteHospital(id: string, actorUserId?: string) {
  return updateHospital(id, { status: HospitalStatus.INACTIVE }, actorUserId)
}

export async function listInvoices(actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  const query: any = {}
  if (!ctx.isAppAdmin && ctx.hospitalId) query.hospital_id = ctx.hospitalId
  const invoices = await Invoice.find(query).populate('hospital_id').sort({ createdAt: -1 }).lean()
  return {
    invoices: invoices.map((invoice: any) => ({
      id: invoice.invoice_number,
      _id: String(invoice._id),
      hospital: invoice.hospital_id?.code || String(invoice.hospital_id?._id || invoice.hospital_id),
      hospitalName: invoice.hospital_id?.name,
      plan: invoice.plan,
      amount: invoice.amount,
      status: invoice.status,
      issued: invoice.issued_date,
      due: invoice.due_date,
    })),
  }
}

export async function generateInvoices(data: any = {}, actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  requireAppAdmin(ctx)
  const hospitals = await Hospital.find({ status: HospitalStatus.ACTIVE })
  const now = new Date()
  const due = new Date(now)
  due.setDate(due.getDate() + 15)
  const created: any[] = []
  const existing: any[] = []
  for (const hospital of hospitals) {
    const existingInvoice = await Invoice.findOne({ hospital_id: hospital._id, billing_period: data.billing_period }).lean()
    if (existingInvoice) {
      existing.push(existingInvoice)
      continue
    }
    try {
      const invoice = await Invoice.findOneAndUpdate(
        { hospital_id: hospital._id, billing_period: data.billing_period },
        { $setOnInsert: {
          invoice_number: `INV-${data.billing_period.replace('-', '')}-${hospital.code}`,
          hospital_id: hospital._id,
          billing_period: data.billing_period,
          plan: data.plan || 'Standard Tier (B2B)',
          amount: data.amount ?? 25000,
          status: InvoiceStatus.PENDING,
          issued_date: now,
          due_date: due,
        } },
        { new: true, upsert: true },
      )
      created.push(invoice)
    } catch (error: any) {
      // The unique index makes concurrent generation idempotent.
      if (error?.code !== 11000) throw error
      const invoice = await Invoice.findOne({ hospital_id: hospital._id, billing_period: data.billing_period }).lean()
      if (!invoice) throw error
      existing.push(invoice)
    }
  }
  return {
    billing_period: data.billing_period,
    created: created.length,
    already_existing: existing.length,
    invoices: [...created.map(invoice => ({ invoice_id: invoice.invoice_number, hospital_id: String(invoice.hospital_id), created: true })),
      ...existing.map(invoice => ({ invoice_id: invoice.invoice_number, hospital_id: String(invoice.hospital_id), created: false }))],
  }
}

type CheckoutSessionRecord = {
  amount: number
  currency: string
  status: 'RESERVED' | 'OPEN' | 'SETTLED'
  checkout_url?: string
  created_at: string
}

const PAYMENT_WEBHOOK_MAX_SKEW_MS = 5 * 60 * 1000

/** Provider callback HMAC covers the full settlement payload, not a checkout-time token. */
function buildPaymentWebhookSignature(
  secret: string,
  parts: {
    sessionId: string
    invoiceNumber: string
    amount: number | string
    currency: string
    providerEventId: string
    timestamp: string | number
  },
) {
  const material = [
    parts.sessionId,
    parts.invoiceNumber,
    String(parts.amount),
    parts.currency,
    parts.providerEventId,
    String(parts.timestamp),
  ].join('.')
  return crypto.createHmac('sha256', secret).update(material).digest('hex')
}

function parseProviderCheckoutUrl(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ApiError(StatusCodes.BAD_GATEWAY, 'Payment provider returned an invalid JSON response')
  }
  const checkoutUrl = (raw as { checkout_url?: unknown }).checkout_url
  if (typeof checkoutUrl !== 'string' || !checkoutUrl.trim()) {
    throw new ApiError(StatusCodes.BAD_GATEWAY, 'Payment provider response missing checkout_url')
  }
  return checkoutUrl.trim()
}

function readCheckoutSession(
  meta: Record<string, unknown>,
  sessionId: string,
): CheckoutSessionRecord | null {
  const sessions = meta.checkout_sessions
  if (sessions && typeof sessions === 'object' && !Array.isArray(sessions)) {
    const entry = (sessions as Record<string, unknown>)[sessionId]
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const rec = entry as Partial<CheckoutSessionRecord>
      if (typeof rec.amount === 'number' && typeof rec.currency === 'string' && typeof rec.status === 'string') {
        return rec as CheckoutSessionRecord
      }
    }
  }
  // Legacy single-session shape from earlier checkout implementation.
  if (meta.checkout_session_id === sessionId && meta.checkout_amount !== undefined) {
    return {
      amount: Number(meta.checkout_amount),
      currency: String(meta.checkout_currency || 'INR').toUpperCase(),
      status: 'OPEN',
      checkout_url: typeof meta.checkout_url === 'string' ? meta.checkout_url : undefined,
      created_at: String(meta.checkout_created_at || ''),
    }
  }
  return null
}

/**
 * Creates a provider checkout session using server-side invoice data only.
 *
 * Requires:
 * - PAYMENT_PROVIDER_API_URL + PAYMENT_PROVIDER_API_KEY: create a remote session
 *   via POST { invoice_number, amount, currency, success_url, cancel_url, metadata }
 *   expecting { checkout_url } JSON.
 * - PAYMENT_WEBHOOK_SECRET: shared secret the provider uses to sign settlement
 *   callbacks over session/invoice/amount/currency/event_id/timestamp.
 *
 * Sessions are reserved atomically before the provider call so concurrent admin
 * checkouts cannot clobber each other's settlement keys. Prior OPEN sessions
 * remain in payment_metadata.checkout_sessions for reconciliation.
 */
export async function createCheckout(invoiceId: string, actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  const invoice = await Invoice.findOne(mongoose.Types.ObjectId.isValid(invoiceId) ? { _id: invoiceId } : { invoice_number: invoiceId })
  if (!invoice) throw new ApiError(StatusCodes.NOT_FOUND, 'Invoice not found')
  ensureTenantAccess(ctx, invoice.hospital_id)

  if (invoice.status === InvoiceStatus.PAID) {
    throw new ApiError(StatusCodes.CONFLICT, 'Invoice is already paid')
  }

  const webhookSecret = (process.env.PAYMENT_WEBHOOK_SECRET || '').trim()
  const providerApiUrl = (process.env.PAYMENT_PROVIDER_API_URL || '').trim()
  const providerApiKey = (process.env.PAYMENT_PROVIDER_API_KEY || '').trim()
  const successUrl = (process.env.PAYMENT_SUCCESS_URL || '').trim()
  const cancelUrl = (process.env.PAYMENT_CANCEL_URL || '').trim()

  if (!webhookSecret || !providerApiUrl || !providerApiKey) {
    throw new ApiError(
      StatusCodes.SERVICE_UNAVAILABLE,
      'Checkout is not configured. Set PAYMENT_WEBHOOK_SECRET, PAYMENT_PROVIDER_API_URL, and PAYMENT_PROVIDER_API_KEY.',
    )
  }

  let apiBase: URL
  try {
    apiBase = new URL(providerApiUrl)
    if (apiBase.protocol !== 'https:') throw new Error('HTTPS required')
  } catch {
    throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'PAYMENT_PROVIDER_API_URL must be an HTTPS URL')
  }

  const amount = Number(invoice.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invoice amount must be a positive number before checkout')
  }
  const currency = 'INR'
  const sessionId = crypto.randomUUID()
  const reservedAt = new Date().toISOString()
  const sessionRecord: CheckoutSessionRecord = {
    amount,
    currency,
    status: 'RESERVED',
    created_at: reservedAt,
  }

  // Atomically reserve this session on the invoice before calling the provider.
  const reserved = await Invoice.findOneAndUpdate(
    {
      _id: invoice._id,
      status: { $in: [InvoiceStatus.PENDING, InvoiceStatus.OVERDUE] },
    },
    {
      $set: {
        [`payment_metadata.checkout_sessions.${sessionId}`]: sessionRecord,
        'payment_metadata.active_checkout_session_id': sessionId,
        'payment_metadata.checkout_session_id': sessionId,
        'payment_metadata.checkout_amount': amount,
        'payment_metadata.checkout_currency': currency,
        'payment_metadata.checkout_provider': 'provider_api',
        'payment_metadata.checkout_reserved_at': reservedAt,
      },
      $unset: {
        // Checkout-time signatures must not authenticate webhooks; provider signs callbacks.
        'payment_metadata.checkout_signature': 1,
      },
    },
    { new: true },
  )
  if (!reserved) {
    throw new ApiError(StatusCodes.CONFLICT, 'Invoice could not reserve a checkout session')
  }

  let response: Response
  try {
    response = await fetch(apiBase.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${providerApiKey}`,
      },
      body: JSON.stringify({
        invoice_number: invoice.invoice_number,
        amount,
        currency,
        success_url: successUrl || undefined,
        cancel_url: cancelUrl || undefined,
        metadata: {
          invoice_id: String(invoice._id),
          hospital_id: String(invoice.hospital_id),
          session_id: sessionId,
          // Provider must HMAC callbacks with PAYMENT_WEBHOOK_SECRET over
          // session_id.invoice_number.amount.currency.provider_event_id.timestamp
        },
      }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    logger.error('checkout.provider_call_failed', {
      invoice_id: invoice.invoice_number,
      session_id: sessionId,
      error: error instanceof Error ? error.message : String(error),
    })
    const aborted = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
    throw new ApiError(
      StatusCodes.BAD_GATEWAY,
      aborted
        ? 'Payment provider checkout timed out'
        : `Payment provider checkout failed: ${error instanceof Error ? error.message : 'network error'}`,
    )
  }
  if (!response.ok) {
    logger.error('checkout.provider_rejected', {
      invoice_id: invoice.invoice_number,
      session_id: sessionId,
      status: response.status,
    })
    throw new ApiError(StatusCodes.BAD_GATEWAY, `Payment provider rejected checkout session (HTTP ${response.status})`)
  }

  let rawBody: unknown
  try {
    rawBody = await response.json()
  } catch {
    throw new ApiError(StatusCodes.BAD_GATEWAY, 'Payment provider returned an invalid JSON response')
  }
  const checkoutUrl = parseProviderCheckoutUrl(rawBody)

  // Activate only if our reservation still owns this session key.
  const activated = await Invoice.findOneAndUpdate(
    {
      _id: invoice._id,
      status: { $in: [InvoiceStatus.PENDING, InvoiceStatus.OVERDUE] },
      [`payment_metadata.checkout_sessions.${sessionId}.status`]: 'RESERVED',
    },
    {
      $set: {
        [`payment_metadata.checkout_sessions.${sessionId}.status`]: 'OPEN',
        [`payment_metadata.checkout_sessions.${sessionId}.checkout_url`]: checkoutUrl,
        'payment_metadata.checkout_url': checkoutUrl,
        'payment_metadata.checkout_created_at': new Date().toISOString(),
        'payment_metadata.active_checkout_session_id': sessionId,
        'payment_metadata.checkout_session_id': sessionId,
      },
    },
    { new: true },
  )
  if (!activated) {
    // Provider session exists but invoice reservation was superseded — leave prior
    // OPEN sessions reconcilable; log the orphaned provider session for ops.
    logger.error('checkout.orphaned_provider_session', {
      invoice_id: invoice.invoice_number,
      session_id: sessionId,
    })
    throw new ApiError(
      StatusCodes.CONFLICT,
      'Checkout session was superseded by a concurrent request; retry checkout',
    )
  }

  return {
    invoice_id: invoice.invoice_number,
    checkout_url: checkoutUrl,
    provider: 'provider_api',
  }
}

/**
 * Idempotent settlement webhook from a trusted payment provider.
 * Verifies HMAC over session/invoice/amount/currency/provider_event_id/timestamp
 * and transitions the invoice to Paid at most once (session settles once).
 */
export async function settleInvoiceFromWebhook(input: {
  session_id: string
  invoice_number: string
  amount: number | string
  currency?: string
  signature: string
  provider_event_id?: string
  timestamp?: string | number
}) {
  const webhookSecret = (process.env.PAYMENT_WEBHOOK_SECRET || '').trim()
  if (!webhookSecret) {
    throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'PAYMENT_WEBHOOK_SECRET is not configured')
  }

  const amount = Number(input.amount)
  const providerEventId = String(input.provider_event_id || '').trim()
  const timestampRaw = input.timestamp
  const timestampMs = typeof timestampRaw === 'number'
    ? timestampRaw
    : Number(String(timestampRaw || '').trim())
  if (
    !input.session_id ||
    !input.invoice_number ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !input.signature ||
    !providerEventId ||
    !Number.isFinite(timestampMs)
  ) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid payment webhook payload')
  }
  if (Math.abs(Date.now() - timestampMs) > PAYMENT_WEBHOOK_MAX_SKEW_MS) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Payment webhook timestamp is outside the allowed window')
  }

  const currency = (input.currency || 'INR').toUpperCase()
  const expected = buildPaymentWebhookSignature(webhookSecret, {
    sessionId: input.session_id,
    invoiceNumber: input.invoice_number,
    amount,
    currency,
    providerEventId,
    timestamp: timestampMs,
  })
  const provided = Buffer.from(input.signature)
  const expectedBuf = Buffer.from(expected)
  if (provided.length !== expectedBuf.length || !crypto.timingSafeEqual(provided, expectedBuf)) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid payment webhook signature')
  }

  const invoice = await Invoice.findOne({ invoice_number: input.invoice_number })
  if (!invoice) throw new ApiError(StatusCodes.NOT_FOUND, 'Invoice not found')

  const meta = (invoice.payment_metadata && typeof invoice.payment_metadata === 'object')
    ? { ...(invoice.payment_metadata as Record<string, unknown>) }
    : {}

  const sessionRec = readCheckoutSession(meta, input.session_id)
  if (!sessionRec) {
    throw new ApiError(StatusCodes.CONFLICT, 'Webhook session does not match a reserved checkout session')
  }
  if (Number(sessionRec.amount) !== amount || String(sessionRec.currency).toUpperCase() !== currency) {
    throw new ApiError(StatusCodes.CONFLICT, 'Webhook amount does not match the checkout session')
  }
  if (sessionRec.status === 'SETTLED' || invoice.status === InvoiceStatus.PAID) {
    return {
      invoice_id: invoice.invoice_number,
      status: InvoiceStatus.PAID,
      already_paid: true,
    }
  }

  // Idempotent CAS: each invoice settles at most once regardless of event id.
  const updated = await Invoice.findOneAndUpdate(
    {
      _id: invoice._id,
      status: { $in: [InvoiceStatus.PENDING, InvoiceStatus.OVERDUE] },
    },
    {
      $set: {
        status: InvoiceStatus.PAID,
        [`payment_metadata.checkout_sessions.${input.session_id}.status`]: 'SETTLED',
        'payment_metadata.paid_at': new Date().toISOString(),
        'payment_metadata.provider_event_id': providerEventId,
        'payment_metadata.settled_session_id': input.session_id,
        'payment_metadata.settled_amount': amount,
        'payment_metadata.settled_currency': currency,
        'payment_metadata.settled_timestamp': timestampMs,
      },
    },
    { new: true },
  )

  if (!updated) {
    const current = await Invoice.findById(invoice._id).lean()
    if (current?.status === InvoiceStatus.PAID) {
      return { invoice_id: invoice.invoice_number, status: InvoiceStatus.PAID, already_paid: true }
    }
    throw new ApiError(StatusCodes.CONFLICT, 'Invoice could not be marked paid')
  }

  return {
    invoice_id: updated.invoice_number,
    status: updated.status,
    already_paid: false,
  }
}

export { listAdminAccounts, createAdminAccount, updateAdminAccount, resetAdminAccountMfa }

/** @deprecated Use listAdminAccounts from the dedicated administrator lifecycle service. */
export async function listUsers(actor: AdminActorInput) {
  const result = await listAdminAccounts(actor as string | AdminAccessContext)
  return {
    admin_accounts: result.admin_accounts,
    users: result.admin_accounts,
  }
}

/** @deprecated Use createAdminAccount from the dedicated administrator lifecycle service. */
export async function inviteAdminUser(data: any, actor: AdminActorInput) {
  const result = await createAdminAccount(data, actor as string | AdminAccessContext)
  return {
    admin_account: result.admin_account,
    account: result.admin_account,
    user: result.admin_account,
    temporary_password: result.temporary_password,
    must_change_password: result.must_change_password,
  }
}

/** @deprecated Use updateAdminAccount from the dedicated administrator lifecycle service. */
export async function updateAdminUser(userId: string, data: any, actor: AdminActorInput) {
  const result = await updateAdminAccount(userId, data, actor as string | AdminAccessContext)
  return {
    admin_account: result.admin_account,
    account: result.admin_account,
    user: result.admin_account,
    invalidated_sessions: result.invalidated_sessions,
    revocation_cleanup_completed: result.revocation_cleanup_completed,
    security_version_bumped: result.security_version_bumped,
  }
}

/** @deprecated Use resetAdminAccountMfa from the dedicated administrator lifecycle service. */
export async function resetAdminAuthenticator(userId: string, actor: AdminActorInput) {
  const result = await resetAdminAccountMfa(userId, actor as string | AdminAccessContext)
  return {
    admin_account: result.admin_account,
    account: result.admin_account,
    user: result.admin_account,
    factor_type: result.factor_type,
    setup: result.setup,
    invalidated_sessions: result.invalidated_sessions,
    revocation_cleanup_completed: result.revocation_cleanup_completed,
    challenge_cleanup_completed: result.challenge_cleanup_completed,
  }
}

// ─── Doctor Management ───

export async function registerDoctor(data: {
  login_id: string
  password?: unknown
  name: string
  department?: string
  contact_number: string
  profile_picture_url?: string
  hospital_id?: string
  hospital?: string
  [key: string]: unknown
}, actorUserId?: string) {
  assertOperationalAccountPayloadSafe(data)
  const ctx = await getAdminContext(actorUserId)
  requireCanMutate(ctx)
  requireHospitalAdmin(ctx)
  const hospitalId = await resolveHospitalId(data.hospital_id || data.hospital, ctx)
  if (!hospitalId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Doctor must be assigned to an active hospital')
  }
  if (ctx.isHospitalAdmin) ensureTenantAccess(ctx, hospitalId)
  const existingUser = await User.findOne({ login_id: data.login_id })
  if (existingUser) {
    throw new ApiError(StatusCodes.CONFLICT, 'A user with this login ID already exists')
  }

  const temporaryPassword = generateTemporaryPassword()
  const membershipGuard = await acquireHospitalMembershipGuard(hospitalId)
  let created: Awaited<ReturnType<typeof createProfileAndUser>> | undefined
  try {
    await membershipGuard.assertOwned()
    created = await createProfileAndUser(
      session => DoctorProfile.create([{
        name: data.name,
        department: data.department || 'Cardiology',
        contact_number: data.contact_number,
        hospital_id: hospitalId,
      }], session ? { session } : undefined).then(([profile]) => profile),
      (profileId, session) => User.create([{
        login_id: data.login_id,
        password: temporaryPassword,
        user_type: UserType.DOCTOR,
        profile_id: profileId,
        user_type_model: 'DoctorProfile',
        must_change_password: true,
      }], session ? { session } : undefined).then(([createdUser]) => createdUser),
    )
    try {
      await membershipGuard.assertOwned()
    } catch (error) {
      if (!await terminalizePublishedUserProfile(created)) throw error
    }
  } finally {
    await membershipGuard.release()
  }
  const { user } = created!

  return {
    user: await User.findById(user._id).populate('profile_id'),
    temporary_password: temporaryPassword,
    must_change_password: true,
  }
}

export async function getAllDoctors(
  filters: { department?: string; is_active?: boolean; search?: string; hospital_id?: string } = {},
  pagination: { page?: number; limit?: number } = {},
  actorUserId?: string
) {
  const ctx = await getAdminContext(actorUserId)
  requireHospitalAdmin(ctx)
  const { department, is_active, search } = filters
  const page = Math.max(1, pagination.page || 1)
  const limit = Math.max(1, pagination.limit || 20)

  const query: any = { user_type: UserType.DOCTOR }

  if (typeof is_active === 'boolean') {
    query.is_active = is_active
  }

  const profileQuery: any = {}
  if (!ctx.isAppAdmin && ctx.hospitalId) profileQuery['profile.hospital_id'] = new mongoose.Types.ObjectId(ctx.hospitalId)
  else if (filters.hospital_id && mongoose.Types.ObjectId.isValid(filters.hospital_id)) {
    profileQuery['profile.hospital_id'] = new mongoose.Types.ObjectId(filters.hospital_id)
  } else if (filters.hospital_id) {
    return emptyPaginatedResult('doctors', page, limit)
  }
  if (department) profileQuery['profile.department'] = new RegExp(escapeRegex(department), 'i')
  if (search) {
    const searchPattern = new RegExp(escapeRegex(search), 'i')
    profileQuery.$or = [{ 'profile.name': searchPattern }, { login_id: searchPattern }]
  }

  const skip = (page - 1) * limit
  const [result] = await User.aggregate([
    { $match: query },
    { $lookup: { from: DoctorProfile.collection.name, localField: 'profile_id', foreignField: '_id', as: 'profile' } },
    { $unwind: '$profile' },
    { $match: profileQuery },
    { $set: { profile_id: '$profile' } },
    // Aggregation bypasses User#toJSON, so explicitly preserve its sensitive-field contract.
    { $unset: ['profile', 'password', 'salt', 'password_history'] },
    {
      $facet: {
        doctors: [{ $sort: { createdAt: -1, _id: -1 } }, { $skip: skip }, { $limit: limit }],
        total: [{ $count: 'count' }],
      },
    },
  ])
  const doctors = result?.doctors ?? []
  const total = result?.total[0]?.count ?? 0

  return {
    doctors,
    pagination: paginationResult(total, page, limit),
  }
}

export async function updateDoctor(
  userId: string,
  data: {
    name?: string
    department?: string
    contact_number?: string
    hospital_id?: string
    hospital?: string
  },
  actorUserId?: string
) {
  // Status/password lifecycle mutations are rejected here and must use dedicated
  // status + credentials endpoints (setDoctorAccountStatus / reset credentials).
  assertOperationalAccountPayloadSafe(data)
  const ctx = await getAdminContext(actorUserId)
  requireCanMutate(ctx)
  requireHospitalAdminOrAppAdmin(ctx)
  // Find user by _id or login_id
  let user = await User.findById(userId).populate('profile_id')
  if (!user) {
    user = await User.findOne({ login_id: userId }).populate('profile_id')
  }
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Doctor not found')
  }
  if (user.user_type !== UserType.DOCTOR) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'User is not a doctor')
  }
  ensureTenantAccess(ctx, (user.profile_id as any)?.hospital_id)
  const doctorProfile = user.profile_id as any
  const originalProfile = doctorProfile.toObject()
  let requestedDoctorHospitalMove: string | undefined

  // Update non-security profile fields only
  const profileUpdate: any = {}
  if (data.name) profileUpdate.name = data.name
  if (data.department) profileUpdate.department = data.department
  if (data.contact_number !== undefined) {
    profileUpdate.contact_number = data.contact_number
    if (data.contact_number !== doctorProfile?.contact_number) {
      profileUpdate.phone_verification = { status: 'PENDING' }
    }
  }
  if (data.hospital_id || data.hospital) {
    profileUpdate.hospital_id = await resolveHospitalId(data.hospital_id || data.hospital, ctx)
    ensureTenantAccess(ctx, profileUpdate.hospital_id)
    const currentHospitalId = doctorProfile?.hospital_id ? String(doctorProfile.hospital_id) : undefined
    if (String(profileUpdate.hospital_id) !== String(currentHospitalId || '')) {
      requestedDoctorHospitalMove = String(profileUpdate.hospital_id)
    }
  }

  let mutationStarted = false
  let expectedProfileAfterMutation: any
  const changedProfilePaths = Object.keys(profileUpdate)
  let moveGuard: Awaited<ReturnType<typeof acquireDoctorMoveGuard>> | undefined
  let membershipGuards: Awaited<ReturnType<typeof acquireHospitalMembershipGuards>> = []
  try {
    if (requestedDoctorHospitalMove) {
      membershipGuards = await acquireHospitalMembershipGuards([
        doctorProfile?.hospital_id,
        requestedDoctorHospitalMove,
      ])
      moveGuard = await acquireDoctorMoveGuard(user._id)
      const freshProfile = await DoctorProfile.findById(doctorProfile._id).select('hospital_id doctor_operation_fence')
      if (String(freshProfile?.hospital_id || '') !== String(doctorProfile?.hospital_id || '')) {
        throw new ApiError(StatusCodes.CONFLICT, 'Doctor hospital changed while the update was being applied')
      }
      const assignedPatients = await PatientProfile.countDocuments({
        assigned_doctor_id: { $in: [user._id, user.profile_id] },
      })
      if (assignedPatients > 0) {
        throw new ApiError(StatusCodes.CONFLICT, 'Cannot move a doctor who still has assigned patients')
      }
      await stampDoctorProfileFence(doctorProfile._id, moveGuard)
      profileUpdate.doctor_operation_fence = moveGuard.fenceToken
      changedProfilePaths.push('doctor_operation_fence')
    }
    if (Object.keys(profileUpdate).length > 0) {
      for (const guard of membershipGuards) await guard.assertOwned()
      if (moveGuard) await moveGuard.assertOwned()
      const profileFilter: any = { _id: doctorProfile._id }
      if (moveGuard) {
        profileFilter.hospital_id = doctorProfile.hospital_id
        profileFilter.doctor_operation_fence = moveGuard.fenceToken
      }
      expectedProfileAfterMutation = await DoctorProfile.findOneAndUpdate(
        profileFilter,
        profileUpdate,
        { runValidators: true, new: true },
      )
      if (!expectedProfileAfterMutation) {
        throw new ApiError(StatusCodes.CONFLICT, 'Doctor profile changed while the update was being applied')
      }
      mutationStarted = true
      if (moveGuard) await moveGuard.assertOwned()
      for (const guard of membershipGuards) await guard.assertOwned()
    }
  } catch (error) {
    if (mutationStarted) {
      let moveOwnershipLost = false
      if (moveGuard) {
        try { await moveGuard.assertOwned() } catch { moveOwnershipLost = true }
      }
      // Fail closed if the hospital-move lease is lost after a profile write:
      // deactivate the doctor so a half-applied move cannot remain operable.
      if (moveOwnershipLost) {
        await User.updateOne(
          { _id: user._id },
          { $set: { is_active: false }, $inc: { security_version: 1 } },
        )
        await bestEffortRevokeSessionsAfterSecurityVersionBump(
          String(user._id),
          AuthSessionRevocationReason.ACCOUNT_DISABLED,
        )
      }
      const safeProfilePaths = moveOwnershipLost
        ? changedProfilePaths.filter(path => path !== 'hospital_id' && path !== 'doctor_operation_fence')
        : changedProfilePaths
      if (expectedProfileAfterMutation && safeProfilePaths.length) {
        await restoreFieldsWithCas(
          DoctorProfile,
          originalProfile._id,
          originalProfile,
          expectedProfileAfterMutation,
          compensationGroups(safeProfilePaths),
        )
      }
    }
    throw error
  } finally {
    if (moveGuard) await moveGuard.release()
    for (const guard of membershipGuards.reverse()) await guard.release()
  }

  return await User.findById(user._id).populate('profile_id')
}

export async function deactivateDoctor(userId: string, actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  requireCanMutate(ctx)
  requireHospitalAdmin(ctx)
  let user = await User.findById(userId)
  if (!user) {
    user = await User.findOne({ login_id: userId })
  }
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Doctor not found')
  }
  if (user.user_type !== UserType.DOCTOR) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'User is not a doctor')
  }
  const profile = await DoctorProfile.findById(user.profile_id)
  ensureTenantAccess(ctx, profile?.hospital_id)

  const wasActive = user.is_active
  const deactivated = await deactivateDoctorWithAssignmentGuard(user)
  const invalidatedSessions = await revokeSessionsIfAccountDisabled(deactivated, wasActive)

  return { message: 'Doctor deactivated successfully', invalidated_sessions: invalidatedSessions }
}

export async function setDoctorAccountStatus(userId: string, isActive: boolean, actorUserId?: string) {
  if (!isActive) return deactivateDoctor(userId, actorUserId)

  const ctx = await getAdminContext(actorUserId)
  requireCanMutate(ctx)
  requireHospitalAdmin(ctx)
  let user = await User.findById(userId)
  if (!user) user = await User.findOne({ login_id: userId })
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'Doctor not found')
  if (user.user_type !== UserType.DOCTOR) throw new ApiError(StatusCodes.BAD_REQUEST, 'User is not a doctor')

  const profile = await DoctorProfile.findById(user.profile_id)
  if (!profile) throw new ApiError(StatusCodes.NOT_FOUND, 'Doctor profile not found')
  ensureTenantAccess(ctx, profile.hospital_id)
  await resolveHospitalId(String(profile.hospital_id), ctx)

  const wasActive = Boolean(user.is_active)
  user.is_active = true
  await user.save()
  const invalidatedSessions = await revokeSessionsIfAccountDisabled(user, wasActive)
  return { message: 'Doctor restored successfully', invalidated_sessions: invalidatedSessions }
}

// ─── Patient Management ───

export async function onboardPatient(data: {
  login_id: string
  password?: unknown
  assigned_doctor_id: string // supports doctor user _id or doctor login_id
  demographics: {
    name: string
    age?: number
    gender?: 'Male' | 'Female' | 'Other'
    phone: string
    next_of_kin?: { name?: string; relation?: string; relationship?: string; phone?: string }
  }
  medical_config?: unknown
  hospital_id?: string
  hospital?: string
  [key: string]: unknown
}, actorUserId?: string) {
  assertOperationalAccountPayloadSafe(data, { patient: true })
  const ctx = await getAdminContext(actorUserId)
  requireCanMutate(ctx)
  requireHospitalAdmin(ctx)
  const existingUser = await User.findOne({ login_id: data.login_id })
  if (existingUser) {
    throw new ApiError(StatusCodes.CONFLICT, 'A user with this login ID already exists')
  }

  // Validate assigned doctor
  const doctorUser = await findDoctorByIdentifier(data.assigned_doctor_id)
  if (!doctorUser || doctorUser.user_type !== UserType.DOCTOR) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid or inactive doctor ID')
  }
  if (!doctorUser.is_active) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Assigned doctor is inactive')
  }
  const doctorProfile: any = await DoctorProfile.findById(doctorUser.profile_id)
  const hospitalId = await resolveHospitalId(data.hospital_id || data.hospital, ctx) || (doctorProfile?.hospital_id ? String(doctorProfile.hospital_id) : undefined)
  ensureTenantAccess(ctx, hospitalId)
  const doctorHospitalId = doctorProfile?.hospital_id ? String(doctorProfile.hospital_id) : undefined
  if (!doctorHospitalId || (hospitalId && doctorHospitalId !== hospitalId)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Assigned doctor must belong to the same hospital as the patient')
  }

  const nextOfKin = data.demographics.next_of_kin
    ? {
        name: data.demographics.next_of_kin.name,
        relation: data.demographics.next_of_kin.relation ?? data.demographics.next_of_kin.relationship,
        phone: data.demographics.next_of_kin.phone,
      }
    : undefined

  const temporaryPassword = generateTemporaryPassword()
  const releaseAssignmentGuard = await acquireDoctorAssignmentGuard(doctorUser._id)
  let createdPatient
  try {
    const guardedDoctor = await User.findById(doctorUser._id).select('is_active profile_id')
    const guardedDoctorProfile = guardedDoctor
      ? await DoctorProfile.findById(guardedDoctor.profile_id).select('hospital_id')
      : null
    if (
      !guardedDoctor?.is_active ||
      !guardedDoctorProfile?.hospital_id ||
      String(guardedDoctorProfile.hospital_id) !== String(hospitalId)
    ) {
      throw new ApiError(StatusCodes.CONFLICT, 'Assigned doctor hospital changed while the patient was being created')
    }
    await stampDoctorProfileFence(guardedDoctor.profile_id, {
      fenceToken: releaseAssignmentGuard.fenceToken,
      assertOwned: releaseAssignmentGuard.assertOwned,
    })
    await releaseAssignmentGuard.assertOwned()
    createdPatient = await createProfileAndUser(
      session => PatientProfile.create([{
      assigned_doctor_id: doctorUser._id,
      assigned_doctor_fence: releaseAssignmentGuard.fenceToken,
      hospital_id: hospitalId,
      demographics: {
        name: data.demographics.name,
        age: data.demographics.age,
        gender: data.demographics.gender,
        phone: data.demographics.phone,
        next_of_kin: nextOfKin,
      },
      }], session ? { session } : undefined).then(([profile]) => profile),
      (profileId, session) => User.create([{
      login_id: data.login_id,
      password: temporaryPassword,
      user_type: UserType.PATIENT,
      profile_id: profileId,
      user_type_model: 'PatientProfile',
      must_change_password: true,
      }], session ? { session } : undefined).then(([createdUser]) => createdUser),
    )
    try {
      await releaseAssignmentGuard.assertOwned()
    } catch (error) {
      const terminal = await terminalizePatientAssignment({
        patientProfileId: createdPatient.profile._id,
        targetDoctorUserId: doctorUser._id,
        targetFence: releaseAssignmentGuard.fenceToken,
        patientHospitalId: hospitalId,
        reason: 'Doctor lifecycle changed after patient creation committed',
        targetGuard: releaseAssignmentGuard,
      })
      createdPatient.profile = terminal.patient
      if (terminal.state === 'QUARANTINED') {
        await User.updateOne(
          { _id: createdPatient.user._id, profile_id: createdPatient.profile._id },
          { $set: { is_active: false }, $inc: { security_version: 1 } },
        )
        throw error
      }
      // COMMITTED and SUPERSEDED both leave a complete published pair. A
      // successor operation owns the current assignment in the latter case.
    }
  } finally {
    await releaseAssignmentGuard()
  }

  return {
    user: await User.findById(createdPatient.user._id).populate('profile_id'),
    temporary_password: temporaryPassword,
    must_change_password: true,
  }
}

export async function getAllPatients(
  filters: { assigned_doctor_id?: string; account_status?: string; search?: string; hospital_id?: string } = {},
  pagination: { page?: number; limit?: number } = {},
  actorUserId?: string
) {
  const ctx = await getAdminContext(actorUserId)
  requireHospitalAdmin(ctx)
  const page = Math.max(1, pagination.page || 1)
  const limit = Math.max(1, pagination.limit || 20)

  const query: any = { user_type: UserType.PATIENT }

  let assignedDoctorId: string | undefined
  if (filters.assigned_doctor_id) {
    const doctorUser = await findDoctorByIdentifier(filters.assigned_doctor_id)
    if (!doctorUser) {
      return emptyPaginatedResult('patients', page, limit)
    }
    assignedDoctorId = String(doctorUser._id)
  }

  const profileQuery: any = {}
  if (!ctx.isAppAdmin && ctx.hospitalId) profileQuery['profile.hospital_id'] = new mongoose.Types.ObjectId(ctx.hospitalId)
  else if (filters.hospital_id && mongoose.Types.ObjectId.isValid(filters.hospital_id)) {
    profileQuery['profile.hospital_id'] = new mongoose.Types.ObjectId(filters.hospital_id)
  } else if (filters.hospital_id) {
    return emptyPaginatedResult('patients', page, limit)
  }
  if (assignedDoctorId) profileQuery['profile.assigned_doctor_id'] = new mongoose.Types.ObjectId(assignedDoctorId)
  if (filters.account_status) profileQuery['profile.account_status'] = filters.account_status
  if (filters.search) {
    const searchPattern = new RegExp(escapeRegex(filters.search), 'i')
    profileQuery.$or = [{ 'profile.demographics.name': searchPattern }, { login_id: searchPattern }]
  }

  const skip = (page - 1) * limit
  const [result] = await User.aggregate([
    { $match: query },
    { $lookup: { from: PatientProfile.collection.name, localField: 'profile_id', foreignField: '_id', as: 'profile' } },
    { $unwind: '$profile' },
    { $match: profileQuery },
    { $set: { profile_id: '$profile' } },
    // Aggregation bypasses User#toJSON, so explicitly preserve its sensitive-field contract.
    { $unset: ['profile', 'password', 'salt', 'password_history'] },
    {
      $facet: {
        patients: [{ $sort: { createdAt: -1, _id: -1 } }, { $skip: skip }, { $limit: limit }],
        total: [{ $count: 'count' }],
      },
    },
  ])
  const patients = result?.patients ?? []
  const total = result?.total[0]?.count ?? 0

  return {
    patients,
    pagination: paginationResult(total, page, limit),
  }
}

export async function updatePatient(
  userId: string,
  data: {
    demographics?: any
    hospital_id?: string
    hospital?: string
  },
  actorUserId?: string
) {
  // Clinical config, assignment, status, and credentials are rejected here and
  // must use dedicated clinical / reassignment / status / credentials surfaces.
  assertOperationalAccountPayloadSafe(data, { patient: true, forbidAssignment: true })
  const ctx = await getAdminContext(actorUserId)
  requireCanMutate(ctx)
  requireHospitalAdmin(ctx)
  let user = await User.findById(userId).populate('profile_id')
  if (!user) {
    user = await User.findOne({ login_id: userId }).populate('profile_id')
  }
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Patient not found')
  }
  if (user.user_type !== UserType.PATIENT) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'User is not a patient')
  }
  ensureTenantAccess(ctx, (user.profile_id as any)?.hospital_id)
  const patientProfile = user.profile_id as any
  const originalProfile = patientProfile.toObject()

  const profileUpdate: any = {}
  if (data.demographics) {
    if (data.demographics.name !== undefined) profileUpdate['demographics.name'] = data.demographics.name
    if (data.demographics.age !== undefined) profileUpdate['demographics.age'] = data.demographics.age
    if (data.demographics.gender !== undefined) profileUpdate['demographics.gender'] = data.demographics.gender
    if (
      data.demographics.phone !== undefined &&
      data.demographics.phone !== patientProfile?.demographics?.phone
    ) {
      profileUpdate['demographics.phone'] = data.demographics.phone
      profileUpdate['demographics.phone_verification'] = { status: 'PENDING' }
    }
    if (data.demographics.next_of_kin) {
      if (data.demographics.next_of_kin.name !== undefined) {
        profileUpdate['demographics.next_of_kin.name'] = data.demographics.next_of_kin.name
      }
      if (data.demographics.next_of_kin.relation !== undefined || data.demographics.next_of_kin.relationship !== undefined) {
        profileUpdate['demographics.next_of_kin.relation'] =
          data.demographics.next_of_kin.relation ?? data.demographics.next_of_kin.relationship
      }
      if (data.demographics.next_of_kin.phone !== undefined) {
        profileUpdate['demographics.next_of_kin.phone'] = data.demographics.next_of_kin.phone
      }
    }
  }

  let requestedHospitalId: string | undefined
  if (data.hospital_id || data.hospital) {
    requestedHospitalId = await resolveHospitalId(data.hospital_id || data.hospital, ctx)
    ensureTenantAccess(ctx, requestedHospitalId)
  }

  if (requestedHospitalId) {
    // Hospital moves keep the existing assignment; reassignment is a dedicated endpoint.
    const retainedDoctor = await findDoctorByAssignment(patientProfile?.assigned_doctor_id)
    if (retainedDoctor) {
      const retainedDoctorProfile: any = await DoctorProfile.findById(retainedDoctor.profile_id)
      const retainedDoctorHospitalId = retainedDoctorProfile?.hospital_id
        ? String(retainedDoctorProfile.hospital_id)
        : undefined
      if (!retainedDoctorHospitalId || retainedDoctorHospitalId !== requestedHospitalId) {
        throw new ApiError(StatusCodes.FORBIDDEN, 'Assigned doctor must belong to the same hospital as the patient')
      }
    } else if (patientProfile?.assigned_doctor_id) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Patient has an invalid assigned doctor')
    }
    profileUpdate.hospital_id = requestedHospitalId
  }

  const resultingHospitalMove = profileUpdate.hospital_id
  const needsMembershipGuard = Boolean(
    resultingHospitalMove && String(resultingHospitalMove) !== String(patientProfile?.hospital_id || ''),
  )
  const membershipGuards = needsMembershipGuard
    ? await acquireHospitalMembershipGuards([patientProfile?.hospital_id, resultingHospitalMove])
    : []
  let mutationStarted = false
  let expectedProfileAfterMutation: any
  const changedProfilePaths = Object.keys(profileUpdate)
  try {
    for (const guard of membershipGuards) await guard.assertOwned()
    if (Object.keys(profileUpdate).length > 0) {
      for (const guard of membershipGuards) await guard.assertOwned()
      const updatedProfile = await PatientProfile.findOneAndUpdate(
        { _id: patientProfile._id },
        { $set: profileUpdate },
        { runValidators: true, new: true },
      )
      if (!updatedProfile) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Patient profile not found')
      }
      expectedProfileAfterMutation = typeof (updatedProfile as any).toObject === 'function'
        ? (updatedProfile as any).toObject()
        : updatedProfile
      mutationStarted = true
      for (const guard of membershipGuards) await guard.assertOwned()
    }
  } catch (error) {
    if (mutationStarted && expectedProfileAfterMutation && changedProfilePaths.length) {
      await restoreFieldsWithCas(
        PatientProfile,
        originalProfile._id,
        originalProfile,
        expectedProfileAfterMutation,
        compensationGroups(changedProfilePaths),
      )
    }
    throw error
  } finally {
    for (const guard of membershipGuards.reverse()) await guard.release()
  }

  return await User.findById(user._id).populate('profile_id')
}

export async function deactivatePatient(userId: string, actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  requireCanMutate(ctx)
  requireHospitalAdmin(ctx)
  let user = await User.findById(userId)
  if (!user) {
    user = await User.findOne({ login_id: userId })
  }
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Patient not found')
  }
  if (user.user_type !== UserType.PATIENT) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'User is not a patient')
  }
  const profile = await PatientProfile.findById(user.profile_id)
  ensureTenantAccess(ctx, profile?.hospital_id)

  const wasActive = user.is_active
  user.is_active = false
  await user.save()
  const invalidatedSessions = await revokeSessionsIfAccountDisabled(user, wasActive)

  // Also update account_status
  await PatientProfile.findByIdAndUpdate(
    user.profile_id,
    { account_status: 'Discharged' },
    { runValidators: true },
  )

  return { message: 'Patient deactivated successfully', invalidated_sessions: invalidatedSessions }
}

export async function setPatientAccountStatus(
  userId: string,
  status: { is_active?: boolean; account_status?: 'Active' | 'Discharged' | 'Deceased' },
  actorUserId?: string,
) {
  const ctx = await getAdminContext(actorUserId)
  requireCanMutate(ctx)
  requireHospitalAdmin(ctx)
  let user = await User.findById(userId)
  if (!user) user = await User.findOne({ login_id: userId })
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'Patient not found')
  if (user.user_type !== UserType.PATIENT) throw new ApiError(StatusCodes.BAD_REQUEST, 'User is not a patient')

  const profile = await PatientProfile.findById(user.profile_id)
  if (!profile) throw new ApiError(StatusCodes.NOT_FOUND, 'Patient profile not found')
  ensureTenantAccess(ctx, profile.hospital_id)
  await resolveHospitalId(String(profile.hospital_id), ctx)

  const requestedStatus = status.account_status
  const requestedActive = status.is_active ?? (requestedStatus === 'Active' ? true : requestedStatus ? false : undefined)
  if (requestedActive === undefined) throw new ApiError(StatusCodes.BAD_REQUEST, 'Patient status change is required')
  if ((requestedStatus === 'Active') !== requestedActive && requestedStatus !== undefined) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Patient account and lifecycle status conflict')
  }
  if (profile.account_status === 'Deceased' && requestedActive) {
    throw new ApiError(StatusCodes.CONFLICT, 'A deceased Patient account cannot be restored')
  }
  if (profile.account_status === 'AssignmentConflict' && requestedActive) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      'Resolve the patient assignment conflict before activation',
    )
  }

  if (requestedActive) {
    const doctor = await findDoctorByAssignment(profile.assigned_doctor_id)
    if (!doctor?.is_active) throw new ApiError(StatusCodes.CONFLICT, 'Assigned doctor must be active before restoring the Patient')
    const doctorProfile = await DoctorProfile.findById(doctor.profile_id).select('hospital_id').lean()
    if (!doctorProfile?.hospital_id || String(doctorProfile.hospital_id) !== String(profile.hospital_id)) {
      throw new ApiError(StatusCodes.CONFLICT, 'Assigned doctor must belong to the Patient hospital')
    }
  }

  const wasActive = Boolean(user.is_active)
  user.is_active = requestedActive
  await user.save()
  profile.account_status = requestedStatus ?? (requestedActive ? 'Active' : 'Discharged')
  await profile.save()
  // Keep conflict markers consistent with the batch activation path: this path
  // never restores into AssignmentConflict, so drop any stale conflict payload.
  await PatientProfile.updateOne(
    { _id: profile._id },
    { $unset: { assignment_conflict: 1 } },
  )
  const invalidatedSessions = await revokeSessionsIfAccountDisabled(user, wasActive)
  return {
    message: requestedActive ? 'Patient restored successfully' : 'Patient status updated successfully',
    account_status: profile.account_status,
    invalidated_sessions: invalidatedSessions,
  }
}

export async function reassignPatient(patientLoginId: string, newDoctorId: string, actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  requireCanMutate(ctx)
  requireHospitalAdmin(ctx)
  let patientUser = mongoose.Types.ObjectId.isValid(patientLoginId)
    ? await User.findById(patientLoginId).populate('profile_id')
    : null
  if (!patientUser) patientUser = await User.findOne({ login_id: patientLoginId }).populate('profile_id')
  if (!patientUser) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Patient not found')
  }
  if (patientUser.user_type !== UserType.PATIENT) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'User is not a patient')
  }

  const doctorUser = await findDoctorByIdentifier(newDoctorId)
  if (!doctorUser || doctorUser.user_type !== UserType.DOCTOR || !doctorUser.is_active) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid or inactive doctor')
  }

  const previousDoctorId = (patientUser.profile_id as any)?.assigned_doctor_id
  const patientHospitalId = (patientUser.profile_id as any)?.hospital_id
  const reconcilingAssignmentConflict = (patientUser.profile_id as any)?.account_status === 'AssignmentConflict'
  ensureTenantAccess(ctx, patientHospitalId)
  const doctorProfile: any = await DoctorProfile.findById(doctorUser.profile_id)
  ensureTenantAccess(ctx, doctorProfile?.hospital_id)
  if (!patientHospitalId || !doctorProfile?.hospital_id || String(patientHospitalId) !== String(doctorProfile.hospital_id)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Assigned doctor must belong to the same hospital as the patient')
  }

  let releasePreviousDoctorGuard: Awaited<ReturnType<typeof acquireDoctorAssignmentGuard>> | undefined
  if (previousDoctorId && String(previousDoctorId) !== String(doctorUser._id)) {
    const previousDoctor = await findDoctorByAssignment(previousDoctorId)
    if (previousDoctor?.is_active) {
      releasePreviousDoctorGuard = await acquireDoctorAssignmentGuard(previousDoctor._id)
      await stampDoctorProfileFence(previousDoctor.profile_id, {
        fenceToken: releasePreviousDoctorGuard.fenceToken,
        assertOwned: releasePreviousDoctorGuard.assertOwned,
      })
    }
  }
  let releaseAssignmentGuard: Awaited<ReturnType<typeof acquireDoctorAssignmentGuard>>
  try {
    releaseAssignmentGuard = await acquireDoctorAssignmentGuard(doctorUser._id)
  } catch (error) {
    if (releasePreviousDoctorGuard) await releasePreviousDoctorGuard()
    throw error
  }
  let updated
  try {
    const guardedDoctor = await User.findById(doctorUser._id).select('is_active profile_id')
    const guardedDoctorProfile = guardedDoctor
      ? await DoctorProfile.findById(guardedDoctor.profile_id).select('hospital_id doctor_operation_fence')
      : null
    if (
      !guardedDoctor?.is_active ||
      !guardedDoctorProfile?.hospital_id ||
      String(guardedDoctorProfile.hospital_id) !== String(patientHospitalId)
    ) {
      throw new ApiError(StatusCodes.CONFLICT, 'Assigned doctor hospital changed while reassignment was being applied')
    }
    await stampDoctorProfileFence(guardedDoctor.profile_id, {
      fenceToken: releaseAssignmentGuard.fenceToken,
      assertOwned: releaseAssignmentGuard.assertOwned,
    })
    await releaseAssignmentGuard.assertOwned()
    if (releasePreviousDoctorGuard) await releasePreviousDoctorGuard.assertOwned()
    updated = await PatientProfile.findOneAndUpdate(
      {
        _id: (patientUser.profile_id as any)?._id || patientUser.profile_id,
        hospital_id: patientHospitalId,
        assigned_doctor_id: previousDoctorId,
        ...(reconcilingAssignmentConflict ? { account_status: 'AssignmentConflict' } : {}),
      },
      {
        $set: {
          assigned_doctor_id: doctorUser._id,
          assigned_doctor_fence: releaseAssignmentGuard.fenceToken,
          ...(reconcilingAssignmentConflict ? { account_status: 'Active' } : {}),
        },
        ...(reconcilingAssignmentConflict ? { $unset: { assignment_conflict: 1 } } : {}),
      },
      { new: true, runValidators: true },
    )
    if (updated) {
      try {
        await releaseAssignmentGuard.assertOwned()
        if (releasePreviousDoctorGuard) await releasePreviousDoctorGuard.assertOwned()
      } catch (error) {
        const terminal = await terminalizePatientAssignment({
          patientProfileId: updated._id,
          targetDoctorUserId: doctorUser._id,
          targetFence: releaseAssignmentGuard.fenceToken,
          patientHospitalId,
          previousDoctorId,
          reason: 'Target doctor lifecycle changed after reassignment commit',
          targetGuard: releaseAssignmentGuard,
        })
        if (terminal.state === 'COMMITTED') {
          updated = terminal.patient
          logger.warn('patient_reassignment.committed_after_lease_superseded', {
            patient_id: String(updated._id), target_doctor_id: String(doctorUser._id),
          })
        } else if (terminal.state === 'QUARANTINED') {
          const quarantined = terminal.patient
          logger.error('patient_reassignment.assignment_conflict', {
            patient_id: String(updated._id), attempted_doctor_id: String(doctorUser._id),
            quarantine_persisted: Boolean(quarantined),
          })
          throw new ApiError(StatusCodes.CONFLICT,
            'Patient assignment entered conflict review; no clinical discharge was recorded')
        } else {
          throw new ApiError(StatusCodes.CONFLICT, 'Patient assignment was superseded by another request')
        }
      }
    }
  } finally {
    await releaseAssignmentGuard()
    if (releasePreviousDoctorGuard) await releasePreviousDoctorGuard()
  }
  if (!updated) {
    throw new ApiError(StatusCodes.CONFLICT, 'Patient assignment changed while the request was being processed')
  }

  await createDoctorUpdateNotification({
    patientUserId: patientUser._id,
    changedByDoctorId: actorUserId || doctorUser._id,
    changeType: 'DOCTOR_REASSIGNED',
    title: 'Doctor assignment changed',
    message: `Your care has been reassigned to ${doctorProfile.name || doctorUser.login_id}.`,
    changedFields: ['assigned_doctor_id'],
  })

  return {
    audit_resource_id: String(updated._id),
    message: 'Patient reassigned successfully',
    previous_doctor_id: previousDoctorId,
    new_doctor_id: String(doctorUser._id),
  }
}

// ─── Audit Logs ───

export async function getAuditLogs(
  filters: {
    user_id?: string
    action?: string
    start_date?: string
    end_date?: string
    success?: boolean
  } = {},
  pagination: { page?: number; limit?: number } = {},
  actorUserId?: string
) {
  const page = pagination.page || 1
  const limit = pagination.limit || 50

  const query: any = {}
  const tenantUserIds = await getTenantUserIdsForAdmin(actorUserId)
  if (tenantUserIds) query.user_id = { $in: tenantUserIds }

  if (filters.user_id) {
    const ctx = await getAdminContext(actorUserId)
    await ensureUserTenantAccess(ctx, filters.user_id)
    query.user_id = filters.user_id
  }
  if (filters.action) query.action = filters.action
  if (typeof filters.success === 'boolean') query.success = filters.success

  if (filters.start_date || filters.end_date) {
    query.createdAt = {}
    if (filters.start_date) query.createdAt.$gte = new Date(filters.start_date)
    if (filters.end_date) query.createdAt.$lte = new Date(filters.end_date)
  }

  const logs = await AuditLog.find(query)
    .populate('user_id', 'login_id user_type')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)

  const total = await AuditLog.countDocuments(query)

  return {
    logs,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  }
}

// ─── Batch Operations ───

export async function performBatchOperation(
  operation: 'activate' | 'deactivate' | 'reset_password',
  userIds: string[],
  actorUserId?: string
) {
  const ctx = await getAdminContext(actorUserId)
  requireCanMutate(ctx)
  requireHospitalAdmin(ctx)
  const results: {
    userId: string
    success: boolean
    message: string
    temporary_password?: string
    invalidated_sessions?: number
    revocation_cleanup_completed?: boolean
  }[] = []

  for (const userId of userIds) {
    try {
      const user = await User.findById(userId)
      if (!user) {
        results.push({ userId, success: false, message: 'User not found' })
        continue
      }
      if (![UserType.DOCTOR, UserType.PATIENT].includes(user.user_type as UserType)) {
        throw new ApiError(
          StatusCodes.FORBIDDEN,
          'Administrator-class accounts cannot be managed through batch operations',
        )
      }
      await ensureOperationalUserTenantAccess(ctx, userId)

      switch (operation) {
        case 'activate': {
          let invalidatedSessions = 0
          if (!user.is_active) {
            let hospitalId: unknown
            if (user.user_type === UserType.DOCTOR) {
              hospitalId = (await DoctorProfile.findById(user.profile_id).select('hospital_id').lean())?.hospital_id
            } else if (user.user_type === UserType.PATIENT) {
              const profile = await PatientProfile.findById(user.profile_id)
                .select('hospital_id account_status assigned_doctor_id').lean()
              hospitalId = profile?.hospital_id
              if (profile?.account_status === 'AssignmentConflict') {
                throw new ApiError(StatusCodes.CONFLICT, 'Resolve the patient assignment conflict before activation')
              }
            } else {
              throw new ApiError(StatusCodes.FORBIDDEN, 'Only Doctor and Patient accounts support operational status changes')
            }
            if (hospitalId) {
              const patientLifecycleLease = user.user_type === UserType.PATIENT
                ? await acquirePatientFileOperationLease(user.profile_id, { requireActive: false })
                : undefined
              try {
                const guard = await acquireHospitalMembershipGuard(hospitalId)
                let activationCommitted = false
                try {
                  await patientLifecycleLease?.assertOwned()
                  await guard.assertOwned()
                  const activated = await User.findOneAndUpdate(
                    { _id: user._id, is_active: false },
                    { $set: { is_active: true }, $inc: { security_version: 1 } },
                    { new: true, runValidators: true },
                  )
                  if (!activated) throw new ApiError(StatusCodes.CONFLICT, 'User activation changed concurrently')
                  activationCommitted = true
                  await patientLifecycleLease?.assertOwned()
                  await guard.assertOwned()
                } catch (error) {
                  if (activationCommitted) {
                    await User.updateOne(
                      { _id: user._id, is_active: true },
                      { $set: { is_active: false }, $inc: { security_version: 1 } },
                    )
                  }
                  throw error
                } finally {
                  await guard.release()
                }
              } finally {
                await patientLifecycleLease?.release()
              }
            } else {
              throw new ApiError(StatusCodes.CONFLICT, 'Operational account must belong to an active hospital before activation')
            }
            const revocation = await bestEffortRevokeSessionsAfterSecurityVersionBump(
              userId,
              AuthSessionRevocationReason.USER_REVOKED,
            )
            invalidatedSessions = revocation.modifiedCount || 0
          }
          results.push({
            userId,
            success: true,
            message: 'User activated',
            invalidated_sessions: invalidatedSessions,
          })
          break
        }

        case 'deactivate':
          const wasActive = user.is_active
          const deactivatedUser = wasActive
            ? await deactivateDoctorWithAssignmentGuard(user)
            : user
          const invalidatedSessions = await revokeSessionsIfAccountDisabled(deactivatedUser, wasActive)
          results.push({
            userId,
            success: true,
            message: 'User deactivated',
            invalidated_sessions: invalidatedSessions,
          })
          break

        case 'reset_password': {
          const temporaryPassword = generateTemporaryPassword()
          const userWithHistory = await User.findById(user._id).select('+password_history')
          if (!userWithHistory) {
            results.push({ userId, success: false, message: 'User not found' })
            continue
          }
          await setUserPasswordWithPolicy(userWithHistory, temporaryPassword, { mustChangePassword: true })
          const invalidatedSessions = await bestEffortRevokeSessionsAfterSecurityVersionBump(
            userId,
            AuthSessionRevocationReason.PASSWORD_RESET,
          )
          results.push({
            userId,
            success: true,
            message: 'Password reset successfully',
            temporary_password: temporaryPassword,
            invalidated_sessions: invalidatedSessions.modifiedCount || 0,
            revocation_cleanup_completed: invalidatedSessions.cleanupCompleted,
          })
          break
        }

        default:
          results.push({ userId, success: false, message: 'Invalid operation' })
      }
    } catch (error: any) {
      results.push({
        userId,
        success: false,
        message: error instanceof ApiError ? error.message : 'Operation could not be completed',
      })
    }
  }

  return {
    operation,
    total: userIds.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results,
  }
}

export async function resetUserPassword(adminUserId: string, targetUserId: string, newPassword?: string) {
  const ctx = await getAdminContext(adminUserId)
  requireCanMutate(ctx)
  requireHospitalAdmin(ctx)
  await ensureOperationalUserTenantAccess(ctx, targetUserId)
  return adminResetPassword(adminUserId, targetUserId, newPassword)
}

export async function resetOperationalUserPassword(
  adminUserId: string,
  targetUserId: string,
  expectedType: UserType.DOCTOR | UserType.PATIENT,
  newPassword?: string,
) {
  const target = await User.findById(targetUserId).select('user_type').lean()
  if (!target) throw new ApiError(StatusCodes.NOT_FOUND, `${expectedType === UserType.DOCTOR ? 'Doctor' : 'Patient'} not found`)
  if (target.user_type !== expectedType) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `User is not a ${expectedType === UserType.DOCTOR ? 'doctor' : 'patient'}`)
  }
  return resetUserPassword(adminUserId, targetUserId, newPassword)
}

export async function listLegacyPatients(actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  requireHospitalAdmin(ctx)
  const patients = await User.find({ user_type: UserType.PATIENT })
    .populate('profile_id')
    .sort({ createdAt: -1 })
  return { patients: patients.filter(patient => isUserVisibleToAdmin(ctx, patient)) }
}

export async function getLegacyPatientByLoginId(opNum: string, actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  requireHospitalAdmin(ctx)
  const user = await User.findOne({ login_id: opNum, user_type: UserType.PATIENT }).populate('profile_id')
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'Patient not found')
  ensureTenantAccess(ctx, getProfileHospitalId(user))
  return { patient: user }
}

export async function getLegacyDoctorById(id: string, actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  requireHospitalAdmin(ctx)
  const user = await User.findById(id).populate('profile_id')
  if (!user || user.user_type !== UserType.DOCTOR) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Doctor not found')
  }
  ensureTenantAccess(ctx, getProfileHospitalId(user))
  return { doctor: user }
}

// ─── System Health ───

export async function getSystemHealth() {
  const mongooseModule = await import('mongoose')
  const mongooseInstance = mongooseModule.default

  const dbStates: Record<number, string> = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  }

  const databaseState = dbStates[mongooseInstance.connection.readyState] || 'unknown'
  return {
    status: databaseState === 'connected' ? 'healthy' : 'degraded',
    uptime: process.uptime(),
    database: {
      state: databaseState,
    },
    timestamp: new Date().toISOString(),
  }
}
