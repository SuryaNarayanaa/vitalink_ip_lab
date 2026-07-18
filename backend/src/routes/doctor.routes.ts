import { NextFunction, Request, Response, Router } from 'express'
import { authenticate, AllowDoctor, validate } from '@alias/middlewares'
import {
    addPatient,
    editPatientDosage,
    getPatients,
    getProfile,
    getReports,
    getDoctors,
    reassignPatient,
    updateNextReview,
    viewPatient,
    UpdateProfile,
    updateProfilePicture,
    updateReport,
    getReport,
    UpdateInstructions,
    getDoctorNotifications,
    markAllDoctorNotificationsAsRead,
    markDoctorNotificationAsRead,
    streamDoctorNotifications,
    createDoctorNotificationStreamTicket,
} from '@alias/controllers/doctor.controller'
import {
    createPatient,
    EditPatientDosageSchema,
    markNotificationReadSchema,
    notificationsQuerySchema,
    patientOpNumParamsSchema,
    patientReportParamsSchema,
    ReassignPatientSchema,
    UpdateNextReviewSchema,
    UpdateReportSchema,
    UpdateInstructionsSchema,
    updateProfile
} from '@alias/validators/doctor.validator'
import multer from 'multer'
import { ApiError } from '@alias/utils'
import { StatusCodes } from 'http-status-codes'

const PROFILE_PICTURE_MAX_SIZE_BYTES = 5 * 1024 * 1024
const PROFILE_PICTURE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])

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

const uploadProfilePicture = (req: Request, res: Response, next: NextFunction) => {
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

router.get('/notifications/stream', streamDoctorNotifications)
router.post('/notifications/stream-ticket', authenticate, AllowDoctor, createDoctorNotificationStreamTicket)
router.get('/notifications', authenticate, AllowDoctor, validate(notificationsQuerySchema), getDoctorNotifications)
router.patch('/notifications/read-all', authenticate, AllowDoctor, markAllDoctorNotificationsAsRead)
router.patch('/notifications/:notification_id/read', authenticate, AllowDoctor, validate(markNotificationReadSchema), markDoctorNotificationAsRead)

router.get('/patients', authenticate, AllowDoctor, getPatients)
router.get('/patients/:op_num', authenticate, AllowDoctor, validate(patientOpNumParamsSchema), viewPatient)
router.post('/patients', authenticate, AllowDoctor, validate(createPatient), addPatient)
router.patch('/patients/:op_num/reassign', authenticate, AllowDoctor, validate(ReassignPatientSchema), reassignPatient)
router.put('/patients/:op_num/dosage', authenticate, AllowDoctor, validate(EditPatientDosageSchema), editPatientDosage)
router.route('/patients/:op_num/reports').get(authenticate, AllowDoctor, validate(patientOpNumParamsSchema), getReports)

router.route('/patients/:op_num/reports/:report_id').get(authenticate, AllowDoctor, validate(patientReportParamsSchema), getReport).put(authenticate, AllowDoctor, validate(UpdateReportSchema), updateReport)

router.put('/patients/:op_num/config', authenticate, AllowDoctor, validate(UpdateNextReviewSchema), updateNextReview)
router.put('/patients/:op_num/instructions', authenticate, AllowDoctor, validate(UpdateInstructionsSchema), UpdateInstructions)
router.route('/profile').get(authenticate, AllowDoctor, getProfile).put(authenticate, AllowDoctor, validate(updateProfile), UpdateProfile)
router.get('/doctors', authenticate, AllowDoctor, getDoctors)
router.post("/profile-pic", authenticate, AllowDoctor, uploadProfilePicture, updateProfilePicture)

export default router
