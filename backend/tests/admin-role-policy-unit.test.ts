import mongoose from 'mongoose'
import {
  DEFAULT_ADMIN_ROLE_POLICIES,
  createRoleCapabilityMap,
} from '@alias/constants/admin-capabilities'
import AdminRolePolicy from '@alias/models/adminrolepolicy.model'
import AdminRolePolicyRevision from '@alias/models/adminrolepolicyrevision.model'
import AdminProfile from '@alias/models/adminprofile.model'
import AuditLog from '@alias/models/auditlog.model'
import User from '@alias/models/user.model'
import {
  AdminRolePolicyConflictError,
  clearAdminRolePolicyCacheForTests,
  diffAdminCapabilityMaps,
  getAdminRolePolicy,
  updateAdminRolePolicy,
} from '@alias/services/admin-role-policy.service'
import {
  parseAdminRbacV2MigrationArgs,
  runAdminRbacV2Migration,
  type AdminRbacV2MigrationAdapter,
} from '@alias/scripts/migrateAdminRbacV2'
import {
  previewAdminRolePolicySchema,
  restoreAdminRolePolicySchema,
  updateAdminRolePolicySchema,
} from '@alias/validators/admin-role-policy.validator'

const actorId = '507f1f77bcf86cd799439011'
const policyId = '507f1f77bcf86cd799439012'

function policyDocument(overrides: Record<string, unknown> = {}) {
  return {
    _id: policyId,
    role_key: 'hospital_admin',
    capabilities: DEFAULT_ADMIN_ROLE_POLICIES.hospital_admin,
    protected: false,
    schema_version: 2,
    policy_version: 3,
    updated_by: actorId,
    change_reason: 'Previous reviewed policy',
    updatedAt: new Date('2026-07-26T00:00:00.000Z'),
    ...overrides,
  }
}

function awaitable<T>(value: T) {
  const query: any = {
    session: jest.fn(() => query),
    then: (resolve: (value: T) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(value).then(resolve, reject),
  }
  return query
}

function findLeanQuery<T>(value: T) {
  const query: any = {
    select: jest.fn(() => query),
    session: jest.fn(() => query),
    lean: jest.fn(async () => value),
  }
  return query
}

describe('strict V2 administrator policy models', () => {
  test('accepts complete supported maps and rejects incomplete maps', async () => {
    const valid = new AdminRolePolicy({
      role_key: 'hospital_admin',
      capabilities: DEFAULT_ADMIN_ROLE_POLICIES.hospital_admin,
      protected: false,
      schema_version: 2,
      policy_version: 1,
      updated_by: new mongoose.Types.ObjectId(actorId),
      change_reason: 'Initial reviewed policy',
    })
    await expect(valid.validate()).resolves.toBeUndefined()

    const invalid = new AdminRolePolicy({
      role_key: 'auditor',
      capabilities: { 'platform.audit.read': true },
      protected: false,
      schema_version: 2,
      policy_version: 1,
      updated_by: new mongoose.Types.ObjectId(actorId),
      change_reason: 'Incomplete policy',
    })
    await expect(invalid.validate()).rejects.toThrow(/Missing capabilities/)
  })

  test('protects App Admin policy and enforces monotonic revision versions', async () => {
    const appPolicy = new AdminRolePolicy({
      role_key: 'app_admin',
      capabilities: DEFAULT_ADMIN_ROLE_POLICIES.app_admin,
      protected: false,
      schema_version: 2,
      policy_version: 1,
      updated_by: new mongoose.Types.ObjectId(actorId),
      change_reason: 'Invalid recovery policy',
    })
    await expect(appPolicy.validate()).rejects.toThrow(/must remain protected/)

    const revision = new AdminRolePolicyRevision({
      role_key: 'hospital_admin',
      previous_capabilities: DEFAULT_ADMIN_ROLE_POLICIES.hospital_admin,
      new_capabilities: createRoleCapabilityMap('hospital_admin', ['tenant.doctors.read']),
      previous_policy_version: 2,
      new_policy_version: 4,
      actor_user_id: new mongoose.Types.ObjectId(actorId),
      actor_role: 'app_admin',
      change_reason: 'Invalid version jump',
      affected_active_account_count: 2,
      request_correlation_id: 'request-1',
    })
    await expect(revision.validate()).rejects.toThrow(/increment the previous version by one/)
  })
})

describe('role-policy validation and diffs', () => {
  test('computes deterministic added and removed capability sets', () => {
    const current = createRoleCapabilityMap('auditor', ['platform.audit.read'])
    const proposed = createRoleCapabilityMap('auditor', ['platform.billing.read'])
    expect(diffAdminCapabilityMaps('auditor', current, proposed)).toMatchObject({
      added: ['platform.billing.read'],
      removed: ['platform.audit.read'],
    })
  })

  test('requires complete maps, expected versions, reasons, and valid restore IDs', () => {
    expect(previewAdminRolePolicySchema.safeParse({
      params: { roleKey: 'auditor' },
      body: { capabilities: { 'platform.audit.read': true } },
    }).success).toBe(false)

    expect(updateAdminRolePolicySchema.safeParse({
      params: { roleKey: 'auditor' },
      body: {
        capabilities: DEFAULT_ADMIN_ROLE_POLICIES.auditor,
        expected_version: 2,
        change_reason: 'Remove unneeded access',
      },
    }).success).toBe(true)

    expect(restoreAdminRolePolicySchema.safeParse({
      params: { roleKey: 'hospital_admin' },
      body: { revision_id: 'not-an-object-id', expected_version: 2, change_reason: 'Restore policy' },
    }).success).toBe(false)
  })
})

describe('transactional policy update foundation', () => {
  afterEach(() => {
    clearAdminRolePolicyCacheForTests()
    jest.restoreAllMocks()
  })

  test('writes policy, revision, and authoritative audit event in one transaction', async () => {
    const current = policyDocument()
    const nextCapabilities = createRoleCapabilityMap('hospital_admin', [
      'tenant.dashboard.read',
      'tenant.doctors.read',
    ])
    jest.spyOn(AdminRolePolicy, 'findOne').mockReturnValue(awaitable(current) as any)
    jest.spyOn(AdminProfile, 'find').mockReturnValue(findLeanQuery([]) as any)
    jest.spyOn(User, 'countDocuments').mockReturnValue(awaitable(0) as any)
    const update = jest.spyOn(AdminRolePolicy, 'findOneAndUpdate').mockResolvedValue(policyDocument({
      capabilities: nextCapabilities,
      policy_version: 4,
      updated_by: actorId,
      change_reason: 'Reduce tenant access',
    }) as any)
    const revisionCreate = jest.spyOn(AdminRolePolicyRevision, 'create').mockResolvedValue([] as any)
    const auditCreate = jest.spyOn(AuditLog, 'create').mockResolvedValue([] as any)
    const session = {
      withTransaction: jest.fn(async (work: () => Promise<void>) => work()),
      endSession: jest.fn(async () => undefined),
    }
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as any)

    const result = await updateAdminRolePolicy({
      roleKey: 'hospital_admin',
      capabilities: nextCapabilities,
      expectedVersion: 3,
      changeReason: 'Reduce tenant access',
      actor: {
        userId: actorId,
        role: 'app_admin',
        scope: 'global',
        readOnly: false,
        permissions: DEFAULT_ADMIN_ROLE_POLICIES.app_admin,
      },
      requestCorrelationId: 'request-123',
    })

    expect(result.policyVersion).toBe(4)
    expect(session.withTransaction).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][0]).toEqual({ role_key: 'hospital_admin', policy_version: 3 })
    expect(update.mock.calls[0][2]).toMatchObject({ session, runValidators: true })
    expect(revisionCreate.mock.calls[0][1]).toEqual({ session })
    expect(auditCreate.mock.calls[0][0][0]).toMatchObject({
      action: 'ROLE_POLICY_UPDATE',
      metadata: { event_type: 'ROLE_POLICY_UPDATE', request_correlation_id: 'request-123' },
    })
    expect(auditCreate.mock.calls[0][1]).toEqual({ session })
    expect(session.endSession).toHaveBeenCalledTimes(1)
  })

  test('fails closed on a missing policy and returns current policy on version conflict', async () => {
    jest.spyOn(AdminRolePolicy, 'findOne').mockReturnValueOnce(awaitable(null) as any)
    await expect(getAdminRolePolicy('auditor')).rejects.toMatchObject({ statusCode: 403 })
    jest.restoreAllMocks()

    jest.spyOn(AdminRolePolicy, 'findOne').mockReturnValue(awaitable(policyDocument()) as any)
    const update = jest.spyOn(AdminRolePolicy, 'findOneAndUpdate')
    const session = {
      withTransaction: jest.fn(async (work: () => Promise<void>) => work()),
      endSession: jest.fn(async () => undefined),
    }
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as any)

    await expect(updateAdminRolePolicy({
      roleKey: 'hospital_admin',
      capabilities: DEFAULT_ADMIN_ROLE_POLICIES.hospital_admin,
      expectedVersion: 2,
      changeReason: 'Stale client update',
      actor: {
        userId: actorId,
        role: 'app_admin',
        scope: 'global',
        readOnly: false,
        permissions: DEFAULT_ADMIN_ROLE_POLICIES.app_admin,
      },
      requestCorrelationId: 'request-456',
    })).rejects.toEqual(expect.objectContaining({
      statusCode: 409,
      currentPolicy: expect.objectContaining({ policyVersion: 3 }),
    } satisfies Partial<AdminRolePolicyConflictError>))
    expect(update).not.toHaveBeenCalled()
    expect(session.endSession).toHaveBeenCalledTimes(1)
  })
})

describe('dry-run-first RBAC migration skeleton', () => {
  test('is import-safe, defaults to dry-run, reports anomalies, and never writes during preview', async () => {
    expect(parseAdminRbacV2MigrationArgs([])).toMatchObject({ execute: false, verify: false })
    expect(() => parseAdminRbacV2MigrationArgs(['--execute', '--verify'])).toThrow(/Choose only one mode/)

    const insertPolicies = jest.fn(async () => undefined)
    const adapter: AdminRbacV2MigrationAdapter = {
      listLegacyRoleDefinitions: async () => [{
        role_key: 'hospital_admin',
        permissions: { manage_doctors: true, export_data: true, unsupported_key: true },
      }],
      listAdminAccounts: async () => [
        { userId: actorId, role: 'app_admin', active: true },
        { userId: 'hospital-admin-1', role: 'hospital_admin', active: true },
        { userId: 'auditor-1', role: 'auditor', hospitalId: 'hospital-1', active: true },
      ],
      listHospitals: async () => [{ id: 'hospital-1', status: 'active' }],
      listExistingPolicies: async () => [],
      insertPolicies,
    }

    const report = await runAdminRbacV2Migration({ adapter })
    expect(report.mode).toBe('dry-run')
    expect(report.sourceSnapshotHash).toMatch(/^[a-f\d]{64}$/)
    expect(report.unsupportedLegacyKeys.hospital_admin).toEqual(['unsupported_key'])
    expect(report.tenantlessHospitalAdmins).toEqual(['hospital-admin-1'])
    expect(report.auditorsWithHospital).toEqual(['auditor-1'])
    expect(report.proposedPolicies.hospital_admin['tenant.doctors.read']).toBe(true)
    // manage_doctors alone still enables status + analytics operational parity.
    expect(report.proposedPolicies.hospital_admin['tenant.accounts.status.manage']).toBe(true)
    expect(report.proposedPolicies.hospital_admin['tenant.analytics.read']).toBe(true)
    // assign requires manage_patients in the legacy map.
    expect(report.proposedPolicies.hospital_admin['tenant.patients.assign']).toBe(false)
    expect(report.documents.wouldAdd).toEqual(['app_admin', 'hospital_admin', 'auditor'])
    expect(report.blockers.length).toBeGreaterThan(0)
    expect(insertPolicies).not.toHaveBeenCalled()
  })

  test('verify mode validates a complete additive state without writing', async () => {
    const insertPolicies = jest.fn(async () => undefined)
    const adapter: AdminRbacV2MigrationAdapter = {
      listLegacyRoleDefinitions: async () => [
        { role_key: 'app_admin', permissions: {} },
        { role_key: 'hospital_admin', permissions: { manage_doctors: true } },
        { role_key: 'auditor', permissions: { view_audit: true } },
      ],
      listAdminAccounts: async () => [
        { userId: actorId, role: 'app_admin', active: true },
        { userId: 'hospital-admin-1', role: 'hospital_admin', hospitalId: 'hospital-1', active: true },
        { userId: 'auditor-1', role: 'auditor', active: true },
      ],
      listHospitals: async () => [{ id: 'hospital-1', status: 'active' }],
      listExistingPolicies: async () => (['app_admin', 'hospital_admin', 'auditor'] as const).map(roleKey => ({
        roleKey,
        capabilities: DEFAULT_ADMIN_ROLE_POLICIES[roleKey],
        protected: roleKey === 'app_admin',
        schemaVersion: 2,
        policyVersion: 1,
      })),
      insertPolicies,
    }

    const report = await runAdminRbacV2Migration({ adapter, verify: true })
    expect(report).toMatchObject({
      mode: 'verify',
      verificationPassed: true,
      blockers: [],
      documents: { wouldAdd: [], added: [] },
    })
    expect(insertPolicies).not.toHaveBeenCalled()
  })
})
