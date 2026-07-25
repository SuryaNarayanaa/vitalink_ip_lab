import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  DYNAMIC_LEDGER_SCHEMA_VERSION,
  type DynamicAllocation,
  type DynamicMutationEffect,
  type DynamicMutationEntry,
  type DynamicMutationLedger,
} from '../fixtures/dynamic/types'
import { assertValidEffect, canonicalJson } from '../fixtures/dynamic/validation'

const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function errorText(error: unknown): string {
  return String(error instanceof Error ? error.message : error).slice(0, 1000)
}

function effectPlanIdentity(effect: DynamicMutationEffect): string {
  if (effect.kind === 'database-delete' || effect.kind === 'database-restore' || effect.kind === 'session') {
    return canonicalJson({ kind: effect.kind, collection: effect.collection, ownership: effect.ownership })
  }
  if (effect.kind === 'provider') {
    return canonicalJson({
      kind: effect.kind,
      provider: effect.provider,
      cleanupAction: effect.cleanupAction,
      ownership: effect.ownership,
    })
  }
  return canonicalJson({
    kind: effect.kind,
    storageProvider: effect.storageProvider,
    cleanupAction: effect.cleanupAction,
    ownership: effect.ownership,
  })
}

export function dynamicLedgerPath(stateDirectory: string, runId: string): string {
  if (!SAFE_RUN_ID.test(runId)) throw new Error('Unsafe dynamic mutation run ID')
  if (!path.isAbsolute(stateDirectory)) throw new Error('Dynamic ledger directory must be absolute')
  return path.join(stateDirectory, `${runId}.dynamic-mutations.json`)
}

function assertLedger(value: DynamicMutationLedger, expectedRunId?: string): void {
  if (
    value.schemaVersion !== DYNAMIC_LEDGER_SCHEMA_VERSION
    || !SAFE_RUN_ID.test(value.runId)
    || !Array.isArray(value.entries)
    || (expectedRunId && value.runId !== expectedRunId)
  ) {
    throw new Error('Unsupported, corrupt, or mismatched dynamic mutation ledger')
  }
  const requestIds = new Set<string>()
  for (const entry of value.entries) {
    if (!entry?.allocation?.requestId || requestIds.has(entry.allocation.requestId)) {
      throw new Error('Dynamic mutation ledger contains a missing or duplicate request ID')
    }
    if (entry.allocation.runId !== value.runId) throw new Error('Dynamic mutation entry belongs to another run')
    if (!Array.isArray(entry.effects) || entry.effects.length === 0) {
      throw new Error(`Dynamic mutation ${entry.allocation.requestId} has no cleanup effects`)
    }
    entry.effects.forEach(assertValidEffect)
    requestIds.add(entry.allocation.requestId)
  }
}

export class DurableMutationLedger {
  readonly file: string
  private readonly runId: string
  private readonly databaseName: string

  constructor(stateDirectory: string, runId: string, databaseName: string) {
    if (!databaseName.trim()) throw new Error('Dynamic mutation ledger requires an exact database name')
    this.file = dynamicLedgerPath(stateDirectory, runId)
    this.runId = runId
    this.databaseName = databaseName
  }

  initialize(): DynamicMutationLedger {
    if (fs.existsSync(this.file)) return this.read()
    const timestamp = new Date().toISOString()
    const ledger: DynamicMutationLedger = {
      schemaVersion: DYNAMIC_LEDGER_SCHEMA_VERSION,
      runId: this.runId,
      databaseName: this.databaseName,
      state: 'open',
      createdAt: timestamp,
      updatedAt: timestamp,
      entries: [],
    }
    this.write(ledger, true)
    return clone(ledger)
  }

  read(): DynamicMutationLedger {
    const backup = `${this.file}.bak`
    if (!fs.existsSync(this.file) && fs.existsSync(backup)) fs.renameSync(backup, this.file)
    const ledger = JSON.parse(fs.readFileSync(this.file, 'utf8')) as DynamicMutationLedger
    assertLedger(ledger, this.runId)
    if (ledger.databaseName !== this.databaseName) throw new Error('Dynamic mutation ledger database identity mismatch')
    return ledger
  }

  plan(
    allocation: DynamicAllocation,
    leaseToken: string,
    effects: DynamicMutationEffect[],
  ): DynamicMutationEntry {
    if (allocation.runId !== this.runId) throw new Error('Allocation belongs to another run')
    if (!Array.isArray(effects) || effects.length === 0) {
      throw new Error('Mutation must declare cleanup effects before the API request')
    }
    effects.forEach(assertValidEffect)
    const ledger = this.readOrInitialize()
    if (ledger.state !== 'open') throw new Error(`Cannot plan mutation while ledger is ${ledger.state}`)
    if (ledger.entries.some(entry => entry.allocation.requestId === allocation.requestId)) {
      throw new Error(`Duplicate dynamic mutation request ID: ${allocation.requestId}`)
    }
    const entry: DynamicMutationEntry = {
      allocation: clone(allocation),
      leaseDigest: crypto.createHash('sha256').update(leaseToken).digest('hex'),
      state: 'planned',
      plannedAt: new Date().toISOString(),
      effects: clone(effects),
    }
    ledger.entries.push(entry)
    this.write(ledger)
    return clone(entry)
  }

  observe(
    requestId: string,
    leaseToken: string,
    response: { status: number; succeeded: boolean },
    observedEffects?: DynamicMutationEffect[],
  ): DynamicMutationEntry {
    if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
      throw new Error('Observed response status is invalid')
    }
    const ledger = this.read()
    if (ledger.state !== 'open') throw new Error(`Cannot observe mutation while ledger is ${ledger.state}`)
    const entry = this.requireEntry(ledger, requestId)
    this.assertLease(entry, leaseToken)
    if (entry.state !== 'planned') throw new Error(`Mutation ${requestId} is already ${entry.state}`)

    if (observedEffects) {
      observedEffects.forEach(assertValidEffect)
      const planned = entry.effects.map(effectPlanIdentity).sort()
      const observed = observedEffects.map(effectPlanIdentity).sort()
      if (canonicalJson(planned) !== canonicalJson(observed)) {
        throw new Error('Observed effects do not exactly match the predeclared cleanup plan')
      }
      entry.effects = clone(observedEffects)
    }
    entry.response = { status: response.status, succeeded: response.succeeded }
    entry.observedAt = new Date().toISOString()
    entry.state = 'observed'
    this.write(ledger)
    return clone(entry)
  }

  updateEntry(
    requestId: string,
    update: (entry: DynamicMutationEntry) => void,
  ): DynamicMutationEntry {
    const ledger = this.read()
    const entry = this.requireEntry(ledger, requestId)
    update(entry)
    this.write(ledger)
    return clone(entry)
  }

  updateLedger(
    update: (ledger: DynamicMutationLedger) => void,
  ): DynamicMutationLedger {
    const ledger = this.readOrInitialize()
    update(ledger)
    this.write(ledger)
    return clone(ledger)
  }

  private readOrInitialize(): DynamicMutationLedger {
    return fs.existsSync(this.file) ? this.read() : this.initialize()
  }

  private requireEntry(ledger: DynamicMutationLedger, requestId: string): DynamicMutationEntry {
    const entry = ledger.entries.find(candidate => candidate.allocation.requestId === requestId)
    if (!entry) throw new Error(`Dynamic mutation entry not found: ${requestId}`)
    return entry
  }

  private assertLease(entry: DynamicMutationEntry, leaseToken: string): void {
    const actual = Buffer.from(crypto.createHash('sha256').update(leaseToken).digest('hex'))
    const expected = Buffer.from(entry.leaseDigest)
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      throw new Error('Dynamic mutation lease token does not match')
    }
  }

  private write(ledger: DynamicMutationLedger, exclusive = false): void {
    assertLedger(ledger, this.runId)
    ledger.updatedAt = new Date().toISOString()
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 })
    const temporary = `${this.file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: exclusive ? 'wx' : 'w',
    })
    if (exclusive && fs.existsSync(this.file)) {
      fs.rmSync(temporary)
      throw new Error('Dynamic mutation ledger already exists')
    }

    const backup = `${this.file}.bak`
    try {
      fs.renameSync(temporary, this.file)
      return
    } catch (error: any) {
      if (!fs.existsSync(this.file) || !['EEXIST', 'EPERM'].includes(error?.code)) throw error
    }
    if (fs.existsSync(backup)) fs.rmSync(backup)
    fs.renameSync(this.file, backup)
    try {
      fs.renameSync(temporary, this.file)
      fs.rmSync(backup)
    } catch (error) {
      if (!fs.existsSync(this.file) && fs.existsSync(backup)) fs.renameSync(backup, this.file)
      throw error
    }
  }
}

export const ledgerInternals = { effectPlanIdentity, errorText }
