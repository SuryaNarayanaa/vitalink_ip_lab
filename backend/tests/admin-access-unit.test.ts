import type { NextFunction, Request, Response } from 'express'
import {
  ADMIN_ROLE_CAPABILITY_ALLOWLISTS,
  DEFAULT_ADMIN_ROLE_POLICIES,
  PLATFORM_ADMIN_CAPABILITIES,
  TENANT_ADMIN_CAPABILITIES,
  createRoleCapabilityMap,
  isMutationAdminCapability,
  isReadAdminCapability,
  normalizeAdminCapabilityMap,
  translateLegacyAdminPermissions,
} from '@alias/constants/admin-capabilities'
import { buildAdminAccessContext } from '@alias/services/admin-access.service'
import {
  requireAdminCapability,
  requireAdminMutation,
  requireGlobalAdminScope,
  requireTenantAdminScope,
} from '@alias/middlewares/adminPermission.middleware'
import { defineAdminRoutePolicy } from '@alias/authorization/admin-route-policy'

function policy(roleKey: 'app_admin' | 'hospital_admin' | 'auditor', capabilities = DEFAULT_ADMIN_ROLE_POLICIES[roleKey]) {
  return {
    roleKey,
    capabilities,
    protected: roleKey === 'app_admin',
    schemaVersion: 2 as const,
    policyVersion: 4,
    updatedBy: '507f1f77bcf86cd799439011',
    changeReason: 'Unit test policy',
  }
}

function responseMock() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as Response
  ;(res.status as jest.Mock).mockReturnValue(res)
  return res
}

describe('canonical administrator capabilities', () => {
  test('freezes the platform, tenant, and auditor role decisions', () => {
    expect(PLATFORM_ADMIN_CAPABILITIES).toHaveLength(14)
    expect(TENANT_ADMIN_CAPABILITIES).toHaveLength(14)
    expect(ADMIN_ROLE_CAPABILITY_ALLOWLISTS.app_admin).toEqual(PLATFORM_ADMIN_CAPABILITIES)
    expect(ADMIN_ROLE_CAPABILITY_ALLOWLISTS.hospital_admin).toEqual(TENANT_ADMIN_CAPABILITIES)
    expect(ADMIN_ROLE_CAPABILITY_ALLOWLISTS.auditor).toEqual([
      'platform.hospitals.read',
      'platform.role_policy.read',
      'platform.audit.read',
      'platform.analytics.read',
      'platform.billing.read',
      'platform.system_health.read',
    ])
    expect(Object.values(DEFAULT_ADMIN_ROLE_POLICIES.app_admin).every(Boolean)).toBe(true)
    expect(Object.keys(DEFAULT_ADMIN_ROLE_POLICIES.app_admin).some(key => key.startsWith('tenant.'))).toBe(false)
  })

  test('classifies reads and mutations explicitly', () => {
    expect(isReadAdminCapability('platform.audit.read')).toBe(true)
    expect(isReadAdminCapability('tenant.operations_health.read')).toBe(true)
    expect(isMutationAdminCapability('platform.role_policy.manage')).toBe(true)
    expect(isMutationAdminCapability('tenant.billing.checkout')).toBe(true)
  })

  test('requires a complete role allowlist map and protects App Admin recovery', () => {
    expect(() => normalizeAdminCapabilityMap('hospital_admin', {
      ...DEFAULT_ADMIN_ROLE_POLICIES.hospital_admin,
      'platform.hospitals.read': true,
    })).toThrow(/Unsupported capabilities/)
    expect(() => normalizeAdminCapabilityMap('auditor', {
      'platform.audit.read': true,
    })).toThrow(/Missing capabilities/)
    expect(() => normalizeAdminCapabilityMap('app_admin', {
      ...DEFAULT_ADMIN_ROLE_POLICIES.app_admin,
      'platform.role_policy.manage': false,
    })).toThrow(/cannot be disabled/)
  })

  test('translates legacy permissions conservatively', () => {
    const hospital = translateLegacyAdminPermissions('hospital_admin', {
      manage_users: true,
      manage_doctors: true,
      manage_patients: true,
      manage_billing: true,
      manage_system: true,
      export_data: true,
    })
    expect(hospital['tenant.credentials.reset']).toBe(true)
    expect(hospital['tenant.doctors.manage']).toBe(true)
    expect(hospital['tenant.patients.manage']).toBe(true)
    expect(hospital['tenant.billing.checkout']).toBe(true)
    expect(hospital['tenant.notifications.broadcast']).toBe(true)
    expect(hospital['tenant.patients.assign']).toBe(false)
    expect(hospital['tenant.accounts.status.manage']).toBe(false)
    expect(hospital['tenant.analytics.read']).toBe(false)

    const auditor = translateLegacyAdminPermissions('auditor', {
      manage_hospitals: true,
      manage_roles: true,
      view_audit: true,
      manage_billing: true,
      manage_system: true,
      manage_users: true,
      export_data: true,
    })
    expect(auditor['platform.hospitals.read']).toBe(true)
    expect(auditor['platform.role_policy.read']).toBe(true)
    expect(auditor['platform.audit.read']).toBe(true)
    expect(auditor['platform.billing.read']).toBe(true)
    expect(auditor['platform.system_health.read']).toBe(true)
    expect(auditor['platform.analytics.read']).toBe(false)
    expect(Object.keys(auditor).some(key => key.endsWith('.manage'))).toBe(false)
  })
})

describe('administrator access context', () => {
  test('builds one-hospital tenant context only for an active hospital', () => {
    const context = buildAdminAccessContext({
      user: { _id: 'user-1', user_type: 'ADMIN', profile_id: 'profile-1', is_active: true },
      profile: { _id: 'profile-1', admin_role: 'hospital_admin', hospital_id: 'hospital-1' },
      hospital: { _id: 'hospital-1', code: 'PSG', status: 'active' },
      policy: policy('hospital_admin'),
    })
    expect(context).toMatchObject({
      userId: 'user-1',
      role: 'hospital_admin',
      scope: 'tenant',
      hospitalId: 'hospital-1',
      hospitalCode: 'PSG',
      policyVersion: 4,
      readOnly: false,
    })
  })

  test('fails closed for disabled accounts and invalid role/scope combinations', () => {
    expect(() => buildAdminAccessContext({
      user: { _id: 'user-1', user_type: 'ADMIN', profile_id: 'profile-1', is_active: false },
      profile: { admin_role: 'app_admin' },
      policy: policy('app_admin'),
    })).toThrow(/active administrator/)

    expect(() => buildAdminAccessContext({
      user: { _id: 'user-2', user_type: 'ADMIN', profile_id: 'profile-2', is_active: true },
      profile: { admin_role: 'hospital_admin', hospital_id: 'hospital-1' },
      hospital: { _id: 'hospital-1', code: 'PSG', status: 'suspended' },
      policy: policy('hospital_admin'),
    })).toThrow(/one active hospital/)

    expect(() => buildAdminAccessContext({
      user: { _id: 'user-3', user_type: 'ADMIN', profile_id: 'profile-3', is_active: true },
      profile: { admin_role: 'auditor', hospital_id: 'hospital-1' },
      policy: policy('auditor'),
    })).toThrow(/must not be assigned/)
  })

  test('forces auditors into global read-only context', () => {
    const context = buildAdminAccessContext({
      user: { _id: 'user-4', user_type: 'ADMIN', profile_id: 'profile-4', is_active: true },
      profile: { admin_role: 'auditor' },
      policy: policy('auditor', createRoleCapabilityMap('auditor', ['platform.audit.read'])),
    })
    expect(context.scope).toBe('global')
    expect(context.readOnly).toBe(true)
    expect(context.permissions['platform.audit.read']).toBe(true)
  })
})

describe('typed administrator guards', () => {
  test('supports explicit capability-free metadata only for administrator self-service', () => {
    expect(defineAdminRoutePolicy({
      method: 'get',
      path: '/access/me',
      capability: null,
      scope: 'self',
      mutation: false,
      surface: 'admin',
    })).toMatchObject({ capability: null, scope: 'self' })
    expect(() => defineAdminRoutePolicy({
      method: 'get',
      path: '/unsafe',
      scope: 'either',
      mutation: false,
      surface: 'admin',
    })).toThrow(/declare exactly one capability/)
  })

  test('requires capability and scope from the attached request snapshot', () => {
    const req = {
      adminAccess: buildAdminAccessContext({
        user: { _id: 'user-5', user_type: 'ADMIN', profile_id: 'profile-5', is_active: true },
        profile: { admin_role: 'hospital_admin', hospital_id: 'hospital-1' },
        hospital: { _id: 'hospital-1', code: 'PSG', status: 'active' },
        policy: policy('hospital_admin'),
      }),
    } as Request
    const next = jest.fn() as NextFunction

    requireAdminCapability('tenant.doctors.read')(req, responseMock(), next)
    requireTenantAdminScope()(req, responseMock(), next)
    expect(next).toHaveBeenCalledTimes(2)

    const denied = responseMock()
    const nextCallsBeforeDeny = (next as jest.Mock).mock.calls.length
    requireGlobalAdminScope()(req, denied, next)
    expect(denied.status).toHaveBeenCalledWith(403)
    // Ensure the guard fails closed and does not continue the chain.
    expect((next as jest.Mock).mock.calls.length).toBe(nextCallsBeforeDeny)
  })

  test('hard-denies Auditor mutations even if a malformed context claims mutation access', () => {
    const req = {
      adminAccess: {
        userId: 'user-6',
        role: 'auditor',
        scope: 'global',
        permissions: { 'platform.role_policy.manage': true },
        policyVersion: 9,
        readOnly: false,
      },
    } as Request
    const res = responseMock()
    const next = jest.fn()
    requireAdminMutation()(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()
  })
})
