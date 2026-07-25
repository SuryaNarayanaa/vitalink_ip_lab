export const DYNAMIC_LEDGER_SCHEMA_VERSION = 1 as const

export type ScalarSignatureValue = string | number | boolean | null

export type ExactOwnershipSignature = Readonly<{
  path: string
  value: ScalarSignatureValue
}>

export type DynamicAllocation = Readonly<{
  runId: string
  endpointId: string
  vuId: number
  iteration: number
  requestId: string
  requestSuffix: string
  ownershipToken: string
}>

export type DatabaseDeleteEffect = {
  kind: 'database-delete'
  collection: string
  id?: string
  ownership: ExactOwnershipSignature[]
}

export type DatabaseRestoreEffect = {
  kind: 'database-restore'
  collection: string
  id: string
  ownership: ExactOwnershipSignature[]
  snapshot: Record<string, unknown>
  snapshotSha256: string
}

export type ProviderEffect = {
  kind: 'provider'
  provider: string
  externalId: string
  cleanupAction: string
  ownership: ExactOwnershipSignature[]
}

export type FileEffect = {
  kind: 'file'
  storageProvider: string
  storageKey: string
  assetCollection?: string
  assetId?: string
  cleanupAction: 'delete-object-and-metadata' | 'restore-object-and-metadata'
  ownership: ExactOwnershipSignature[]
  metadataSnapshot?: Record<string, unknown>
  metadataSnapshotSha256?: string
}

export type SessionEffect = {
  kind: 'session'
  collection: string
  id?: string
  ownership: ExactOwnershipSignature[]
  cleanupAction: 'delete' | 'revoke'
}

export type DynamicMutationEffect =
  | DatabaseDeleteEffect
  | DatabaseRestoreEffect
  | ProviderEffect
  | FileEffect
  | SessionEffect

export type MutationEntryState =
  | 'planned'
  | 'observed'
  | 'reconciling'
  | 'reconciled'
  | 'failed'

export type DynamicMutationEntry = {
  allocation: DynamicAllocation
  leaseDigest: string
  state: MutationEntryState
  plannedAt: string
  observedAt?: string
  reconciliationStartedAt?: string
  reconciledAt?: string
  response?: {
    status: number
    succeeded: boolean
  }
  effects: DynamicMutationEffect[]
  lastError?: string
}

export type DynamicMutationLedger = {
  schemaVersion: typeof DYNAMIC_LEDGER_SCHEMA_VERSION
  runId: string
  databaseName: string
  state: 'open' | 'reconciling' | 'clean' | 'failed'
  createdAt: string
  updatedAt: string
  entries: DynamicMutationEntry[]
  lastError?: string
}

export type ReconciliationResult = {
  status: 'reconciled' | 'already-absent'
  detail?: string
}

export type EffectReconciler = (
  effect: DynamicMutationEffect,
  entry: DynamicMutationEntry,
) => Promise<ReconciliationResult>

export type ReconcilerRegistry = Partial<Record<DynamicMutationEffect['kind'], EffectReconciler>>
