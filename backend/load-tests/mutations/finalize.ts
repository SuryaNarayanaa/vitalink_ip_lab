import fs from 'node:fs'
import { connectFixtureDatabase, disconnectFixtureDatabase } from '../fixtures/database'
import { loadGuardedMutationEnvironment } from './guard'
import { DurableMutationLedger, dynamicLedgerPath } from './ledger'
import { mongoReconcilerRegistry } from './mongo-reconciler'
import { MutationReconciliationCoordinator } from './reconcile'

export async function finalizeDynamicMutations(): Promise<void> {
  const environment = loadGuardedMutationEnvironment()
  const file = dynamicLedgerPath(environment.stateDirectory, environment.runId)
  if (!fs.existsSync(file)) {
    process.stdout.write(`${JSON.stringify({ status: 'clean', runId: environment.runId, entries: 0 })}\n`)
    return
  }

  const ledger = new DurableMutationLedger(
    environment.stateDirectory,
    environment.runId,
    environment.databaseName,
  )
  await connectFixtureDatabase(environment.mongoUri)
  try {
    const result = await new MutationReconciliationCoordinator(
      ledger,
      mongoReconcilerRegistry(),
    ).reconcileAll()
    if (result.state !== 'clean') throw new Error(result.lastError || 'Dynamic mutation reconciliation failed')
    process.stdout.write(`${JSON.stringify({
      status: result.state,
      runId: result.runId,
      entries: result.entries.length,
      reconciled: result.entries.filter(entry => entry.state === 'reconciled').length,
    }, null, 2)}\n`)
  } finally {
    await disconnectFixtureDatabase()
  }
}

if (require.main === module) {
  finalizeDynamicMutations().catch(error => {
    process.stderr.write(`Dynamic mutation finalizer failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
