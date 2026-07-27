import { Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import { asyncHandler, ApiError, ApiResponse } from '@alias/utils'
import * as adminService from '@alias/services/admin.service'
import * as configService from '@alias/services/config.service'
import * as notificationService from '@alias/services/notification.service'
import { AdminProfile, AuditLog, DoctorProfile, Notification, NotificationDelivery, PatientProfile, User } from '@alias/models'
import { AuditAction } from '@alias/models/auditlog.model'
import logger from '@alias/utils/logger'
import { getDeliveryMetrics } from '@alias/services/notification-delivery.metrics'
import type { AdminAccessContext } from '@alias/types/admin-access'
import { hasAdminCapability } from '@alias/types/admin-access'
import type { AdminCapability } from '@alias/constants/admin-capabilities'
import { UserType } from '@alias/validators'

function accessContext(req: Request): AdminAccessContext {
  if (!req.adminAccess) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Administrator access context is required.')
  }
  return req.adminAccess
}

function requireAccessCapability(
  access: AdminAccessContext,
  capability: AdminCapability,
  scope?: 'global' | 'tenant',
): void {
  if (
    !hasAdminCapability(access, capability)
    || (scope !== undefined && access.scope !== scope)
    || (access.readOnly && !capability.endsWith('.read'))
  ) {
    const error = new ApiError(StatusCodes.FORBIDDEN, 'Administrator access is not permitted for this operation.')
    Object.assign(error, { requiredCapability: capability })
    throw error
  }
}

async function getTenantUserIds(access: AdminAccessContext): Promise<any[]> {
  if (access.scope !== 'tenant' || !access.hospitalId) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Active hospital administrator scope is required.')
  }
  const [doctorProfiles, patientProfiles, adminProfiles] = await Promise.all([
    DoctorProfile.find({ hospital_id: access.hospitalId }).select('_id').lean(),
    PatientProfile.find({ hospital_id: access.hospitalId }).select('_id').lean(),
    AdminProfile.find({ hospital_id: access.hospitalId }).select('_id').lean(),
  ])
  const profileIds = [
    ...doctorProfiles.map(profile => profile._id),
    ...patientProfiles.map(profile => profile._id),
    ...adminProfiles.map(profile => profile._id),
  ]
  if (!profileIds.length) return []
  const users = await User.find({ profile_id: { $in: profileIds } }).select('_id').lean()
  return users.map(user => user._id)
}

// ─── Doctor Management ───

export const createDoctor = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.registerDoctor(req.body, accessContext(req).userId)
  res.status(StatusCodes.CREATED).json(new ApiResponse(StatusCodes.CREATED, 'Doctor created successfully', result))
})

export const getAllDoctors = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, department, is_active, search, hospital_id } = (req.validatedQuery ?? req.query) as any
  const filters: any = {}
  if (department) filters.department = department
  if (is_active !== undefined) filters.is_active = is_active === 'true'
  if (search) filters.search = search
  if (hospital_id) filters.hospital_id = hospital_id

  const result = await adminService.getAllDoctors(filters, { page: Number(page), limit: Number(limit) }, accessContext(req).userId)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Doctors retrieved successfully', result))
})

export const updateDoctor = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await adminService.updateDoctor(id, req.body, accessContext(req).userId)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Doctor updated successfully', result))
})

export const deactivateDoctor = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await adminService.deactivateDoctor(id, accessContext(req).userId)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Doctor deactivated successfully', result))
})

export const updateDoctorStatus = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.setDoctorAccountStatus(req.params.id, req.body.is_active, accessContext(req).userId)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Doctor status updated successfully', result))
})

export const resetDoctorCredentials = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.resetOperationalUserPassword(
    accessContext(req).userId,
    req.params.id,
    UserType.DOCTOR,
    req.body.new_password,
  )
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Doctor credentials reset successfully', result))
})

// ─── Patient Management ───

export const createPatient = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.onboardPatient(req.body, accessContext(req).userId)
  res.status(StatusCodes.CREATED).json(new ApiResponse(StatusCodes.CREATED, 'Patient created successfully', result))
})

export const getAllPatients = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, assigned_doctor_id, account_status, search, hospital_id } = (req.validatedQuery ?? req.query) as any
  const filters: any = {}
  if (assigned_doctor_id) filters.assigned_doctor_id = assigned_doctor_id
  if (account_status) filters.account_status = account_status
  if (search) filters.search = search
  if (hospital_id) filters.hospital_id = hospital_id

  const result = await adminService.getAllPatients(filters, { page: Number(page), limit: Number(limit) }, accessContext(req).userId)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Patients retrieved successfully', result))
})

export const updatePatient = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await adminService.updatePatient(id, req.body, accessContext(req).userId)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Patient updated successfully', result))
})

export const deactivatePatient = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await adminService.deactivatePatient(id, accessContext(req).userId)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Patient deactivated successfully', result))
})

export const reassignPatient = asyncHandler(async (req: Request, res: Response) => {
  const { op_num } = req.params
  const { new_doctor_id } = req.body
  const { audit_resource_id, ...result } = await adminService.reassignPatient(
    op_num,
    new_doctor_id,
    accessContext(req).userId,
  )
  res.locals.auditResourceId = audit_resource_id
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Patient reassigned successfully', result))
})

export const assignPatient = asyncHandler(async (req: Request, res: Response) => {
  const { audit_resource_id, ...result } = await adminService.reassignPatient(
    req.params.id,
    req.body.doctor_id,
    accessContext(req).userId,
  )
  res.locals.auditResourceId = audit_resource_id
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Patient assigned successfully', result))
})

export const updatePatientStatus = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.setPatientAccountStatus(req.params.id, req.body, accessContext(req).userId)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Patient status updated successfully', result))
})

export const resetPatientCredentials = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.resetOperationalUserPassword(
    accessContext(req).userId,
    req.params.id,
    UserType.PATIENT,
    req.body.new_password,
  )
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Patient credentials reset successfully', result))
})

// ─── Audit Logs ───

export const getAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, user_id, action, start_date, end_date, success } = (req.validatedQuery ?? req.query) as any
  const filters: any = {}
  if (user_id) filters.user_id = user_id
  if (action) filters.action = action
  if (start_date) filters.start_date = start_date
  if (end_date) filters.end_date = end_date
  if (success !== undefined) filters.success = success === 'true'

  const result = await adminService.getAuditLogs(filters, { page: Number(page), limit: Number(limit) }, accessContext(req).userId)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Audit logs retrieved successfully', result))
})

// ─── System Config ───

export const getSystemConfig = asyncHandler(async (req: Request, res: Response) => {
  const config = await configService.getAdminSystemConfig(accessContext(req))
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'System config retrieved', config))
})

export const updateSystemConfig = asyncHandler(async (req: Request, res: Response) => {
  const config = await configService.updateAdminSystemConfig(accessContext(req), req.body)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'System config updated', config))
})

// ─── Notifications ───

export const broadcastNotification = asyncHandler(async (req: Request, res: Response) => {
  const { title, message, target, user_ids, priority } = req.body
  const result = await notificationService.broadcastNotification(
    title,
    message,
    target,
    user_ids,
    priority,
    accessContext(req),
  )
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Notification broadcast successful', result))
})

// ─── Batch Operations ───

export const performBatchOperation = asyncHandler(async (req: Request, res: Response) => {
  const { operation, user_ids } = req.body
  const result = await adminService.performBatchOperation(operation, user_ids, accessContext(req).userId)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Batch operation completed', result))
})

// ─── System Health ───

export const getSystemHealth = asyncHandler(async (req: Request, res: Response) => {
  const access = accessContext(req)
  requireAccessCapability(access, 'platform.system_health.read', 'global')
  const rawHealth = await adminService.getSystemHealth()
  const databaseStatus = rawHealth?.database?.state === 'connected' ? 'available' : 'unavailable'
  const health = {
    status: rawHealth?.status === 'healthy' ? 'healthy' : 'degraded',
    uptime_seconds: Math.max(0, Math.floor(Number(rawHealth?.uptime) || 0)),
    dependencies: {
      database: { status: databaseStatus },
      notification_delivery: {
        status: 'available',
        metrics: getDeliveryMetrics(),
      },
    },
    timestamp: rawHealth?.timestamp || new Date().toISOString(),
  }
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'System health', health))
})

/** Reminder-only operational health, strictly scoped to the requesting hospital. */
export const getReminderDeliveryHealth = asyncHandler(async (req: Request, res: Response) => {
  const access = accessContext(req)
  requireAccessCapability(access, 'tenant.operations_health.read', 'tenant')
  const tenantUserIds = await getTenantUserIds(access)
  const reminderTypes = ['DOSAGE_REMINDER', 'INR_REMINDER', 'APPOINTMENT_REMINDER', 'CRITICAL_ALERT']
  const now = new Date()
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  // Bound the health scan to a finite recent window so the endpoint never loads
  // the entire historical reminder set for a large tenant.
  const healthWindowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const notifications = tenantUserIds.length
    ? await Notification.find({
      type: { $in: reminderTypes },
      user_id: { $in: tenantUserIds },
      createdAt: { $gte: healthWindowStart },
    }).select('_id type createdAt').lean()
    : []
  const notificationIds = notifications.map(row => row._id)
  const deliveries = notificationIds.length
    ? await NotificationDelivery.find({ notification_id: { $in: notificationIds } })
      .select('status notification_id next_attempt_at')
      .lean()
    : []
  const byStatus: Record<string, number> = {}
  for (const row of deliveries) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1
  const overdue = deliveries.filter(row => (
    ['PENDING', 'QUEUED', 'FAILED_RETRYABLE'].includes(row.status)
    && row.next_attempt_at <= now
  )).length
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Reminder delivery health', {
    scope: 'tenant',
    hospital_id: access.hospitalId,
    reminders_last_24_hours: notifications.filter(row => row.createdAt >= twentyFourHoursAgo).length,
    total_reminders: notifications.length,
    reminder_window_days: 7,
    deliveries_by_status: byStatus,
    overdue_deliveries: overdue,
  }))
})

// ─── Legacy Endpoints ───

export const listAllPatients = asyncHandler(async (req: Request, res: Response) => {
  const { patients } = await adminService.listLegacyPatients(accessContext(req).userId)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'All patients', { patients }))
})

export const getPatientById = asyncHandler(async (req: Request, res: Response) => {
  const { op_num } = req.params
  const result = await adminService.getLegacyPatientByLoginId(op_num, accessContext(req).userId)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Patient found', result))
})

export const getDoctorById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params
  const result = await adminService.getLegacyDoctorById(id, accessContext(req).userId)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Doctor found', result))
})

// ─── Password Reset ───

export const resetUserPassword = asyncHandler(async (req: Request, res: Response) => {
  const { target_user_id, new_password } = req.body
  const adminUserId = accessContext(req).userId
  const result = await adminService.resetUserPassword(adminUserId, target_user_id, new_password)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Password reset successful', result))
})

// ─── HTML Admin Console: Hospitals / Roles / Users / Billing ───

export const getRoles = asyncHandler(async (req: Request, res: Response) => {
  accessContext(req)
  const result = await adminService.getRoles()
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Roles retrieved successfully', result))
})

export const updateRole = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.updateRoleDefinition(req.params.roleKey, req.body, accessContext(req).userId)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Role updated successfully', result))
})

export const listHospitals = asyncHandler(async (req: Request, res: Response) => {
  const { status, search } = (req.validatedQuery ?? req.query) as any
  const result = await adminService.listHospitals({ status, search }, accessContext(req).userId)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Hospitals retrieved successfully', result))
})

export const createHospital = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.createHospital(req.body, accessContext(req).userId)
  res.status(StatusCodes.CREATED).json(new ApiResponse(StatusCodes.CREATED, 'Hospital created successfully', result))
})

export const getHospital = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.listHospitals({}, accessContext(req).userId)
  const hospital = result.hospitals.find((h: any) => h.id === req.params.id || h._id === req.params.id)
  if (!hospital) {
    res.status(StatusCodes.NOT_FOUND).json(new ApiResponse(StatusCodes.NOT_FOUND, 'Hospital not found'))
    return
  }
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Hospital retrieved successfully', { hospital }))
})

export const updateHospital = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.updateHospital(req.params.id, req.body, accessContext(req).userId)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Hospital updated successfully', result))
})

export const updateHospitalStatus = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.setHospitalStatus(req.params.id, req.body.status, accessContext(req).userId)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Hospital status updated successfully', result))
})

export const deleteHospital = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.deleteHospital(req.params.id, accessContext(req).userId)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Hospital deactivated successfully', result))
})

export const listInvoices = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.listInvoices(accessContext(req).userId)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Invoices retrieved successfully', result))
})

export const generateInvoices = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.generateInvoices(req.body, accessContext(req).userId)
  res.status(StatusCodes.CREATED).json(new ApiResponse(StatusCodes.CREATED, 'Invoices generated successfully', result))
})

export const createInvoiceCheckout = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.createCheckout(req.params.invoiceId, accessContext(req).userId)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Checkout session created', result))
})

/** Unauthenticated payment provider webhook — authenticity is HMAC-bound. */
export const paymentWebhook = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body || {}
  const result = await adminService.settleInvoiceFromWebhook({
    session_id: String(body.session_id || body.sessionId || ''),
    invoice_number: String(body.invoice_number || body.invoice || ''),
    amount: body.amount,
    currency: body.currency ? String(body.currency) : undefined,
    signature: String(body.signature || body.sig || req.header('x-payment-signature') || ''),
    provider_event_id: body.provider_event_id ? String(body.provider_event_id) : undefined,
    timestamp: body.timestamp ?? body.ts ?? req.header('x-payment-timestamp') ?? undefined,
  })
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Payment settled', result))
})

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.listUsers(accessContext(req))
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Users retrieved successfully', result))
})

export const inviteUser = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.inviteAdminUser(req.body, accessContext(req))
  res.status(StatusCodes.CREATED).json(new ApiResponse(StatusCodes.CREATED, 'User invited successfully', result))
})

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.updateAdminUser(req.params.id, req.body, accessContext(req))
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'User updated successfully', result))
})

export const resetUserAuthenticator = asyncHandler(async (req: Request, res: Response) => {
  let result
  try {
    result = await adminService.resetAdminAuthenticator(req.params.id, accessContext(req))
  } catch (error) {
    try {
      await AuditLog.create({
        user_id: accessContext(req).userId, user_type: 'ADMIN',
        action: AuditAction.MFA_RESET, description: 'Supervised admin authenticator reset failed',
        resource_type: 'User', resource_id: req.params.id, success: false,
        error_message: 'mfa_reset_failed', ip_address: req.ip || req.socket?.remoteAddress,
        user_agent: req.headers['user-agent'], metadata: { target_user_id: req.params.id },
      })
    } catch { logger.error('MFA reset failure audit persistence failed', { target_user_id: req.params.id }) }
    throw error
  }
  let auditRecorded = true
  try {
    await AuditLog.create({
      user_id: accessContext(req).userId, user_type: 'ADMIN',
      action: AuditAction.MFA_RESET, description: 'Supervised admin authenticator reset completed',
      resource_type: 'User', resource_id: req.params.id, success: true,
      ip_address: req.ip || req.socket?.remoteAddress, user_agent: req.headers['user-agent'],
      metadata: {
        target_user_id: req.params.id, factor_type: result.factor_type,
        invalidated_sessions: result.invalidated_sessions,
        revocation_cleanup_completed: result.revocation_cleanup_completed,
        challenge_cleanup_completed: result.challenge_cleanup_completed,
        user_enrichment_completed: result.user_enrichment_completed,
      },
    })
  } catch {
    auditRecorded = false
    logger.error('MFA reset success audit persistence failed', { target_user_id: req.params.id })
  }
  result.audit_recorded = auditRecorded
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Authenticator reset successfully', result))
})
