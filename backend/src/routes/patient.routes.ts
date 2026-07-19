import { NextFunction, Request, Response, Router } from 'express'
import multer from 'multer'
import { authenticate, AllowPatient, validate } from '@alias/middlewares'
import {
	getProfile,
	missedDoses,
	getReport,
	submitReport,
	takeDosage,
	getDosageCalendar,
	updateHealthLogs,
	updateProfilePicture,
	updateProfile,
	getDoctorUpdates,
	getDoctorUpdatesSummary,
	getNotifications,
	getNotificationsUnreadCount,
	markAllNotificationsAsRead,
	markNotificationAsRead,
	markDoctorUpdateAsRead,
	markAllDoctorUpdatesAsRead,
	streamNotifications,
	createPatientNotificationStreamTicket,
} from '@alias/controllers/patient.controller'
import {
	reportSchema,
	takeDosageSchema,
	dosageCalendarQuerySchema,
	updateHealthLogSchema,
	updateProfileSchema,
	doctorUpdatesQuerySchema,
	notificationsQuerySchema,
	markNotificationReadSchema,
	markDoctorUpdateReadSchema,
} from '@alias/validators/patient.validator'
import { ApiError } from '@alias/utils'
import { StatusCodes } from 'http-status-codes'

const REPORT_MAX_SIZE_BYTES = 10 * 1024 * 1024
const PROFILE_PICTURE_MAX_SIZE_BYTES = 5 * 1024 * 1024

const REPORT_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'])
const PROFILE_PICTURE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])

const reportUpload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: REPORT_MAX_SIZE_BYTES },
	fileFilter: (_req, file, cb) => {
		if (!REPORT_MIME_TYPES.has(file.mimetype)) {
			cb(new ApiError(StatusCodes.BAD_REQUEST, 'Invalid file type. Only PDF, PNG, JPEG allowed'))
			return
		}
		cb(null, true)
	}
})

const profilePictureUpload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: PROFILE_PICTURE_MAX_SIZE_BYTES },
	fileFilter: (_req, file, cb) => {
		if (!PROFILE_PICTURE_MIME_TYPES.has(file.mimetype)) {
			cb(new ApiError(StatusCodes.BAD_REQUEST, 'Invalid file type. Only PNG, JPEG, JPG, and WEBP images are allowed'))
			return
		}
		cb(null, true)
	}
})

const uploadReportFile = (req: Request, res: Response, next: NextFunction) => {
	reportUpload.single('file')(req, res, (err: unknown) => {
		if (!err) {
			next()
			return
		}

		if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
			next(new ApiError(StatusCodes.BAD_REQUEST, 'File size exceeds 10MB limit'))
			return
		}

		next(err as Error)
	})
}

const uploadProfilePictureFile = (req: Request, res: Response, next: NextFunction) => {
	profilePictureUpload.single('file')(req, res, (err: unknown) => {
		if (!err) {
			next()
			return
		}

		if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
			next(new ApiError(StatusCodes.BAD_REQUEST, 'File size exceeds 5MB limit'))
			return
		}

		next(err as Error)
	})
}

const router = Router()

router.route('/profile').get(authenticate, AllowPatient, getProfile).put(authenticate, AllowPatient, validate(updateProfileSchema), updateProfile)
router.get('/reports', authenticate, AllowPatient, getReport)
router.post('/reports', authenticate, AllowPatient, uploadReportFile, validate(reportSchema), submitReport)
router.get('/missed-doses', authenticate, AllowPatient, missedDoses)
router.get('/dosage-calendar', authenticate, AllowPatient, validate(dosageCalendarQuerySchema), getDosageCalendar)
router.post('/dosage', authenticate, AllowPatient, validate(takeDosageSchema), takeDosage)
router.post('/health-logs', authenticate, AllowPatient, validate(updateHealthLogSchema), updateHealthLogs)
router.get('/notifications/stream', streamNotifications)
router.post('/notifications/stream-ticket', authenticate, AllowPatient, createPatientNotificationStreamTicket)
router.get('/notifications/unread-count', authenticate, AllowPatient, getNotificationsUnreadCount)
router.get('/notifications', authenticate, AllowPatient, validate(notificationsQuerySchema), getNotifications)
router.patch('/notifications/read-all', authenticate, AllowPatient, markAllNotificationsAsRead)
router.patch('/notifications/:notification_id/read', authenticate, AllowPatient, validate(markNotificationReadSchema), markNotificationAsRead)
router.get('/doctor-updates/summary', authenticate, AllowPatient, getDoctorUpdatesSummary)
router.get('/doctor-updates', authenticate, AllowPatient, validate(doctorUpdatesQuerySchema), getDoctorUpdates)
router.patch('/doctor-updates/read-all', authenticate, AllowPatient, markAllDoctorUpdatesAsRead)
router.patch('/doctor-updates/:event_id/read', authenticate, AllowPatient, validate(markDoctorUpdateReadSchema), markDoctorUpdateAsRead)
router.post("/profile-pic", authenticate, AllowPatient, uploadProfilePictureFile, updateProfilePicture)

export default router
