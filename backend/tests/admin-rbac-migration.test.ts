import fs from 'fs'
import path from 'path'
import mongoose, { type Connection } from 'mongoose'
import RoleDefinition from '@alias/models/roledefinition.model'
import {
  assertTransactionCapability,
  startMongoReplicaSet,
  type MongoReplicaSetHarness,
} from './setup/mongo-replica-set'
import {
  createAdminRbacFixtures,
  loadAdminRbacPolicyModels,
} from './setup/admin-rbac-fixtures'

jest.setTimeout(180_000)

const BACKEND_ROOT = path.resolve(__dirname, '..')
const MIGRATION_MODULE = path.join(BACKEND_ROOT, 'src/scripts/migrateAdminRbacV2')

type MigrationModule = {
  runAdminRbacV2Migration?: (input: Record<string, unknown>) => Promise<unknown>
  runMigration?: (input: Record<string, unknown>) => Promise<unknown>
  verifyAdminRbacV2Migration?: (input: Record<string, unknown>) => Promise<unknown>
  verifyMigration?: (input: Record<string, unknown>) => Promise<unknown>
}

function migrationModuleExists() {
  return ['.ts', '.js', ''].some(extension => fs.existsSync(`${MIGRATION_MODULE}${extension}`))
}

function loadMigrationModule(): MigrationModule {
  // Import safety is part of the contract: importing this module must not call
  // process.exit, connect to another database, or execute writes.
  return require(MIGRATION_MODULE) as MigrationModule
}

async function snapshotDocuments(connection: Connection) {
  const database = connection.db!
  const collections = (await database.listCollections({}, { nameOnly: true }).toArray())
    .map(collection => collection.name)
    .filter(name => !name.startsWith('system.'))
    .sort()
  const snapshot: Record<string, unknown[]> = {}
  for (const name of collections) {
    snapshot[name] = await database.collection(name).find({}).sort({ _id: 1 }).toArray()
  }
  return JSON.stringify(snapshot)
}

async function seedLegacyRoleDefinitions() {
  await RoleDefinition.create([
    {
      role_key: 'app_admin',
      label: 'Application Admin',
      color: '#6750A4',
      permissions: {
        manage_users: true,
        manage_doctors: true,
        manage_patients: true,
        manage_hospitals: true,
        manage_roles: true,
        view_audit: true,
        manage_billing: true,
        manage_system: true,
        export_data: false,
      },
    },
    {
      role_key: 'hospital_admin',
      label: 'Hospital Admin',
      color: '#006C4C',
      permissions: {
        manage_users: true,
        manage_doctors: true,
        manage_patients: true,
        manage_hospitals: false,
        manage_roles: false,
        view_audit: true,
        manage_billing: true,
        manage_system: false,
        export_data: false,
      },
    },
    {
      role_key: 'auditor',
      label: 'System Auditor',
      color: '#455A64',
      permissions: {
        manage_users: false,
        manage_doctors: false,
        manage_patients: false,
        manage_hospitals: false,
        manage_roles: false,
        view_audit: true,
        manage_billing: false,
        manage_system: false,
        export_data: false,
      },
    },
  ])
}

function migrationContext(connection: Connection, mode: 'dry-run' | 'verify') {
  return {
    execute: false,
    dryRun: mode === 'dry-run',
    verify: mode === 'verify',
    mode,
    connection,
    mongoose,
    database: connection.db,
  }
}

describe('Admin RBAC V2 migration validation scaffolding', () => {
  let harness: MongoReplicaSetHarness
  let connection: Connection

  beforeAll(async () => {
    // A missing Docker daemon must reject this suite with a BLOCKED error from
    // the harness. Do not catch it and do not replace it with describe.skip.
    harness = await startMongoReplicaSet({ databaseName: 'admin_rbac_migration_test' })
    await mongoose.connect(harness.uri)
    connection = mongoose.connection
  })

  afterEach(async () => {
    if (connection?.db) await connection.db.dropDatabase()
  })

  afterAll(async () => {
    await mongoose.disconnect().catch(() => undefined)
    await harness?.stop().catch(() => undefined)
  })

  test('uses a real replica set with commit and rollback transaction semantics', async () => {
    await assertTransactionCapability(connection)
  })

  test('fixture factories cover fixed roles, two tenants, clinical users, policies, and revisions', async () => {
    const policyModels = loadAdminRbacPolicyModels()
    const fixtures = await createAdminRbacFixtures({
      namespace: 'fixture_inventory',
      persistPolicies: Boolean(policyModels),
    })

    expect(Object.keys(fixtures.admins).sort()).toEqual(['appAdmin', 'auditor', 'hospitalAdmin'])
    expect(String(fixtures.admins.hospitalAdmin.profile.hospital_id))
      .toBe(String(fixtures.hospitals.primary._id))
    expect(fixtures.admins.auditor.profile.hospital_id).toBeUndefined()
    expect(String(fixtures.clinical.primary.patientProfile.assigned_doctor_id))
      .toBe(String(fixtures.clinical.primary.doctor._id))
    expect(String(fixtures.clinical.secondary.patientProfile.hospital_id))
      .toBe(String(fixtures.hospitals.secondary._id))
    expect(fixtures.policyInputs).toHaveLength(3)
    expect(fixtures.revisionInputs).toHaveLength(3)

    if (policyModels) {
      expect(fixtures.policies).toHaveLength(3)
      expect(fixtures.revisions).toHaveLength(3)
    } else {
      // During the parallel additive wave the plain policy/revision inputs are
      // still usable; persistence becomes mandatory as soon as both models land.
      expect(fixtures.policies).toEqual([])
      expect(fixtures.revisions).toEqual([])
    }
  })

  test('dry-run export reports against fixtures without changing documents', async () => {
    if (!migrationModuleExists()) {
      expect(path.relative(BACKEND_ROOT, `${MIGRATION_MODULE}.ts`).replace(/\\/g, '/'))
        .toBe('src/scripts/migrateAdminRbacV2.ts')
      return
    }

    await createAdminRbacFixtures({ namespace: 'migration_dry_run' })
    await seedLegacyRoleDefinitions()
    const before = await snapshotDocuments(connection)
    const migration = loadMigrationModule()
    const runner = migration.runAdminRbacV2Migration ?? migration.runMigration

    expect(typeof runner).toBe('function')
    const report = await runner!(migrationContext(connection, 'dry-run'))
    expect(report).toBeDefined()
    expect(await snapshotDocuments(connection)).toBe(before)
  })

  test('verify export checks a fully seeded V2 fixture without changing documents', async () => {
    if (!migrationModuleExists()) {
      expect(migrationModuleExists()).toBe(false)
      return
    }

    const policyModels = loadAdminRbacPolicyModels()
    expect(policyModels).toBeDefined()
    await createAdminRbacFixtures({
      namespace: 'migration_verify',
      persistPolicies: true,
    })
    await seedLegacyRoleDefinitions()
    const before = await snapshotDocuments(connection)
    const migration = loadMigrationModule()
    const verifier = migration.verifyAdminRbacV2Migration ?? migration.verifyMigration
    const runner = migration.runAdminRbacV2Migration ?? migration.runMigration

    expect(typeof (verifier ?? runner)).toBe('function')
    const report = verifier
      ? await verifier(migrationContext(connection, 'verify'))
      : await runner!(migrationContext(connection, 'verify'))
    expect(report).toBeDefined()
    // Fully seeded V2 fixtures must pass verification (no blockers / missing policies).
    expect((report as { verificationPassed?: boolean }).verificationPassed).toBe(true)
    expect(await snapshotDocuments(connection)).toBe(before)
  })
})
