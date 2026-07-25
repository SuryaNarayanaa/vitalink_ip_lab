import crypto from 'node:crypto'
import type {
  DynamicMutationEffect,
  ExactOwnershipSignature,
} from './types'

const SAFE_COLLECTION = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const SAFE_OBJECT_ID = /^[a-fA-F0-9]{24}$/
const SAFE_SIGNATURE_PATH = /^[A-Za-z_][A-Za-z0-9_.]{0,127}$/

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
    .join(',')}}`
}

export function snapshotDigest(snapshot: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(canonicalJson(snapshot)).digest('hex')
}

function assertOwnership(ownership: ExactOwnershipSignature[]): void {
  if (!Array.isArray(ownership) || ownership.length === 0) {
    throw new Error('Every dynamic side effect requires at least one exact ownership signature')
  }
  const paths = new Set<string>()
  for (const signature of ownership) {
    if (!SAFE_SIGNATURE_PATH.test(signature.path) || paths.has(signature.path)) {
      throw new Error(`Unsafe or duplicate ownership signature path: ${signature.path}`)
    }
    if (!['string', 'number', 'boolean'].includes(typeof signature.value) && signature.value !== null) {
      throw new Error(`Unsupported ownership signature value at ${signature.path}`)
    }
    paths.add(signature.path)
  }
}

function assertCollectionAndId(collection: string, id?: string): void {
  if (!SAFE_COLLECTION.test(collection)) throw new Error(`Unsafe MongoDB collection name: ${collection}`)
  if (id !== undefined && !SAFE_OBJECT_ID.test(id)) throw new Error(`Invalid MongoDB ObjectId: ${id}`)
}

export function assertValidEffect(effect: DynamicMutationEffect): void {
  if (!effect || typeof effect !== 'object') throw new Error('Mutation effect must be an object')
  assertOwnership(effect.ownership)

  if (effect.kind === 'database-delete') {
    assertCollectionAndId(effect.collection, effect.id)
    return
  }
  if (effect.kind === 'database-restore') {
    assertCollectionAndId(effect.collection, effect.id)
    if (!effect.snapshot || snapshotDigest(effect.snapshot) !== effect.snapshotSha256) {
      throw new Error('Database restore snapshot digest mismatch')
    }
    return
  }
  if (effect.kind === 'session') {
    assertCollectionAndId(effect.collection, effect.id)
    if (!['delete', 'revoke'].includes(effect.cleanupAction)) {
      throw new Error(`Unsupported session cleanup action: ${String(effect.cleanupAction)}`)
    }
    return
  }
  if (effect.kind === 'provider') {
    if (!effect.provider?.trim() || !effect.externalId?.trim() || !effect.cleanupAction?.trim()) {
      throw new Error('Provider effects require provider, externalId, and cleanupAction')
    }
    return
  }
  if (effect.kind === 'file') {
    if (!effect.storageProvider?.trim() || !effect.storageKey?.trim()) {
      throw new Error('File effects require storageProvider and storageKey')
    }
    if (effect.assetId || effect.assetCollection) {
      assertCollectionAndId(effect.assetCollection ?? '', effect.assetId ?? '')
    }
    if (effect.cleanupAction === 'restore-object-and-metadata') {
      if (!effect.metadataSnapshot || snapshotDigest(effect.metadataSnapshot) !== effect.metadataSnapshotSha256) {
        throw new Error('File metadata restore snapshot digest mismatch')
      }
    }
    return
  }

  const unreachable: never = effect
  throw new Error(`Unknown mutation effect kind: ${String((unreachable as any)?.kind)}`)
}
