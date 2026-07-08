import { Request, Response } from 'express'
import { ApiError, ApiResponse, asyncHandler } from '@alias/utils'
import { StatusCodes } from 'http-status-codes'
import { DoctorProfile, Notification, PatientProfile, User } from '@alias/models'
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
import { getDownloadUrl, uploadFile } from '@alias/utils/fileUpload'
import logger from '@alias/utils/logger'
import { getObjectIdString } from '@alias/utils/objectid'
import { extractTokenFromHeader } from '@alias/utils/jwt.utils'
import { validateAuthToken } from '@alias/middlewares/authProvider.middleware'
import { registerUserNotificationStream } from '@alias/services/realtime-notification.service'
import * as notificationService from '@alias/services/notification.service'
import {
  DoctorChangeType,
  createDoctorUpdateNotification
} from '@alias/services/doctor-update-notification.service'

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

const getDoctorUserOrThrow = async (userId: string) => {
  const doctor = await User.findById(userId)
  if (!doctor || doctor.user_type !== UserType.DOCTOR) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Doctor not found')
  }
  return doctor
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
  changedFields: string[] = []
) => {
  await createDoctorUpdateNotification({
    patientUserId,
    changedByDoctorId: doctorId,
    changeType,
    title,
    message,
    changedFields,
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
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null
  const token = headerToken || queryToken
  if (!token) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Missing authentication token')
  }

  const { user } = await validateAuthToken(token, UserType.DOCTOR)
  return user
}

export const getPatients = asyncHandler(async (req: Request, res: Response) => {
  const { user_id } = req.user
  const doctor = await getDoctorUserOrThrow(user_id)
  const doctorOwnershipIds = getDoctorOwnershipIds(doctor)
  const patientProfiles = await PatientProfile.find({ assigned_doctor_id: { $in: doctorOwnershipIds } })

  // Get login_ids for each patient profile
  const patientUsers = await User.find({
    profile_id: { $in: patientProfiles.map(p => p._id) },
    user_type: UserType.PATIENT
  })

  // Create a map of profile_id to login_id
  const profileToLoginId = new Map<string, string>()
  patientUsers.forEach(u => {
    profileToLoginId.set(u.profile_id?.toString() ?? '', u.login_id)
  })

  // Add login_id to each patient profile
  const patients = patientProfiles.map(p => ({
    ...p.toObject(),
    login_id: profileToLoginId.get(p._id.toString()) ?? null
  }))

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

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Patient fetched successfully', { patient }))
})

export const addPatient = asyncHandler(async (req: Request<{}, {}, CreatePatientInput['body']>, res: Response) => {
  if (!req.user) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Unauthorized')
  }

  const doctorUser = await getDoctorUserOrThrow(req.user.user_id)

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
      parsedTherapyStartDate = new Date(therapy_start_date);
      if (isNaN(parsedTherapyStartDate.getTime())) {
        parsedTherapyStartDate = undefined;
      }
    }
  }

  const patientProfile = await PatientProfile.create({
    assigned_doctor_id: doctorUser._id,
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
  })

  const tempPassword = contact_no
  await User.create({ login_id: normalizedOpNum, password: tempPassword, user_type: UserType.PATIENT, profile_id: patientProfile._id })

  res.status(StatusCodes.CREATED).json(new ApiResponse(StatusCodes.CREATED, 'Patient created successfully', { patient: patientProfile }))
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

  const patient = await PatientProfile.findByIdAndUpdate(
    patientUser.profile_id,
    {
      $set: { assigned_doctor_id: doctorUser._id },
    },
    { new: true }
  )

  await notifyPatientDoctorUpdate(
    patientUser._id,
    currentDoctorUser._id,
    'DOCTOR_REASSIGNED',
    'Doctor assignment changed',
    `Your case was reassigned to doctor ${new_doctor_id}.`,
    ['assigned_doctor_id']
  )

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

  const patient = await PatientProfile.findByIdAndUpdate(
    patientUser.profile_id,
    {
      $set: { weekly_dosage: prescription },
    },
    { new: true }
  )

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
  const patient = await PatientProfile.findById(patientUser.profile_id).select('assigned_doctor_id inr_history')
  if (!patient) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Patient not found')
  }
  if (!isDoctorOwnerOfPatient(patient, doctor)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Unauthorized Doctor to View The Patient')
  }

  // Convert S3 keys to presigned URLs for each report
  const reportsWithUrls = await Promise.all(
    (patient?.inr_history || []).map(async (report) => {
      const reportObj = report.toObject()
      if (reportObj.file_url) {
        try {
          reportObj.file_url = await getDownloadUrl(reportObj.file_url)
        } catch (error) {
          logger.error('Error generating presigned URL for report', { error, file_url: reportObj.file_url })
          // Keep the original key if presigned URL generation fails
        }
      }
      return reportObj
    })
  )

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'INR reports fetched successfully', { inr_history: reportsWithUrls }))
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

  const report = patientProfile.inr_history.id(report_id)
  if (!report) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Report not found')
  }

  if (notes !== undefined) report.notes = notes;
  if (is_critical !== undefined) report.is_critical = is_critical;

  const changedFields: string[] = []
  if (notes !== undefined) changedFields.push('inr_history.notes')
  if (is_critical !== undefined) changedFields.push('inr_history.is_critical')

  await patientProfile.save()

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
  const dateRegex = /^\d{2}-\d{2}-\d{4}$/

  if (typeof date !== 'string' || !dateRegex.test(date)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Date must be in DD-MM-YYYY format')
  }

  const [day, month, year] = date.split('-').map(Number)
  const parsedDate = new Date(year, month - 1, day)

  const doctor = await getDoctorUserOrThrow(req.user.user_id)
  const patientUser = await getPatientUserOrThrow(op_num)
  const patientProfile = await getPatientProfileOrThrow(patientUser.profile_id)
  if (!isDoctorOwnerOfPatient(patientProfile, doctor)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Unauthorized Patient Access')
  }

  const patient = await PatientProfile.findByIdAndUpdate(
    patientUser.profile_id,
    {
      $set: { 'medical_config.next_review_date': parsedDate },
    },
    { new: true }
  )

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

  const patient = await PatientProfile.findByIdAndUpdate(
    patientUser.profile_id,
    {
      $set: { 'medical_config.instructions': instructions },
    },
    { new: true }
  )

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
    try {
      profilePictureUrl = await getDownloadUrl(doctorProfile.profile_picture_url)
    } catch (error) {
      logger.error('Error fetching profile picture URL', { error })
    }
  }

  const patientsCount = await PatientProfile.countDocuments({ assigned_doctor_id: { $in: getDoctorOwnershipIds(doctor) } })

  const response = {
    doctor: {
      ...doctor.toObject(),
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
  const doctorUser = await User.findById(user_id).populate('profile_id')
  if (!doctorUser) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Doctor not found')
  }
  const currentProfile = doctorUser.profile_id as any
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
    currentProfile?._id ?? doctorUser.profile_id,
    profileUpdate,
    { new: true }
  )
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Profile updated successfully'))
})

export const getDoctors = asyncHandler(async (req: Request, res: Response) => {
  const doctors = await User.find({ user_type: UserType.DOCTOR }).populate('profile_id').select('-password -salt').lean()
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

  const report = patientProfile.inr_history.id(report_id)
  if (!report) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Report not found')
  }
  const downloadUrl = await getDownloadUrl(report.file_url)
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

  let fileUrl = ''
  try {
    fileUrl = await uploadFile("profiles", req.file)
  } catch (error) {
    logger.error("Error While Uploading profile to filebase", { error })
    throw new ApiError(StatusCodes.INSUFFICIENT_STORAGE, "Error While Uploading report to cloud")
  }

  const user = await User.findById(user_id)
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found')
  }

  await DoctorProfile.findByIdAndUpdate(user.profile_id, { profile_picture_url: fileUrl }, { new: true })
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, "Profile Picture successfully changed"))
})

export const getDoctorNotifications = asyncHandler(async (
  req: Request<{}, {}, {}, NotificationsQueryInput['query']>,
  res: Response
) => {
  const doctorUser = await getDoctorUserOrThrow(req.user.user_id)

  const parsedPage = req.query.page ? parseInt(req.query.page, 10) : 1
  const parsedLimit = req.query.limit ? parseInt(req.query.limit, 10) : 20
  const page = Number.isFinite(parsedPage) ? Math.max(parsedPage, 1) : 1
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 20
  const isReadFilter = req.query.is_read === undefined ? undefined : req.query.is_read === 'true'

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
