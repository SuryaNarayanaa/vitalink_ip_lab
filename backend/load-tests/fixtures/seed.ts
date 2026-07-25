import { buildFixturePlan } from './plan'
import { connectFixtureDatabase, createResource, disconnectFixtureDatabase, findOwnedResource, resourceExists, withFixtureTransaction } from './database'
import { createJournal, journalPath, readJournal, setEntryState, setJournalState, writeJournal } from './journal'
import { loadGuardedEnvironment } from './guards'
import fs from 'node:fs'
import path from 'node:path'
import jwt from 'jsonwebtoken'

function writeSessionSecrets(
  stateDirectory: string,
  runId: string,
  jwtSecret: string,
  credentials: Awaited<ReturnType<typeof buildFixturePlan>>['sessionCredentials'],
): string {
  const file = path.join(stateDirectory, `${runId}.session-secrets.json`)
  const sessions = Object.fromEntries(credentials.map(credential => [credential.role, {
    loginId: credential.loginId,
    userId: credential.userId,
    userType: credential.userType,
    accessToken: jwt.sign({
      user_id: credential.userId,
      user_type: credential.userType,
      session_id: credential.sessionId,
      token_id: credential.accessTokenId,
    }, jwtSecret, { expiresIn: '24h' }),
    refreshToken: credential.refreshToken,
  }]))
  fs.writeFileSync(file, `${JSON.stringify({ schemaVersion: 1, runId, sessions }, null, 2)}\n`, {
    encoding: 'utf8', mode: 0o600,
  })
  return file
}

export async function seedFixtures(options: { dryRun?: boolean } = {}): Promise<void> {
  const environment = loadGuardedEnvironment({ requireDatabase: !options.dryRun, requirePassword: true })
  const plan = await buildFixturePlan(environment.runId, environment.fixturePassword!)
  const file = journalPath(environment.stateDirectory, environment.runId)

  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({
      mode: 'dry-run', runId: plan.runId, fixtureVersion: plan.fixtureVersion,
      resourceCount: plan.resources.length, accountCount: plan.accountLoginIds.length,
      resourceKinds: [...new Set(plan.resources.map(item => item.kind))],
    }, null, 2)}\n`)
    return
  }

  let journal
  try {
    journal = readJournal(file)
    if (journal.runId !== plan.runId || journal.databaseName !== environment.databaseName) {
      throw new Error('Existing journal does not match the requested run/database')
    }
    if (journal.state === 'clean') {
      journal = createJournal(plan, environment.databaseName, environment.databaseHosts)
      writeJournal(file, journal)
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error
    journal = createJournal(plan, environment.databaseName, environment.databaseHosts)
    writeJournal(file, journal)
  }

  setJournalState(file, journal, 'seeding')
  await connectFixtureDatabase(environment.mongoUri)
  try {
    for (const resource of plan.resources) {
      if (await resourceExists(resource) && !(await findOwnedResource(resource))) {
        throw new Error(`Refusing deterministic ID collision for ${resource.label} (${resource.id})`)
      }
    }

    await withFixtureTransaction(async session => {
      for (const resource of plan.resources) {
        if (!(await findOwnedResource(resource))) await createResource(resource, session)
      }
    })

    for (const resource of plan.resources) setEntryState(file, journal, resource.id, 'created')
    const sessionSecretsFile = writeSessionSecrets(
      environment.stateDirectory,
      environment.runId,
      environment.jwtSecret!,
      plan.sessionCredentials,
    )
    setJournalState(file, journal, 'seeded')
    process.stdout.write(`${JSON.stringify({
      status: 'seeded', runId: plan.runId, database: environment.databaseName,
      resources: plan.resources.length, accounts: plan.accountLoginIds,
      cleanupJournal: file,
      sessionSecretsFile,
    }, null, 2)}\n`)
  } catch (error) {
    setJournalState(file, journal, 'failed', error)
    throw error
  } finally {
    await disconnectFixtureDatabase()
  }
}

if (require.main === module) {
  seedFixtures({ dryRun: process.argv.includes('--dry-run') }).catch(error => {
    process.stderr.write(`Fixture seed failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
