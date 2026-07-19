import mongoose from "mongoose";
import logger from '@alias/utils/logger'
import { config } from '@alias/config'
import { AdminMfaChallenge, AuthSession, OtpChallenge, User } from '@alias/models'
import { sanitizeLogText } from '@alias/utils/logger'

/**
 * One-time / operational migration: challenge audit retention indexes and
 * purge_at backfill. Run via `migrateAuthSchemaDefaults` — not on every boot.
 *
 * Safe to re-run (idempotent). Concurrent instances may race on index drop;
 * IndexNotFound is treated as success.
 */
export async function ensureChallengeAuditRetention() {
  for (const model of [OtpChallenge, AdminMfaChallenge]) {
    if (model === AdminMfaChallenge) {
      // Older deployments allowed more than one pending challenge per admin.
      // Retain the newest and cancel the rest before building the singleton index.
      const cleanupDuplicates = async () => {
        const duplicateGroups = await model.collection.aggregate<{ ids: mongoose.Types.ObjectId[] }>([
          { $match: { status: 'PENDING' } },
          { $sort: { createdAt: -1 } },
          { $group: { _id: '$user_id', ids: { $push: '$_id' } } },
          { $match: { 'ids.1': { $exists: true } } },
        ]).toArray()
        for (const group of duplicateGroups) {
          await model.collection.updateMany(
            { _id: { $in: group.ids.slice(1) } },
            { $set: { status: 'CANCELLED' } },
          )
        }
      }
      // Build directly (rather than schema auto-indexing) so a duplicate
      // inserted by a rolling legacy instance between cleanup and build can be
      // cleaned and retried without taking the new instance down.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await cleanupDuplicates()
        try {
          await model.collection.createIndex(
            { user_id: 1 },
            {
              name: 'one_pending_admin_mfa_challenge_per_user',
              unique: true,
              partialFilterExpression: { status: 'PENDING' },
            },
          )
          break
        } catch (error: any) {
          if (error?.code !== 11000 || attempt === 4) throw error
        }
      }
    }
    await model.init()
    const indexes = await model.collection.indexes()
    const destructiveExpiryIndex = indexes.find(index =>
      index.key?.expires_at === 1 && index.expireAfterSeconds !== undefined
    )
    if (destructiveExpiryIndex?.name) {
      try {
        await model.collection.dropIndex(destructiveExpiryIndex.name)
      } catch (error: any) {
        // Another instance may have already dropped this index concurrently.
        if (error?.codeName !== 'IndexNotFound' && error?.code !== 27) throw error
      }
    }
    await model.collection.updateMany(
      { purge_at: { $exists: false }, expires_at: { $type: 'date' } },
      [{ $set: { purge_at: { $dateAdd: { startDate: '$expires_at', unit: 'day', amount: 30 } } } }],
    )
    await model.collection.createIndex({ purge_at: 1 }, { expireAfterSeconds: 0, name: 'purge_at_1' })
  }
}

/**
 * One-time / operational migration: backfill generation fields introduced
 * after the first production schema. Run via `migrateAuthSchemaDefaults` —
 * not on every boot.
 *
 * Mongoose defaults are not applied to existing raw documents, while auth
 * predicates intentionally require an exact generation match.
 * Safe to re-run (idempotent).
 */
export async function ensureAuthGenerationDefaults() {
  await User.collection.updateMany(
    { security_version: { $exists: false } },
    { $set: { security_version: 0 } },
  )
  await User.collection.updateMany(
    {
      'admin_mfa.totp': { $exists: true },
      'admin_mfa.totp.factor_generation': { $exists: false },
    },
    { $set: { 'admin_mfa.totp.factor_generation': 0 } },
  )
  // Preserve legacy sessions at generation zero. They remain subject to all
  // existing expiry/revocation/account-state checks.
  await AuthSession.collection.updateMany(
    { security_version: { $exists: false } },
    { $set: { security_version: 0 } },
  )
  // Password-authenticated challenges cannot be safely inferred after the
  // generation fields were introduced. Force legacy clients to authenticate
  // again instead of allowing old password proof to cross a credential reset.
  await AdminMfaChallenge.collection.updateMany(
    { status: 'PENDING', security_version: { $exists: false } },
    { $set: { status: 'CANCELLED' } },
  )
  await OtpChallenge.collection.updateMany(
    {
      status: 'PENDING',
      $or: [
        { security_version: { $exists: false } },
        { profile_id: { $exists: false } },
      ],
    },
    { $set: { status: 'CANCELLED' } },
  )
}

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(config.databaseUrl);
    // Full-collection auth schema backfills and index repairs are operational
    // migrations (see migrateAuthSchemaDefaults). Do not run them on every
    // boot — that adds startup latency, multiplies work across replicas, and
    // races concurrent index drops during rolling deploys.
    logger.info(`MongoDB Connected: ${conn.connection.host}`);
  }
  catch (err) {
    logger.error('Database initialization failed', { error: sanitizeLogText(err) });
    process.exit(1);
  }
}
export default connectDB;
