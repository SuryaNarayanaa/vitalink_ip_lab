import mongoose from 'mongoose'
import type {
  DynamicMutationEffect,
  EffectReconciler,
  ExactOwnershipSignature,
  ReconciliationResult,
  ReconcilerRegistry,
} from '../fixtures/dynamic/types'
import { snapshotDigest } from '../fixtures/dynamic/validation'

function ownershipFilter(ownership: ExactOwnershipSignature[]): Record<string, unknown> {
  return Object.fromEntries(ownership.map(signature => [signature.path, signature.value]))
}

function objectId(id: string): mongoose.Types.ObjectId {
  if (!mongoose.isObjectIdOrHexString(id)) throw new Error(`Invalid mutation effect ObjectId: ${id}`)
  return new mongoose.Types.ObjectId(id)
}

async function resolveExactId(
  effect: Extract<DynamicMutationEffect, { kind: 'database-delete' | 'session' }>,
): Promise<mongoose.Types.ObjectId | undefined> {
  if (effect.id) return objectId(effect.id)
  const matches = await mongoose.connection.collection(effect.collection)
    .find(ownershipFilter(effect.ownership), { projection: { _id: 1 }, limit: 2 })
    .toArray()
  if (matches.length > 1) {
    throw new Error(`Ownership signatures matched multiple ${effect.collection} records; cleanup refused`)
  }
  return matches[0]?._id as mongoose.Types.ObjectId | undefined
}

const reconcileDelete: EffectReconciler = async effect => {
  if (effect.kind !== 'database-delete') throw new Error('Wrong reconciler for effect')
  const id = await resolveExactId(effect)
  if (!id) return { status: 'already-absent' }
  const collection = mongoose.connection.collection(effect.collection)
  const exact = { _id: id, ...ownershipFilter(effect.ownership) }
  const result = await collection.deleteOne(exact)
  if (result.deletedCount === 1) return { status: 'reconciled' }
  const stillExists = await collection.findOne({ _id: id }, { projection: { _id: 1 } })
  if (stillExists) throw new Error(`${effect.collection}:${id.toHexString()} exists but is not run-owned`)
  return { status: 'already-absent' }
}

const reconcileRestore: EffectReconciler = async effect => {
  if (effect.kind !== 'database-restore') throw new Error('Wrong reconciler for effect')
  if (snapshotDigest(effect.snapshot) !== effect.snapshotSha256) {
    throw new Error('Restore snapshot changed after it was journaled')
  }
  const id = objectId(effect.id)
  const collection = mongoose.connection.collection(effect.collection)
  const exact = { _id: id, ...ownershipFilter(effect.ownership) }
  const existing = await collection.findOne({ _id: id })

  const snapshot = { ...effect.snapshot, _id: id }
  if (!existing) {
    const ownershipMatchesSnapshot = effect.ownership.every(signature => {
      const value = signature.path.split('.').reduce<unknown>((current, key) => (
        current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined
      ), snapshot)
      return Object.is(value, signature.value)
    })
    if (!ownershipMatchesSnapshot) throw new Error('Restore snapshot does not carry the exact ownership signatures')
    await collection.insertOne(snapshot)
    return { status: 'reconciled', detail: 'restored-deleted-document' }
  }

  const owned = await collection.findOne(exact, { projection: { _id: 1 } })
  if (!owned) throw new Error(`${effect.collection}:${effect.id} exists but is not run-owned`)
  const result = await collection.replaceOne(exact, snapshot)
  if (result.matchedCount !== 1) throw new Error(`Concurrent ownership change prevented restore of ${effect.collection}:${effect.id}`)
  return { status: 'reconciled', detail: 'restored-snapshot' }
}

const reconcileSession: EffectReconciler = async effect => {
  if (effect.kind !== 'session') throw new Error('Wrong reconciler for effect')
  const id = await resolveExactId(effect)
  if (!id) return { status: 'already-absent' }
  const collection = mongoose.connection.collection(effect.collection)
  const exact = { _id: id, ...ownershipFilter(effect.ownership) }
  if (effect.cleanupAction === 'delete') {
    const result = await collection.deleteOne(exact)
    if (result.deletedCount === 1) return { status: 'reconciled' }
  } else {
    const result = await collection.updateOne(exact, {
      $set: { revoked_at: new Date(), expires_at: new Date(0), access_expires_at: new Date(0) },
      $unset: { refresh_token_hash: '' },
    })
    if (result.matchedCount === 1) return { status: 'reconciled', detail: 'session-revoked' }
  }
  const stillExists = await collection.findOne({ _id: id }, { projection: { _id: 1 } })
  if (stillExists) throw new Error(`${effect.collection}:${id.toHexString()} exists but is not run-owned`)
  return { status: 'already-absent' }
}

export function mongoReconcilerRegistry(
  additional: ReconcilerRegistry = {},
): ReconcilerRegistry {
  return {
    'database-delete': reconcileDelete,
    'database-restore': reconcileRestore,
    session: reconcileSession,
    ...additional,
  }
}
