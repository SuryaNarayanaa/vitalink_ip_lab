import crypto from 'crypto'
import { StatusCodes } from 'http-status-codes'
import { User, DoctorProfile, PatientProfile, AuditLog, AdminProfile, Hospital, Invoice } from '@alias/models'
import { ApiError } from '@alias/utils'
import { UserType } from '@alias/validators'
import { adminResetPassword, generateTemporaryPassword, setUserPasswordWithPolicy, validatePasswordChangeForUser } from './password.service'
import { bestEffortRevokeSessionsAfterSecurityVersionBump, revokeActiveAuthSessionsForUser, revokeActiveAuthSessionsForUsers } from './auth-session.service'
import { AuthSessionRevocationReason } from '@alias/models/authsession.model'
import { AuditAction } from '@alias/models/auditlog.model'
import mongoose from 'mongoose'
import { AdminRole } from '@alias/models/adminprofile.model'
import { HospitalStatus } from '@alias/models/hospital.model'
import { InvoiceStatus } from '@alias/models/invoice.model'
import { replaceAdminTotpForRecovery } from './admin-totp.service'
import { DEFAULT_ROLE_DEFINITIONS, getRoleDefinitions, getRolePermissions, updateRolePermissions } from './role-policy.service'
import { createDoctorUpdateNotification } from './doctor-update-notification.service'
import { acquireDoctorAssignmentGuard, acquireDoctorMoveGuard, acquireHospitalMembershipGuard, acquireHospitalMembershipGuards, acquireHospitalTransitionGuard, deactivateDoctorWithAssignmentGuard, stampDoctorProfileFence, terminalizePatientAssignment } from './doctor-assignment.service'
import logger, { sanitizeLogText } from '@alias/utils/logger'
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

export async function getAdminContext(userId?: string) {
  if (!userId) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Valid admin profile is required')
  }
  const user = await User.findById(userId).populate({
    path: 'profile_id',
    populate: { path: 'hospital_id' },
  })
  const profile: any = user?.profile_id
  const role = profile?.admin_role
  if (!user || user.user_type !== UserType.ADMIN || !profile || !ADMIN_ROLES.includes(role)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Valid admin profile is required')
  }
  const hospitalId = profile?.hospital_id?._id || profile?.hospital_id
  if (role === AdminRole.HOSPITAL_ADMIN && !hospitalId) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Hospital Admin must be assigned to a hospital')
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
  if (wasActive && user.is_active === false) {
    try {
      const result = await revokeActiveAuthSessionsForUser(
        user._id.toString(),
        AuthSessionRevocationReason.ACCOUNT_DISABLED
      )
      return result.modifiedCount || 0
    } catch {
      // is_active is checked on every request, so physical session revocation
      // is cleanup and cannot make the disabled account usable again.
      return 0
    }
  }

  return 0
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
        }, { $set: { is_active: false } })
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
        const updateResult = await User.updateOne({ _id: member._id, is_active: true }, { $set: { is_active: false } })
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

/**
 * Creates a provider checkout session using server-side invoice data only.
 *
 * Configuration:
 * - PAYMENT_PROVIDER_API_URL + PAYMENT_PROVIDER_API_KEY: create a remote session
 *   via POST { invoice_number, amount, currency, success_url, cancel_url, metadata }
 *   expecting { checkout_url, session_id } JSON.
 * - PAYMENT_CHECKOUT_BASE_URL + PAYMENT_WEBHOOK_SECRET: signed hosted-checkout
 *   fallback when no remote session API is configured.
 * - PAYMENT_WEBHOOK_SECRET: required to settle invoices via the webhook.
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
  const checkoutBaseUrl = (process.env.PAYMENT_CHECKOUT_BASE_URL || '').trim()
  const successUrl = (process.env.PAYMENT_SUCCESS_URL || '').trim()
  const cancelUrl = (process.env.PAYMENT_CANCEL_URL || '').trim()

  if (!webhookSecret) {
    throw new ApiError(
      StatusCodes.SERVICE_UNAVAILABLE,
      'Checkout is not configured. Set PAYMENT_WEBHOOK_SECRET (and provider API or PAYMENT_CHECKOUT_BASE_URL).',
    )
  }

  const sessionId = crypto.randomUUID()
  const amount = Number(invoice.amount)
  const currency = 'INR'
  const signedPayload = [
    sessionId,
    invoice.invoice_number,
    String(amount),
    currency,
  ].join('.')
  const signature = crypto.createHmac('sha256', webhookSecret).update(signedPayload).digest('hex')

  let checkoutUrl: string
  let provider = 'signed_hosted_checkout'

  if (providerApiUrl && providerApiKey) {
    let apiBase: URL
    try {
      apiBase = new URL(providerApiUrl)
      if (apiBase.protocol !== 'https:') throw new Error('HTTPS required')
    } catch {
      throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'PAYMENT_PROVIDER_API_URL must be an HTTPS URL')
    }

    const response = await fetch(apiBase.toString(), {
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
          signature,
        },
      }),
    })
    if (!response.ok) {
      throw new ApiError(StatusCodes.BAD_GATEWAY, `Payment provider rejected checkout session (HTTP ${response.status})`)
    }
    const body = await response.json() as { checkout_url?: string; session_id?: string }
    if (!body.checkout_url) {
      throw new ApiError(StatusCodes.BAD_GATEWAY, 'Payment provider response missing checkout_url')
    }
    checkoutUrl = body.checkout_url
    provider = 'provider_api'
    if (body.session_id) {
      // Prefer provider session id when returned; re-sign for webhook reconciliation.
    }
  } else if (checkoutBaseUrl) {
    let url: URL
    try {
      url = new URL(checkoutBaseUrl)
      if (url.protocol !== 'https:') throw new Error('HTTPS is required')
    } catch {
      throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'Checkout configuration must be an HTTPS provider URL')
    }
    // Amount and invoice identity are bound by HMAC; clients cannot alter them.
    url.searchParams.set('session_id', sessionId)
    url.searchParams.set('invoice', invoice.invoice_number)
    url.searchParams.set('amount', String(amount))
    url.searchParams.set('currency', currency)
    url.searchParams.set('sig', signature)
    checkoutUrl = url.toString()
  } else {
    throw new ApiError(
      StatusCodes.SERVICE_UNAVAILABLE,
      'Checkout is not configured. Set PAYMENT_PROVIDER_API_URL+PAYMENT_PROVIDER_API_KEY or PAYMENT_CHECKOUT_BASE_URL.',
    )
  }

  invoice.payment_metadata = {
    ...(invoice.payment_metadata && typeof invoice.payment_metadata === 'object' ? invoice.payment_metadata : {}),
    checkout_session_id: sessionId,
    checkout_signature: signature,
    checkout_amount: amount,
    checkout_currency: currency,
    checkout_created_at: new Date().toISOString(),
    checkout_provider: provider,
  }
  await invoice.save()

  return {
    invoice_id: invoice.invoice_number,
    checkout_url: checkoutUrl,
    session_id: sessionId,
    provider,
  }
}

/**
 * Idempotent settlement webhook. Verifies HMAC over session/invoice/amount and
 * transitions the invoice to Paid at most once.
 */
export async function settleInvoiceFromWebhook(input: {
  session_id: string
  invoice_number: string
  amount: number | string
  currency?: string
  signature: string
  provider_event_id?: string
}) {
  const webhookSecret = (process.env.PAYMENT_WEBHOOK_SECRET || '').trim()
  if (!webhookSecret) {
    throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'PAYMENT_WEBHOOK_SECRET is not configured')
  }

  const amount = Number(input.amount)
  if (!input.session_id || !input.invoice_number || !Number.isFinite(amount) || !input.signature) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid payment webhook payload')
  }

  const currency = (input.currency || 'INR').toUpperCase()
  const signedPayload = [input.session_id, input.invoice_number, String(amount), currency].join('.')
  const expected = crypto.createHmac('sha256', webhookSecret).update(signedPayload).digest('hex')
  const provided = Buffer.from(input.signature)
  const expectedBuf = Buffer.from(expected)
  if (provided.length !== expectedBuf.length || !crypto.timingSafeEqual(provided, expectedBuf)) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid payment webhook signature')
  }

  const invoice = await Invoice.findOne({ invoice_number: input.invoice_number })
  if (!invoice) throw new ApiError(StatusCodes.NOT_FOUND, 'Invoice not found')

  const meta = (invoice.payment_metadata && typeof invoice.payment_metadata === 'object')
    ? invoice.payment_metadata as Record<string, unknown>
    : {}

  if (meta.checkout_session_id && meta.checkout_session_id !== input.session_id) {
    throw new ApiError(StatusCodes.CONFLICT, 'Webhook session does not match the open checkout session')
  }
  if (meta.checkout_amount !== undefined && Number(meta.checkout_amount) !== amount) {
    throw new ApiError(StatusCodes.CONFLICT, 'Webhook amount does not match the checkout session')
  }

  if (invoice.status === InvoiceStatus.PAID) {
    return {
      invoice_id: invoice.invoice_number,
      status: invoice.status,
      already_paid: true,
    }
  }

  // Idempotent CAS: only transition Pending/Overdue → Paid once.
  const updated = await Invoice.findOneAndUpdate(
    {
      _id: invoice._id,
      status: { $in: [InvoiceStatus.PENDING, InvoiceStatus.OVERDUE] },
    },
    {
      $set: {
        status: InvoiceStatus.PAID,
        payment_metadata: {
          ...meta,
          paid_at: new Date().toISOString(),
          provider_event_id: input.provider_event_id,
          settled_session_id: input.session_id,
          settled_amount: amount,
          settled_currency: currency,
        },
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

export async function listUsers(actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  const hasGlobalUserVisibility = ctx.isAppAdmin || (ctx.isAuditor && !ctx.hospitalId)
  if (!hasGlobalUserVisibility) {
    if (!ctx.hospitalId) return { users: [] }
    const hospitalId = new mongoose.Types.ObjectId(ctx.hospitalId)
    const profileProjection = (model: string, fields: Record<string, unknown>): any[] => [
      { $match: { hospital_id: hospitalId } },
      {
        $project: {
          _id: 1,
          hospital_id: 1,
          profile_model: { $literal: model },
          ...fields,
        },
      },
    ]
    const users = await DoctorProfile.aggregate([
      ...profileProjection('DoctorProfile', { name: 1 }),
      {
        $unionWith: {
          coll: PatientProfile.collection.name,
          pipeline: profileProjection('PatientProfile', { 'demographics.name': 1 }),
        },
      },
      {
        $unionWith: {
          coll: AdminProfile.collection.name,
          pipeline: profileProjection('AdminProfile', { name: 1, admin_role: 1 }),
        },
      },
      {
        $lookup: {
          from: User.collection.name,
          let: { profileId: '$_id', profileModel: '$profile_model' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$profile_id', '$$profileId'] },
                    { $eq: ['$user_type_model', '$$profileModel'] },
                  ],
                },
              },
            },
            { $project: { login_id: 1, user_type: 1, is_active: 1, createdAt: 1, updatedAt: 1 } },
          ],
          as: 'users',
        },
      },
      { $unwind: '$users' },
      {
        $lookup: {
          from: Hospital.collection.name,
          localField: 'hospital_id',
          foreignField: '_id',
          pipeline: [{ $project: { code: 1 } }],
          as: 'hospitals',
        },
      },
      { $sort: { 'users.createdAt': -1 } },
    ])
    return {
      users: users.map(row => formatUserForAdmin({
        ...row.users,
        profile_id: {
          ...row,
          hospital_id: row.hospitals[0] || row.hospital_id,
        },
      })),
    }
  }
  const users = await User.find().populate({
    path: 'profile_id',
    populate: { path: 'hospital_id' },
  }).sort({ createdAt: -1 })
  const formatted = users
    .filter(user => isUserVisibleToAdmin(ctx, user))
    .map(formatUserForAdmin)
  return { users: formatted }
}

export async function inviteAdminUser(data: any, actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  requireCanMutate(ctx)
  if (data.role !== undefined && !ADMIN_ROLES.includes(data.role)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid admin role')
  }
  if (data.role === AdminRole.APP_ADMIN) requireAppAdmin(ctx)
  const hospitalId = await resolveHospitalId(data.hospital_id || data.hospital, ctx)
  if (data.role === AdminRole.HOSPITAL_ADMIN) {
    if (!hospitalId) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Hospital Admin must be assigned to an active hospital')
    }
    ensureTenantAccess(ctx, hospitalId)
  }
  const existing = await User.findOne({ login_id: data.email || data.login_id })
  if (existing) throw new ApiError(StatusCodes.CONFLICT, 'A user with this login ID already exists')
  const temporaryPassword = generateTemporaryPassword()
  const membershipGuard = hospitalId ? await acquireHospitalMembershipGuard(hospitalId) : undefined
  let created: Awaited<ReturnType<typeof createProfileAndUser>> | undefined
  try {
    if (membershipGuard) await membershipGuard.assertOwned()
    created = await createProfileAndUser(
    session => AdminProfile.create([{
      name: data.name,
      admin_role: data.role || AdminRole.HOSPITAL_ADMIN,
      permission: data.role === AdminRole.AUDITOR ? 'READ_ONLY' : 'FULL_ACCESS',
      hospital_id: hospitalId,
    }], session ? { session } : undefined).then(([profile]) => profile),
    (profileId, session) => User.create([{
      login_id: data.email || data.login_id,
      password: temporaryPassword,
      user_type: UserType.ADMIN,
      profile_id: profileId,
      user_type_model: 'AdminProfile',
      must_change_password: true,
    }], session ? { session } : undefined).then(([createdUser]) => createdUser),
    )
    if (membershipGuard) await membershipGuard.assertOwned()
  } catch (error) {
    if (created) {
      if (await terminalizePublishedUserProfile(created)) {
        const { user } = created
        return {
          user: formatUserForAdmin(await User.findById(user._id).populate('profile_id')),
          temporary_password: temporaryPassword,
          must_change_password: true,
        }
      }
    }
    throw error
  } finally {
    if (membershipGuard) await membershipGuard.release()
  }
  const { user } = created!
  return {
    user: formatUserForAdmin(await user.populate('profile_id')),
    temporary_password: temporaryPassword,
    must_change_password: true,
  }
}

export async function updateAdminUser(userId: string, data: any, actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  requireCanMutate(ctx)
  const user = await User.findById(userId).populate('profile_id')
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'User not found')
  ensureTenantAccess(ctx, getProfileHospitalId(user))
  const profile: any = user.profile_id
  const originalProfile = typeof profile?.toObject === 'function' ? profile.toObject() : { ...profile }
  const updates: any = {}
  if (data.role !== undefined) {
    if (!ADMIN_ROLES.includes(data.role)) throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid admin role')
    if (data.role === AdminRole.APP_ADMIN) requireAppAdmin(ctx)
    updates.admin_role = data.role
  }
  if (data.name) updates.name = data.name
  if (data.hospital_id || data.hospital) {
    updates.hospital_id = await resolveHospitalId(data.hospital_id || data.hospital, ctx)
    ensureTenantAccess(ctx, updates.hospital_id)
  }
  if (updates.admin_role === AdminRole.HOSPITAL_ADMIN) {
    const hospitalId = updates.hospital_id || getProfileHospitalId(user)
    if (!hospitalId) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Hospital Admin must be assigned to an active hospital')
    }
    const hospital = await Hospital.findById(hospitalId).select('status').lean()
    if (!hospital) throw new ApiError(StatusCodes.BAD_REQUEST, 'Hospital not found')
    if (hospital.status !== HospitalStatus.ACTIVE) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Hospital must be active')
    }
  }
  const wasActive = user.is_active
  const requestedActive = typeof data.is_active === 'boolean'
    ? data.is_active
    : data.status ? data.status === 'active' : user.is_active
  const activating = !wasActive && requestedActive
  const resultingHospitalId = updates.hospital_id || getProfileHospitalId(user)
  const resultingAdminRole = updates.admin_role || profile.admin_role
  if (activating && !resultingHospitalId &&
      ![AdminRole.APP_ADMIN, AdminRole.AUDITOR].includes(resultingAdminRole)) {
    throw new ApiError(StatusCodes.CONFLICT, 'Tenant admin must belong to an active hospital before activation')
  }
  const membershipGuards = (updates.hospital_id || (activating && resultingHospitalId))
    ? await acquireHospitalMembershipGuards([getProfileHospitalId(user), resultingHospitalId])
    : []
  let activationCommitted = false
  let expectedProfileAfterMutation: any
  try {
    if (Object.keys(updates).length && user.user_type === UserType.ADMIN) {
      for (const guard of membershipGuards) await guard.assertOwned()
      const changed = await AdminProfile.findOneAndUpdate(
        { _id: profile._id, ...(updates.hospital_id ? { hospital_id: getProfileHospitalId(user) } : {}) },
        updates,
        { runValidators: true, new: true },
      )
      if (!changed) throw new ApiError(StatusCodes.CONFLICT, 'Admin hospital membership changed concurrently')
      expectedProfileAfterMutation = typeof changed.toObject === 'function' ? changed.toObject() : changed
      for (const guard of membershipGuards) await guard.assertOwned()
    }
    if (typeof data.is_active === 'boolean') user.is_active = data.is_active
    if (data.status) user.is_active = data.status === 'active'
    for (const guard of membershipGuards) await guard.assertOwned()
    await user.save()
    activationCommitted = activating
    for (const guard of membershipGuards) await guard.assertOwned()
  } catch (error) {
    if (activationCommitted) {
      await User.updateOne(
        { _id: user._id, is_active: true },
        { $set: { is_active: false } },
      )
    }
    if (expectedProfileAfterMutation && Object.keys(updates).length) {
      const restored = await restoreFieldsWithCas(
        AdminProfile,
        profile._id,
        originalProfile,
        expectedProfileAfterMutation,
        compensationGroups(Object.keys(updates)),
      )
      if (!restored) {
        await User.updateOne({ _id: user._id }, { $set: { is_active: false } })
        await bestEffortRevokeSessionsAfterSecurityVersionBump(
          String(user._id),
          AuthSessionRevocationReason.ACCOUNT_DISABLED,
        )
      }
    }
    throw error
  } finally {
    for (const guard of membershipGuards.reverse()) await guard.release()
  }
  const invalidatedSessions = await revokeSessionsIfAccountDisabled(user, wasActive)
  return {
    user: formatUserForAdmin(await User.findById(user._id).populate({ path: 'profile_id', populate: { path: 'hospital_id' } })),
    invalidated_sessions: invalidatedSessions,
  }
}

export async function resetAdminAuthenticator(userId: string, actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  requireAppAdmin(ctx)

  const user = await User.findById(userId).populate('profile_id')
  if (!user || user.user_type !== UserType.ADMIN) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Admin user not found')
  }
  if (!user.is_active) {
    throw new ApiError(StatusCodes.CONFLICT, 'Cannot reset MFA for an inactive admin')
  }
  if (String(user._id) === actorUserId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Ask another App Admin to reset your authenticator')
  }

  const enrollment = await replaceAdminTotpForRecovery(user)
  const invalidatedSessions = await bestEffortRevokeSessionsAfterSecurityVersionBump(
    String(user._id),
    AuthSessionRevocationReason.MFA_RESET
  )

  // Factor replacement is already committed and `enrollment.secret` cannot be
  // reconstructed. Response-only enrichment must therefore never turn this
  // successful credential mutation into an error that withholds the secret.
  let responseUser: any = user
  let userEnrichmentCompleted = true
  try {
    const enrichedUser = await User.findById(user._id).populate({ path: 'profile_id', populate: { path: 'hospital_id' } })
    if (enrichedUser) responseUser = enrichedUser
    else userEnrichmentCompleted = false
  } catch (error) {
    userEnrichmentCompleted = false
    logger.error('admin_mfa.recovery_response_enrichment_failed', {
      user_id: String(user._id),
      error: sanitizeLogText(error),
    })
  }

  return {
    user: formatUserForAdmin(responseUser),
    factor_type: 'AUTHENTICATOR_APP',
    setup: enrollment,
    invalidated_sessions: invalidatedSessions.modifiedCount || 0,
    revocation_cleanup_completed: invalidatedSessions.cleanupCompleted,
    challenge_cleanup_completed: enrollment.challenge_cleanup_completed,
    user_enrichment_completed: userEnrichmentCompleted,
  }
}

// ─── Doctor Management ───

export async function registerDoctor(data: {
  login_id: string
  password: string
  name: string
  department?: string
  contact_number: string
  profile_picture_url?: string
  hospital_id?: string
  hospital?: string
}, actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  requireCanMutate(ctx)
  const hospitalId = await resolveHospitalId(data.hospital_id || data.hospital, ctx)
  if (!hospitalId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Doctor must be assigned to an active hospital')
  }
  if (ctx.isHospitalAdmin) ensureTenantAccess(ctx, hospitalId)
  const existingUser = await User.findOne({ login_id: data.login_id })
  if (existingUser) {
    throw new ApiError(StatusCodes.CONFLICT, 'A user with this login ID already exists')
  }

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
        password: data.password,
        user_type: UserType.DOCTOR,
        profile_id: profileId,
        user_type_model: 'DoctorProfile',
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
  }
}

export async function getAllDoctors(
  filters: { department?: string; is_active?: boolean; search?: string; hospital_id?: string } = {},
  pagination: { page?: number; limit?: number } = {},
  actorUserId?: string
) {
  const ctx = await getAdminContext(actorUserId)
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
    is_active?: boolean
    password?: string
    hospital_id?: string
    hospital?: string
  },
  actorUserId?: string
) {
  const ctx = await getAdminContext(actorUserId)
  requireCanMutate(ctx)
  // Find user by _id or login_id
  let user = await User.findById(userId).select('+password_history').populate('profile_id')
  if (!user) {
    user = await User.findOne({ login_id: userId }).select('+password_history').populate('profile_id')
  }
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Doctor not found')
  }
  if (user.user_type !== UserType.DOCTOR) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'User is not a doctor')
  }
  ensureTenantAccess(ctx, (user.profile_id as any)?.hospital_id)
  const doctorProfile = user.profile_id as any
  const originalUser = user.toObject({ depopulate: true })
  const originalProfile = doctorProfile.toObject()
  let requestedDoctorHospitalMove: string | undefined

  // Update profile fields
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

  const wasActive = user.is_active
  if (data.password) {
    await validatePasswordChangeForUser(user, data.password)
  }

  let mutationStarted = false
  let expectedUserAfterMutation: any
  let expectedProfileAfterMutation: any
  let preserveCommittedPasswordAfterMembershipLoss = false
  let deactivationCommitted = false
  let passwordCommitted = false
  const changedUserPaths: string[] = []
  const changedProfilePaths = Object.keys(profileUpdate)
  let moveGuard: Awaited<ReturnType<typeof acquireDoctorMoveGuard>> | undefined
  let membershipGuards: Awaited<ReturnType<typeof acquireHospitalMembershipGuards>> = []
  try {
    const activating = !wasActive && data.is_active === true
    if (requestedDoctorHospitalMove || activating) {
      membershipGuards = await acquireHospitalMembershipGuards([
        doctorProfile?.hospital_id,
        requestedDoctorHospitalMove || doctorProfile?.hospital_id,
      ])
    }
    if (requestedDoctorHospitalMove) {
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

    const deactivating = wasActive && data.is_active === false
    if (deactivating) {
      await deactivateDoctorWithAssignmentGuard(user, moveGuard)
      user.is_active = false
      changedUserPaths.push('is_active')
      expectedUserAfterMutation = user.toObject({ depopulate: true })
      mutationStarted = true
      deactivationCommitted = true
    } else if (typeof data.is_active === 'boolean') {
      user.is_active = data.is_active
      changedUserPaths.push('is_active')
    }

    if (data.password) {
      if (moveGuard) await moveGuard.assertOwned()
      for (const guard of membershipGuards) await guard.assertOwned()
      await setUserPasswordWithPolicy(user, data.password, { mustChangePassword: true })
      changedUserPaths.push('password', 'salt', 'password_history', 'password_changed_at', 'must_change_password', 'security_version')
      expectedUserAfterMutation = user.toObject({ depopulate: true })
      mutationStarted = true
      passwordCommitted = true
      preserveCommittedPasswordAfterMembershipLoss = true
      if (moveGuard) await moveGuard.assertOwned()
      try {
        for (const guard of membershipGuards) await guard.assertOwned()
      } catch (membershipError) {
        preserveCommittedPasswordAfterMembershipLoss = true
        await User.updateOne(
          { _id: user._id, security_version: user.security_version, is_active: true },
          { $set: { is_active: false } },
        )
        user.is_active = false
        await bestEffortRevokeSessionsAfterSecurityVersionBump(user._id.toString(), AuthSessionRevocationReason.PASSWORD_RESET)
        throw membershipError
      }
      await bestEffortRevokeSessionsAfterSecurityVersionBump(user._id.toString(), AuthSessionRevocationReason.PASSWORD_RESET)
    } else if (!deactivating) {
      if (moveGuard) await moveGuard.assertOwned()
      for (const guard of membershipGuards) await guard.assertOwned()
      await user.save()
      expectedUserAfterMutation = user.toObject({ depopulate: true })
      mutationStarted = true
      if (moveGuard) await moveGuard.assertOwned()
      for (const guard of membershipGuards) await guard.assertOwned()
    }
    await revokeSessionsIfAccountDisabled(user, wasActive)
  } catch (error) {
    if (mutationStarted) {
      let moveOwnershipLost = false
      if (moveGuard) {
        try { await moveGuard.assertOwned() } catch { moveOwnershipLost = true }
      }
      const irreversibleSecurityMutation = deactivationCommitted || passwordCommitted
      if (irreversibleSecurityMutation || moveOwnershipLost) {
        await User.updateOne({ _id: originalUser._id }, { $set: { is_active: false } })
        await bestEffortRevokeSessionsAfterSecurityVersionBump(
          String(originalUser._id),
          passwordCommitted ? AuthSessionRevocationReason.PASSWORD_RESET : AuthSessionRevocationReason.ACCOUNT_DISABLED,
        )
      }
      const safeProfilePaths = moveOwnershipLost
        ? changedProfilePaths.filter(path => path !== 'hospital_id' && path !== 'doctor_operation_fence')
        : changedProfilePaths
      await Promise.all([
        expectedUserAfterMutation && changedUserPaths.length &&
          !preserveCommittedPasswordAfterMembershipLoss && !deactivationCommitted && !moveOwnershipLost
          ? restoreFieldsWithCas(User, originalUser._id, originalUser, expectedUserAfterMutation, compensationGroups(changedUserPaths))
          : Promise.resolve(),
        expectedProfileAfterMutation && safeProfilePaths.length
          ? restoreFieldsWithCas(DoctorProfile, originalProfile._id, originalProfile, expectedProfileAfterMutation, compensationGroups(safeProfilePaths))
          : Promise.resolve(),
      ])
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

  const deactivated = await deactivateDoctorWithAssignmentGuard(user)
  const invalidatedSessions = await revokeSessionsIfAccountDisabled(deactivated, true)

  return { message: 'Doctor deactivated successfully', invalidated_sessions: invalidatedSessions }
}

// ─── Patient Management ───

export async function onboardPatient(data: {
  login_id: string
  password: string
  assigned_doctor_id: string // supports doctor user _id or doctor login_id
  demographics: {
    name: string
    age?: number
    gender?: 'Male' | 'Female' | 'Other'
    phone: string
    next_of_kin?: { name?: string; relation?: string; relationship?: string; phone?: string }
  }
  medical_config?: {
    diagnosis?: string
    therapy_drug?: string
    therapy_start_date?: Date
    target_inr?: { min: number; max: number }
  }
  hospital_id?: string
  hospital?: string
}, actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  requireCanMutate(ctx)
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
      medical_config: data.medical_config
        ? {
            ...data.medical_config,
            therapy_start_date: data.medical_config.therapy_start_date,
          }
        : undefined,
      }], session ? { session } : undefined).then(([profile]) => profile),
      (profileId, session) => User.create([{
      login_id: data.login_id,
      password: data.password,
      user_type: UserType.PATIENT,
      profile_id: profileId,
      user_type_model: 'PatientProfile',
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
          { $set: { is_active: false } },
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
  }
}

export async function getAllPatients(
  filters: { assigned_doctor_id?: string; account_status?: string; search?: string; hospital_id?: string } = {},
  pagination: { page?: number; limit?: number } = {},
  actorUserId?: string
) {
  const ctx = await getAdminContext(actorUserId)
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
    medical_config?: any
    assigned_doctor_id?: string
    account_status?: string
    is_active?: boolean
    password?: string
    hospital_id?: string
    hospital?: string
  },
  actorUserId?: string
) {
  const ctx = await getAdminContext(actorUserId)
  requireCanMutate(ctx)
  let user = await User.findById(userId).select('+password_history').populate('profile_id')
  if (!user) {
    user = await User.findOne({ login_id: userId }).select('+password_history').populate('profile_id')
  }
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Patient not found')
  }
  if (user.user_type !== UserType.PATIENT) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'User is not a patient')
  }
  ensureTenantAccess(ctx, (user.profile_id as any)?.hospital_id)
  const patientProfile = user.profile_id as any
  const originalUser = user.toObject({ depopulate: true })
  const originalProfile = patientProfile.toObject()
  let therapyStartGuard: Date | undefined
  let assignmentDoctorUserId: unknown
  const previousAssignedDoctorId = patientProfile?.assigned_doctor_id

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
  if (data.medical_config) {
    // Medical config contains historical adherence and clinician-maintained
    // fields. Replacing the whole subdocument from a partial PATCH silently
    // erased taken doses, instructions, and review state.
    if (data.medical_config.diagnosis !== undefined) {
      profileUpdate['medical_config.diagnosis'] = data.medical_config.diagnosis
    }
    if (data.medical_config.therapy_drug !== undefined) {
      profileUpdate['medical_config.therapy_drug'] = data.medical_config.therapy_drug
    }
    if (data.medical_config.therapy_start_date !== undefined) {
      const proposedStart = new Date(data.medical_config.therapy_start_date)
      const takenDoses = patientProfile?.medical_config?.taken_doses ?? []
      if (takenDoses.some((dose: Date) => new Date(dose).getTime() < proposedStart.getTime())) {
        throw new ApiError(StatusCodes.CONFLICT, 'Therapy start date cannot be moved after an already recorded dose')
      }
      const nextReview = patientProfile?.medical_config?.next_review_date
      if (nextReview && new Date(nextReview).getTime() < proposedStart.getTime()) {
        throw new ApiError(StatusCodes.CONFLICT, 'Therapy start date cannot be moved after the scheduled review date')
      }
      profileUpdate['medical_config.therapy_start_date'] = data.medical_config.therapy_start_date
      therapyStartGuard = proposedStart
    }
    if (data.medical_config.target_inr !== undefined) {
      profileUpdate['medical_config.target_inr'] = data.medical_config.target_inr
    }
  }
  if (data.account_status) profileUpdate.account_status = data.account_status
  const transitioningToActive = data.account_status === 'Active' && patientProfile?.account_status !== 'Active'
  const wasActive = user.is_active
  const activatingUser = !wasActive && data.is_active === true
  const requiresPatientPurgeFence = transitioningToActive || activatingUser
  if (activatingUser && profileUpdate.account_status === undefined) {
    profileUpdate.account_status = patientProfile.account_status
  }

  let requestedHospitalId: string | undefined
  if (data.hospital_id || data.hospital) {
    requestedHospitalId = await resolveHospitalId(data.hospital_id || data.hospital, ctx)
    ensureTenantAccess(ctx, requestedHospitalId)
  }

  if (data.assigned_doctor_id) {
    const doctorUser = await findDoctorByIdentifier(data.assigned_doctor_id)
    if (!doctorUser || doctorUser.user_type !== UserType.DOCTOR || !doctorUser.is_active) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid or inactive doctor ID')
    }
    const doctorProfile: any = await DoctorProfile.findById(doctorUser.profile_id)
    const doctorHospitalId = doctorProfile?.hospital_id ? String(doctorProfile.hospital_id) : undefined
    if (!doctorHospitalId) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Assigned doctor must be assigned to a hospital')
    }
    ensureTenantAccess(ctx, doctorHospitalId)
    if (requestedHospitalId && requestedHospitalId !== doctorHospitalId) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'Assigned doctor must belong to the same hospital as the patient')
    }
    profileUpdate.assigned_doctor_id = doctorUser._id
    profileUpdate.hospital_id = doctorHospitalId
    assignmentDoctorUserId = doctorUser._id
  } else if (requestedHospitalId) {
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

  if (data.assigned_doctor_id !== undefined &&
      (data.password !== undefined || data.is_active !== undefined)) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      'Doctor assignment cannot be combined with password or account activation changes; submit them separately',
    )
  }

  if (transitioningToActive && !assignmentDoctorUserId) {
    const retainedDoctor = await findDoctorByAssignment(patientProfile?.assigned_doctor_id)
    if (!retainedDoctor || retainedDoctor.user_type !== UserType.DOCTOR || !retainedDoctor.is_active) {
      throw new ApiError(StatusCodes.CONFLICT, 'An active doctor must be assigned before reactivating this patient')
    }
    assignmentDoctorUserId = retainedDoctor._id
  }

  if (data.password) {
    await validatePasswordChangeForUser(user, data.password)
  }

  let releaseAssignmentGuard: Awaited<ReturnType<typeof acquireDoctorAssignmentGuard>> | undefined
  let releasePreviousDoctorGuard: Awaited<ReturnType<typeof acquireDoctorAssignmentGuard>> | undefined
  let patientLifecycleLease: Awaited<ReturnType<typeof acquirePatientFileOperationLease>> | undefined
  const resultingHospitalMove = profileUpdate.hospital_id
  const needsMembershipGuard = (resultingHospitalMove && String(resultingHospitalMove) !== String(patientProfile?.hospital_id || '')) || activatingUser
  const membershipGuards = needsMembershipGuard
    ? await acquireHospitalMembershipGuards([patientProfile?.hospital_id, resultingHospitalMove || patientProfile?.hospital_id])
    : []
  let mutationStarted = false
  let committedAssignmentAfterLeaseLoss = false
  let assignmentTerminalFailure: 'QUARANTINED' | 'SUPERSEDED' | undefined
  let expectedUserAfterMutation: any
  let expectedProfileAfterMutation: any
  let preserveCommittedPasswordAfterMembershipLoss = false
  const changedUserPaths: string[] = []
  const changedProfilePaths = Object.keys(profileUpdate)
  try {
    if (requiresPatientPurgeFence) {
      patientLifecycleLease = await acquirePatientFileOperationLease(patientProfile._id, { requireActive: false })
      await patientLifecycleLease.assertOwned()
    }
    for (const guard of membershipGuards) await guard.assertOwned()
    if (assignmentDoctorUserId) {
      releaseAssignmentGuard = await acquireDoctorAssignmentGuard(assignmentDoctorUserId)
      if (
        profileUpdate.assigned_doctor_id &&
        patientProfile.assigned_doctor_id &&
        String(profileUpdate.assigned_doctor_id) !== String(patientProfile.assigned_doctor_id)
      ) {
        const previousDoctor = await findDoctorByAssignment(patientProfile.assigned_doctor_id)
        if (previousDoctor?.is_active) {
          releasePreviousDoctorGuard = await acquireDoctorAssignmentGuard(previousDoctor._id)
          await stampDoctorProfileFence(previousDoctor.profile_id, {
            fenceToken: releasePreviousDoctorGuard.fenceToken,
            assertOwned: releasePreviousDoctorGuard.assertOwned,
          })
        }
      }
      const guardedDoctor = await User.findById(assignmentDoctorUserId).select('is_active profile_id')
      const guardedDoctorProfile = guardedDoctor
        ? await DoctorProfile.findById(guardedDoctor.profile_id).select('hospital_id doctor_operation_fence')
        : null
      const resultingHospitalId = String(profileUpdate.hospital_id || patientProfile.hospital_id || '')
      if (
        !guardedDoctor?.is_active ||
        !guardedDoctorProfile?.hospital_id ||
        String(guardedDoctorProfile.hospital_id) !== resultingHospitalId
      ) {
        throw new ApiError(StatusCodes.CONFLICT, 'Assigned doctor is inactive or belongs to a different hospital')
      }
      await stampDoctorProfileFence(guardedDoctor.profile_id, {
        fenceToken: releaseAssignmentGuard.fenceToken,
        assertOwned: releaseAssignmentGuard.assertOwned,
      })
      profileUpdate.assigned_doctor_fence = releaseAssignmentGuard.fenceToken
      if (!changedProfilePaths.includes('assigned_doctor_fence')) changedProfilePaths.push('assigned_doctor_fence')
    }
    if (Object.keys(profileUpdate).length > 0) {
      for (const guard of membershipGuards) await guard.assertOwned()
      if (releaseAssignmentGuard) await releaseAssignmentGuard.assertOwned()
      if (releasePreviousDoctorGuard) await releasePreviousDoctorGuard.assertOwned()
      for (const guard of membershipGuards) await guard.assertOwned()
      const profileFilter: any = { _id: patientProfile._id }
      if (requiresPatientPurgeFence) {
        await patientLifecycleLease?.assertOwned()
        profileFilter['file_purge.state'] = { $nin: ['PURGING', 'COMPLETE'] }
      }
      if (therapyStartGuard) {
        profileFilter['medical_config.taken_doses'] = {
          $not: { $elemMatch: { $lt: therapyStartGuard } },
        }
        profileFilter.$or = [
          { 'medical_config.next_review_date': { $exists: false } },
          { 'medical_config.next_review_date': null },
          { 'medical_config.next_review_date': { $gte: therapyStartGuard } },
        ]
      }
      const updatedProfile = await PatientProfile.findOneAndUpdate(
        profileFilter,
        {
          $set: profileUpdate,
          ...(data.account_status === 'Active' && assignmentDoctorUserId
            ? { $unset: { assignment_conflict: 1 } }
            : {}),
        },
        { runValidators: true, new: true },
      )
      if (!updatedProfile) {
        if (therapyStartGuard && await PatientProfile.exists({ _id: patientProfile._id })) {
          throw new ApiError(StatusCodes.CONFLICT, 'Therapy state changed while the update was being applied')
        }
        throw new ApiError(StatusCodes.NOT_FOUND, 'Patient profile not found')
      }
      expectedProfileAfterMutation = typeof (updatedProfile as any).toObject === 'function'
        ? (updatedProfile as any).toObject()
        : updatedProfile
      mutationStarted = true
      if (releaseAssignmentGuard) await releaseAssignmentGuard.assertOwned()
      if (releasePreviousDoctorGuard) await releasePreviousDoctorGuard.assertOwned()
      for (const guard of membershipGuards) await guard.assertOwned()
    }

    if (typeof data.is_active === 'boolean') {
      user.is_active = data.is_active
      changedUserPaths.push('is_active')
    }
    if (data.password) {
      await patientLifecycleLease?.assertOwned()
      for (const guard of membershipGuards) await guard.assertOwned()
      await setUserPasswordWithPolicy(user, data.password, { mustChangePassword: true })
      changedUserPaths.push('password', 'salt', 'password_history', 'password_changed_at', 'must_change_password', 'security_version')
      expectedUserAfterMutation = user.toObject({ depopulate: true })
      mutationStarted = true
      try {
        for (const guard of membershipGuards) await guard.assertOwned()
      } catch (membershipError) {
        preserveCommittedPasswordAfterMembershipLoss = true
        await User.updateOne(
          { _id: user._id, security_version: user.security_version, is_active: true },
          { $set: { is_active: false } },
        )
        user.is_active = false
        await bestEffortRevokeSessionsAfterSecurityVersionBump(user._id.toString(), AuthSessionRevocationReason.PASSWORD_RESET)
        throw membershipError
      }
      await bestEffortRevokeSessionsAfterSecurityVersionBump(user._id.toString(), AuthSessionRevocationReason.PASSWORD_RESET)
    } else {
      await patientLifecycleLease?.assertOwned()
      for (const guard of membershipGuards) await guard.assertOwned()
      await user.save()
      expectedUserAfterMutation = user.toObject({ depopulate: true })
      mutationStarted = true
      for (const guard of membershipGuards) await guard.assertOwned()
    }
    await revokeSessionsIfAccountDisabled(user, wasActive)
  } catch (error) {
    if (mutationStarted) {
      let safeProfilePaths = changedProfilePaths
      if (changedProfilePaths.includes('assigned_doctor_id')) {
        try {
          if (releaseAssignmentGuard) await releaseAssignmentGuard.assertOwned()
          if (releasePreviousDoctorGuard) await releasePreviousDoctorGuard.assertOwned()
        } catch {
          safeProfilePaths = changedProfilePaths.filter(path =>
            path !== 'assigned_doctor_id' && path !== 'assigned_doctor_fence' && path !== 'hospital_id')
          if (releaseAssignmentGuard && assignmentDoctorUserId) {
            const terminal = await terminalizePatientAssignment({
              patientProfileId: patientProfile._id,
              targetDoctorUserId: assignmentDoctorUserId,
              targetFence: releaseAssignmentGuard.fenceToken,
              patientHospitalId: profileUpdate.hospital_id || patientProfile.hospital_id,
              previousDoctorId: previousAssignedDoctorId,
              reason: 'Target doctor lifecycle changed after patient update committed',
              targetGuard: releaseAssignmentGuard,
            })
            if (terminal.state === 'COMMITTED') {
              committedAssignmentAfterLeaseLoss = true
            } else if (terminal.state === 'QUARANTINED') {
              assignmentTerminalFailure = terminal.state
              logger.error('patient_update.assignment_conflict', {
                patient_id: String(patientProfile._id),
                attempted_doctor_id: String(assignmentDoctorUserId),
              })
            } else {
              assignmentTerminalFailure = terminal.state
            }
          }
        }
      }
      if (!committedAssignmentAfterLeaseLoss) {
        await Promise.all([
          expectedUserAfterMutation && changedUserPaths.length && !preserveCommittedPasswordAfterMembershipLoss
            ? restoreFieldsWithCas(User, originalUser._id, originalUser, expectedUserAfterMutation, compensationGroups(changedUserPaths))
            : Promise.resolve(),
          expectedProfileAfterMutation && safeProfilePaths.length
            ? restoreFieldsWithCas(PatientProfile, originalProfile._id, originalProfile, expectedProfileAfterMutation, compensationGroups(safeProfilePaths))
            : Promise.resolve(),
        ])
      }
    }
    if (assignmentTerminalFailure) {
      try {
        await AuditLog.create({
          user_id: actorUserId,
          user_type: UserType.ADMIN,
          action: AuditAction.PATIENT_REASSIGN,
          description: assignmentTerminalFailure === 'QUARANTINED'
            ? 'Admin patient update entered assignment-conflict review'
            : 'Admin patient reassignment was superseded',
          resource_type: 'Patient', resource_id: String(patientProfile._id), success: false,
          error_message: assignmentTerminalFailure.toLowerCase(),
          metadata: {
            patient_user_id: String(user._id),
            previous_doctor_id: previousAssignedDoctorId ? String(previousAssignedDoctorId) : undefined,
            attempted_doctor_id: assignmentDoctorUserId ? String(assignmentDoctorUserId) : undefined,
          },
        })
      } catch {
        logger.error('patient_update.assignment_conflict_audit_failed', { patient_id: String(patientProfile._id) })
      }
    }
    if (!committedAssignmentAfterLeaseLoss) throw error
  } finally {
    await patientLifecycleLease?.release()
    if (releasePreviousDoctorGuard) await releasePreviousDoctorGuard()
    if (releaseAssignmentGuard) await releaseAssignmentGuard()
    for (const guard of membershipGuards.reverse()) await guard.release()
  }

  if (profileUpdate.assigned_doctor_id) {
    await createDoctorUpdateNotification({
      patientUserId: user._id,
      changedByDoctorId: actorUserId || assignmentDoctorUserId,
      changeType: 'DOCTOR_REASSIGNED',
      title: 'Doctor assignment changed',
      message: 'Your assigned care team has changed.',
      changedFields: ['assigned_doctor_id'],
    })
    try {
      await AuditLog.create({
        user_id: actorUserId,
        user_type: UserType.ADMIN,
        action: AuditAction.PATIENT_REASSIGN,
        description: 'Admin patient update changed doctor assignment',
        resource_type: 'Patient',
        resource_id: String(patientProfile._id),
        success: true,
        metadata: {
          patient_user_id: String(user._id),
          previous_doctor_id: previousAssignedDoctorId ? String(previousAssignedDoctorId) : undefined,
          assigned_doctor_id: String(assignmentDoctorUserId),
          terminalized_after_lease_loss: committedAssignmentAfterLeaseLoss,
        },
      })
    } catch (auditError) {
      logger.error('patient_update.reassignment_audit_failed', {
        patient_id: String(patientProfile._id),
      })
    }
  }

  return await User.findById(user._id).populate('profile_id')
}

export async function deactivatePatient(userId: string, actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  requireCanMutate(ctx)
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

  user.is_active = false
  await user.save()
  const invalidatedSessions = await revokeSessionsIfAccountDisabled(user, true)

  // Also update account_status
  await PatientProfile.findByIdAndUpdate(
    user.profile_id,
    { account_status: 'Discharged' },
    { runValidators: true },
  )

  return { message: 'Patient deactivated successfully', invalidated_sessions: invalidatedSessions }
}

export async function reassignPatient(patientLoginId: string, newDoctorId: string, actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  requireCanMutate(ctx)
  const patientUser = await User.findOne({ login_id: patientLoginId }).populate('profile_id')
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
      },
      {
        $set: {
          assigned_doctor_id: doctorUser._id,
          assigned_doctor_fence: releaseAssignmentGuard.fenceToken,
        },
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
      await ensureUserTenantAccess(ctx, userId)

      switch (operation) {
        case 'activate':
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
              hospitalId = (await AdminProfile.findById(user.profile_id).select('hospital_id admin_role').lean())?.hospital_id
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
                    { $set: { is_active: true } },
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
                      { $set: { is_active: false } },
                    )
                  }
                  throw error
                } finally {
                  await guard.release()
                }
              } finally {
                await patientLifecycleLease?.release()
              }
            } else if (user.user_type === UserType.ADMIN) {
              const adminProfile = await AdminProfile.findById(user.profile_id).select('admin_role').lean()
              if (![AdminRole.APP_ADMIN, AdminRole.AUDITOR].includes(adminProfile?.admin_role as AdminRole)) {
                throw new ApiError(StatusCodes.CONFLICT, 'Tenant user must belong to an active hospital before activation')
              }
              await User.updateOne({ _id: user._id, is_active: false }, { $set: { is_active: true } })
            } else {
              throw new ApiError(StatusCodes.CONFLICT, 'Tenant user must belong to an active hospital before activation')
            }
          }
          results.push({ userId, success: true, message: 'User activated' })
          break

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
  await ensureUserTenantAccess(ctx, targetUserId)
  return adminResetPassword(adminUserId, targetUserId, newPassword)
}

export async function listLegacyPatients(actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  const patients = await User.find({ user_type: UserType.PATIENT })
    .populate('profile_id')
    .sort({ createdAt: -1 })
  return { patients: patients.filter(patient => isUserVisibleToAdmin(ctx, patient)) }
}

export async function getLegacyPatientByLoginId(opNum: string, actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  const user = await User.findOne({ login_id: opNum, user_type: UserType.PATIENT }).populate('profile_id')
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'Patient not found')
  ensureTenantAccess(ctx, getProfileHospitalId(user))
  return { patient: user }
}

export async function getLegacyDoctorById(id: string, actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
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
