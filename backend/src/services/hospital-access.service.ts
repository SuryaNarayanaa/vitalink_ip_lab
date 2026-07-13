import { AdminProfile, DoctorProfile, Hospital, PatientProfile } from '@alias/models'
import { HospitalStatus } from '@alias/models/hospital.model'
import { UserType } from '@alias/validators'

/** Returns whether a user's assigned hospital is active. Users without a hospital are global users. */
export async function hasActiveHospitalAccess(user: {
  profile_id?: unknown
  user_type?: UserType | string
}): Promise<boolean> {
  if (!user.profile_id) return true

  const profile = user.user_type === UserType.DOCTOR
    ? await DoctorProfile.findById(user.profile_id).select('hospital_id').lean()
    : user.user_type === UserType.PATIENT
      ? await PatientProfile.findById(user.profile_id).select('hospital_id').lean()
      : user.user_type === UserType.ADMIN
        ? await AdminProfile.findById(user.profile_id).select('hospital_id').lean()
        : undefined
  if (!profile?.hospital_id) return true

  return Boolean(await Hospital.exists({
    _id: profile.hospital_id,
    status: HospitalStatus.ACTIVE,
  }))
}
