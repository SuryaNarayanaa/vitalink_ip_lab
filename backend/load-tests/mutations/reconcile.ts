import type {
  DynamicMutationEntry,
  DynamicMutationLedger,
  ReconcilerRegistry,
} from '../fixtures/dynamic/types'
import { DurableMutationLedger } from './ledger'

function errorText(error: unknown): string {
  return String(error instanceof Error ? error.message : error).slice(0, 1000)
}

export class MutationReconciliationCoordinator {
  constructor(
    private readonly ledger: DurableMutationLedger,
    private readonly reconcilers: ReconcilerRegistry,
  ) {}

  async reconcileAll(): Promise<DynamicMutationLedger> {
    this.ledger.updateLedger(current => {
      if (current.state === 'clean') return
      current.state = 'reconciling'
      current.lastError = undefined
    })

    const snapshot = this.ledger.read()
    const failures: string[] = []
    for (const entry of [...snapshot.entries].reverse()) {
      if (entry.state === 'reconciled') continue
      try {
        await this.reconcileEntry(entry)
      } catch (error) {
        const message = errorText(error)
        failures.push(`${entry.allocation.requestId}:${message}`)
        this.ledger.updateEntry(entry.allocation.requestId, current => {
          current.state = 'failed'
          current.lastError = message
        })
      }
    }

    return this.ledger.updateLedger(current => {
      const unresolved = current.entries.filter(entry => entry.state !== 'reconciled')
      if (failures.length || unresolved.length) {
        current.state = 'failed'
        current.lastError = failures.join(' | ') || `${unresolved.length} mutation(s) remain unreconciled`
        return
      }
      current.state = 'clean'
      current.lastError = undefined
    })
  }

  private async reconcileEntry(entry: DynamicMutationEntry): Promise<void> {
    this.ledger.updateEntry(entry.allocation.requestId, current => {
      current.state = 'reconciling'
      current.reconciliationStartedAt = new Date().toISOString()
      current.lastError = undefined
    })

    for (const effect of [...entry.effects].reverse()) {
      const reconciler = this.reconcilers[effect.kind]
      if (!reconciler) {
        throw new Error(`No registered reconciler for ${effect.kind}; cleanup refused`)
      }
      await reconciler(effect, entry)
    }

    this.ledger.updateEntry(entry.allocation.requestId, current => {
      current.state = 'reconciled'
      current.reconciledAt = new Date().toISOString()
      current.lastError = undefined
    })
  }
}
