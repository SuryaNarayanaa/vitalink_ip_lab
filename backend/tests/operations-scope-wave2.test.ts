import type { NextFunction, Request, Response } from 'express'
import { AdminProfile, AuditLog, DoctorProfile, PatientProfile, SystemConfig, User } from '@alias/models'
import { DEFAULT_ADMIN_ROLE_POLICIES } from '@alias/constants/admin-capabilities'
import auditLogger from '@alias/middlewares/audit.middleware'
import { getAdminSystemConfig } from '@alias/services/config.service'
import { resolveBroadcastRecipientIds } from '@alias/services/notification.service'
import type { AdminAccessContext } from '@alias/types/admin-access'

function leanQuery<T>(value: T) {
  const query: any = {
    select: jest.fn(() => query),
    lean: jest.fn(async () => value),
  }
  return query
}

const globalAccess: AdminAccessContext = {
  userId: '507f1f77bcf86cd799439011',
  role: 'app_admin',
  scope: 'global',
  permissions: DEFAULT_ADMIN_ROLE_POLICIES.app_admin,
  policyVersion: 2,
  readOnly: false,
}

const tenantAccess: AdminAccessContext = {
  userId: '507f1f77bcf86cd799439012',
  role: 'hospital_admin',
  scope: 'tenant',
  hospitalId: '507f1f77bcf86cd799439013',
  hospitalCode: 'PSG',
  permissions: DEFAULT_ADMIN_ROLE_POLICIES.hospital_admin,
  policyVersion: 6,
  readOnly: false,
}

describe('Wave 2 operational scope and audit minimization', () => {
  afterEach(() => jest.restoreAllMocks())

  test('global config wrapper is Application Admin-only by access context', async () => {
    const config = { session_timeout_minutes: 30 }
    const find = jest.spyOn(SystemConfig, 'findOne').mockResolvedValue(config as any)
    await expect(getAdminSystemConfig(globalAccess)).resolves.toBe(config)

    const auditor: AdminAccessContext = {
      userId: '507f1f77bcf86cd799439014',
      role: 'auditor',
      scope: 'global',
      permissions: DEFAULT_ADMIN_ROLE_POLICIES.auditor,
      policyVersion: 3,
      readOnly: true,
    }
    await expect(getAdminSystemConfig(auditor)).rejects.toMatchObject({
      statusCode: 403,
      requiredCapability: 'platform.system_config.read',
    })
    expect(find).toHaveBeenCalledTimes(1)
  })

  test('tenant broadcast rejects a specific recipient outside the actor hospital', async () => {
    jest.spyOn(DoctorProfile, 'find').mockReturnValue(leanQuery([{ _id: 'doctor-profile' }]) as any)
    jest.spyOn(PatientProfile, 'find').mockReturnValue(leanQuery([]) as any)
    jest.spyOn(AdminProfile, 'find').mockReturnValue(leanQuery([]) as any)
    jest.spyOn(User, 'find').mockReturnValue(leanQuery([{ _id: 'tenant-user' }]) as any)

    await expect(resolveBroadcastRecipientIds(
      tenantAccess,
      'SPECIFIC',
      ['tenant-user', 'outside-user'],
    )).rejects.toMatchObject({
      statusCode: 403,
      requiredCapability: 'tenant.notifications.broadcast',
    })
  })

  test('global broadcast recipient resolution does not add a tenant filter', async () => {
    const find = jest.spyOn(User, 'find').mockReturnValue(leanQuery([{ _id: 'user-1' }]) as any)
    await expect(resolveBroadcastRecipientIds(globalAccess, 'ALL')).resolves.toEqual(['user-1'])
    expect(find).toHaveBeenCalledWith({ is_active: true })
  })

  test('broadcast audit metadata excludes free text and recipient identifiers', async () => {
    const create = jest.spyOn(AuditLog, 'create').mockResolvedValue({} as any)
    const originalSend = jest.fn()
    const req = {
      method: 'POST',
      originalUrl: '/api/admin/notifications/broadcast',
      body: {
        title: 'Sensitive title',
        message: 'Sensitive free text',
        user_ids: ['patient-id'],
        target: 'SPECIFIC',
        priority: 'HIGH',
      },
      params: {},
      headers: {},
      socket: {},
      user: { user_id: globalAccess.userId, user_type: 'ADMIN' },
    } as unknown as Request
    const res = {
      send: originalSend,
      statusCode: 200,
      headersSent: false,
    } as unknown as Response

    auditLogger(req, res, jest.fn())
    await (res.send as any)({ success: true })

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'NOTIFICATION_BROADCAST',
      new_data: { target: 'SPECIFIC', priority: 'HIGH' },
    }))
    expect(JSON.stringify(create.mock.calls[0][0])).not.toContain('Sensitive')
    expect(JSON.stringify(create.mock.calls[0][0])).not.toContain('patient-id')
  })

  test('Doctor and Patient audit rows minimize credentials, MFA, contact data, and PHI', async () => {
    const create = jest.spyOn(AuditLog, 'create').mockResolvedValue({} as any)
    const originalSend = jest.fn()
    const req = {
      method: 'POST',
      originalUrl: '/api/admin/patients',
      body: {
        login_id: 'PAT-AUDIT-MIN',
        assigned_doctor_id: 'DOC-AUDIT-MIN',
        password: 'NeverPersist1!',
        new_password: 'NeverPersist2!',
        admin_mfa: { totp_secret: 'SECRET' },
        demographics: {
          name: 'Sensitive Patient Name',
          phone: '+919000000001',
          next_of_kin: { name: 'Sensitive Relative', phone: '+919000000002' },
        },
        medical_config: {
          diagnosis: 'Sensitive diagnosis',
          therapy_drug: 'Sensitive drug',
          target_inr: { min: 2, max: 3 },
        },
      },
      params: {},
      headers: { authorization: 'Bearer secret-token' },
      socket: {},
      user: { user_id: tenantAccess.userId, user_type: 'ADMIN' },
    } as unknown as Request
    const res = {
      send: originalSend,
      statusCode: 400,
      headersSent: false,
    } as unknown as Response

    auditLogger(req, res, jest.fn())
    await (res.send as any)({ message: 'Validation failed for Sensitive Patient Name and NeverPersist1!' })

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'USER_CREATE',
      new_data: {
        login_id: 'PAT-AUDIT-MIN',
        assigned_doctor_id: 'DOC-AUDIT-MIN',
      },
      success: false,
    }))
    const serialized = JSON.stringify(create.mock.calls[0][0])
    for (const forbidden of [
      'NeverPersist', 'SECRET', 'secret-token', 'Sensitive Patient',
      'Sensitive Relative', 'Sensitive diagnosis', 'Sensitive drug', '+919',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  test.each([
    ['PATCH', '/api/admin/doctors/doctor-1/status', { is_active: false }, 'USER_DEACTIVATE'],
    ['POST', '/api/admin/doctors/doctor-1/credentials/reset', { new_password: 'NeverAudit1!' }, 'PASSWORD_RESET'],
    ['PATCH', '/api/admin/patients/patient-1/status', { account_status: 'Discharged' }, 'USER_DEACTIVATE'],
    ['POST', '/api/admin/patients/patient-1/credentials/reset', { new_password: 'NeverAudit2!' }, 'PASSWORD_RESET'],
  ])('classifies %s %s as the dedicated lifecycle audit action', async (method, originalUrl, body, action) => {
    const create = jest.spyOn(AuditLog, 'create').mockResolvedValue({} as any)
    const originalSend = jest.fn()
    const req = {
      method,
      originalUrl,
      body,
      params: { id: originalUrl.includes('patients') ? 'patient-1' : 'doctor-1' },
      headers: {},
      socket: {},
      user: { user_id: tenantAccess.userId, user_type: 'ADMIN' },
    } as unknown as Request
    const res = { send: originalSend, statusCode: 200, headersSent: false } as unknown as Response

    auditLogger(req, res, jest.fn())
    await (res.send as any)({ success: true })

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ action }))
    expect(JSON.stringify(create.mock.calls[0][0])).not.toContain('NeverAudit')
  })

  test('transactionally audited role-policy writes skip generic audit middleware rows', () => {
    const create = jest.spyOn(AuditLog, 'create')
    const originalSend = jest.fn()
    const req = {
      method: 'PUT',
      originalUrl: '/api/admin/role-policies/auditor',
      body: {
        capabilities: DEFAULT_ADMIN_ROLE_POLICIES.auditor,
        change_reason: 'Reviewed access',
      },
      user: { user_id: globalAccess.userId, user_type: 'ADMIN' },
      transactionallyAuditedRolePolicyWrite: true,
    } as unknown as Request
    const res = {
      send: originalSend,
      statusCode: 200,
      headersSent: false,
    } as unknown as Response
    const next = jest.fn() as NextFunction

    auditLogger(req, res, next)
    res.send?.({ success: true })

    expect(next).toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(originalSend).toHaveBeenCalledWith({ success: true })
  })
})
