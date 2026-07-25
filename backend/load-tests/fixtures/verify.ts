import { connectFixtureDatabase, disconnectFixtureDatabase, findOwnedResource, resourceExists } from './database'
import { loadGuardedEnvironment } from './guards'
import { journalPath, readJournal } from './journal'

export async function verifyFixtures(): Promise<void> {
  const environment = loadGuardedEnvironment({ requireDatabase: true })
  const file = journalPath(environment.stateDirectory, environment.runId)
  const journal = readJournal(file)
  if (journal.databaseName !== environment.databaseName) throw new Error('Journal database does not match guarded target')

  await connectFixtureDatabase(environment.mongoUri)
  try {
    const missing: string[] = []
    const collisions: string[] = []
    for (const entry of journal.entries) {
      const exists = await resourceExists(entry)
      const owned = exists && await findOwnedResource(entry)
      if (!exists) missing.push(`${entry.kind}:${entry.label}`)
      else if (!owned) collisions.push(`${entry.kind}:${entry.label}`)
    }
    if (missing.length || collisions.length || journal.state !== 'seeded') {
      throw new Error(JSON.stringify({ journalState: journal.state, missing, collisions }))
    }
    process.stdout.write(`${JSON.stringify({ status: 'verified', runId: journal.runId, resources: journal.entries.length }, null, 2)}\n`)
  } finally {
    await disconnectFixtureDatabase()
  }
}

if (require.main === module) {
  verifyFixtures().catch(error => {
    process.stderr.write(`Fixture verification failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}

