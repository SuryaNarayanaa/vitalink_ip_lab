import mongoose from 'mongoose'
import {
  DEFAULT_ADMIN_ROLE_POLICIES,
  createRoleCapabilityMap,
} from '@alias/constants/admin-capabilities'
import AdminRolePolicy from '@alias/models/adminrolepolicy.model'
import AdminRolePolicyRevision from '@alias/models/adminrolepolicyrevision.model'
import AuditLog from '@alias/models/auditlog.model'
import { resolveAdminAccessContext } from '@alias/services/admin-access.service'
import {
  getAdminRolePolicyHistory,
  previewAdminRolePolicyRestore,
  restoreAdminRolePolicy,
  updateAdminRolePolicy,
} from '@alias/services/admin-role-policy.service'
import type { AdminAccessContext } from '@alias/types/admin-access'
import { createAdminRbacFixtures } from './setup/admin-rbac-fixtures'
import {
  assertTransactionCapability,
  startMongoReplicaSet,
  type MongoReplicaSetHarness,
} from './setup/mongo-replica-set'

jest.setTimeout(180_000)

describe('RBAC V2 policy transaction integration', () => {
  let harness: MongoReplicaSetHarness

  beforeAll(async () => {
    harness = await startMongoReplicaSet({ databaseName: 'admin_role_policy_integration' })
    await mongoose.connect(harness.uri)
    await assertTransactionCapability(mongoose.connection)
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    if (mongoose.connection.db) await mongoose.connection.db.dropDatabase()
  })

  afterAll(async () => {
    await mongoose.disconnect().catch(() => undefined)
    await harness?.stop().catch(() => undefined)
  })

  test('enforces updates immediately and restores history through CAS with atomic audit', async () => {
    const fixtures = await createAdminRbacFixtures({
      namespace: 'policy_txn',
      persistPolicies: true,
    })
    await AdminRolePolicyRevision.deleteMany({})

    const actor: AdminAccessContext = {
      userId: String(fixtures.admins.appAdmin.user._id),
      role: 'app_admin',
      scope: 'global',
      permissions: DEFAULT_ADMIN_ROLE_POLICIES.app_admin,
      policyVersion: 1,
      readOnly: false,
    }
    const mutationBase = {
      roleKey: 'hospital_admin' as const,
      actor,
      ipAddress: '127.0.0.1',
      userAgent: 'jest-policy-integration',
    }
    const dashboardOnly = createRoleCapabilityMap('hospital_admin', ['tenant.dashboard.read'])
    const doctorsReadOnly = createRoleCapabilityMap('hospital_admin', [
      'tenant.dashboard.read',
      'tenant.doctors.read',
    ])

    const first = await updateAdminRolePolicy({
      ...mutationBase,
      capabilities: dashboardOnly,
      expectedVersion: 1,
      changeReason: 'Restrict tenant policy for verification',
      requestCorrelationId: 'policy-integration-update-1',
    })
    expect(first.policyVersion).toBe(2)

    const nextRequestContext = await resolveAdminAccessContext(
      String(fixtures.admins.hospitalAdmin.user._id),
    )
    expect(nextRequestContext.policyVersion).toBe(2)
    expect(nextRequestContext.permissions['tenant.dashboard.read']).toBe(true)
    expect(nextRequestContext.permissions['tenant.doctors.read']).toBe(false)

    const second = await updateAdminRolePolicy({
      ...mutationBase,
      capabilities: doctorsReadOnly,
      expectedVersion: 2,
      changeReason: 'Enable reviewed doctor read access',
      requestCorrelationId: 'policy-integration-update-2',
    })
    expect(second.policyVersion).toBe(3)

    const history = await getAdminRolePolicyHistory({ roleKey: 'hospital_admin' })
    expect(history.map((revision: any) => revision.new_policy_version)).toEqual([3, 2])
    const versionTwoRevision = history.find((revision: any) => revision.new_policy_version === 2)
    expect(versionTwoRevision).toBeDefined()

    const preview = await previewAdminRolePolicyRestore({
      roleKey: 'hospital_admin',
      revisionId: String(versionTwoRevision!._id),
      expectedVersion: 3,
    })
    expect(preview).toMatchObject({
      currentVersion: 3,
      sourcePolicyVersion: 2,
      sourceRevisionId: String(versionTwoRevision!._id),
      removed: ['tenant.doctors.read'],
    })

    await expect(restoreAdminRolePolicy({
      ...mutationBase,
      revisionId: String(versionTwoRevision!._id),
      expectedVersion: 2,
      changeReason: 'Stale restore must not commit',
      requestCorrelationId: 'policy-integration-stale-restore',
    })).rejects.toMatchObject({ statusCode: 409 })

    const restored = await restoreAdminRolePolicy({
      ...mutationBase,
      revisionId: String(versionTwoRevision!._id),
      expectedVersion: 3,
      changeReason: 'Restore the reviewed restricted tenant policy',
      requestCorrelationId: 'policy-integration-restore',
    })
    expect(restored.policyVersion).toBe(4)
    expect(restored.capabilities).toEqual(dashboardOnly)

    const restoreRevision = await AdminRolePolicyRevision.findOne({
      role_key: 'hospital_admin',
      new_policy_version: 4,
    }).lean()
    expect(String(restoreRevision?.restored_from_revision_id)).toBe(String(versionTwoRevision!._id))
    const restoreAudit = await AuditLog.findOne({
      action: 'ROLE_POLICY_UPDATE',
      'metadata.request_correlation_id': 'policy-integration-restore',
    }).lean()
    expect(restoreAudit).toMatchObject({
      success: true,
      metadata: {
        affected_active_account_count: 1,
        restored_from_revision_id: String(versionTwoRevision!._id),
      },
    })

    const beforeRollback = {
      policy: await AdminRolePolicy.findOne({ role_key: 'hospital_admin' }).lean(),
      revisions: await AdminRolePolicyRevision.countDocuments({ role_key: 'hospital_admin' }),
      audits: await AuditLog.countDocuments({ action: 'ROLE_POLICY_UPDATE' }),
    }
    jest.spyOn(AuditLog, 'create').mockRejectedValue(new Error('forced authoritative audit failure') as never)

    await expect(updateAdminRolePolicy({
      ...mutationBase,
      capabilities: doctorsReadOnly,
      expectedVersion: 4,
      changeReason: 'This transaction must roll back',
      requestCorrelationId: 'policy-integration-rollback',
    })).rejects.toThrow(/forced authoritative audit failure/i)

    const afterRollback = {
      policy: await AdminRolePolicy.findOne({ role_key: 'hospital_admin' }).lean(),
      revisions: await AdminRolePolicyRevision.countDocuments({ role_key: 'hospital_admin' }),
      audits: await AuditLog.countDocuments({ action: 'ROLE_POLICY_UPDATE' }),
    }
    expect(beforeRollback.policy).toBeTruthy()
    expect(afterRollback.policy).toBeTruthy()
    expect(afterRollback.policy!.policy_version).toBe(beforeRollback.policy!.policy_version)
    expect(afterRollback.policy!.capabilities).toEqual(beforeRollback.policy!.capabilities)
    expect(afterRollback.revisions).toBe(beforeRollback.revisions)
    expect(afterRollback.audits).toBe(beforeRollback.audits)
  })
})
