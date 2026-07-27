import mongoose from 'mongoose'
import { AdminProfile, AuditLog, DoctorProfile, PatientProfile, User } from '@alias/models'
import type { AdminCapability } from '@alias/constants/admin-capabilities'
import type { AdminAccessContext } from '@alias/types/admin-access'
import { hasAdminCapability } from '@alias/types/admin-access'
import { UserType } from '@alias/validators'
import { ApiError } from '@alias/utils'
import { StatusCodes } from 'http-status-codes'

type TenantStatisticsScope = {
  hospitalId: mongoose.Types.ObjectId
  doctorProfileIds: any[]
  patientProfileIds: any[]
  tenantUserIds: any[]
}

function forbidden(message: string, requiredCapability?: AdminCapability): ApiError {
  const error = new ApiError(StatusCodes.FORBIDDEN, message)
  if (requiredCapability) Object.assign(error, { requiredCapability })
  return error
}

function assertDashboardAccess(access: AdminAccessContext): void {
  const capability: AdminCapability = access.scope === 'global'
    ? 'platform.analytics.read'
    : 'tenant.dashboard.read'
  if (!hasAdminCapability(access, capability)) {
    throw forbidden('Administrator dashboard access is not permitted.', capability)
  }
}

function assertAnalyticsAccess(access: AdminAccessContext): void {
  const capability: AdminCapability = access.scope === 'global'
    ? 'platform.analytics.read'
    : 'tenant.analytics.read'
  if (!hasAdminCapability(access, capability)) {
    throw forbidden('Administrator analytics access is not permitted.', capability)
  }
}

async function getTenantStatisticsScope(access: AdminAccessContext): Promise<TenantStatisticsScope | undefined> {
  if (access.scope === 'global') return undefined
  if (!access.hospitalId || !mongoose.Types.ObjectId.isValid(access.hospitalId)) {
    throw forbidden('Active hospital administrator scope is required.')
  }

  const hospitalId = new mongoose.Types.ObjectId(access.hospitalId)
  const [doctorProfiles, patientProfiles, adminProfiles] = await Promise.all([
    DoctorProfile.find({ hospital_id: hospitalId }).select('_id').lean(),
    PatientProfile.find({ hospital_id: hospitalId }).select('_id').lean(),
    AdminProfile.find({ hospital_id: hospitalId }).select('_id').lean(),
  ])
  const doctorProfileIds = doctorProfiles.map(profile => profile._id)
  const patientProfileIds = patientProfiles.map(profile => profile._id)
  const profileIds = [
    ...doctorProfileIds,
    ...patientProfileIds,
    ...adminProfiles.map(profile => profile._id),
  ]
  const tenantUsers = profileIds.length
    ? await User.find({ profile_id: { $in: profileIds } }).select('_id').lean()
    : []

  return {
    hospitalId,
    doctorProfileIds,
    patientProfileIds,
    tenantUserIds: tenantUsers.map(user => user._id),
  }
}

function userProfileScope(profileIds: any[] | undefined): Record<string, unknown> {
  return profileIds ? { profile_id: { $in: profileIds } } : {}
}

export async function getAdminDashboardStats(access: AdminAccessContext) {
  assertDashboardAccess(access)
  const scope = await getTenantStatisticsScope(access)
  const doctorScope = userProfileScope(scope?.doctorProfileIds)
  const patientScope = userProfileScope(scope?.patientProfileIds)
  const auditScope = scope ? { user_id: { $in: scope.tenantUserIds } } : {}

  const [totalDoctors, activeDoctors, totalPatients, activePatients, totalAuditLogs] = await Promise.all([
    User.countDocuments({ user_type: UserType.DOCTOR, ...doctorScope }),
    User.countDocuments({ user_type: UserType.DOCTOR, is_active: true, ...doctorScope }),
    User.countDocuments({ user_type: UserType.PATIENT, ...patientScope }),
    User.countDocuments({ user_type: UserType.PATIENT, is_active: true, ...patientScope }),
    AuditLog.countDocuments(auditScope),
  ])

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const [recentDoctors, recentPatients] = await Promise.all([
    User.countDocuments({ user_type: UserType.DOCTOR, createdAt: { $gte: thirtyDaysAgo }, ...doctorScope }),
    User.countDocuments({ user_type: UserType.PATIENT, createdAt: { $gte: thirtyDaysAgo }, ...patientScope }),
  ])

  return {
    scope: access.scope,
    doctors: {
      total: totalDoctors,
      active: activeDoctors,
      inactive: totalDoctors - activeDoctors,
      recent: recentDoctors,
    },
    patients: {
      total: totalPatients,
      active: activePatients,
      inactive: totalPatients - activePatients,
      recent: recentPatients,
    },
    audit_logs: totalAuditLogs,
  }
}

export async function getRegistrationTrends(access: AdminAccessContext, period: string = '30d') {
  assertAnalyticsAccess(access)
  const scope = await getTenantStatisticsScope(access)
  const days = period === '7d' ? 7 : period === '90d' ? 90 : period === '1y' ? 365 : 30
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)

  const doctorTrends = await User.aggregate([
    {
      $match: {
        user_type: UserType.DOCTOR,
        createdAt: { $gte: startDate },
        ...userProfileScope(scope?.doctorProfileIds),
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ])

  const patientTrends = await User.aggregate([
    {
      $match: {
        user_type: UserType.PATIENT,
        createdAt: { $gte: startDate },
        ...userProfileScope(scope?.patientProfileIds),
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ])

  return {
    scope: access.scope,
    period,
    doctors: doctorTrends.map(trend => ({ date: trend._id, count: trend.count })),
    patients: patientTrends.map(trend => ({ date: trend._id, count: trend.count })),
  }
}

export async function getInrComplianceStats(access: AdminAccessContext) {
  assertAnalyticsAccess(access)
  if (access.scope !== 'tenant') {
    throw forbidden('Global platform analytics do not expose clinical INR compliance data.')
  }
  const scope = await getTenantStatisticsScope(access)
  const patients = await PatientProfile.find({ hospital_id: scope!.hospitalId })
    .select('inr_history medical_config')

  let inRange = 0
  let belowRange = 0
  let aboveRange = 0
  let noData = 0

  for (const patient of patients) {
    const history = (patient as any).inr_history || []
    if (history.length === 0) {
      noData++
      continue
    }

    const latest = history
      .filter((entry: any) => entry?.test_date && !Number.isNaN(new Date(entry.test_date).getTime()))
      .sort((a: any, b: any) => +new Date(b.test_date) - +new Date(a.test_date))[0]
    if (!latest) {
      noData++
      continue
    }
    const targetMin = (patient as any).medical_config?.target_inr?.min || 2.0
    const targetMax = (patient as any).medical_config?.target_inr?.max || 3.0

    if (latest.inr_value < targetMin) belowRange++
    else if (latest.inr_value > targetMax) aboveRange++
    else inRange++
  }

  return {
    scope: 'tenant' as const,
    total_patients: patients.length,
    in_range: inRange,
    below_range: belowRange,
    above_range: aboveRange,
    no_data: noData,
  }
}

export async function getDoctorWorkloadStats(access: AdminAccessContext) {
  assertAnalyticsAccess(access)
  const scope = await getTenantStatisticsScope(access)
  const match: Record<string, unknown> = {
    account_status: 'Active',
    assigned_doctor_id: { $exists: true, $ne: null },
  }

  if (!scope) {
    const aggregate = await PatientProfile.aggregate([
      { $match: match },
      { $group: { _id: '$assigned_doctor_id', patient_count: { $sum: 1 } } },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'doctor_user',
        },
      },
      { $unwind: { path: '$doctor_user', preserveNullAndEmptyArrays: false } },
      { $match: { 'doctor_user.user_type': UserType.DOCTOR } },
      {
        $group: {
          _id: null,
          doctors_with_active_patients: { $sum: 1 },
          active_patient_assignments: { $sum: '$patient_count' },
          maximum_assignments_per_doctor: { $max: '$patient_count' },
          average_assignments_per_doctor: { $avg: '$patient_count' },
        },
      },
      { $project: { _id: 0 } },
    ])
    return {
      scope: 'global' as const,
      doctors_with_active_patients: aggregate[0]?.doctors_with_active_patients ?? 0,
      active_patient_assignments: aggregate[0]?.active_patient_assignments ?? 0,
      maximum_assignments_per_doctor: aggregate[0]?.maximum_assignments_per_doctor ?? 0,
      average_assignments_per_doctor: aggregate[0]?.average_assignments_per_doctor ?? 0,
    }
  }

  match.hospital_id = scope.hospitalId
  const items = await PatientProfile.aggregate([
    { $match: match },
    { $group: { _id: '$assigned_doctor_id', patient_count: { $sum: 1 } } },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'doctor_user',
      },
    },
    { $unwind: { path: '$doctor_user', preserveNullAndEmptyArrays: false } },
    {
      $lookup: {
        from: 'doctorprofiles',
        localField: 'doctor_user.profile_id',
        foreignField: '_id',
        as: 'doctor_profile',
      },
    },
    { $unwind: { path: '$doctor_profile', preserveNullAndEmptyArrays: false } },
    {
      $project: {
        doctor_id: '$_id',
        doctor_name: '$doctor_profile.name',
        department: '$doctor_profile.department',
        patient_count: 1,
      },
    },
    { $sort: { patient_count: -1 } },
  ])

  // Always return an object envelope so global (anonymous aggregate) and tenant
  // (per-doctor items) share a stable response shape under data.
  return {
    scope: 'tenant' as const,
    items,
  }
}

export async function getPeriodStatistics(
  access: AdminAccessContext,
  startDate?: string,
  endDate?: string,
) {
  assertAnalyticsAccess(access)
  const scope = await getTenantStatisticsScope(access)
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const end = endDate ? new Date(endDate) : new Date()
  end.setHours(23, 59, 59, 999)

  const [newDoctors, newPatients, auditActions] = await Promise.all([
    User.countDocuments({
      user_type: UserType.DOCTOR,
      createdAt: { $gte: start, $lte: end },
      ...userProfileScope(scope?.doctorProfileIds),
    }),
    User.countDocuments({
      user_type: UserType.PATIENT,
      createdAt: { $gte: start, $lte: end },
      ...userProfileScope(scope?.patientProfileIds),
    }),
    AuditLog.aggregate([
      {
        $match: {
          createdAt: { $gte: start, $lte: end },
          ...(scope ? { user_id: { $in: scope.tenantUserIds } } : {}),
        },
      },
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ])

  return {
    scope: access.scope,
    period: { start: start.toISOString(), end: end.toISOString() },
    new_doctors: newDoctors,
    new_patients: newPatients,
    audit_summary: auditActions.map(action => ({ action: action._id, count: action.count })),
  }
}
