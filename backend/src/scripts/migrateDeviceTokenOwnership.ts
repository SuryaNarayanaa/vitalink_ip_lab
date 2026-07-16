import 'dotenv/config'
import mongoose from 'mongoose'
import connectDB from '@alias/config/db'
import DeviceToken from '@alias/models/DeviceToken.model'

type TokenRecord = {
  _id: unknown
  fcm_token: string
  last_refreshed_at?: Date
  updatedAt?: Date
}

type IndexRecord = {
  name: string
  key: Record<string, number>
  unique?: boolean
}

export type DeviceTokenMigrationAdapter = {
  listDuplicateTokens(): Promise<string[]>
  listRecords(token: string): Promise<TokenRecord[]>
  deleteRecords(ids: unknown[]): Promise<void>
  listIndexes(): Promise<IndexRecord[]>
  dropIndex(name: string): Promise<void>
  createUniqueTokenIndex(): Promise<void>
}

export type DeviceTokenMigrationStats = {
  duplicateTokens: number
  duplicateRecords: number
  wouldDelete: number
  deleted: number
  wouldDropIndexes: string[]
  droppedIndexes: string[]
  wouldCreateUniqueIndex: boolean
  createdUniqueIndex: boolean
}

const sameKey = (key: Record<string, number>, expected: Record<string, number>) => {
  const entries = Object.entries(key)
  const expectedEntries = Object.entries(expected)
  return entries.length === expectedEntries.length && entries.every(([name, value]) => expected[name] === value)
}

const productionAdapter: DeviceTokenMigrationAdapter = {
  async listDuplicateTokens() {
    const groups = await DeviceToken.aggregate<{ _id: string }>([
      { $group: { _id: '$fcm_token', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $sort: { _id: 1 } },
    ])
    return groups.map(group => group._id)
  },
  async listRecords(token) {
    return DeviceToken.find({ fcm_token: token })
      .sort({ last_refreshed_at: -1, updatedAt: -1, _id: -1 })
      .select('_id fcm_token last_refreshed_at updatedAt')
      .lean() as unknown as Promise<TokenRecord[]>
  },
  async deleteRecords(ids) {
    await DeviceToken.deleteMany({ _id: { $in: ids } } as any)
  },
  async listIndexes() {
    try {
      return await DeviceToken.collection.indexes() as unknown as IndexRecord[]
    } catch (error: any) {
      if (error?.code === 26 || error?.codeName === 'NamespaceNotFound') return []
      throw error
    }
  },
  async dropIndex(name) {
    await DeviceToken.collection.dropIndex(name)
  },
  async createUniqueTokenIndex() {
    await DeviceToken.collection.createIndex({ fcm_token: 1 }, { unique: true, name: 'fcm_token_1' })
  },
}

export async function runDeviceTokenOwnershipMigration(input: {
  execute: boolean
  adapter?: DeviceTokenMigrationAdapter
}): Promise<DeviceTokenMigrationStats> {
  const adapter = input.adapter ?? productionAdapter
  const stats: DeviceTokenMigrationStats = {
    duplicateTokens: 0,
    duplicateRecords: 0,
    wouldDelete: 0,
    deleted: 0,
    wouldDropIndexes: [],
    droppedIndexes: [],
    wouldCreateUniqueIndex: false,
    createdUniqueIndex: false,
  }

  const duplicateTokens = await adapter.listDuplicateTokens()
  stats.duplicateTokens = duplicateTokens.length
  for (const token of duplicateTokens) {
    // Adapter order defines ownership: newest refresh, then updatedAt, then ObjectId descending.
    const records = await adapter.listRecords(token)
    stats.duplicateRecords += records.length
    const losingIds = records.slice(1).map(record => record._id)
    stats.wouldDelete += losingIds.length
    if (input.execute && losingIds.length) {
      await adapter.deleteRecords(losingIds)
      stats.deleted += losingIds.length
    }
  }

  const indexes = await adapter.listIndexes()
  const obsoleteOrConflicting = indexes.filter(index => (
    sameKey(index.key, { user_id: 1, fcm_token: 1 }) ||
    (sameKey(index.key, { fcm_token: 1 }) && index.unique !== true)
  ))
  const uniqueTokenIndex = indexes.find(index => sameKey(index.key, { fcm_token: 1 }) && index.unique === true)
  stats.wouldDropIndexes = obsoleteOrConflicting.map(index => index.name)
  stats.wouldCreateUniqueIndex = !uniqueTokenIndex

  if (input.execute) {
    for (const index of obsoleteOrConflicting) {
      await adapter.dropIndex(index.name)
      stats.droppedIndexes.push(index.name)
    }
    if (!uniqueTokenIndex) {
      await adapter.createUniqueTokenIndex()
      stats.createdUniqueIndex = true
    }

    const verifiedIndexes = await adapter.listIndexes()
    const verified = verifiedIndexes.some(index => sameKey(index.key, { fcm_token: 1 }) && index.unique === true)
    if (!verified) throw new Error('Unique fcm_token_1 index verification failed')
  }

  return stats
}

function parseExecute(args: string[]) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: npm run migrate:device-tokens -- [--execute]')
    console.log('Defaults to dry-run. Disable FCM and stop token registration before --execute.')
    process.exit(0)
  }
  const unknown = args.filter(arg => arg !== '--execute')
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(', ')}`)
  return args.includes('--execute')
}

async function main() {
  const execute = parseExecute(process.argv.slice(2))
  // Prevent Mongoose from racing the migration by auto-building the new unique index first.
  mongoose.set('autoIndex', false)
  await connectDB()
  const stats = await runDeviceTokenOwnershipMigration({ execute })
  console.log('--- DeviceToken Ownership Migration ---')
  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY RUN (default)'}`)
  console.log(stats)
  await mongoose.disconnect()
}

if (require.main === module) {
  main().catch(async error => {
    console.error('DeviceToken migration failed:', error)
    await mongoose.disconnect().catch(() => undefined)
    process.exit(1)
  })
}
