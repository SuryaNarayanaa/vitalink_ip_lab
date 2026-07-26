import type { NextFunction, Request, Response } from 'express'
import { DEFAULT_ADMIN_ROLE_POLICIES } from '@alias/constants/admin-capabilities'
import { getCurrentAdminAccess } from '@alias/controllers/admin-access.controller'
import { getSystemHealth } from '@alias/controllers/admin.controller'
import {
  listAdminAccounts,
} from '@alias/controllers/admin-account.controller'
import {
  updateAdminRolePolicy,
} from '@alias/controllers/admin-role-policy.controller'
import AdminProfile from '@alias/models/adminprofile.model'
import * as adminAccountService from '@alias/services/admin-account.service'
import * as adminService from '@alias/services/admin.service'
import * as policyService from '@alias/services/admin-role-policy.service'
import type { AdminAccessContext } from '@alias/types/admin-access'
import errorHandler from '@alias/middlewares/errorHandler'
import { ApiError } from '@alias/utils'

function responseMock() {
  const res: any = {
    statusCode: 200,
    headersSent: false,
    status: jest.fn((code: number) => {
      res.statusCode = code
      return res
    }),
    json: jest.fn((body: unknown) => body),
    send: jest.fn((body: unknown) => body),
  }
  return res as Response
}

async function run(handler: any, req: Partial<Request>, res = responseMock()) {
  let forwarded: unknown
  handler(req as Request, res, ((error?: unknown) => { forwarded = error }) as NextFunction)
  await new Promise(resolve => setImmediate(resolve))
  if (forwarded) throw forwarded
  return res as any
}

const appAdminAccess: AdminAccessContext = {
  userId: '507f1f77bcf86cd799439011',
  role: 'app_admin',
  scope: 'global',
  permissions: DEFAULT_ADMIN_ROLE_POLICIES.app_admin,
  policyVersion: 8,
  readOnly: false,
}

const auditorAccess: AdminAccessContext = {
  userId: '507f1f77bcf86cd799439012',
  role: 'auditor',
  scope: 'global',
  permissions: DEFAULT_ADMIN_ROLE_POLICIES.auditor,
  policyVersion: 4,
  readOnly: true,
}

describe('Wave 2 protected administrator controllers', () => {
  afterEach(() => jest.restoreAllMocks())

  test('GET access/me serializes only the attached request snapshot', async () => {
    const res = await run(getCurrentAdminAccess, { adminAccess: auditorAccess })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0].data).toMatchObject({
      schema_version: 2,
      user_id: auditorAccess.userId,
      role: 'auditor',
      scope: 'global',
      hospital: null,
      policy_version: 4,
      read_only: true,
    })
    expect(res.json.mock.calls[0][0].data.effective_capabilities).toContain('platform.audit.read')
  })

  test('admin-account list passes the same access context to lifecycle service', async () => {
    const lifecycle = jest.spyOn(adminAccountService, 'listAdminAccounts').mockResolvedValue({ admin_accounts: [] })
    await run(listAdminAccounts, { adminAccess: appAdminAccess })
    expect(lifecycle).toHaveBeenCalledWith(appAdminAccess)
  })

  test('role-policy update uses the attached actor and transaction audit marker', async () => {
    jest.spyOn(policyService, 'updateAdminRolePolicy').mockResolvedValue({
      roleKey: 'auditor',
      capabilities: DEFAULT_ADMIN_ROLE_POLICIES.auditor,
      protected: false,
      schemaVersion: 2,
      policyVersion: 5,
      updatedBy: appAdminAccess.userId,
      changeReason: 'Reduce auditor access',
      updatedAt: new Date('2026-07-26T00:00:00.000Z'),
    })
    const profileQuery: any = { select: jest.fn(() => profileQuery), lean: jest.fn(async () => []) }
    jest.spyOn(AdminProfile, 'find').mockReturnValue(profileQuery)
    const req: any = {
      adminAccess: appAdminAccess,
      params: { roleKey: 'auditor' },
      body: {
        capabilities: DEFAULT_ADMIN_ROLE_POLICIES.auditor,
        expected_version: 4,
        change_reason: 'Reduce auditor access',
      },
      requestId: 'request-wave-2',
      headers: { 'user-agent': 'jest' },
      socket: {},
    }
    await run(updateAdminRolePolicy, req)
    expect(policyService.updateAdminRolePolicy).toHaveBeenCalledWith(expect.objectContaining({
      roleKey: 'auditor',
      actor: appAdminAccess,
      requestCorrelationId: 'request-wave-2',
    }))
    expect(req.transactionallyAuditedRolePolicyWrite).toBe(true)
  })

  test('global health output exposes status only, not connection topology', async () => {
    jest.spyOn(adminService, 'getSystemHealth').mockResolvedValue({
      status: 'healthy',
      uptime: 123.8,
      database: { state: 'connected', uri: 'mongodb://secret-host/private' },
      timestamp: '2026-07-26T00:00:00.000Z',
    } as any)
    const res = await run(getSystemHealth, { adminAccess: appAdminAccess })
    const data = res.json.mock.calls[0][0].data
    expect(data).toMatchObject({
      status: 'healthy',
      uptime_seconds: 123,
      dependencies: { database: { status: 'available' } },
    })
    expect(JSON.stringify(data)).not.toContain('secret-host')
    expect(JSON.stringify(data)).not.toContain('mongodb://')
  })

  test('error handler emits safe policy version and structured conflict state', () => {
    const req = { adminAccess: appAdminAccess, originalUrl: '/api/admin/role-policies/auditor', method: 'PUT' } as Request
    const forbiddenRes = responseMock() as any
    const denied: any = new ApiError(403, 'Denied')
    denied.requiredCapability = 'platform.role_policy.manage'
    errorHandler(denied, req, forbiddenRes, jest.fn())
    expect(forbiddenRes.json.mock.calls[0][0]).toMatchObject({
      required_capability: 'platform.role_policy.manage',
      policy_version: 8,
    })

    const conflictRes = responseMock() as any
    const conflict = new policyService.AdminRolePolicyConflictError({
      roleKey: 'auditor',
      capabilities: DEFAULT_ADMIN_ROLE_POLICIES.auditor,
      protected: false,
      schemaVersion: 2,
      policyVersion: 9,
      updatedBy: appAdminAccess.userId,
      changeReason: 'Concurrent policy update',
    })
    errorHandler(conflict, req, conflictRes, jest.fn())
    expect(conflictRes.json.mock.calls[0][0]).toMatchObject({
      statusCode: 409,
      conflict: {
        type: 'role_policy_version_conflict',
        current_policy: { role_key: 'auditor', policy_version: 9 },
      },
    })
  })
})
