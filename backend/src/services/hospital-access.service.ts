import { AdminProfile, DoctorProfile, Hospital, PatientProfile } from '@alias/models'
import { AdminRole } from '@alias/models/adminprofile.model'
import { HospitalStatus } from '@alias/models/hospital.model'
import { UserType } from '@alias/validators'

/** Returns whether the user's persisted tenant context is currently usable. */
export async function hasActiveHospitalAccess(user: {
  profile_id?: unknown
  user_type?: UserType | string
}): Promise<boolean> {
  // A deleted/missing profile must fail closed. Tenantless clinical profiles
  // remain login-compatible for legacy migrations, while every tenant-scoped
  // clinical controller independently requires a hospital before data access.
  if (!user.profile_id) return false

  const profile = user.user_type === UserType.DOCTOR
    ? await DoctorProfile.findById(user.profile_id).select('hospital_id').lean()
    : user.user_type === UserType.PATIENT
      ? await PatientProfile.findById(user.profile_id).select('hospital_id').lean()
      : user.user_type === UserType.ADMIN
        ? await AdminProfile.findById(user.profile_id).select('hospital_id admin_role').lean()
        : undefined
  if (!profile) return false
  if (!profile.hospital_id) {
    if (user.user_type !== UserType.ADMIN) return false
    const role = (profile as { admin_role?: AdminRole }).admin_role
    return role === AdminRole.APP_ADMIN || role === AdminRole.AUDITOR
  }

  return Boolean(await Hospital.exists({
    _id: profile.hospital_id,
    status: HospitalStatus.ACTIVE,
    accepting_assignments: { $ne: false },
    lifecycle_state: { $in: ['STABLE', null] },
  }))
}

/** Fail-closed eligibility for clinical disclosure and tenant-scoped work. */
export async function hasActiveClinicalHospitalAccess(user: {
  profile_id?: unknown
  user_type?: UserType | string
}): Promise<boolean> {
  if (!user.profile_id) return false
  const profile = user.user_type === UserType.DOCTOR
    ? await DoctorProfile.findById(user.profile_id).select('hospital_id').lean()
    : user.user_type === UserType.PATIENT
      ? await PatientProfile.findById(user.profile_id).select('hospital_id').lean()
      : user.user_type === UserType.ADMIN
        ? await AdminProfile.findById(user.profile_id).select('hospital_id').lean()
        : undefined
  if (!profile?.hospital_id) return false
  return Boolean(await Hospital.exists({
    _id: profile.hospital_id,
    status: HospitalStatus.ACTIVE,
    accepting_assignments: { $ne: false },
    lifecycle_state: { $in: ['STABLE', null] },
  }))
}
