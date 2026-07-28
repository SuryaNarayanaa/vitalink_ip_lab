import { Router, type RequestHandler } from 'express'
import { authenticate, authorize, validate } from '@alias/middlewares'
import { UserType } from '@alias/validators'
import auditLogger from '@alias/middlewares/audit.middleware'
import { requireAdminCapability } from '@alias/middlewares/adminPermission.middleware'
import { registerAdminRoute } from '@alias/authorization/admin-route-policy'
import { getCurrentAdminAccess } from '@alias/controllers/admin-access.controller'
import {
  createAdminAccount, listAdminAccounts, resetAdminAccountMfa, updateAdminAccount,
} from '@alias/controllers/admin-account.controller'
import {
  getAdminRolePolicy, getAdminRolePolicyHistory, listAdminRolePolicies,
  previewAdminRolePolicyRestore, previewAdminRolePolicyUpdate,
  restoreAdminRolePolicy, updateAdminRolePolicy,
} from '@alias/controllers/admin-role-policy.controller'
import {
  createDoctor, getAllDoctors, updateDoctor, deactivateDoctor, updateDoctorStatus, resetDoctorCredentials,
  createPatient, getAllPatients, updatePatient, deactivatePatient, updatePatientStatus, resetPatientCredentials,
  reassignPatient, assignPatient, getAuditLogs, getSystemConfig, updateSystemConfig,
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
  reassignPatientSchema, patientAssignmentSchema, doctorStatusSchema, patientStatusSchema,
  operationalCredentialsResetSchema, userIdParamSchema, updateSystemConfigSchema,
  broadcastNotificationSchema, batchOperationSchema, resetPasswordSchema,
  updateAdminUserSchema, createHospitalSchema, updateHospitalSchema,
  updateHospitalStatusSchema, inviteAdminUserSchema, generateInvoicesSchema, invoiceIdParamSchema,
  auditLogsQuerySchema, hospitalListQuerySchema,
  createAdminAccountSchema, updateAdminAccountSchema, resetAdminAccountMfaSchema,
} from '@alias/validators/admin.validator'
import {
  adminRolePolicyHistorySchema, adminRolePolicyParamsSchema,
  previewAdminRolePolicyRestoreSchema, previewAdminRolePolicySchema,
  restoreAdminRolePolicySchema, updateAdminRolePolicySchema,
} from '@alias/validators/admin-role-policy.validator'

const router = Router()

// All admin routes require authentication + ADMIN role, with mutation auditing
// installed before typed route guards and handlers.
router.use(authenticate)
router.use(authorize([UserType.ADMIN]))
router.use(auditLogger)

const requireBatchOperationCapability: RequestHandler = (req, res, next) => {
  const guard = req.body?.operation === 'reset_password'
    ? requireAdminCapability('tenant.credentials.reset')
    : requireAdminCapability('tenant.accounts.status.manage')
  guard(req, res, next)
}

// ─── Effective Access ───
registerAdminRoute(router, {
  method: 'get', path: '/access/me', capability: null, scope: 'self', mutation: false, surface: 'admin',
}, getCurrentAdminAccess)

// ─── V2 Role Policies ───
registerAdminRoute(router, {
  method: 'get', path: '/role-policies', capability: 'platform.role_policy.read', scope: 'global', mutation: false, surface: 'admin',
}, listAdminRolePolicies)
registerAdminRoute(router, {
  method: 'post', path: '/role-policies/:roleKey/preview', capability: 'platform.role_policy.manage', scope: 'global', mutation: true, surface: 'admin',
}, validate(previewAdminRolePolicySchema), previewAdminRolePolicyUpdate)
registerAdminRoute(router, {
  method: 'get', path: '/role-policies/:roleKey/history', capability: 'platform.role_policy.read', scope: 'global', mutation: false, surface: 'admin',
}, validate(adminRolePolicyHistorySchema), getAdminRolePolicyHistory)
registerAdminRoute(router, {
  method: 'post', path: '/role-policies/:roleKey/restore-preview', capability: 'platform.role_policy.manage', scope: 'global', mutation: true, surface: 'admin',
}, validate(previewAdminRolePolicyRestoreSchema), previewAdminRolePolicyRestore)
registerAdminRoute(router, {
  method: 'post', path: '/role-policies/:roleKey/restore', capability: 'platform.role_policy.manage', scope: 'global', mutation: true, surface: 'admin',
}, validate(restoreAdminRolePolicySchema), restoreAdminRolePolicy)
registerAdminRoute(router, {
  method: 'put', path: '/role-policies/:roleKey', capability: 'platform.role_policy.manage', scope: 'global', mutation: true, surface: 'admin',
}, validate(updateAdminRolePolicySchema), updateAdminRolePolicy)
registerAdminRoute(router, {
  method: 'get', path: '/role-policies/:roleKey', capability: 'platform.role_policy.read', scope: 'global', mutation: false, surface: 'admin',
}, validate(adminRolePolicyParamsSchema), getAdminRolePolicy)

// ─── Compatibility Role Endpoints ───
// GET /roles is deprecated: fixed admin roles are projected from V2 policies;
// doctor/patient rows remain legacy catalog metadata. Prefer /role-policies.
// Capability-denied responses use the standard V2 403 body (required_capability,
// policy_version). Clients that only understood manage_* RoleDefinition maps
// must migrate; writes already return 410.
registerAdminRoute(router, {
  method: 'get', path: '/roles', capability: 'platform.role_policy.read', scope: 'global', mutation: false, surface: 'admin',
}, getRoles)
// No body validation: this compatibility write is retired and must return 410
// for any payload (including malformed legacy permissions) so clients migrate
// to /admin/role-policies instead of debugging Zod 400s.
registerAdminRoute(router, {
  method: 'put', path: '/roles/:roleKey', capability: 'platform.role_policy.manage', scope: 'global', mutation: true, surface: 'admin',
}, updateRole)

// ─── Hospitals ───
// App admins list the platform catalog; hospital admins may list only their
// assigned hospital (service-layer tenant filter) so operational dialogs work.
registerAdminRoute(router, {
  method: 'get',
  path: '/hospitals',
  anyOfCapabilities: ['platform.hospitals.read', 'tenant.dashboard.read'],
  scope: 'either',
  mutation: false,
  surface: 'admin',
}, validate(hospitalListQuerySchema), listHospitals)
registerAdminRoute(router, {
  method: 'post', path: '/hospitals', capability: 'platform.hospitals.manage', scope: 'global', mutation: true, surface: 'admin',
}, validate(createHospitalSchema), createHospital)
registerAdminRoute(router, {
  method: 'get',
  path: '/hospitals/:id',
  anyOfCapabilities: ['platform.hospitals.read', 'tenant.dashboard.read'],
  scope: 'either',
  mutation: false,
  surface: 'admin',
}, getHospital)
registerAdminRoute(router, {
  method: 'put', path: '/hospitals/:id', capability: 'platform.hospitals.manage', scope: 'global', mutation: true, surface: 'admin',
}, validate(updateHospitalSchema), updateHospital)
registerAdminRoute(router, {
  method: 'patch', path: '/hospitals/:id/status', capability: 'platform.hospitals.manage', scope: 'global', mutation: true, surface: 'admin',
}, validate(updateHospitalStatusSchema), updateHospitalStatus)
registerAdminRoute(router, {
  method: 'delete', path: '/hospitals/:id', capability: 'platform.hospitals.manage', scope: 'global', mutation: true, surface: 'admin',
}, validate(userIdParamSchema), deleteHospital)

// ─── Billing ───
registerAdminRoute(router, {
  method: 'get', path: '/billing/invoices', anyOfCapabilities: ['platform.billing.read', 'tenant.billing.read'], scope: 'either', mutation: false, surface: 'admin',
}, listInvoices)
registerAdminRoute(router, {
  method: 'post', path: '/billing/invoices', capability: 'platform.billing.manage', scope: 'global', mutation: true, surface: 'admin',
}, validate(generateInvoicesSchema), generateInvoices)
registerAdminRoute(router, {
  method: 'post', path: '/billing/checkout/:invoiceId', capability: 'tenant.billing.checkout', scope: 'tenant', mutation: true, surface: 'admin',
}, validate(invoiceIdParamSchema), createInvoiceCheckout)

// ─── V2 Administrator Accounts ───
registerAdminRoute(router, {
  method: 'get', path: '/admin-accounts', capability: 'platform.admin_accounts.read', scope: 'global', mutation: false, surface: 'admin',
}, listAdminAccounts)
registerAdminRoute(router, {
  method: 'post', path: '/admin-accounts', capability: 'platform.admin_accounts.manage', scope: 'global', mutation: true, surface: 'admin',
}, validate(createAdminAccountSchema), createAdminAccount)
registerAdminRoute(router, {
  method: 'post', path: '/admin-accounts/:id/mfa/reset', capability: 'platform.admin_accounts.manage', scope: 'global', mutation: true, surface: 'admin',
}, validate(resetAdminAccountMfaSchema), resetAdminAccountMfa)
registerAdminRoute(router, {
  method: 'put', path: '/admin-accounts/:id', capability: 'platform.admin_accounts.manage', scope: 'global', mutation: true, surface: 'admin',
}, validate(updateAdminAccountSchema), updateAdminAccount)

// ─── Compatibility Administrator Account Endpoints ───
registerAdminRoute(router, {
  method: 'get', path: '/users', capability: 'platform.admin_accounts.read', scope: 'global', mutation: false, surface: 'admin',
}, listUsers)
registerAdminRoute(router, {
  method: 'post', path: '/users', capability: 'platform.admin_accounts.manage', scope: 'global', mutation: true, surface: 'admin',
}, validate(inviteAdminUserSchema), inviteUser)
registerAdminRoute(router, {
  method: 'post', path: '/users/:id/mfa/reset', capability: 'platform.admin_accounts.manage', scope: 'global', mutation: true, surface: 'admin',
}, validate(userIdParamSchema), resetUserAuthenticator)
registerAdminRoute(router, {
  method: 'put', path: '/users/:id', capability: 'platform.admin_accounts.manage', scope: 'global', mutation: true, surface: 'admin',
}, validate(updateAdminUserSchema), updateUser)

// ─── Doctor Management ───
registerAdminRoute(router, {
  method: 'post', path: '/doctors', capability: 'tenant.doctors.manage', scope: 'tenant', mutation: true, surface: 'admin',
}, validate(createDoctorSchema), createDoctor)
registerAdminRoute(router, {
  method: 'get', path: '/doctors', capability: 'tenant.doctors.read', scope: 'tenant', mutation: false, surface: 'admin',
}, validate(getDoctorsSchema), getAllDoctors)
registerAdminRoute(router, {
  method: 'put', path: '/doctors/:id', capability: 'tenant.doctors.manage', scope: 'tenant', mutation: true, surface: 'admin',
}, validate(updateDoctorSchema), updateDoctor)
registerAdminRoute(router, {
  method: 'patch', path: '/doctors/:id/status', capability: 'tenant.accounts.status.manage', scope: 'tenant', mutation: true, surface: 'admin',
}, validate(doctorStatusSchema), updateDoctorStatus)
registerAdminRoute(router, {
  method: 'post', path: '/doctors/:id/credentials/reset', capability: 'tenant.credentials.reset', scope: 'tenant', mutation: true, surface: 'admin',
}, validate(operationalCredentialsResetSchema), resetDoctorCredentials)
registerAdminRoute(router, {
  method: 'delete', path: '/doctors/:id', capability: 'tenant.accounts.status.manage', scope: 'tenant', mutation: true, surface: 'admin',
}, validate(userIdParamSchema), deactivateDoctor)

// ─── Patient Management ───
registerAdminRoute(router, {
  method: 'post', path: '/patients', capability: 'tenant.patients.manage', scope: 'tenant', mutation: true, surface: 'admin',
}, validate(createPatientSchema), createPatient)
registerAdminRoute(router, {
  method: 'get', path: '/patients', capability: 'tenant.patients.read', scope: 'tenant', mutation: false, surface: 'admin',
}, validate(getUsersSchema), getAllPatients)
registerAdminRoute(router, {
  method: 'put', path: '/patients/:id/assignment', capability: 'tenant.patients.assign', scope: 'tenant', mutation: true, surface: 'admin',
}, validate(patientAssignmentSchema), assignPatient)
registerAdminRoute(router, {
  method: 'put', path: '/patients/:id', capability: 'tenant.patients.manage', scope: 'tenant', mutation: true, surface: 'admin',
}, validate(updatePatientSchema), updatePatient)
registerAdminRoute(router, {
  method: 'patch', path: '/patients/:id/status', capability: 'tenant.accounts.status.manage', scope: 'tenant', mutation: true, surface: 'admin',
}, validate(patientStatusSchema), updatePatientStatus)
registerAdminRoute(router, {
  method: 'post', path: '/patients/:id/credentials/reset', capability: 'tenant.credentials.reset', scope: 'tenant', mutation: true, surface: 'admin',
}, validate(operationalCredentialsResetSchema), resetPatientCredentials)
registerAdminRoute(router, {
  method: 'delete', path: '/patients/:id', capability: 'tenant.accounts.status.manage', scope: 'tenant', mutation: true, surface: 'admin',
}, validate(userIdParamSchema), deactivatePatient)

// ─── Compatibility Patient Reassignment ───
registerAdminRoute(router, {
  method: 'put', path: '/reassign/:op_num', capability: 'tenant.patients.assign', scope: 'tenant', mutation: true, surface: 'admin',
}, validate(reassignPatientSchema), reassignPatient)

// ─── Audit Logs ───
registerAdminRoute(router, {
  method: 'get', path: '/audit-logs', anyOfCapabilities: ['platform.audit.read', 'tenant.audit.read'], scope: 'either', mutation: false, surface: 'admin',
}, validate(auditLogsQuerySchema), getAuditLogs)

// ─── System Config ───
registerAdminRoute(router, {
  method: 'get', path: '/config', capability: 'platform.system_config.read', scope: 'global', mutation: false, surface: 'admin',
}, getSystemConfig)
registerAdminRoute(router, {
  method: 'put', path: '/config', capability: 'platform.system_config.manage', scope: 'global', mutation: true, surface: 'admin',
}, validate(updateSystemConfigSchema), updateSystemConfig)

// ─── Notifications ───
registerAdminRoute(router, {
  method: 'post', path: '/notifications/broadcast', anyOfCapabilities: ['platform.notifications.broadcast', 'tenant.notifications.broadcast'], scope: 'either', mutation: true, surface: 'admin',
}, validate(broadcastNotificationSchema), broadcastNotification)

// ─── Compatibility Batch and Credential Operations ───
registerAdminRoute(router, {
  method: 'post', path: '/users/batch', anyOfCapabilities: ['tenant.accounts.status.manage', 'tenant.credentials.reset'], scope: 'tenant', mutation: true, surface: 'admin',
}, validate(batchOperationSchema), requireBatchOperationCapability, performBatchOperation)
registerAdminRoute(router, {
  method: 'post', path: '/users/reset-password', capability: 'tenant.credentials.reset', scope: 'tenant', mutation: true, surface: 'admin',
}, validate(resetPasswordSchema), resetUserPassword)

// ─── System Health ───
registerAdminRoute(router, {
  method: 'get', path: '/system/health', capability: 'platform.system_health.read', scope: 'global', mutation: false, surface: 'admin',
}, getSystemHealth)
registerAdminRoute(router, {
  method: 'get', path: '/system/reminder-delivery-health', capability: 'tenant.operations_health.read', scope: 'tenant', mutation: false, surface: 'admin',
}, getReminderDeliveryHealth)

// ─── Legacy Read Endpoints ───
registerAdminRoute(router, {
  method: 'get', path: '/legacy/patients', capability: 'tenant.patients.read', scope: 'tenant', mutation: false, surface: 'admin',
}, listAllPatients)
registerAdminRoute(router, {
  method: 'get', path: '/legacy/patient/:op_num', capability: 'tenant.patients.read', scope: 'tenant', mutation: false, surface: 'admin',
}, getPatientById)
registerAdminRoute(router, {
  method: 'get', path: '/legacy/doctor/:id', capability: 'tenant.doctors.read', scope: 'tenant', mutation: false, surface: 'admin',
}, getDoctorById)

export default router
