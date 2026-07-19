import { Request, Response } from 'express'
import { ApiError, ApiResponse, asyncHandler } from '@alias/utils'
import { StatusCodes } from 'http-status-codes'
import { AuditLog, DoctorProfile, Hospital, Notification, PatientProfile, User } from '@alias/models'
import { AuditAction } from '@alias/models/auditlog.model'
import { UserType } from '@alias/validators'
import type {
  CreatePatientInput,
  EditPatientDosageInput,
  MarkNotificationReadInput,
  NotificationsQueryInput,
  ReassignPatientInput,
  UpdateInstructionsInput,
  UpdateNextReviewInput,
  UpdateProfileInput,
  UpdateReportInput
} from '@alias/validators/doctor.validator'
import mongoose from 'mongoose'
import { parseStrictDateOnly } from '@alias/utils/dateOnly'
import { FileValidationError, isLegacyFileReferenceEligible } from '@alias/utils/fileUpload'
import { FileAssetPurpose } from '@alias/models/fileasset.model'
import { compensateFileAsset, resolveAssetDownloadUrl, retireReplacedFileAsset, uploadTrackedFile } from '@alias/services/fileasset.service'
import logger, { sanitizeLogText } from '@alias/utils/logger'
import { getObjectIdString } from '@alias/utils/objectid'
import { extractTokenFromHeader } from '@alias/utils/jwt.utils'
import { validateAuthToken } from '@alias/middlewares/authProvider.middleware'
import { registerUserNotificationStream } from '@alias/services/realtime-notification.service'
import * as notificationService from '@alias/services/notification.service'
import {
  DoctorChangeType,
  createDoctorUpdateNotification
} from '@alias/services/doctor-update-notification.service'
import { generateTemporaryPassword } from '@alias/services/password.service'
import { acquireDoctorAssignmentGuard, stampDoctorProfileFence, terminalizePatientAssignment } from '@alias/services/doctor-assignment.service'
import { createNotificationStreamTicket, verifyNotificationStreamTicket } from '@alias/services/notification-stream-ticket.service'

const normalizeLoginId = (value: string) => value.trim()

const getDoctorOwnershipIds = (doctor: { _id: unknown; profile_id?: unknown }): string[] => {
  const ids = new Set<string>()
  const userId = getObjectIdString(doctor._id)
  const profileId = getObjectIdString(doctor.profile_id)
  if (userId) ids.add(userId)
  if (profileId) ids.add(profileId)
  return Array.from(ids)
}

const isDoctorOwnerOfPatient = (patient: { assigned_doctor_id?: unknown }, doctor: { _id: unknown; profile_id?: unknown }): boolean => {
  const assignedDoctorId = getObjectIdString(patient.assigned_doctor_id)
  if (!assignedDoctorId) return false
  const validDoctorIds = new Set(getDoctorOwnershipIds(doctor))
  return validDoctorIds.has(assignedDoctorId)
}

const getDoctorHospitalId = async (doctor: { profile_id?: unknown }) => {
  const profile = await DoctorProfile.findById(doctor.profile_id).select('hospital_id')
  return profile?.hospital_id ? String(profile.hospital_id) : undefined
}

const getRequiredDoctorHospitalId = async (doctor: { profile_id?: unknown }) => {
  const hospitalId = await getDoctorHospitalId(doctor)
  if (!hospitalId) throw new ApiError(StatusCodes.FORBIDDEN, 'Doctor must be assigned to a hospital to access files')
  return hospitalId
}

const ensureSameHospital = async (
  currentDoctor: { profile_id?: unknown },
  patient: { hospital_id?: unknown },
  targetDoctor?: { profile_id?: unknown }
) => {
  const currentHospitalId = await getDoctorHospitalId(currentDoctor)
  const patientHospitalId = patient.hospital_id ? String(patient.hospital_id) : undefined
  const targetHospitalId = targetDoctor ? await getDoctorHospitalId(targetDoctor) : undefined

  if (!currentHospitalId || !patientHospitalId) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Doctor and patient must both be assigned to a hospital')
  }
  if (currentHospitalId !== patientHospitalId) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Cross-tenant patient access is not allowed')
  }
  if (targetDoctor && !targetHospitalId) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'All doctors must be assigned to a hospital before reassignment')
  }
  if (targetHospitalId && targetHospitalId !== patientHospitalId) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Cross-tenant doctor reassignment is not allowed')
  }
  if (currentHospitalId && targetHospitalId && currentHospitalId !== targetHospitalId) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Cross-tenant doctor reassignment is not allowed')
  }
}

const doctorOwnedPatientFilter = (
  patientProfileId: unknown,
  doctor: { _id: unknown; profile_id?: unknown },
  hospitalId?: unknown,
) => ({
  _id: patientProfileId,
  assigned_doctor_id: { $in: getDoctorOwnershipIds(doctor) },
  account_status: 'Active',
  ...(hospitalId ? { hospital_id: hospitalId } : {}),
})

const throwOwnershipChanged = (): never => {
  throw new ApiError(StatusCodes.CONFLICT, 'Patient assignment changed while the request was being processed')
}

const ensureReassignmentHospitalAccess = async (
  currentDoctor: { profile_id?: unknown },
  patient: { hospital_id?: unknown },
  targetDoctor: { profile_id?: unknown }
) => {
  const [currentHospitalId, targetHospitalId] = await Promise.all([
    getDoctorHospitalId(currentDoctor),
    getDoctorHospitalId(targetDoctor),
  ])
  const patientHospitalId = patient.hospital_id ? String(patient.hospital_id) : undefined

  if (!currentHospitalId || !patientHospitalId || !targetHospitalId) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'All doctors and the patient must be assigned to a hospital before reassignment')
  }
  if (currentHospitalId !== patientHospitalId || targetHospitalId !== patientHospitalId) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Cross-tenant doctor reassignment is not allowed')
  }
}

const getDoctorUserOrThrow = async (userId: string) => {
  const doctor = await User.findById(userId)
  if (!doctor || doctor.user_type !== UserType.DOCTOR) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Doctor not found')
  }
  return doctor
}

async function createPatientProfileAndUser(
  createProfile: (session?: mongoose.ClientSession) => Promise<any>,
  createUser: (profileId: mongoose.Types.ObjectId, session?: mongoose.ClientSession) => Promise<any>,
) {
  const session = await mongoose.startSession()
  let profile: any
  let user: any
  try {
    await session.withTransaction(async () => {
      profile = await createProfile(session)
      user = await createUser(profile._id, session)
    })
    return { profile, user }
  } catch (error: any) {
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

const getPatientUserOrThrow = async (op_num: string) => {
  const normalizedOpNum = normalizeLoginId(op_num)
  const patientUsers = await User.find({ login_id: normalizedOpNum, user_type: UserType.PATIENT }).limit(2)
  if (patientUsers.length === 0) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Patient not found')
  }
  if (patientUsers.length > 1) {
    throw new ApiError(StatusCodes.CONFLICT, 'Multiple patient accounts found for this OP number. Please contact support.')
  }
  return patientUsers[0]
}

const getPatientProfileOrThrow = async (profileId: unknown, notFoundMessage = 'Patient not found') => {
  const patient = await PatientProfile.findById(profileId)
  if (!patient) {
    throw new ApiError(StatusCodes.NOT_FOUND, notFoundMessage)
  }
  return patient
}


const notifyPatientDoctorUpdate = async (
  patientUserId: unknown,
  doctorId: unknown,
  changeType: DoctorChangeType,
  title: string,
  message: string,
  changedFields: string[] = [],
  options: { session?: mongoose.ClientSession; idempotencyKey?: string } = {},
) => {
  // Persists both the in-app notification and durable push outbox before the
  // request completes; queue publication itself remains best-effort.
  await createDoctorUpdateNotification({
    patientUserId,
    changedByDoctorId: doctorId,
    changeType,
    title,
    message,
    changedFields,
    session: options.session,
    idempotencyKey: options.idempotencyKey,
  })

}

const mapNotificationToAppNotificationItem = (notification: any) => ({
  _id: String(notification?._id ?? ''),
  title: notification?.title ?? 'Notification',
  message: notification?.message ?? '',
  type: String(notification?.type ?? 'GENERAL'),
  priority: String(notification?.priority ?? 'MEDIUM'),
  is_read: notification?.is_read === true,
  created_at: notification?.createdAt ? new Date(notification.createdAt) : new Date(0),
  read_at: notification?.read_at ? new Date(notification.read_at) : undefined,
  data: notification?.data,
})

const resolveDoctorStreamUserOrThrow = async (req: Request) => {
  const headerToken = extractTokenFromHeader(req.headers.authorization)
  if (headerToken) {
    const { user } = await validateAuthToken(headerToken, UserType.DOCTOR)
    return user
  }
  const ticket = typeof req.query.ticket === 'string' ? req.query.ticket : null
  const payload = ticket ? verifyNotificationStreamTicket(ticket, UserType.DOCTOR) : null
  if (!payload) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Missing authentication token')
  }
  const user = await User.findById(payload.user_id)
  if (!user?.is_active || user.user_type !== UserType.DOCTOR) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid or expired stream ticket')
  }
  return user
}

export const createDoctorNotificationStreamTicket = asyncHandler(async (req: Request, res: Response) => {
  const ticket = createNotificationStreamTicket(String(req.user.user_id), UserType.DOCTOR)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Notification stream ticket created', { ticket }))
})

export const getPatients = asyncHandler(async (req: Request, res: Response) => {
  const { user_id } = req.user
  const doctor = await getDoctorUserOrThrow(user_id)
  const doctorOwnershipIds = getDoctorOwnershipIds(doctor)
  const hospitalId = await getRequiredDoctorHospitalId(doctor)
  const patientQuery: Record<string, unknown> = { assigned_doctor_id: { $in: doctorOwnershipIds } }
  if (hospitalId) patientQuery.hospital_id = hospitalId
  // List payload only needs identity + INR criticality flags — skip heavy embeds
  // and never presign profile pictures (O(n) FileAsset + S3 work).
  const patientProfiles = await PatientProfile.find(patientQuery)
    .select('demographics inr_history.test_date inr_history.is_critical hospital_id assigned_doctor_id createdAt')
    .lean()

  // Get login_ids for each patient profile
  const patientUsers = await User.find({
    profile_id: { $in: patientProfiles.map(p => p._id) },
    user_type: UserType.PATIENT
  }).select('profile_id login_id').lean()

  // Create a map of profile_id to login_id
  const profileToUser = new Map<string, typeof patientUsers[number]>()
  patientUsers.forEach(u => {
    profileToUser.set(u.profile_id?.toString() ?? '', u)
  })

  const patients = patientProfiles.map((p) => {
    const patientUser = profileToUser.get(String(p._id))
    return {
      ...p,
      profile_picture_url: null,
      login_id: patientUser?.login_id ?? null,
    }
  })

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, "Patients fetched successfully", { patients }))
})

export const viewPatient = asyncHandler(async (req: Request, res: Response) => {
  const { op_num } = req.params
  const { user_id } = req.user
  const doctor = await getDoctorUserOrThrow(user_id)
  const patientUser = await getPatientUserOrThrow(op_num)
  const patient = await getPatientProfileOrThrow(patientUser.profile_id)
  if (!isDoctorOwnerOfPatient(patient, doctor)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Unauthorized Patient Access')
  }
  await ensureSameHospital(doctor, patient)
  const requesterHospitalId = await getRequiredDoctorHospitalId(doctor)

  const patientData = patient.toObject() as any
  if (patientData.profile_picture_url) {
    patientData.profile_picture_url = await resolveAssetDownloadUrl({
      fileAssetId: patientData.profile_picture_file_asset_id,
      legacyObjectKey: patientData.profile_picture_url,
      hospitalId: patient.hospital_id,
      requesterHospitalId,
      ownerUserId: patientUser._id,
      patientProfileId: patient._id,
      purpose: FileAssetPurpose.PATIENT_PROFILE_PICTURE,
      legacyEligible: isLegacyFileReferenceEligible(patientData.createdAt),
    })
  }

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Patient fetched successfully', { patient: patientData }))
})

export const addPatient = asyncHandler(async (req: Request<{}, {}, CreatePatientInput['body']>, res: Response) => {
  if (!req.user) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Unauthorized')
  }

  const doctorUser = await getDoctorUserOrThrow(req.user.user_id)
  const hospitalId = await getRequiredDoctorHospitalId(doctorUser)

  const { name, op_num, age, gender, contact_no, target_inr_min, target_inr_max, therapy, therapy_start_date,
    prescription, medical_history, kin_name, kin_relation, kin_contact_number } = req.body

  const normalizedOpNum = normalizeLoginId(op_num)

  const existingUser = await User.findOne({ login_id: normalizedOpNum })
  if (existingUser) {
    throw new ApiError(StatusCodes.CONFLICT, 'Patient with this OP number already exists')
  }

  let parsedTherapyStartDate: Date | undefined = undefined;
  if (therapy_start_date) {
    if (therapy_start_date instanceof Date) {
      parsedTherapyStartDate = therapy_start_date;
    } else if (typeof therapy_start_date === 'string') {
      parsedTherapyStartDate = parseStrictDateOnly(therapy_start_date)
    }
  }

  // A phone number is public/predictable patient data and must never be an
  // account password. Issue a strong one-time password and force replacement.
  const tempPassword = generateTemporaryPassword()
  const releaseAssignmentGuard = await acquireDoctorAssignmentGuard(doctorUser._id)
  let patientProfile
  try {
    const guardedDoctorProfile = await DoctorProfile.findById(doctorUser.profile_id).select('hospital_id')
    if (!guardedDoctorProfile?.hospital_id || String(guardedDoctorProfile.hospital_id) !== hospitalId) {
      throw new ApiError(StatusCodes.CONFLICT, 'Doctor hospital changed while the patient was being assigned')
    }
    await stampDoctorProfileFence(doctorUser.profile_id, {
      fenceToken: releaseAssignmentGuard.fenceToken,
      assertOwned: releaseAssignmentGuard.assertOwned,
    })
    await releaseAssignmentGuard.assertOwned()
    const createdPatient = await createPatientProfileAndUser(
      session => PatientProfile.create([{
      assigned_doctor_id: doctorUser._id,
      assigned_doctor_fence: releaseAssignmentGuard.fenceToken,
      hospital_id: hospitalId,
      demographics: {
        name,
        age,
        gender,
        phone: contact_no,
        next_of_kin: { name: kin_name, relation: kin_relation, phone: kin_contact_number },
      },
      medical_config: {
        therapy_drug: therapy,
        therapy_start_date: parsedTherapyStartDate,
        target_inr: {
          min: target_inr_min ?? 2.0,
          max: target_inr_max ?? 3.0,
        },
      },
      medical_history: medical_history ?? undefined,
      weekly_dosage: prescription ?? undefined,
      }], session ? { session } : undefined).then(([profile]) => profile),
      (profileId, session) => User.create([{
      login_id: normalizedOpNum,
      password: tempPassword,
      user_type: UserType.PATIENT,
      profile_id: profileId,
      user_type_model: 'PatientProfile',
      must_change_password: true,
      }], session ? { session } : undefined).then(([user]) => user),
    )
    patientProfile = createdPatient.profile
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
      patientProfile = terminal.patient
      if (terminal.state === 'QUARANTINED') {
        await User.updateOne(
          { _id: createdPatient.user._id, profile_id: createdPatient.profile._id },
          { $set: { is_active: false } },
        )
        throw error
      }
    }
  } finally {
    await releaseAssignmentGuard()
  }

  res.status(StatusCodes.CREATED).json(new ApiResponse(StatusCodes.CREATED, 'Patient created successfully', {
    patient: patientProfile,
    temporary_password: tempPassword,
    must_change_password: true,
  }))
})

export const reassignPatient = asyncHandler(async (
  req: Request<ReassignPatientInput['params'], {}, ReassignPatientInput['body']>,
  res: Response
) => {
  const { op_num } = req.params
  const { new_doctor_id } = req.body

  const currentDoctorUser = await getDoctorUserOrThrow(req.user.user_id)
  const patientUser = await getPatientUserOrThrow(op_num)
  const existingPatientProfile = await getPatientProfileOrThrow(patientUser.profile_id)
  if (!isDoctorOwnerOfPatient(existingPatientProfile, currentDoctorUser)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Unauthorized Patient Access')
  }

  const doctorUser = await User.findOne({ login_id: normalizeLoginId(new_doctor_id), user_type: UserType.DOCTOR })
  if (!doctorUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Target doctor not found')
  }
  if (!doctorUser.is_active) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Target doctor is inactive')
  }
  await ensureReassignmentHospitalAccess(currentDoctorUser, existingPatientProfile, doctorUser)

  const releaseCurrentDoctorGuard = await acquireDoctorAssignmentGuard(currentDoctorUser._id)
  let releaseAssignmentGuard: Awaited<ReturnType<typeof acquireDoctorAssignmentGuard>>
  if (String(currentDoctorUser._id) === String(doctorUser._id)) {
    releaseAssignmentGuard = releaseCurrentDoctorGuard
  } else {
    try {
      releaseAssignmentGuard = await acquireDoctorAssignmentGuard(doctorUser._id)
    } catch (error) {
      await releaseCurrentDoctorGuard()
      throw error
    }
  }
  let patient
  try {
    const guardedTargetProfile = await DoctorProfile.findById(doctorUser.profile_id).select('hospital_id')
    if (
      !guardedTargetProfile?.hospital_id ||
      String(guardedTargetProfile.hospital_id) !== String(existingPatientProfile.hospital_id)
    ) {
      throw new ApiError(StatusCodes.CONFLICT, 'Target doctor hospital changed while reassignment was being applied')
    }
    await stampDoctorProfileFence(doctorUser.profile_id, {
      fenceToken: releaseAssignmentGuard.fenceToken,
      assertOwned: releaseAssignmentGuard.assertOwned,
    })
    if (String(currentDoctorUser._id) !== String(doctorUser._id)) {
      await stampDoctorProfileFence(currentDoctorUser.profile_id, {
        fenceToken: releaseCurrentDoctorGuard.fenceToken,
        assertOwned: releaseCurrentDoctorGuard.assertOwned,
      })
    }
    await releaseAssignmentGuard.assertOwned()
    await releaseCurrentDoctorGuard.assertOwned()
    const reassignmentSession = await mongoose.startSession()
    try {
      await reassignmentSession.withTransaction(async () => {
        patient = await PatientProfile.findOneAndUpdate(
          doctorOwnedPatientFilter(patientUser.profile_id, currentDoctorUser, existingPatientProfile.hospital_id),
          {
            $set: {
              assigned_doctor_id: doctorUser._id,
              assigned_doctor_fence: releaseAssignmentGuard.fenceToken,
            },
          },
          { new: true, runValidators: true, session: reassignmentSession }
        )
        if (!patient) throwOwnershipChanged()
        await releaseAssignmentGuard.assertOwned()
        await releaseCurrentDoctorGuard.assertOwned()
        await notifyPatientDoctorUpdate(
          patientUser._id,
          currentDoctorUser._id,
          'DOCTOR_REASSIGNED',
          'Doctor assignment changed',
          `Your case was reassigned to doctor ${new_doctor_id}.`,
          ['assigned_doctor_id'],
          {
            session: reassignmentSession,
            idempotencyKey: `doctor-reassignment:${patient._id}:${currentDoctorUser._id}:${doctorUser._id}:${releaseAssignmentGuard.fenceToken}`,
          },
        )
      })
    } finally {
      await reassignmentSession.endSession()
    }
    if (patient) {
      try {
        await releaseAssignmentGuard.assertOwned()
        await releaseCurrentDoctorGuard.assertOwned()
      } catch (error) {
        const terminal = await terminalizePatientAssignment({
          patientProfileId: patient._id,
          targetDoctorUserId: doctorUser._id,
          targetFence: releaseAssignmentGuard.fenceToken,
          patientHospitalId: existingPatientProfile.hospital_id,
          previousDoctorId: currentDoctorUser._id,
          reason: 'Target doctor lifecycle changed after reassignment commit',
          targetGuard: releaseAssignmentGuard,
        })
        if (terminal.state === 'COMMITTED') {
          patient = terminal.patient
          // The clinical write is already valid and committed. A superseded
          // cleanup lease must not turn that success into a retryable failure.
          logger.warn('patient_reassignment.committed_after_lease_superseded', {
            patient_id: String(patient._id),
            target_doctor_id: String(doctorUser._id),
          })
        } else if (terminal.state === 'QUARANTINED') {
          const quarantined = terminal.patient
          logger.error('patient_reassignment.assignment_conflict', {
            patient_id: String(patient._id),
            attempted_doctor_id: String(doctorUser._id),
            quarantine_persisted: Boolean(quarantined),
            error: sanitizeLogText(error),
          })
          try {
            await AuditLog.create({
              user_id: currentDoctorUser._id,
              user_type: currentDoctorUser.user_type,
              action: AuditAction.PATIENT_REASSIGN,
              description: 'Doctor reassignment entered assignment-conflict review',
              resource_type: 'Patient',
              resource_id: String(patient._id),
              success: false,
              error_message: 'assignment_conflict',
              ip_address: req.ip || req.socket?.remoteAddress,
              user_agent: req.headers['user-agent'],
              metadata: {
                patient_user_id: String(patientUser._id),
                previous_doctor_id: String(currentDoctorUser._id),
                attempted_doctor_id: String(doctorUser._id),
                quarantine_persisted: Boolean(quarantined),
              },
            })
          } catch (auditError) {
            logger.error('patient_reassignment.conflict_audit_failed', {
              patient_id: String(patient._id),
              error: sanitizeLogText(auditError),
            })
          }
          throw new ApiError(StatusCodes.CONFLICT,
            'Patient assignment entered conflict review; no clinical discharge was recorded')
        } else {
          throw new ApiError(StatusCodes.CONFLICT, 'Patient assignment was superseded by another request')
        }
      }
    }
  } finally {
    await releaseAssignmentGuard()
    if (releaseCurrentDoctorGuard !== releaseAssignmentGuard) await releaseCurrentDoctorGuard()
  }
  if (!patient) throwOwnershipChanged()

  try {
    await AuditLog.create({
      user_id: currentDoctorUser._id,
      user_type: currentDoctorUser.user_type,
      action: AuditAction.PATIENT_REASSIGN,
      description: 'Doctor reassigned patient successfully',
      resource_type: 'Patient',
      resource_id: String(patient._id),
      success: true,
      ip_address: req.ip || req.socket?.remoteAddress,
      user_agent: req.headers['user-agent'],
      metadata: {
        patient_user_id: String(patientUser._id),
        previous_doctor_id: String(currentDoctorUser._id),
        assigned_doctor_id: String(doctorUser._id),
      },
    })
  } catch (auditError) {
    // The assignment is already committed and valid. Preserve truthful API
    // success while surfacing the audit durability failure operationally.
    logger.error('patient_reassignment.success_audit_failed', {
      patient_id: String(patient._id),
      error: sanitizeLogText(auditError),
    })
  }

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Patient reassigned successfully', { patient }))
})

export const editPatientDosage = asyncHandler(async (
  req: Request<EditPatientDosageInput['params'], {}, EditPatientDosageInput['body']>,
  res: Response
) => {
  const { op_num } = req.params
  const { prescription } = req.body

  const doctor = await getDoctorUserOrThrow(req.user.user_id)
  const patientUser = await getPatientUserOrThrow(op_num)
  const patientProfile = await getPatientProfileOrThrow(patientUser.profile_id)
  if (!isDoctorOwnerOfPatient(patientProfile, doctor)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Unauthorized Patient Access')
  }
  await ensureSameHospital(doctor, patientProfile)

  const patient = await PatientProfile.findOneAndUpdate(
    doctorOwnedPatientFilter(patientUser.profile_id, doctor, patientProfile.hospital_id),
    {
      $set: { weekly_dosage: prescription },
    },
    { new: true, runValidators: true }
  )
  if (!patient) throwOwnershipChanged()

  await notifyPatientDoctorUpdate(
    patientUser._id,
    doctor._id,
    'DOSAGE_UPDATED',
    'Dosage updated',
    'Your weekly dosage plan was updated by your doctor.',
    ['weekly_dosage']
  )

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Dosage updated successfully', { patient }))
})

export const getReports = asyncHandler(async (req: Request, res: Response) => {
  const { op_num } = req.params

  const doctor = await getDoctorUserOrThrow(req.user.user_id)
  const patientUser = await getPatientUserOrThrow(op_num)
  const patient = await PatientProfile.findById(patientUser.profile_id).select('assigned_doctor_id hospital_id inr_history')
  if (!patient) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Patient not found')
  }
  if (!isDoctorOwnerOfPatient(patient, doctor)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Unauthorized Doctor to View The Patient')
  }
  await ensureSameHospital(doctor, patient)
  const requesterHospitalId = await getRequiredDoctorHospitalId(doctor)

  const includeUrls = String(req.query.include_urls ?? '').toLowerCase() === 'true'
  const history = (patient?.inr_history || []).map((report) => {
    const reportObj = typeof (report as any).toObject === 'function'
      ? (report as any).toObject()
      : { ...(report as any) }
    return reportObj
  })

  const inrHistory = includeUrls
    ? await Promise.all(
      history.map(async (reportObj: any) => {
        if (reportObj.file_url) {
          reportObj.file_url = await resolveAssetDownloadUrl({
            fileAssetId: reportObj.file_asset_id,
            legacyObjectKey: reportObj.file_url,
            hospitalId: patient.hospital_id,
            requesterHospitalId,
            ownerUserId: patientUser._id,
            patientProfileId: patient._id,
            purpose: FileAssetPurpose.INR_REPORT,
            legacyEligible: isLegacyFileReferenceEligible(reportObj.uploaded_at),
          })
        }
        return reportObj
      }),
    )
    : history

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'INR reports fetched successfully', { inr_history: inrHistory }))
})

export const updateReport = asyncHandler(async (req: Request<UpdateReportInput['params'], {}, UpdateReportInput['body']>, res: Response) => {
  const { op_num, report_id } = req.params
  const { notes, is_critical } = req.body

  const doctor = await getDoctorUserOrThrow(req.user.user_id)
  const patientUser = await getPatientUserOrThrow(op_num)
  const patientProfile = await getPatientProfileOrThrow(patientUser.profile_id)
  if (!isDoctorOwnerOfPatient(patientProfile, doctor)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Unauthorized Patient Access')
  }
  await ensureSameHospital(doctor, patientProfile)

  const existingReport = patientProfile.inr_history.id(report_id)
  if (!existingReport) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Report not found')
  }

  const changedFields: string[] = []
  if (notes !== undefined) changedFields.push('inr_history.notes')
  if (is_critical !== undefined) changedFields.push('inr_history.is_critical')

  const reportSet: Record<string, unknown> = {}
  if (notes !== undefined) reportSet['inr_history.$.notes'] = notes
  if (is_critical !== undefined) reportSet['inr_history.$.is_critical'] = is_critical
  let report = existingReport
  if (changedFields.length > 0) {
    const updatedPatient = await PatientProfile.findOneAndUpdate(
      {
        ...doctorOwnedPatientFilter(patientUser.profile_id, doctor, patientProfile.hospital_id),
        'inr_history._id': report_id,
      },
      { $set: reportSet },
      { new: true, runValidators: true },
    )
    if (!updatedPatient) throwOwnershipChanged()
    report = updatedPatient.inr_history.id(report_id)!
  }

  if (changedFields.length > 0) {
    await notifyPatientDoctorUpdate(
      patientUser._id,
      doctor._id,
      'REPORT_UPDATED',
      'Report updated',
      'Your uploaded INR report has new doctor notes or status updates.',
      changedFields
    )
  }

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Report updated successfully', { report }))
})

export const updateNextReview = asyncHandler(async (
  req: Request<UpdateNextReviewInput['params'], {}, UpdateNextReviewInput['body']>,
  res: Response
) => {
  const { date } = req.body
  const { op_num } = req.params
  const parsedDate = typeof date === 'string' ? parseStrictDateOnly(date) : undefined
  if (!parsedDate) throw new ApiError(StatusCodes.BAD_REQUEST, 'Date must be a valid calendar date in DD-MM-YYYY format')

  const doctor = await getDoctorUserOrThrow(req.user.user_id)
  const patientUser = await getPatientUserOrThrow(op_num)
  const patientProfile = await getPatientProfileOrThrow(patientUser.profile_id)
  if (!isDoctorOwnerOfPatient(patientProfile, doctor)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Unauthorized Patient Access')
  }
  await ensureSameHospital(doctor, patientProfile)

  const therapyStart = patientProfile.medical_config?.therapy_start_date
  if (therapyStart && parsedDate.getTime() < new Date(therapyStart).getTime()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Next review date cannot be before therapy started')
  }

  const reviewFilter: any = doctorOwnedPatientFilter(patientUser.profile_id, doctor, patientProfile.hospital_id)
  reviewFilter.$and = [{
    $or: [
      { 'medical_config.therapy_start_date': { $exists: false } },
      { 'medical_config.therapy_start_date': null },
      { 'medical_config.therapy_start_date': { $lte: parsedDate } },
    ],
  }]
  const patient = await PatientProfile.findOneAndUpdate(
    reviewFilter,
    {
      $set: { 'medical_config.next_review_date': parsedDate },
    },
    { new: true, runValidators: true }
  )
  if (!patient) {
    const stillOwned = await PatientProfile.exists(
      doctorOwnedPatientFilter(patientUser.profile_id, doctor, patientProfile.hospital_id),
    )
    if (stillOwned) throw new ApiError(StatusCodes.CONFLICT, 'Therapy start changed while the review date was being applied')
    throwOwnershipChanged()
  }

  await notifyPatientDoctorUpdate(
    patientUser._id,
    doctor._id,
    'NEXT_REVIEW_UPDATED',
    'Next review updated',
    `Your next review date was updated to ${date}.`,
    ['medical_config.next_review_date']
  )

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Next review date updated successfully', { patient }))
})

export const UpdateInstructions = asyncHandler(async (
  req: Request<UpdateInstructionsInput['params'], {}, UpdateInstructionsInput['body']>,
  res: Response
) => {
  const { instructions } = req.body
  const { op_num } = req.params

  const doctor = await getDoctorUserOrThrow(req.user.user_id)
  const patientUser = await getPatientUserOrThrow(op_num)
  const patientProfile = await getPatientProfileOrThrow(patientUser.profile_id)
  if (!isDoctorOwnerOfPatient(patientProfile, doctor)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Unauthorized Patient Access')
  }
  await ensureSameHospital(doctor, patientProfile)

  const patient = await PatientProfile.findOneAndUpdate(
    doctorOwnedPatientFilter(patientUser.profile_id, doctor, patientProfile.hospital_id),
    {
      $set: { 'medical_config.instructions': instructions },
    },
    { new: true, runValidators: true }
  )
  if (!patient) throwOwnershipChanged()

  await notifyPatientDoctorUpdate(
    patientUser._id,
    doctor._id,
    'INSTRUCTIONS_UPDATED',
    'Instructions updated',
    'Your doctor updated your care instructions.',
    ['medical_config.instructions']
  )

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Instructions updated successfully', { patient }))
})

export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  const doctor = await User.findById(req.user.user_id).populate('profile_id')
  if (!doctor || doctor.user_type !== UserType.DOCTOR) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Doctor not found')
  }

  const doctorProfile = doctor.profile_id as typeof DoctorProfile.prototype
  let profilePictureUrl = null

  if (doctorProfile?.profile_picture_url) {
    profilePictureUrl = await resolveAssetDownloadUrl({
      fileAssetId: doctorProfile.profile_picture_file_asset_id,
      legacyObjectKey: doctorProfile.profile_picture_url,
      hospitalId: doctorProfile.hospital_id,
      requesterHospitalId: doctorProfile.hospital_id,
      ownerUserId: doctor._id,
      purpose: FileAssetPurpose.DOCTOR_PROFILE_PICTURE,
      legacyEligible: isLegacyFileReferenceEligible(doctorProfile.createdAt),
    })
  }

  const patientsCount = await PatientProfile.countDocuments({
    assigned_doctor_id: { $in: getDoctorOwnershipIds(doctor) },
    ...(doctorProfile?.hospital_id ? { hospital_id: doctorProfile.hospital_id } : {}),
  })

  const doctorData = doctor.toObject() as any
  delete doctorData.password
  delete doctorData.salt
  delete doctorData.password_history
  delete doctorData.admin_mfa
  delete doctorData.failed_login_attempts
  delete doctorData.locked_until
  delete doctorData.last_failed_login_at

  const response = {
    doctor: {
      ...doctorData,
      profile_id: {
        ...doctorProfile?.toObject(),
        profile_picture_url: profilePictureUrl
      }
    },
    patients_count: patientsCount
  }

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Profile fetched successfully', response))
})

export const UpdateProfile = asyncHandler(async (req: Request<{}, {}, UpdateProfileInput["body"]>, res: Response) => {
  const { name, contact_number, department } = req.body
  const { user_id } = req.user
  const doctorUser = await getDoctorUserOrThrow(user_id)
  await doctorUser.populate('profile_id')
  const currentProfile = doctorUser.profile_id as any
  if (!currentProfile) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Doctor profile not found')
  }
  const profileUpdate: any = {}
  if (name !== undefined) profileUpdate.name = name
  if (department !== undefined) profileUpdate.department = department
  if (contact_number !== undefined) {
    profileUpdate.contact_number = contact_number
    if (contact_number !== currentProfile?.contact_number) {
      profileUpdate.phone_verification = { status: 'PENDING' }
    }
  }
  const updatedProfile = await DoctorProfile.findByIdAndUpdate(
    currentProfile._id,
    profileUpdate,
    { new: true, runValidators: true }
  )
  if (!updatedProfile) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Doctor profile not found')
  }
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Profile updated successfully'))
})

export const getDoctors = asyncHandler(async (req: Request, res: Response) => {
  const doctorUser = await getDoctorUserOrThrow(req.user.user_id)
  const hospitalId = await getDoctorHospitalId(doctorUser)
  let doctorsQuery = User.find({ user_type: UserType.DOCTOR, is_active: true })
    .populate('profile_id')
    // Peer-facing list: explicit allowlist only (exclude lockout/MFA/auth material).
    .select('_id login_id user_type user_type_model profile_id is_active createdAt updatedAt')
  const doctors = (await doctorsQuery.lean()).filter((doctor: any) => {
    const doctorHospitalId = doctor?.profile_id?.hospital_id ? String(doctor.profile_id.hospital_id) : undefined
    return hospitalId ? doctorHospitalId === hospitalId : String(doctor._id) === String(doctorUser._id)
  })
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, "Doctors fetched successfully", { doctors }))
})

export const getReport = asyncHandler(async (req: Request, res: Response) => {
  const { report_id, op_num } = req.params

  if (!mongoose.Types.ObjectId.isValid(report_id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid report_id or op_num')
  }

  const doctor = await getDoctorUserOrThrow(req.user.user_id)
  const patientUser = await getPatientUserOrThrow(op_num)
  const patientProfile = await getPatientProfileOrThrow(patientUser.profile_id)

  if (!isDoctorOwnerOfPatient(patientProfile, doctor)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Unauthorized Doctor to View The Patient')
  }
  await ensureSameHospital(doctor, patientProfile)
  const requesterHospitalId = await getRequiredDoctorHospitalId(doctor)

  const report = patientProfile.inr_history.id(report_id)
  if (!report) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Report not found')
  }
  const downloadUrl = await resolveAssetDownloadUrl({
    fileAssetId: report.file_asset_id,
    legacyObjectKey: report.file_url,
    hospitalId: patientProfile.hospital_id,
    requesterHospitalId,
    ownerUserId: patientUser._id,
    patientProfileId: patientProfile._id,
    purpose: FileAssetPurpose.INR_REPORT,
    legacyEligible: isLegacyFileReferenceEligible(report.uploaded_at),
  })
  const reportResponse = { ...report.toObject(), file_url: downloadUrl }
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Report fetched successfully', { report: reportResponse }))
})

export const updateProfilePicture = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Image is required for setting up profile picture")
  }
  const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
  if (!allowedMimeTypes.includes(req.file.mimetype)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid file type. Only PNG, JPEG, JPG, and WEBP images are allowed')
  }
  const { user_id } = req.user
  const user = await getDoctorUserOrThrow(user_id)
  const hospitalId = await getDoctorHospitalId(user)
  if (!hospitalId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Doctor must be assigned to a hospital before uploading files')
  }

  let uploadedFile: Awaited<ReturnType<typeof uploadTrackedFile>>['metadata']
  let fileAsset: Awaited<ReturnType<typeof uploadTrackedFile>>['asset']
  const doctorProfile = await DoctorProfile.findById(user.profile_id)
  if (!doctorProfile) throw new ApiError(StatusCodes.NOT_FOUND, 'Doctor profile not found')
  try {
    const trackedUpload = await uploadTrackedFile(`hospitals/${hospitalId}/profiles/${user._id}`, req.file, {
      hospitalId,
      ownerUserId: user._id,
      purpose: FileAssetPurpose.DOCTOR_PROFILE_PICTURE,
      createdBy: user._id,
    })
    uploadedFile = trackedUpload.metadata
    fileAsset = trackedUpload.asset
  } catch (error) {
    logger.error("Error While Uploading profile to filebase", { error: sanitizeLogText(error) })
    if (error instanceof FileValidationError) throw new ApiError(StatusCodes.BAD_REQUEST, error.message)
    throw new ApiError(StatusCodes.INSUFFICIENT_STORAGE, "Error While Uploading report to cloud")
  }

  const previousAssetId = doctorProfile.profile_picture_file_asset_id
  try {
    const referenceFilter = previousAssetId
      ? { profile_picture_file_asset_id: previousAssetId }
      : { $or: [{ profile_picture_file_asset_id: { $exists: false } }, { profile_picture_file_asset_id: null }] }
    const updated = await DoctorProfile.findOneAndUpdate({ _id: user.profile_id, ...referenceFilter }, {
      profile_picture_url: uploadedFile.key,
      profile_picture_file_asset_id: fileAsset._id,
    }, { new: true })
    if (!updated) throw new ApiError(StatusCodes.CONFLICT, 'Profile picture was changed by another request')
  } catch (error) {
    // Compensate only when the new asset was not committed to the profile.
    await compensateFileAsset(fileAsset, error)
    throw error
  }

  // Best-effort retirement of the previous asset; failure must not roll back the new profile picture.
  try {
    await retireReplacedFileAsset({
      fileAssetId: previousAssetId,
      hospitalId,
      ownerUserId: user._id,
      purpose: FileAssetPurpose.DOCTOR_PROFILE_PICTURE,
    })
  } catch (error) {
    logger.warn('Failed to retire replaced doctor profile picture asset', {
      error: sanitizeLogText(error),
      previousAssetId: previousAssetId ? String(previousAssetId) : undefined,
    })
  }
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, "Profile Picture successfully changed"))
})

export const getDoctorNotifications = asyncHandler(async (
  req: Request<{}, {}, {}, NotificationsQueryInput['query']>,
  res: Response
) => {
  const doctorUser = await getDoctorUserOrThrow(req.user.user_id)

  const query = (req.validatedQuery ?? req.query) as NotificationsQueryInput['query']
  const parsedPage = query.page ? parseInt(query.page, 10) : 1
  const parsedLimit = query.limit ? parseInt(query.limit, 10) : 20
  const page = Number.isFinite(parsedPage) ? Math.max(parsedPage, 1) : 1
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 20
  const isReadFilter = query.is_read === undefined ? undefined : query.is_read === 'true'

  const { notifications, pagination } = await notificationService.getUserNotifications(
    String(doctorUser._id),
    { is_read: isReadFilter },
    { page, limit }
  )

  const unreadCount = await Notification.countDocuments({
    user_id: doctorUser._id,
    is_read: false,
  })

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Notifications fetched successfully', {
    notifications: notifications.map(mapNotificationToAppNotificationItem),
    pagination,
    unread_count: unreadCount,
  }))
})

/** Lightweight badge endpoint: count only, no notification list. */
export const getDoctorNotificationsUnreadCount = asyncHandler(async (req: Request, res: Response) => {
  const doctorUser = await getDoctorUserOrThrow(req.user.user_id)
  const unreadCount = await Notification.countDocuments({
    user_id: doctorUser._id,
    is_read: false,
  })
  res.status(StatusCodes.OK).json(new ApiResponse(
    StatusCodes.OK,
    'Unread notification count fetched successfully',
    { unread_count: unreadCount },
  ))
})

export const markDoctorNotificationAsRead = asyncHandler(async (
  req: Request<MarkNotificationReadInput['params']>,
  res: Response
) => {
  const doctorUser = await getDoctorUserOrThrow(req.user.user_id)
  const { notification_id } = req.params

  const notification = await notificationService.markNotificationRead(
    notification_id,
    String(doctorUser._id),
  )
  if (!notification) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Notification not found')
  }

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Notification marked as read'))
})

export const markAllDoctorNotificationsAsRead = asyncHandler(async (
  req: Request,
  res: Response
) => {
  const doctorUser = await getDoctorUserOrThrow(req.user.user_id)
  const markedCount = await notificationService.markAllNotificationsRead(String(doctorUser._id))

  res.status(StatusCodes.OK).json(new ApiResponse(
    StatusCodes.OK,
    'All notifications marked as read',
    { marked_count: markedCount },
  ))
})

export const streamDoctorNotifications = asyncHandler(async (req: Request, res: Response) => {
  const doctorUser = await resolveDoctorStreamUserOrThrow(req)
  registerUserNotificationStream(String(doctorUser._id), res)
})
