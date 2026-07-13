import { Router } from 'express'
import { authenticate, authorize, validate } from '@alias/middlewares'
import { UserType } from '@alias/validators'
import auditLogger from '@alias/middlewares/audit.middleware'
import { requireAdminPermission } from '@alias/middlewares/adminPermission.middleware'
import {
  createDoctor, getAllDoctors, updateDoctor, deactivateDoctor,
  createPatient, getAllPatients, updatePatient, deactivatePatient,
  reassignPatient, getAuditLogs, getSystemConfig, updateSystemConfig,
  broadcastNotification, performBatchOperation, getSystemHealth,
  getReminderDeliveryHealth,
  listAllPatients, getPatientById, getDoctorById, resetUserPassword,
  getRoles, updateRole,
  listHospitals, createHospital, getHospital, updateHospital, updateHospitalStatus, deleteHospital,
  listInvoices, generateInvoices, createInvoiceCheckout,
  listUsers, inviteUser, updateUser, resetUserAuthenticator,
} from '@alias/controllers/admin.controller'
import {
  createDoctorSchema, updateDoctorSchema, getDoctorsSchema,
  createPatientSchema, updatePatientSchema, getUsersSchema,
  reassignPatientSchema, userIdParamSchema, updateSystemConfigSchema,
  broadcastNotificationSchema, batchOperationSchema, resetPasswordSchema,
  updateAdminUserSchema, updateRoleSchema, createHospitalSchema, updateHospitalSchema,
  updateHospitalStatusSchema, inviteAdminUserSchema, generateInvoicesSchema, invoiceIdParamSchema,
} from '@alias/validators/admin.validator'

const router = Router()

// All admin routes require authentication + ADMIN role
router.use(authenticate)
router.use(authorize([UserType.ADMIN]))
router.use(auditLogger)

// ─── HTML Admin Console Support ───
// Any authenticated admin may inspect the policy matrix; only manage_roles may edit it.
router.get('/roles', getRoles)
router.put('/roles/:roleKey', requireAdminPermission('manage_roles'), validate(updateRoleSchema), updateRole)

router.get('/hospitals', requireAdminPermission('manage_hospitals'), listHospitals)
router.post('/hospitals', requireAdminPermission('manage_hospitals'), validate(createHospitalSchema), createHospital)
router.get('/hospitals/:id', requireAdminPermission('manage_hospitals'), getHospital)
router.put('/hospitals/:id', requireAdminPermission('manage_hospitals'), validate(updateHospitalSchema), updateHospital)
router.patch('/hospitals/:id/status', requireAdminPermission('manage_hospitals'), validate(updateHospitalStatusSchema), updateHospitalStatus)
router.delete('/hospitals/:id', requireAdminPermission('manage_hospitals'), validate(userIdParamSchema), deleteHospital)

router.get('/billing/invoices', requireAdminPermission('manage_billing'), listInvoices)
router.post('/billing/invoices', requireAdminPermission('manage_billing'), validate(generateInvoicesSchema), generateInvoices)
router.post('/billing/checkout/:invoiceId', requireAdminPermission('manage_billing'), validate(invoiceIdParamSchema), createInvoiceCheckout)

router.get('/users', requireAdminPermission('manage_users'), listUsers)
router.post('/users', requireAdminPermission('manage_users'), validate(inviteAdminUserSchema), inviteUser)
router.post('/users/:id/mfa/reset', requireAdminPermission('manage_users'), validate(userIdParamSchema), resetUserAuthenticator)
router.put('/users/:id', requireAdminPermission('manage_users'), validate(updateAdminUserSchema), updateUser)

// ─── Doctor Management ───
router.post('/doctors', requireAdminPermission('manage_doctors'), validate(createDoctorSchema), createDoctor)
router.get('/doctors', requireAdminPermission('manage_doctors'), validate(getDoctorsSchema), getAllDoctors)
router.put('/doctors/:id', requireAdminPermission('manage_doctors'), validate(updateDoctorSchema), updateDoctor)
router.delete('/doctors/:id', requireAdminPermission('manage_doctors'), validate(userIdParamSchema), deactivateDoctor)

// ─── Patient Management ───
router.post('/patients', requireAdminPermission('manage_patients'), validate(createPatientSchema), createPatient)
router.get('/patients', requireAdminPermission('manage_patients'), validate(getUsersSchema), getAllPatients)
router.put('/patients/:id', requireAdminPermission('manage_patients'), validate(updatePatientSchema), updatePatient)
router.delete('/patients/:id', requireAdminPermission('manage_patients'), validate(userIdParamSchema), deactivatePatient)

// ─── Patient Reassignment ───
router.put('/reassign/:op_num', requireAdminPermission('manage_patients'), validate(reassignPatientSchema), reassignPatient)

// ─── Audit Logs ───
router.get('/audit-logs', requireAdminPermission('view_audit'), getAuditLogs)

// ─── System Config ───
router.get('/config', requireAdminPermission('manage_system'), getSystemConfig)
router.put('/config', requireAdminPermission('manage_system'), validate(updateSystemConfigSchema), updateSystemConfig)

// ─── Notifications ───
router.post('/notifications/broadcast', requireAdminPermission('manage_system'), validate(broadcastNotificationSchema), broadcastNotification)

// ─── Batch Operations ───
router.post('/users/batch', requireAdminPermission('manage_users'), validate(batchOperationSchema), performBatchOperation)

// ─── Password Reset ───
router.post('/users/reset-password', requireAdminPermission('manage_users'), validate(resetPasswordSchema), resetUserPassword)

// ─── System Health ───
router.get('/system/health', requireAdminPermission('manage_system'), getSystemHealth)
router.get('/system/reminder-delivery-health', requireAdminPermission('manage_system'), getReminderDeliveryHealth)

// ─── Legacy Endpoints ───
router.get('/legacy/patients', requireAdminPermission('manage_patients'), listAllPatients)
router.get('/legacy/patient/:op_num', requireAdminPermission('manage_patients'), getPatientById)
router.get('/legacy/doctor/:id', requireAdminPermission('manage_doctors'), getDoctorById)

export default router
