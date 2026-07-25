import { connectFixtureDatabase, deleteOwnedResource, disconnectFixtureDatabase } from './database'
import { loadGuardedEnvironment } from './guards'
import { journalPath, readJournal, setEntryState, setJournalState } from './journal'
import fs from 'node:fs'
import path from 'node:path'

export async function cleanupFixtures(): Promise<void> {
  const environment = loadGuardedEnvironment({ requireDatabase: true })
  const file = journalPath(environment.stateDirectory, environment.runId)
  const journal = readJournal(file)
  if (journal.runId !== environment.runId || journal.databaseName !== environment.databaseName) {
    throw new Error('Journal identity does not match the guarded cleanup target')
  }

  setJournalState(file, journal, 'cleaning')
  await connectFixtureDatabase(environment.mongoUri)
  const failures: string[] = []
  try {
    for (const entry of [...journal.entries].reverse()) {
      const result = await deleteOwnedResource(entry)
      if (result.existsButNotOwned) {
        failures.push(`${entry.collection}:${entry.id}:ownership-signature-mismatch`)
        continue
      }
      setEntryState(file, journal, entry.id, 'deleted')
    }

    if (failures.length) throw new Error(`Cleanup refused ${failures.length} non-owned record(s): ${failures.join(', ')}`)
    setJournalState(file, journal, 'clean')
    for (const suffix of ['session-secrets.json', 'scenario-context.json']) {
      const sensitiveStateFile = path.join(environment.stateDirectory, `${environment.runId}.${suffix}`)
      if (fs.existsSync(sensitiveStateFile)) fs.rmSync(sensitiveStateFile)
    }
    process.stdout.write(`${JSON.stringify({ status: 'clean', runId: journal.runId, exactIdsChecked: journal.entries.length }, null, 2)}\n`)
  } catch (error) {
    setJournalState(file, journal, 'failed', error)
    throw error
  } finally {
    await disconnectFixtureDatabase()
  }
}

if (require.main === module) {
  cleanupFixtures().catch(error => {
    process.stderr.write(`Fixture cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
