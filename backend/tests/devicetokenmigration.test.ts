import {
  runDeviceTokenOwnershipMigration,
  type DeviceTokenMigrationAdapter,
} from '@alias/scripts/migrateDeviceTokenOwnership'

type FakeRecord = {
  _id: string
  fcm_token: string
  last_refreshed_at: Date
  updatedAt: Date
}

function createFakeAdapter() {
  const records: FakeRecord[] = [
    { _id: '1', fcm_token: 'shared', last_refreshed_at: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') },
    { _id: '2', fcm_token: 'shared', last_refreshed_at: new Date('2026-02-01'), updatedAt: new Date('2026-02-01') },
    { _id: '3', fcm_token: 'single', last_refreshed_at: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') },
  ]
  const indexes: any[] = [
    { name: '_id_', key: { _id: 1 }, unique: true },
    { name: 'user_id_1_fcm_token_1', key: { user_id: 1, fcm_token: 1 }, unique: true },
  ]
  const adapter: DeviceTokenMigrationAdapter = {
    async listDuplicateTokens() {
      const counts = new Map<string, number>()
      records.forEach(record => counts.set(record.fcm_token, (counts.get(record.fcm_token) || 0) + 1))
      return Array.from(counts).filter(([, count]) => count > 1).map(([token]) => token).sort()
    },
    async listRecords(token) {
      return records.filter(record => record.fcm_token === token).sort((a, b) => (
        b.last_refreshed_at.getTime() - a.last_refreshed_at.getTime() ||
        b.updatedAt.getTime() - a.updatedAt.getTime() ||
        b._id.localeCompare(a._id)
      ))
    },
    async deleteRecords(ids) {
      for (const id of ids.map(String)) {
        const index = records.findIndex(record => record._id === id)
        if (index >= 0) records.splice(index, 1)
      }
    },
    async listIndexes() { return indexes.map(index => ({ ...index, key: { ...index.key } })) },
    async dropIndex(name) {
      const index = indexes.findIndex(candidate => candidate.name === name)
      if (index >= 0) indexes.splice(index, 1)
    },
    async createUniqueTokenIndex() {
      indexes.push({ name: 'fcm_token_1', key: { fcm_token: 1 }, unique: true })
    },
  }
  return { adapter, records, indexes }
}

describe('DeviceToken ownership migration', () => {
  test('dry run reports duplicates and index changes without writes', async () => {
    const fake = createFakeAdapter()
    const before = JSON.stringify({ records: fake.records, indexes: fake.indexes })
    const stats = await runDeviceTokenOwnershipMigration({ execute: false, adapter: fake.adapter })

    expect(stats.duplicateTokens).toBe(1)
    expect(stats.wouldDelete).toBe(1)
    expect(stats.wouldDropIndexes).toEqual(['user_id_1_fcm_token_1'])
    expect(stats.wouldCreateUniqueIndex).toBe(true)
    expect(JSON.stringify({ records: fake.records, indexes: fake.indexes })).toBe(before)
  })

  test('execute keeps the newest owner, replaces indexes, and reruns idempotently', async () => {
    const fake = createFakeAdapter()
    const first = await runDeviceTokenOwnershipMigration({ execute: true, adapter: fake.adapter })

    expect(first.deleted).toBe(1)
    expect(fake.records.filter(record => record.fcm_token === 'shared').map(record => record._id)).toEqual(['2'])
    expect(fake.indexes).not.toContainEqual(expect.objectContaining({ name: 'user_id_1_fcm_token_1' }))
    expect(fake.indexes).toContainEqual({ name: 'fcm_token_1', key: { fcm_token: 1 }, unique: true })

    const snapshot = JSON.stringify({ records: fake.records, indexes: fake.indexes })
    const second = await runDeviceTokenOwnershipMigration({ execute: true, adapter: fake.adapter })
    expect(second.deleted).toBe(0)
    expect(second.droppedIndexes).toEqual([])
    expect(second.createdUniqueIndex).toBe(false)
    expect(JSON.stringify({ records: fake.records, indexes: fake.indexes })).toBe(snapshot)
  })
})
