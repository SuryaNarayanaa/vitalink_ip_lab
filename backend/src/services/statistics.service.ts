import mongoose from 'mongoose'
import { AdminProfile, AuditLog, DoctorProfile, PatientProfile, User } from '@alias/models'
import type { AdminCapability } from '@alias/constants/admin-capabilities'
import type { AdminAccessContext } from '@alias/types/admin-access'
import { hasAdminCapability } from '@alias/types/admin-access'
import { UserType } from '@alias/validators'
import { ApiError } from '@alias/utils'
import { StatusCodes } from 'http-status-codes'

/**
 * Tenant statistics scope.
 *
 * Hospital linkage lives on DoctorProfile / PatientProfile / AdminProfile, not User.
 * We intentionally do NOT materialize every profile/user `_id` into Node (O(tenant size)
 * memory + BSON $in limits). Callers filter via hospital-scoped aggregation pipelines
 * that `$lookup` users server-side.
 */
type TenantStatisticsScope = {
  hospitalId: mongoose.Types.ObjectId
}

type ProfileUserCounts = {
  total: number
  active: number
  recent: number
}

type TrendPoint = { date: string; count: number }

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

function resolveTenantHospitalId(access: AdminAccessContext): mongoose.Types.ObjectId {
  if (!access.hospitalId || !mongoose.Types.ObjectId.isValid(access.hospitalId)) {
    throw forbidden('Active hospital administrator scope is required.')
  }
  return new mongoose.Types.ObjectId(access.hospitalId)
}

function getTenantStatisticsScope(access: AdminAccessContext): TenantStatisticsScope | undefined {
  if (access.scope === 'global') return undefined
  return { hospitalId: resolveTenantHospitalId(access) }
}

/** Stages that emit `{ _id: <userId> }` for every user whose profile is in the hospital. */
function tenantUserIdUnionStages(hospitalId: mongoose.Types.ObjectId): mongoose.PipelineStage[] {
  const usersColl = User.collection.name
  // Nested $lookup/$unionWith pipelines use a narrower mongoose stage union than PipelineStage.
  const userIdFromProfile = [
    {
      $lookup: {
        from: usersColl,
        localField: '_id',
        foreignField: 'profile_id',
        as: 'user',
        pipeline: [{ $project: { _id: 1 } }, { $limit: 1 }],
      },
    },
    { $unwind: '$user' },
    { $project: { _id: '$user._id' } },
  ] as mongoose.PipelineStage.FacetPipelineStage[]

  return [
    { $match: { hospital_id: hospitalId } },
    ...userIdFromProfile,
    {
      $unionWith: {
        coll: PatientProfile.collection.name,
        pipeline: [
          { $match: { hospital_id: hospitalId } },
          ...userIdFromProfile,
        ],
      },
    },
    {
      $unionWith: {
        coll: AdminProfile.collection.name,
        pipeline: [
          { $match: { hospital_id: hospitalId } },
          ...userIdFromProfile,
        ],
      },
    },
  ]
}

/**
 * Count users linked to hospital profiles without pulling id lists into Node.
 * Starts from the profile collection (indexed hospital_id) then lookups users.
 */
async function countUsersForHospitalProfiles(
  ProfileModel: typeof DoctorProfile | typeof PatientProfile,
  hospitalId: mongoose.Types.ObjectId,
  userType: string,
  options: { isActive?: boolean; createdAtGte?: Date; createdAtLte?: Date } = {},
): Promise<number> {
  const userMatch: Record<string, unknown> = { user_type: userType }
  if (options.isActive !== undefined) userMatch.is_active = options.isActive
  if (options.createdAtGte || options.createdAtLte) {
    const createdAt: Record<string, Date> = {}
    if (options.createdAtGte) createdAt.$gte = options.createdAtGte
    if (options.createdAtLte) createdAt.$lte = options.createdAtLte
    userMatch.createdAt = createdAt
  }

  const result = await ProfileModel.aggregate([
    { $match: { hospital_id: hospitalId } },
    {
      $lookup: {
        from: User.collection.name,
        localField: '_id',
        foreignField: 'profile_id',
        as: 'user',
        pipeline: [
          { $match: userMatch },
          { $project: { _id: 1 } },
          { $limit: 1 },
        ],
      },
    },
    { $match: { 'user.0': { $exists: true } } },
    { $count: 'n' },
  ])
  return result[0]?.n ?? 0
}

/** Dashboard doctor/patient totals, active, and recent in one profile-side pass each. */
async function countProfileUsersForDashboard(
  ProfileModel: typeof DoctorProfile | typeof PatientProfile,
  hospitalId: mongoose.Types.ObjectId,
  userType: string,
  recentSince: Date,
): Promise<ProfileUserCounts> {
  const result = await ProfileModel.aggregate([
    { $match: { hospital_id: hospitalId } },
    {
      $lookup: {
        from: User.collection.name,
        localField: '_id',
        foreignField: 'profile_id',
        as: 'user',
        pipeline: [
          { $match: { user_type: userType } },
          { $project: { is_active: 1, createdAt: 1 } },
          { $limit: 1 },
        ],
      },
    },
    { $unwind: '$user' },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        active: { $sum: { $cond: ['$user.is_active', 1, 0] } },
        recent: {
          $sum: {
            $cond: [{ $gte: ['$user.createdAt', recentSince] }, 1, 0],
          },
        },
      },
    },
  ])
  return {
    total: result[0]?.total ?? 0,
    active: result[0]?.active ?? 0,
    recent: result[0]?.recent ?? 0,
  }
}

async function countTenantAuditLogs(
  hospitalId: mongoose.Types.ObjectId,
  dateMatch?: { createdAt?: { $gte?: Date; $lte?: Date } },
): Promise<number> {
  const auditPipeline: mongoose.PipelineStage.FacetPipelineStage[] = []
  if (dateMatch?.createdAt) {
    auditPipeline.push({ $match: { createdAt: dateMatch.createdAt } })
  }
  auditPipeline.push({ $count: 'n' })

  const result = await DoctorProfile.aggregate([
    ...tenantUserIdUnionStages(hospitalId),
    {
      $lookup: {
        from: AuditLog.collection.name,
        localField: '_id',
        foreignField: 'user_id',
        as: 'logs',
        pipeline: auditPipeline,
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: { $ifNull: [{ $arrayElemAt: ['$logs.n', 0] }, 0] } },
      },
    },
  ])
  return result[0]?.total ?? 0
}

async function tenantAuditActionSummary(
  hospitalId: mongoose.Types.ObjectId,
  start: Date,
  end: Date,
): Promise<Array<{ _id: string; count: number }>> {
  return DoctorProfile.aggregate([
    ...tenantUserIdUnionStages(hospitalId),
    {
      $lookup: {
        from: AuditLog.collection.name,
        localField: '_id',
        foreignField: 'user_id',
        as: 'logs',
        pipeline: [
          { $match: { createdAt: { $gte: start, $lte: end } } },
          { $project: { action: 1 } },
        ],
      },
    },
    { $unwind: '$logs' },
    { $group: { _id: '$logs.action', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ])
}

async function registrationTrendsForHospital(
  ProfileModel: typeof DoctorProfile | typeof PatientProfile,
  hospitalId: mongoose.Types.ObjectId,
  userType: string,
  startDate: Date,
): Promise<TrendPoint[]> {
  const trends = await ProfileModel.aggregate([
    { $match: { hospital_id: hospitalId } },
    {
      $lookup: {
        from: User.collection.name,
        localField: '_id',
        foreignField: 'profile_id',
        as: 'user',
        pipeline: [
          {
            $match: {
              user_type: userType,
              createdAt: { $gte: startDate },
            },
          },
          { $project: { createdAt: 1 } },
          { $limit: 1 },
        ],
      },
    },
    { $unwind: '$user' },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$user.createdAt' } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ])
  return trends.map(trend => ({ date: trend._id, count: trend.count }))
}

export async function getAdminDashboardStats(access: AdminAccessContext) {
  assertDashboardAccess(access)
  const scope = getTenantStatisticsScope(access)

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  if (!scope) {
    const [totalDoctors, activeDoctors, totalPatients, activePatients, totalAuditLogs, recentDoctors, recentPatients] =
      await Promise.all([
        User.countDocuments({ user_type: UserType.DOCTOR }),
        User.countDocuments({ user_type: UserType.DOCTOR, is_active: true }),
        User.countDocuments({ user_type: UserType.PATIENT }),
        User.countDocuments({ user_type: UserType.PATIENT, is_active: true }),
        AuditLog.countDocuments({}),
        User.countDocuments({ user_type: UserType.DOCTOR, createdAt: { $gte: thirtyDaysAgo } }),
        User.countDocuments({ user_type: UserType.PATIENT, createdAt: { $gte: thirtyDaysAgo } }),
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

  const [doctors, patients, totalAuditLogs] = await Promise.all([
    countProfileUsersForDashboard(DoctorProfile, scope.hospitalId, UserType.DOCTOR, thirtyDaysAgo),
    countProfileUsersForDashboard(PatientProfile, scope.hospitalId, UserType.PATIENT, thirtyDaysAgo),
    countTenantAuditLogs(scope.hospitalId),
  ])

  return {
    scope: access.scope,
    doctors: {
      total: doctors.total,
      active: doctors.active,
      inactive: doctors.total - doctors.active,
      recent: doctors.recent,
    },
    patients: {
      total: patients.total,
      active: patients.active,
      inactive: patients.total - patients.active,
      recent: patients.recent,
    },
    audit_logs: totalAuditLogs,
  }
}

export async function getRegistrationTrends(access: AdminAccessContext, period: string = '30d') {
  assertAnalyticsAccess(access)
  const scope = getTenantStatisticsScope(access)
  const days = period === '7d' ? 7 : period === '90d' ? 90 : period === '1y' ? 365 : 30
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)

  if (!scope) {
    const doctorTrends = await User.aggregate([
      {
        $match: {
          user_type: UserType.DOCTOR,
          createdAt: { $gte: startDate },
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

  const [doctors, patients] = await Promise.all([
    registrationTrendsForHospital(DoctorProfile, scope.hospitalId, UserType.DOCTOR, startDate),
    registrationTrendsForHospital(PatientProfile, scope.hospitalId, UserType.PATIENT, startDate),
  ])

  return {
    scope: access.scope,
    period,
    doctors,
    patients,
  }
}

export async function getInrComplianceStats(access: AdminAccessContext) {
  assertAnalyticsAccess(access)
  if (access.scope !== 'tenant') {
    throw forbidden('Global platform analytics do not expose clinical INR compliance data.')
  }
  const scope = getTenantStatisticsScope(access)!

  // Keep classification logic in Node for clarity; only load this hospital's profiles
  // (already hospital-scoped — no intermediate id materialization).
  const patients = await PatientProfile.find({ hospital_id: scope.hospitalId })
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
  const scope = getTenantStatisticsScope(access)
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
  // Preserve the v1 contract: tenant workload is a plain array of doctor items
  // (global remains an anonymous aggregate object for privacy).
  return PatientProfile.aggregate([
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
}

export async function getPeriodStatistics(
  access: AdminAccessContext,
  startDate?: string,
  endDate?: string,
) {
  assertAnalyticsAccess(access)
  const scope = getTenantStatisticsScope(access)
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const end = endDate ? new Date(endDate) : new Date()
  end.setHours(23, 59, 59, 999)

  if (!scope) {
    const [newDoctors, newPatients, auditActions] = await Promise.all([
      User.countDocuments({
        user_type: UserType.DOCTOR,
        createdAt: { $gte: start, $lte: end },
      }),
      User.countDocuments({
        user_type: UserType.PATIENT,
        createdAt: { $gte: start, $lte: end },
      }),
      AuditLog.aggregate([
        {
          $match: {
            createdAt: { $gte: start, $lte: end },
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

  const [newDoctors, newPatients, auditActions] = await Promise.all([
    countUsersForHospitalProfiles(DoctorProfile, scope.hospitalId, UserType.DOCTOR, {
      createdAtGte: start,
      createdAtLte: end,
    }),
    countUsersForHospitalProfiles(PatientProfile, scope.hospitalId, UserType.PATIENT, {
      createdAtGte: start,
      createdAtLte: end,
    }),
    tenantAuditActionSummary(scope.hospitalId, start, end),
  ])

  return {
    scope: access.scope,
    period: { start: start.toISOString(), end: end.toISOString() },
    new_doctors: newDoctors,
    new_patients: newPatients,
    audit_summary: auditActions.map(action => ({ action: action._id, count: action.count })),
  }
}
