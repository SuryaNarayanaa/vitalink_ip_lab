import { Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import { asyncHandler, ApiResponse } from '@alias/utils'
import * as adminService from '@alias/services/admin.service'
import * as configService from '@alias/services/config.service'
import * as notificationService from '@alias/services/notification.service'
import { Notification, NotificationDelivery } from '@alias/models'
import { getTenantUserIdsForAdmin } from '@alias/services/admin.service'
import { getDeliveryMetrics } from '@alias/services/notification-delivery.metrics'

// ─── Doctor Management ───

export const createDoctor = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.registerDoctor(req.body, req.user?.user_id)
  res.status(StatusCodes.CREATED).json(new ApiResponse(StatusCodes.CREATED, 'Doctor created successfully', result))
})

export const getAllDoctors = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, department, is_active, search, hospital_id } = req.query as any
  const filters: any = {}
  if (department) filters.department = department
  if (is_active !== undefined) filters.is_active = is_active === 'true'
  if (search) filters.search = search
  if (hospital_id) filters.hospital_id = hospital_id

  const result = await adminService.getAllDoctors(filters, { page: Number(page), limit: Number(limit) }, req.user?.user_id)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Doctors retrieved successfully', result))
})

export const updateDoctor = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await adminService.updateDoctor(id, req.body, req.user?.user_id)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Doctor updated successfully', result))
})

export const deactivateDoctor = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await adminService.deactivateDoctor(id, req.user?.user_id)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Doctor deactivated successfully', result))
})

// ─── Patient Management ───

export const createPatient = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.onboardPatient(req.body, req.user?.user_id)
  res.status(StatusCodes.CREATED).json(new ApiResponse(StatusCodes.CREATED, 'Patient created successfully', result))
})

export const getAllPatients = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, assigned_doctor_id, account_status, search, hospital_id } = req.query as any
  const filters: any = {}
  if (assigned_doctor_id) filters.assigned_doctor_id = assigned_doctor_id
  if (account_status) filters.account_status = account_status
  if (search) filters.search = search
  if (hospital_id) filters.hospital_id = hospital_id

  const result = await adminService.getAllPatients(filters, { page: Number(page), limit: Number(limit) }, req.user?.user_id)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Patients retrieved successfully', result))
})

export const updatePatient = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await adminService.updatePatient(id, req.body, req.user?.user_id)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Patient updated successfully', result))
})

export const deactivatePatient = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await adminService.deactivatePatient(id, req.user?.user_id)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Patient deactivated successfully', result))
})

export const reassignPatient = asyncHandler(async (req: Request, res: Response) => {
  const { op_num } = req.params
  const { new_doctor_id } = req.body
  const result = await adminService.reassignPatient(op_num, new_doctor_id, req.user?.user_id)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Patient reassigned successfully', result))
})

// ─── Audit Logs ───

export const getAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, user_id, action, start_date, end_date, success } = req.query as any
  const filters: any = {}
  if (user_id) filters.user_id = user_id
  if (action) filters.action = action
  if (start_date) filters.start_date = start_date
  if (end_date) filters.end_date = end_date
  if (success !== undefined) filters.success = success === 'true'

  const result = await adminService.getAuditLogs(filters, { page: Number(page), limit: Number(limit) }, req.user?.user_id)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Audit logs retrieved successfully', result))
})

// ─── System Config ───

export const getSystemConfig = asyncHandler(async (req: Request, res: Response) => {
  const config = await configService.getSystemConfig()
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'System config retrieved', config))
})

export const updateSystemConfig = asyncHandler(async (req: Request, res: Response) => {
  adminService.requireCanMutate(await adminService.getAdminContext(req.user?.user_id))
  const config = await configService.updateSystemConfig(req.body)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'System config updated', config))
})

// ─── Notifications ───

export const broadcastNotification = asyncHandler(async (req: Request, res: Response) => {
  adminService.requireCanMutate(await adminService.getAdminContext(req.user?.user_id))
  const { title, message, target, user_ids, priority } = req.body
  const result = await notificationService.broadcastNotification(title, message, target, user_ids, priority, req.user?.user_id)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Notification broadcast successful', result))
})

// ─── Batch Operations ───

export const performBatchOperation = asyncHandler(async (req: Request, res: Response) => {
  const { operation, user_ids } = req.body
  const result = await adminService.performBatchOperation(operation, user_ids, req.user?.user_id)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Batch operation completed', result))
})

// ─── System Health ───

export const getSystemHealth = asyncHandler(async (req: Request, res: Response) => {
  const health = await adminService.getSystemHealth(req.user?.user_id)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'System health', health))
})

/** Reminder-only operational health, scoped to the requesting admin's tenant. */
export const getReminderDeliveryHealth = asyncHandler(async (req: Request, res: Response) => {
  const tenantUserIds = await getTenantUserIdsForAdmin(req.user?.user_id)
  const reminderTypes = ['DOSAGE_REMINDER', 'INR_REMINDER', 'APPOINTMENT_REMINDER', 'CRITICAL_ALERT']
  const notificationQuery: any = { type: { $in: reminderTypes } }
  if (tenantUserIds) notificationQuery.user_id = { $in: tenantUserIds }
  const notifications = await Notification.find(notificationQuery).select('_id type createdAt').lean()
  const notificationIds = notifications.map((row) => row._id)
  const deliveries = notificationIds.length
    ? await NotificationDelivery.find({ notification_id: { $in: notificationIds } }).select('status notification_id next_attempt_at').lean()
    : []
  const byStatus: Record<string, number> = {}
  for (const row of deliveries) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const overdue = deliveries.filter((row) => ['PENDING', 'QUEUED', 'FAILED_RETRYABLE'].includes(row.status) && row.next_attempt_at <= new Date()).length
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Reminder delivery health', {
    remindersLast24Hours: notifications.filter((row) => row.createdAt >= twentyFourHoursAgo).length,
    totalReminders: notifications.length,
    deliveriesByStatus: byStatus,
    overdueDeliveries: overdue,
    processMetrics: getDeliveryMetrics(),
  }))
})

// ─── Legacy Endpoints ───

export const listAllPatients = asyncHandler(async (req: Request, res: Response) => {
  const { patients } = await adminService.listLegacyPatients(req.user?.user_id)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'All patients', { patients }))
})

export const getPatientById = asyncHandler(async (req: Request, res: Response) => {
  const { op_num } = req.params
  const result = await adminService.getLegacyPatientByLoginId(op_num, req.user?.user_id)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Patient found', result))
})

export const getDoctorById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await adminService.getLegacyDoctorById(id, req.user?.user_id)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Doctor found', result))
})

// ─── Password Reset ───

export const resetUserPassword = asyncHandler(async (req: Request, res: Response) => {
  const { target_user_id, new_password } = req.body
  const adminUserId = req.user!.user_id
  const result = await adminService.resetUserPassword(adminUserId, target_user_id, new_password)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Password reset successful', result))
})

// ─── HTML Admin Console: Hospitals / Roles / Users / Billing ───

export const getRoles = asyncHandler(async (_req: Request, res: Response) => {
  const result = await adminService.getRoles()
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Roles retrieved successfully', result))
})

export const updateRole = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.updateRoleDefinition(req.params.roleKey, req.body, req.user?.user_id)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Role updated successfully', result))
})

export const listHospitals = asyncHandler(async (req: Request, res: Response) => {
  const { status, search } = req.query as any
  const result = await adminService.listHospitals({ status, search }, req.user?.user_id)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Hospitals retrieved successfully', result))
})

export const createHospital = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.createHospital(req.body, req.user?.user_id)
  res.status(StatusCodes.CREATED).json(new ApiResponse(StatusCodes.CREATED, 'Hospital created successfully', result))
})

export const getHospital = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.listHospitals({}, req.user?.user_id)
  const hospital = result.hospitals.find((h: any) => h.id === req.params.id || h._id === req.params.id)
  if (!hospital) {
    res.status(StatusCodes.NOT_FOUND).json(new ApiResponse(StatusCodes.NOT_FOUND, 'Hospital not found'))
    return
  }
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Hospital retrieved successfully', { hospital }))
})

export const updateHospital = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.updateHospital(req.params.id, req.body, req.user?.user_id)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Hospital updated successfully', result))
})

export const updateHospitalStatus = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.setHospitalStatus(req.params.id, req.body.status, req.user?.user_id)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Hospital status updated successfully', result))
})

export const deleteHospital = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.deleteHospital(req.params.id, req.user?.user_id)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Hospital deactivated successfully', result))
})

export const listInvoices = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.listInvoices(req.user?.user_id)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Invoices retrieved successfully', result))
})

export const generateInvoices = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.generateInvoices(req.body, req.user?.user_id)
  res.status(StatusCodes.CREATED).json(new ApiResponse(StatusCodes.CREATED, 'Invoices generated successfully', result))
})

export const createInvoiceCheckout = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.createCheckout(req.params.invoiceId, req.user?.user_id)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Checkout session created', result))
})

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.listUsers(req.user?.user_id)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Users retrieved successfully', result))
})

export const inviteUser = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.inviteAdminUser(req.body, req.user?.user_id)
  res.status(StatusCodes.CREATED).json(new ApiResponse(StatusCodes.CREATED, 'User invited successfully', result))
})

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.updateAdminUser(req.params.id, req.body, req.user?.user_id)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'User updated successfully', result))
})

export const resetUserAuthenticator = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.resetAdminAuthenticator(req.params.id, req.user?.user_id)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Authenticator reset successfully', result))
})
