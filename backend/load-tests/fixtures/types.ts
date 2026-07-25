export const FIXTURE_SCHEMA_VERSION = 1 as const

export type FixtureResourceKind =
  | 'runSentinel'
  | 'hospital'
  | 'adminProfile'
  | 'doctorProfile'
  | 'patientProfile'
  | 'user'
  | 'authSession'
  | 'systemConfig'
  | 'notification'
  | 'deviceToken'
  | 'invoice'
  | 'auditLog'

export type JournalEntryState = 'planned' | 'created' | 'deleted'

export type OwnershipSignature = {
  path: string
  value: string | number | boolean
}

export type JournalEntry = {
  kind: FixtureResourceKind
  collection: string
  id: string
  label: string
  signature: OwnershipSignature
  state: JournalEntryState
  plannedAt: string
  createdAt?: string
  deletedAt?: string
}

export type CleanupJournal = {
  schemaVersion: typeof FIXTURE_SCHEMA_VERSION
  fixtureVersion: string
  runId: string
  databaseName: string
  databaseHosts: string[]
  state: 'planned' | 'seeding' | 'seeded' | 'cleaning' | 'clean' | 'failed'
  createdAt: string
  updatedAt: string
  lastError?: string
  entries: JournalEntry[]
}

export type PlannedFixture = {
  kind: FixtureResourceKind
  collection: string
  id: string
  label: string
  signature: OwnershipSignature
  document: Record<string, unknown>
}

export type FixturePlan = {
  fixtureVersion: string
  runId: string
  prefix: string
  resources: PlannedFixture[]
  accountLoginIds: string[]
  sessionCredentials: Array<{
    role: string
    loginId: string
    userId: string
    userType: 'ADMIN' | 'DOCTOR' | 'PATIENT'
    sessionId: string
    accessTokenId: string
    refreshToken: string
  }>
}
