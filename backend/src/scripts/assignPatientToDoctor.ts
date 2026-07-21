import 'dotenv/config'
import connectDB from '@alias/config/db'
import { DoctorProfile, PatientProfile, User } from '@alias/models'
import { UserType } from '@alias/validators'
import logger from '@alias/utils/logger'
import { getObjectIdString } from '@alias/utils/objectid'
import {
  acquireDoctorAssignmentGuard,
  stampDoctorProfileFence,
  terminalizePatientAssignment,
} from '@alias/services/doctor-assignment.service'
import { createDoctorUpdateNotification } from '@alias/services/doctor-update-notification.service'
import { Hospital } from '@alias/models'

/**
 * Operational reassignment entrypoint.
 * Applies the same tenant, activity, assignment-fence, and notification
 * protections as the admin reassignment service. Does not log patient PII.
 */
async function main() {
  const doctorLoginId = process.argv[2]
  const patientLoginId = process.argv[3]

  if (!doctorLoginId || !patientLoginId) {
    console.error('Usage: ts-node src/scripts/assignPatientToDoctor.ts <doctor_login_id> <patient_login_id>')
    console.error('Example: ts-node src/scripts/assignPatientToDoctor.ts DOC001 PAT001')
    process.exit(1)
  }

  await connectDB()

  const doctorUser = await User.findOne({ login_id: doctorLoginId, user_type: UserType.DOCTOR })
  if (!doctorUser?.is_active) {
    logger.error('Doctor not found or inactive', { doctor_login_id: doctorLoginId })
    process.exit(1)
  }

  const doctorProfile = await DoctorProfile.findById(doctorUser.profile_id).select('hospital_id name')
  if (!doctorProfile?.hospital_id) {
    logger.error('Doctor has no hospital membership', { doctor_login_id: doctorLoginId })
    process.exit(1)
  }

  const hospital = await Hospital.findById(doctorProfile.hospital_id)
    .select('status lifecycle_state accepting_assignments')
    .lean()
  if (
    !hospital ||
    hospital.status !== 'active' ||
    hospital.lifecycle_state !== 'STABLE' ||
    hospital.accepting_assignments === false
  ) {
    logger.error('Doctor hospital is not active for reassignment', {
      doctor_login_id: doctorLoginId,
      hospital_id: String(doctorProfile.hospital_id),
      status: hospital?.status,
      lifecycle_state: hospital?.lifecycle_state,
    })
    process.exit(1)
  }

  const patientUser = await User.findOne({ login_id: patientLoginId, user_type: UserType.PATIENT })
  if (!patientUser?.is_active) {
    logger.error('Patient not found or inactive', { patient_login_id: patientLoginId })
    process.exit(1)
  }

  const patientProfile = await PatientProfile.findById(patientUser.profile_id)
  if (!patientProfile) {
    logger.error('Patient profile not found', { patient_login_id: patientLoginId })
    process.exit(1)
  }

  const patientHospitalId = getObjectIdString(patientProfile.hospital_id)
  const doctorHospitalId = getObjectIdString(doctorProfile.hospital_id)
  if (!patientHospitalId || !doctorHospitalId || patientHospitalId !== doctorHospitalId) {
    logger.error('Cross-tenant reassignment refused', {
      patient_login_id: patientLoginId,
      doctor_login_id: doctorLoginId,
      patient_hospital_id: patientHospitalId,
      doctor_hospital_id: doctorHospitalId,
    })
    process.exit(1)
  }

  if (patientProfile.account_status && patientProfile.account_status !== 'Active') {
    logger.error('Patient is not Active; reassignment refused', {
      patient_login_id: patientLoginId,
      account_status: patientProfile.account_status,
    })
    process.exit(1)
  }

  const previousDoctorId = patientProfile.assigned_doctor_id
  const assignedDoctorId = getObjectIdString(previousDoctorId)
  const doctorUserId = getObjectIdString(doctorUser._id)
  const doctorProfileId = getObjectIdString(doctorUser.profile_id)
  if (assignedDoctorId && (assignedDoctorId === doctorUserId || assignedDoctorId === doctorProfileId)) {
    logger.warn('Patient already assigned to target doctor', {
      patient_login_id: patientLoginId,
      doctor_login_id: doctorLoginId,
    })
    process.exit(0)
  }

  let releasePreviousDoctorGuard: Awaited<ReturnType<typeof acquireDoctorAssignmentGuard>> | undefined
  if (previousDoctorId && String(previousDoctorId) !== String(doctorUser._id)) {
    const previousDoctor = await User.findOne({
      user_type: UserType.DOCTOR,
      is_active: true,
      $or: [{ _id: previousDoctorId }, { profile_id: previousDoctorId }],
    }).select('_id profile_id')
    if (previousDoctor) {
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
      String(guardedDoctorProfile.hospital_id) !== patientHospitalId
    ) {
      logger.error('Target doctor lifecycle changed during reassignment')
      process.exit(1)
    }
    await stampDoctorProfileFence(guardedDoctor.profile_id, {
      fenceToken: releaseAssignmentGuard.fenceToken,
      assertOwned: releaseAssignmentGuard.assertOwned,
    })
    await releaseAssignmentGuard.assertOwned()
    if (releasePreviousDoctorGuard) await releasePreviousDoctorGuard.assertOwned()

    updated = await PatientProfile.findOneAndUpdate(
      {
        _id: patientProfile._id,
        hospital_id: patientProfile.hospital_id,
        assigned_doctor_id: previousDoctorId,
        account_status: 'Active',
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
      } catch {
        const terminal = await terminalizePatientAssignment({
          patientProfileId: updated._id,
          targetDoctorUserId: doctorUser._id,
          targetFence: releaseAssignmentGuard.fenceToken,
          patientHospitalId: patientProfile.hospital_id,
          previousDoctorId,
          reason: 'Target doctor lifecycle changed after operational reassignment commit',
          targetGuard: releaseAssignmentGuard,
        })
        if (terminal.state === 'COMMITTED') {
          updated = terminal.patient
          logger.warn('patient_reassignment.committed_after_lease_superseded', {
            patient_login_id: patientLoginId,
            doctor_login_id: doctorLoginId,
          })
        } else if (terminal.state === 'QUARANTINED') {
          logger.error('patient_reassignment.assignment_conflict', {
            patient_login_id: patientLoginId,
            doctor_login_id: doctorLoginId,
          })
          process.exit(1)
        } else {
          logger.error('Patient assignment was superseded by another request')
          process.exit(1)
        }
      }
    }
  } finally {
    await releaseAssignmentGuard()
    if (releasePreviousDoctorGuard) await releasePreviousDoctorGuard()
  }

  if (!updated) {
    logger.error('Patient assignment changed while the request was being processed', {
      patient_login_id: patientLoginId,
    })
    process.exit(1)
  }

  await createDoctorUpdateNotification({
    patientUserId: patientUser._id,
    changedByDoctorId: doctorUser._id,
    changeType: 'DOCTOR_REASSIGNED',
    title: 'Doctor assignment changed',
    message: `Your care has been reassigned to ${doctorProfile.name || doctorUser.login_id}.`,
    changedFields: ['assigned_doctor_id'],
  })

  logger.info('Successfully assigned patient to doctor', {
    patient_login_id: patientLoginId,
    doctor_login_id: doctorLoginId,
    hospital_id: doctorHospitalId,
  })

  process.exit(0)
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
