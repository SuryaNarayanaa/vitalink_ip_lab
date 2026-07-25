import fs from 'node:fs'
import path from 'node:path'
import { FIXTURE_SCHEMA_VERSION, type CleanupJournal, type FixturePlan, type JournalEntryState } from './types'

function assertSafeFilePart(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(value)) {
    throw new Error('Unsafe run ID for journal path')
  }
}

export function journalPath(stateDirectory: string, runId: string): string {
  assertSafeFilePart(runId)
  return path.join(stateDirectory, `${runId}.cleanup-journal.json`)
}

export function writeJournal(file: string, journal: CleanupJournal): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  journal.updatedAt = new Date().toISOString()
  const temporary = `${file}.${process.pid}.tmp`
  const backup = `${file}.bak`
  fs.writeFileSync(temporary, `${JSON.stringify(journal, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try {
    fs.renameSync(temporary, file)
    return
  } catch (error: any) {
    // Windows does not allow rename() to replace an existing destination.
    // Preserve the previous durable journal until the new file is in place so
    // a process failure can be recovered by readJournal().
    if (!fs.existsSync(file) || !['EEXIST', 'EPERM'].includes(error?.code)) {
      throw error
    }
  }

  if (fs.existsSync(backup)) fs.rmSync(backup)
  fs.renameSync(file, backup)
  try {
    fs.renameSync(temporary, file)
    fs.rmSync(backup)
  } catch (error) {
    if (!fs.existsSync(file) && fs.existsSync(backup)) fs.renameSync(backup, file)
    throw error
  }
}

export function createJournal(
  plan: FixturePlan,
  databaseName: string,
  databaseHosts: string[],
): CleanupJournal {
  const timestamp = new Date().toISOString()
  return {
    schemaVersion: FIXTURE_SCHEMA_VERSION,
    fixtureVersion: plan.fixtureVersion,
    runId: plan.runId,
    databaseName,
    databaseHosts,
    state: 'planned',
    createdAt: timestamp,
    updatedAt: timestamp,
    entries: plan.resources.map(resource => ({
      kind: resource.kind,
      collection: resource.collection,
      id: resource.id,
      label: resource.label,
      signature: resource.signature,
      state: 'planned',
      plannedAt: timestamp,
    })),
  }
}

export function readJournal(file: string): CleanupJournal {
  const backup = `${file}.bak`
  if (!fs.existsSync(file) && fs.existsSync(backup)) fs.renameSync(backup, file)
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as CleanupJournal
  if (value.schemaVersion !== FIXTURE_SCHEMA_VERSION || !Array.isArray(value.entries)) {
    throw new Error(`Unsupported or corrupt cleanup journal: ${file}`)
  }
  return value
}

export function setJournalState(
  file: string,
  journal: CleanupJournal,
  state: CleanupJournal['state'],
  error?: unknown,
): void {
  journal.state = state
  journal.lastError = error ? String(error instanceof Error ? error.message : error).slice(0, 500) : undefined
  writeJournal(file, journal)
}

export function setEntryState(
  file: string,
  journal: CleanupJournal,
  id: string,
  state: JournalEntryState,
): void {
  const entry = journal.entries.find(candidate => candidate.id === id)
  if (!entry) throw new Error(`Journal entry not found for ${id}`)
  entry.state = state
  if (state === 'created') entry.createdAt = new Date().toISOString()
  if (state === 'deleted') entry.deletedAt = new Date().toISOString()
  writeJournal(file, journal)
}
