import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { allocateDynamicMutation, leaseToken } from '../fixtures/dynamic/allocator'
import { selectExclusiveVuContext } from '../fixtures/dynamic/context-pool'
import type { DatabaseDeleteEffect, ProviderEffect } from '../fixtures/dynamic/types'
import { DurableMutationLedger } from './ledger'
import { assertMutationReadinessCoverage, MUTATION_CAPACITY_READINESS } from './readiness'
import { MutationReconciliationCoordinator } from './reconcile'
import { createMutationSidecar } from './sidecar'

const RUN_ID = 'mutation_test_run'
const DATABASE = 'vitalink_load_test'
const SECRET = 'mutation-test-secret-that-is-longer-than-32-bytes'

function withDirectory(work: (directory: string) => Promise<void> | void): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalink-mutation-ledger-'))
  return Promise.resolve(work(directory)).finally(() => fs.rmSync(directory, { recursive: true, force: true }))
}

function deleteEffect(id?: string): DatabaseDeleteEffect {
  return {
    kind: 'database-delete',
    collection: 'devicetokens',
    ...(id ? { id } : {}),
    ownership: [{ path: 'fcm_token', value: `load:${RUN_ID}:owned` }],
  }
}

test('allocator is deterministic for retry and unique across VU/iteration coordinates', () => {
  const first = allocateDynamicMutation(RUN_ID, 'POST /api/v1/devices/register', 1, 0, SECRET)
  const retry = allocateDynamicMutation(RUN_ID, 'POST /api/v1/devices/register', 1, 0, SECRET)
  const nextVu = allocateDynamicMutation(RUN_ID, 'POST /api/v1/devices/register', 2, 0, SECRET)
  const nextIteration = allocateDynamicMutation(RUN_ID, 'POST /api/v1/devices/register', 1, 1, SECRET)

  assert.deepEqual(first, retry)
  assert.notEqual(first.requestId, nextVu.requestId)
  assert.notEqual(first.requestId, nextIteration.requestId)
  assert.match(first.ownershipToken, /^load:mutation_test_run:v1i0_/)
})

test('exclusive context selection refuses modulo reuse and undersized pools', () => {
  const pool = [{
    poolIndex: 0,
    accessToken: 'token',
    userId: '0123456789abcdef01234567',
    profileId: '0123456789abcdef01234568',
    mutableIds: {},
  }]
  assert.equal(selectExclusiveVuContext(pool, 1, 1).poolIndex, 0)
  assert.throws(() => selectExclusiveVuContext(pool, 2, 2), /at least 2 exclusive fixture contexts/)
})

test('durable ledger recovers a planned request and records returned exact IDs', async () => {
  await withDirectory(directory => {
    const allocation = allocateDynamicMutation(RUN_ID, 'POST /api/v1/devices/register', 7, 19, SECRET)
    const token = leaseToken(allocation, SECRET)
    const ledger = new DurableMutationLedger(directory, RUN_ID, DATABASE)
    ledger.initialize()
    ledger.plan(allocation, token, [deleteEffect()])

    const recovered = new DurableMutationLedger(directory, RUN_ID, DATABASE)
    assert.equal(recovered.read().entries[0]?.state, 'planned')
    recovered.observe(allocation.requestId, token, { status: 201, succeeded: true }, [
      deleteEffect('0123456789abcdef01234567'),
    ])

    const entry = recovered.read().entries[0]
    assert.equal(entry?.state, 'observed')
    assert.equal(entry?.effects[0]?.kind, 'database-delete')
    assert.equal((entry?.effects[0] as DatabaseDeleteEffect).id, '0123456789abcdef01234567')
  })
})

test('ledger refuses missing ownership, invalid snapshots, and effect-plan substitution', async () => {
  await withDirectory(directory => {
    const allocation = allocateDynamicMutation(RUN_ID, 'POST /api/v1/devices/register', 1, 0, SECRET)
    const token = leaseToken(allocation, SECRET)
    const ledger = new DurableMutationLedger(directory, RUN_ID, DATABASE)
    ledger.initialize()

    assert.throws(() => ledger.plan(allocation, token, [{
      kind: 'database-delete',
      collection: 'devicetokens',
      ownership: [],
    }]), /ownership signature/)

    ledger.plan(allocation, token, [deleteEffect()])
    assert.throws(() => ledger.observe(allocation.requestId, token, { status: 201, succeeded: true }, [{
      kind: 'database-delete',
      collection: 'users',
      ownership: [{ path: 'login_id', value: 'substituted' }],
    }]), /do not exactly match/)
  })
})

test('reconciliation fails closed for provider effects until an exact handler is registered', async () => {
  await withDirectory(async directory => {
    const allocation = allocateDynamicMutation(
      RUN_ID,
      'POST /api/v1/admin/billing/checkout/{invoiceId}',
      1,
      0,
      SECRET,
    )
    const token = leaseToken(allocation, SECRET)
    const providerEffect: ProviderEffect = {
      kind: 'provider',
      provider: 'synthetic-payments',
      externalId: 'checkout_exact_1',
      cleanupAction: 'cancel-session',
      ownership: [{ path: 'metadata.load_test_run_id', value: RUN_ID }],
    }
    const ledger = new DurableMutationLedger(directory, RUN_ID, DATABASE)
    ledger.initialize()
    ledger.plan(allocation, token, [providerEffect])
    ledger.observe(allocation.requestId, token, { status: 200, succeeded: true })

    const failed = await new MutationReconciliationCoordinator(ledger, {}).reconcileAll()
    assert.equal(failed.state, 'failed')
    assert.match(failed.lastError ?? '', /No registered reconciler for provider/)

    const cleaned = await new MutationReconciliationCoordinator(ledger, {
      provider: async effect => {
        assert.equal(effect.kind, 'provider')
        assert.equal(effect.externalId, 'checkout_exact_1')
        return { status: 'reconciled' }
      },
    }).reconcileAll()
    assert.equal(cleaned.state, 'clean')
    assert.equal(cleaned.entries[0]?.state, 'reconciled')
  })
})

test('reconciliation processes effects and entries in reverse order', async () => {
  await withDirectory(async directory => {
    const ledger = new DurableMutationLedger(directory, RUN_ID, DATABASE)
    ledger.initialize()
    const calls: string[] = []
    for (const iteration of [0, 1]) {
      const allocation = allocateDynamicMutation(RUN_ID, 'POST /api/v1/devices/register', 1, iteration, SECRET)
      const token = leaseToken(allocation, SECRET)
      ledger.plan(allocation, token, [deleteEffect(`0123456789abcdef0123456${iteration}`)])
      ledger.observe(allocation.requestId, token, { status: 201, succeeded: true })
    }

    const result = await new MutationReconciliationCoordinator(ledger, {
      'database-delete': async effect => {
        assert.equal(effect.kind, 'database-delete')
        calls.push(effect.id ?? 'missing')
        return { status: 'reconciled' }
      },
    }).reconcileAll()
    assert.equal(result.state, 'clean')
    assert.deepEqual(calls, ['0123456789abcdef01234561', '0123456789abcdef01234560'])
  })
})

test('readiness catalog covers every destructive canonical descriptor exactly once', async () => {
  const publicModule = await import('../scenarios/public-auth-devices/descriptors.js')
  const clinicalModule = await import('../scenarios/clinical/descriptors.js')
  const adminModule = await import('../scenarios/admin-platform/descriptors.js')
  const descriptors = [
    ...publicModule.OPERATION_DESCRIPTORS,
    ...clinicalModule.CLINICAL_OPERATIONS,
    ...adminModule.ADMIN_PLATFORM_OPERATIONS,
  ]
  const destructive = descriptors.filter(entry => entry.destructive).map(entry => entry.id)
  assertMutationReadinessCoverage(destructive)
  assert.equal(MUTATION_CAPACITY_READINESS.length, 53)
})

test('loopback sidecar exposes authenticated plan and observe API for k6', async () => {
  await withDirectory(async directory => {
    const previous = { ...process.env }
    Object.assign(process.env, {
      ALLOW_LOAD_TESTS: 'true',
      ALLOW_DESTRUCTIVE_LOAD: 'true',
      NODE_ENV: 'test',
      LOAD_TEST_RUN_ID: RUN_ID,
      LOAD_TEST_MONGO_URI: `mongodb://127.0.0.1:27017/${DATABASE}`,
      LOAD_TEST_ALLOWED_DB_HOSTS: '127.0.0.1',
      LOAD_TEST_STATE_DIR: directory,
      LOAD_TEST_MUTATION_SECRET: SECRET,
    })
    const server = createMutationSidecar()
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      const address = server.address()
      assert(address && typeof address === 'object')
      const baseUrl = `http://127.0.0.1:${address.port}`
      const unauthorized = await fetch(`${baseUrl}/v1/status`)
      assert.equal(unauthorized.status, 401)

      const planned = await fetch(`${baseUrl}/v1/plan`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-load-mutation-secret': SECRET,
        },
        body: JSON.stringify({
          endpointId: 'POST /api/v1/devices/register',
          vuId: 3,
          iteration: 4,
          effects: [deleteEffect()],
        }),
      })
      assert.equal(planned.status, 201)
      const planBody = await planned.json() as any
      const observed = await fetch(`${baseUrl}/v1/observe`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-load-mutation-secret': SECRET,
        },
        body: JSON.stringify({
          requestId: planBody.allocation.requestId,
          leaseToken: planBody.leaseToken,
          status: 201,
          succeeded: true,
          effects: [deleteEffect('0123456789abcdef01234567')],
        }),
      })
      assert.equal(observed.status, 200)
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
      for (const key of Object.keys(process.env)) {
        if (!(key in previous)) delete process.env[key]
      }
      Object.assign(process.env, previous)
    }
  })
})
