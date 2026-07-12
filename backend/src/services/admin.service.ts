import { StatusCodes } from 'http-status-codes'
import { User, DoctorProfile, PatientProfile, AuditLog, AdminProfile, Hospital, Invoice } from '@alias/models'
import { ApiError } from '@alias/utils'
import { UserType } from '@alias/validators'
import { adminResetPassword, generateTemporaryPassword, setUserPasswordWithPolicy } from './password.service'
import { revokeActiveAuthSessionsForUser, revokeActiveAuthSessionsForUsers } from './auth-session.service'
import { AuthSessionRevocationReason } from '@alias/models/authsession.model'
import mongoose from 'mongoose'
import { AdminRole } from '@alias/models/adminprofile.model'
import { HospitalStatus } from '@alias/models/hospital.model'
import { InvoiceStatus } from '@alias/models/invoice.model'
import { replaceAdminTotpForRecovery } from './admin-totp.service'

const normalizeSearchValue = (value: unknown): string => {
  if (typeof value === 'string') return value.toLowerCase()
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).toLowerCase()
  }
  return ''
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

export const ROLE_DEFINITIONS = {
  app_admin: {
    label: 'App Admin',
    color: 'admin',
    permissions: { manage_hospitals: true, manage_users: true, manage_roles: true, view_audit: true, manage_doctors: true, manage_patients: true, export_data: true, manage_billing: true },
  },
  hospital_admin: {
    label: 'Hospital Admin',
    color: 'doctor',
    permissions: { manage_hospitals: false, manage_users: false, manage_roles: false, view_audit: false, manage_doctors: true, manage_patients: true, export_data: false, manage_billing: true },
  },
  doctor: {
    label: 'Doctor',
    color: 'doctor',
    permissions: { manage_hospitals: false, manage_users: false, manage_roles: false, view_audit: false, manage_doctors: false, manage_patients: true, export_data: false, manage_billing: false },
  },
  patient: {
    label: 'Patient',
    color: 'patient',
    permissions: { manage_hospitals: false, manage_users: false, manage_roles: false, view_audit: false, manage_doctors: false, manage_patients: false, export_data: false, manage_billing: false },
  },
  auditor: {
    label: 'System Auditor',
    color: 'auditor',
    permissions: { manage_hospitals: false, manage_users: false, manage_roles: false, view_audit: true, manage_doctors: false, manage_patients: false, export_data: true, manage_billing: true },
  },
}

export async function getAdminContext(userId?: string) {
  const user = userId ? await User.findById(userId).populate({
    path: 'profile_id',
    populate: { path: 'hospital_id' },
  }) : null
  const profile: any = user?.profile_id
  const role = profile?.admin_role || AdminRole.APP_ADMIN
  const hospitalId = profile?.hospital_id?._id || profile?.hospital_id
  return {
    role,
    hospitalId: hospitalId ? String(hospitalId) : undefined,
    hospitalCode: profile?.hospital_id?.code,
    isAppAdmin: role === AdminRole.APP_ADMIN,
    isHospitalAdmin: role === AdminRole.HOSPITAL_ADMIN,
    isAuditor: role === AdminRole.AUDITOR,
  }
}

export function requireCanMutate(ctx: Awaited<ReturnType<typeof getAdminContext>>) {
  if (ctx.isAuditor) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Auditors have read-only access')
  }
}

function requireAppAdmin(ctx: Awaited<ReturnType<typeof getAdminContext>>) {
  if (!ctx.isAppAdmin) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'App Admin access is required')
  }
}

function ensureTenantAccess(ctx: Awaited<ReturnType<typeof getAdminContext>>, hospitalId?: unknown) {
  if (ctx.isAppAdmin || ctx.isAuditor) return
  const value = String(hospitalId || '')
  if (!ctx.hospitalId || (value !== ctx.hospitalId && value !== ctx.hospitalCode)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Cross-tenant access is not allowed')
  }
}

async function resolveHospitalId(input?: string, ctx?: Awaited<ReturnType<typeof getAdminContext>>) {
  if (ctx?.isHospitalAdmin) return ctx.hospitalId
  if (!input) return undefined
  if (mongoose.Types.ObjectId.isValid(input)) {
    const byId = await Hospital.findById(input)
    if (byId) return String(byId._id)
  }
  const byCode = await Hospital.findOne({ code: input.toUpperCase() })
  return byCode ? String(byCode._id) : undefined
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
    hospital: role === 'app_admin' || role === 'auditor' ? 'ALL' : String(hospital),
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
  if (ctx.isAppAdmin) return true
  const hospitalId = getProfileHospitalId(user)
  return Boolean(ctx.hospitalId && hospitalId === ctx.hospitalId)
}

export async function getTenantUserIdsForAdmin(actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  if (ctx.isAppAdmin) return undefined
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
    const result = await revokeActiveAuthSessionsForUser(
      user._id.toString(),
      AuthSessionRevocationReason.ACCOUNT_DISABLED
    )
    return result.modifiedCount || 0
  }

  return 0
}

export async function getRoles() {
  return { roles: ROLE_DEFINITIONS }
}

export async function updateRoleDefinition(roleKey: string, data: any, actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  requireAppAdmin(ctx)
  if (!(ROLE_DEFINITIONS as any)[roleKey]) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Role not found')
  }
  ;(ROLE_DEFINITIONS as any)[roleKey].permissions = {
    ...(ROLE_DEFINITIONS as any)[roleKey].permissions,
    ...(data.permissions || {}),
  }
  return { role: (ROLE_DEFINITIONS as any)[roleKey] }
}

export async function listHospitals(filters: { status?: string; search?: string } = {}, actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  if (ctx.isHospitalAdmin) {
    if (!ctx.hospitalId) return { hospitals: [] }
    filters = { ...filters }
  }
  const query: any = {}
  if (filters.status) query.status = filters.status
  if (ctx.isHospitalAdmin) query._id = ctx.hospitalId
  if (filters.search) {
    query.$or = [
      { name: new RegExp(filters.search, 'i') },
      { location: new RegExp(filters.search, 'i') },
      { admin_email: new RegExp(filters.search, 'i') },
      { code: new RegExp(filters.search, 'i') },
    ]
  }
  const hospitals = await Hospital.find(query).sort({ createdAt: -1 }).lean()
  const formatted = await Promise.all(hospitals.map(async h => {
    const [doctors, patients] = await Promise.all([
      DoctorProfile.countDocuments({ hospital_id: h._id }),
      PatientProfile.countDocuments({ hospital_id: h._id }),
    ])
    return formatHospital(h, { doctors, patients })
  }))
  return { hospitals: formatted }
}

export async function createHospital(data: any, actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  requireAppAdmin(ctx)
  const count = await Hospital.countDocuments()
  const hospital = await Hospital.create({
    code: data.code || `H${String(count + 1).padStart(3, '0')}`,
    name: data.name,
    location: data.location,
    admin_email: data.admin_email || data.admin,
    status: data.status || HospitalStatus.ACTIVE,
    metadata: data.metadata,
  })
  return { hospital: formatHospital(hospital.toObject()) }
}

export async function updateHospital(id: string, data: any, actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  requireAppAdmin(ctx)
  const hospital = await Hospital.findOneAndUpdate(
    mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { code: id.toUpperCase() },
    {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.location !== undefined ? { location: data.location } : {}),
      ...(data.admin_email !== undefined || data.admin !== undefined ? { admin_email: data.admin_email || data.admin } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
    },
    { new: true }
  )
  if (!hospital) throw new ApiError(StatusCodes.NOT_FOUND, 'Hospital not found')
  let usersDeactivated = 0
  let invalidatedSessions = 0
  if (hospital.status !== HospitalStatus.ACTIVE) {
    const [doctorProfiles, patientProfiles, adminProfiles] = await Promise.all([
      DoctorProfile.find({ hospital_id: hospital._id }).select('_id').lean(),
      PatientProfile.find({ hospital_id: hospital._id }).select('_id').lean(),
      AdminProfile.find({ hospital_id: hospital._id }).select('_id').lean(),
    ])
    const profileIds = [...doctorProfiles, ...patientProfiles, ...adminProfiles].map(profile => profile._id)
    const users = profileIds.length
      ? await User.find({ profile_id: { $in: profileIds } }).select('_id is_active').lean()
      : []
    const activeUserIds = users.filter(user => user.is_active).map(user => user._id)
    if (activeUserIds.length) {
      const updateResult = await User.updateMany({ _id: { $in: activeUserIds } }, { $set: { is_active: false } })
      usersDeactivated = updateResult.modifiedCount || 0
    }
    const revocationResult = await revokeActiveAuthSessionsForUsers(
      users.map(user => user._id),
      AuthSessionRevocationReason.ACCOUNT_DISABLED
    )
    invalidatedSessions = revocationResult.modifiedCount || 0
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
  if (ctx.isHospitalAdmin) query.hospital_id = ctx.hospitalId
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
  const created = []
  for (const hospital of hospitals) {
    const invoice = await Invoice.create({
      invoice_number: `INV-${Date.now()}-${hospital.code}`,
      hospital_id: hospital._id,
      plan: data.plan || 'Standard Tier (B2B)',
      amount: data.amount || 25000,
      status: InvoiceStatus.PENDING,
      issued_date: now,
      due_date: due,
    })
    created.push(invoice)
  }
  return { generated: created.length }
}

export async function createCheckout(invoiceId: string, actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
  const invoice = await Invoice.findOne(mongoose.Types.ObjectId.isValid(invoiceId) ? { _id: invoiceId } : { invoice_number: invoiceId })
  if (!invoice) throw new ApiError(StatusCodes.NOT_FOUND, 'Invoice not found')
  ensureTenantAccess(ctx, invoice.hospital_id)
  return {
    invoice_id: invoice.invoice_number,
    checkout_url: `https://payments.example.local/checkout/${invoice.invoice_number}`,
    provider: 'placeholder',
  }
}

export async function listUsers(actorUserId?: string) {
  const ctx = await getAdminContext(actorUserId)
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
  if (data.role === AdminRole.APP_ADMIN) requireAppAdmin(ctx)
  const hospitalId = await resolveHospitalId(data.hospital_id || data.hospital, ctx)
  if (data.role === AdminRole.HOSPITAL_ADMIN) ensureTenantAccess(ctx, hospitalId)
  const existing = await User.findOne({ login_id: data.email || data.login_id })
  if (existing) throw new ApiError(StatusCodes.CONFLICT, 'A user with this login ID already exists')
  const profile = await AdminProfile.create({
    name: data.name,
    admin_role: data.role || AdminRole.HOSPITAL_ADMIN,
    permission: data.role === AdminRole.AUDITOR ? 'READ_ONLY' : 'FULL_ACCESS',
    hospital_id: hospitalId,
  })
  const temporaryPassword = generateTemporaryPassword()
  const user = await User.create({
    login_id: data.email || data.login_id,
    password: temporaryPassword,
    user_type: UserType.ADMIN,
    profile_id: profile._id,
    user_type_model: 'AdminProfile',
    must_change_password: true,
  })
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
  const updates: any = {}
  if (data.role) {
    if (data.role === AdminRole.APP_ADMIN) requireAppAdmin(ctx)
    updates.admin_role = data.role
  }
  if (data.name) updates.name = data.name
  if (data.hospital_id || data.hospital) {
    updates.hospital_id = await resolveHospitalId(data.hospital_id || data.hospital, ctx)
    ensureTenantAccess(ctx, updates.hospital_id)
  }
  if (Object.keys(updates).length && user.user_type === UserType.ADMIN) {
    await AdminProfile.findByIdAndUpdate(profile._id, updates)
  }
  const wasActive = user.is_active
  if (typeof data.is_active === 'boolean') user.is_active = data.is_active
  if (data.status) user.is_active = data.status === 'active'
  await user.save()
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
  const invalidatedSessions = await revokeActiveAuthSessionsForUser(
    String(user._id),
    AuthSessionRevocationReason.MFA_RESET
  )

  return {
    user: formatUserForAdmin(await User.findById(user._id).populate({ path: 'profile_id', populate: { path: 'hospital_id' } })),
    factor_type: 'AUTHENTICATOR_APP',
    setup: enrollment,
    invalidated_sessions: invalidatedSessions.modifiedCount || 0,
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
  if (ctx.isHospitalAdmin) ensureTenantAccess(ctx, hospitalId)
  const existingUser = await User.findOne({ login_id: data.login_id })
  if (existingUser) {
    throw new ApiError(StatusCodes.CONFLICT, 'A user with this login ID already exists')
  }

  const doctorProfile = await DoctorProfile.create({
    name: data.name,
    department: data.department || 'Cardiology',
    contact_number: data.contact_number,
    hospital_id: hospitalId,
  })

  const user = await User.create({
    login_id: data.login_id,
    password: data.password,
    user_type: UserType.DOCTOR,
    profile_id: doctorProfile._id,
    user_type_model: 'DoctorProfile',
  })

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
  const page = pagination.page || 1
  const limit = pagination.limit || 20

  const query: any = { user_type: UserType.DOCTOR }

  if (typeof is_active === 'boolean') {
    query.is_active = is_active
  }

  const users = await User.find(query)
    .populate('profile_id')
    .sort({ createdAt: -1 })

  const filteredUsers = users.filter((user: any) => {
    const profile = user.profile_id as any
    if (!profile) return false
    if (ctx.isHospitalAdmin && String(profile.hospital_id || '') !== ctx.hospitalId) return false
    if (!ctx.isHospitalAdmin && filters.hospital_id && String(profile.hospital_id || '') !== filters.hospital_id) return false
    if (department) {
      const departmentMatch = normalizeSearchValue(profile.department)
        .includes(normalizeSearchValue(department))
      if (!departmentMatch) return false
    }
    if (search) {
      const s = normalizeSearchValue(search)
      const nameMatch = normalizeSearchValue(profile.name).includes(s)
      const loginMatch = normalizeSearchValue(user.login_id).includes(s)
      if (!nameMatch && !loginMatch) return false
    }
    return true
  })

  const total = filteredUsers.length
  const skip = (page - 1) * limit
  const paginatedUsers = filteredUsers.slice(skip, skip + limit)

  return {
    doctors: paginatedUsers,
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
  }

  if (Object.keys(profileUpdate).length > 0) {
    await DoctorProfile.findByIdAndUpdate(user.profile_id, profileUpdate)
  }

  // Update user-level fields
  const wasActive = user.is_active
  if (typeof data.is_active === 'boolean') {
    user.is_active = data.is_active
  }
  if (data.password) {
    const userWithHistory = await User.findById(user._id).select('+password_history')
    if (!userWithHistory) throw new ApiError(StatusCodes.NOT_FOUND, 'Doctor not found')
    if (typeof data.is_active === 'boolean') userWithHistory.is_active = data.is_active
    await setUserPasswordWithPolicy(userWithHistory, data.password, { mustChangePassword: true })
    await revokeActiveAuthSessionsForUser(user._id.toString(), AuthSessionRevocationReason.PASSWORD_RESET)
  } else {
    await user.save()
  }
  await revokeSessionsIfAccountDisabled(user, wasActive)

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

  user.is_active = false
  await user.save()
  const invalidatedSessions = await revokeSessionsIfAccountDisabled(user, true)

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
    therapy_start_date?: string
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

  const patientProfile = await PatientProfile.create({
    assigned_doctor_id: doctorUser._id,
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
          therapy_start_date: data.medical_config.therapy_start_date
            ? new Date(data.medical_config.therapy_start_date)
            : undefined,
        }
      : undefined,
  })

  const user = await User.create({
    login_id: data.login_id,
    password: data.password,
    user_type: UserType.PATIENT,
    profile_id: patientProfile!._id,
    user_type_model: 'PatientProfile',
  })

  return {
    user: await User.findById(user._id).populate('profile_id'),
  }
}

export async function getAllPatients(
  filters: { assigned_doctor_id?: string; account_status?: string; search?: string; hospital_id?: string } = {},
  pagination: { page?: number; limit?: number } = {},
  actorUserId?: string
) {
  const ctx = await getAdminContext(actorUserId)
  const page = pagination.page || 1
  const limit = pagination.limit || 20

  const query: any = { user_type: UserType.PATIENT }

  const users = await User.find(query)
    .populate('profile_id')
    .sort({ createdAt: -1 })

  let assignedDoctorId: string | undefined
  if (filters.assigned_doctor_id) {
    const doctorUser = await findDoctorByIdentifier(filters.assigned_doctor_id)
    if (!doctorUser) {
      return {
        patients: [],
        pagination: {
          total: 0,
          page,
          limit,
          pages: 0,
          hasNext: false,
          hasPrev: false,
        },
      }
    }
    assignedDoctorId = String(doctorUser._id)
  }

  const filteredUsers = users.filter((user: any) => {
    const profile = user.profile_id as any
    if (!profile) return false
    if (ctx.isHospitalAdmin && String(profile.hospital_id || '') !== ctx.hospitalId) return false
    if (!ctx.isHospitalAdmin && filters.hospital_id && String(profile.hospital_id || '') !== filters.hospital_id) return false
    if (assignedDoctorId && String(profile.assigned_doctor_id) !== assignedDoctorId) return false
    if (filters.account_status && profile.account_status !== filters.account_status) return false
    if (filters.search) {
      const s = normalizeSearchValue(filters.search)
      const nameMatch = normalizeSearchValue(profile.demographics?.name).includes(s)
      const loginMatch = normalizeSearchValue(user.login_id).includes(s)
      if (!nameMatch && !loginMatch) return false
    }
    return true
  })

  const total = filteredUsers.length
  const skip = (page - 1) * limit
  const paginatedUsers = filteredUsers.slice(skip, skip + limit)

  return {
    patients: paginatedUsers,
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
  if (data.medical_config) profileUpdate.medical_config = data.medical_config
  if (data.account_status) profileUpdate.account_status = data.account_status

  if (data.assigned_doctor_id) {
    const doctorUser = await findDoctorByIdentifier(data.assigned_doctor_id)
    if (!doctorUser || doctorUser.user_type !== UserType.DOCTOR || !doctorUser.is_active) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid or inactive doctor ID')
    }
    profileUpdate.assigned_doctor_id = doctorUser._id
    const doctorProfile: any = await DoctorProfile.findById(doctorUser.profile_id)
    ensureTenantAccess(ctx, doctorProfile?.hospital_id)
    if (doctorProfile?.hospital_id) profileUpdate.hospital_id = doctorProfile.hospital_id
  }
  if (data.hospital_id || data.hospital) {
    profileUpdate.hospital_id = await resolveHospitalId(data.hospital_id || data.hospital, ctx)
    ensureTenantAccess(ctx, profileUpdate.hospital_id)
  }

  if (Object.keys(profileUpdate).length > 0) {
    await PatientProfile.findByIdAndUpdate(user.profile_id, profileUpdate)
  }

  const wasActive = user.is_active
  if (typeof data.is_active === 'boolean') {
    user.is_active = data.is_active
  }
  if (data.password) {
    const userWithHistory = await User.findById(user._id).select('+password_history')
    if (!userWithHistory) throw new ApiError(StatusCodes.NOT_FOUND, 'Patient not found')
    if (typeof data.is_active === 'boolean') userWithHistory.is_active = data.is_active
    await setUserPasswordWithPolicy(userWithHistory, data.password, { mustChangePassword: true })
    await revokeActiveAuthSessionsForUser(user._id.toString(), AuthSessionRevocationReason.PASSWORD_RESET)
  } else {
    await user.save()
  }
  await revokeSessionsIfAccountDisabled(user, wasActive)

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
  await PatientProfile.findByIdAndUpdate(user.profile_id, { account_status: 'Discharged' })

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
  ensureTenantAccess(ctx, (patientUser.profile_id as any)?.hospital_id)
  const doctorProfile: any = await DoctorProfile.findById(doctorUser.profile_id)
  ensureTenantAccess(ctx, doctorProfile?.hospital_id)

  await PatientProfile.findByIdAndUpdate(patientUser.profile_id, {
    assigned_doctor_id: doctorUser._id,
    ...(doctorProfile?.hospital_id ? { hospital_id: doctorProfile.hospital_id } : {}),
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
          user.is_active = true
          await user.save()
          results.push({ userId, success: true, message: 'User activated' })
          break

        case 'deactivate':
          const wasActive = user.is_active
          user.is_active = false
          await user.save()
          const invalidatedSessions = await revokeSessionsIfAccountDisabled(user, wasActive)
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
          await revokeActiveAuthSessionsForUser(userId, AuthSessionRevocationReason.PASSWORD_RESET)
          results.push({
            userId,
            success: true,
            message: 'Password reset successfully',
            temporary_password: temporaryPassword,
          })
          break
        }

        default:
          results.push({ userId, success: false, message: 'Invalid operation' })
      }
    } catch (error: any) {
      results.push({ userId, success: false, message: error.message })
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

  return {
    status: 'ok',
    uptime: process.uptime(),
    database: {
      state: dbStates[mongooseInstance.connection.readyState] || 'unknown',
      host: mongooseInstance.connection.host,
      name: mongooseInstance.connection.name,
    },
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + ' MB',
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB',
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
    },
    timestamp: new Date().toISOString(),
  }
}
