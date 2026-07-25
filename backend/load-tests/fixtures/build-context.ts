import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { loadGuardedEnvironment } from './guards'
import { readJournal, journalPath } from './journal'

type SecretSession = {
  loginId: string
  userId: string
  userType: 'ADMIN' | 'DOCTOR' | 'PATIENT'
  accessToken: string
  refreshToken: string
}

type SecretFile = {
  schemaVersion: number
  runId: string
  sessions: Record<string, SecretSession>
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined || value === null || value === '') throw new Error(`Missing fixture context value: ${label}`)
  return value
}

function objectId(runId: string, label: string): string {
  return crypto.createHash('sha256').update(`vitalink-load-fixtures-v1:${runId}:${label}`).digest('hex').slice(0, 24)
}

export function buildScenarioContext(): string {
  const environment = loadGuardedEnvironment({ requireDatabase: false, requirePassword: true })
  const journal = readJournal(journalPath(environment.stateDirectory, environment.runId))
  if (journal.state !== 'seeded') throw new Error(`Fixture journal must be seeded, got ${journal.state}`)

  const secretPath = path.join(environment.stateDirectory, `${environment.runId}.session-secrets.json`)
  const secrets = JSON.parse(fs.readFileSync(secretPath, 'utf8')) as SecretFile
  if (secrets.schemaVersion !== 1 || secrets.runId !== environment.runId) {
    throw new Error('Session secret file does not match the requested run')
  }

  const idByLabel = new Map(journal.entries.map(entry => [entry.label, entry.id]))
  const id = (label: string) => required(idByLabel.get(label), label)
  const session = (role: string) => required(secrets.sessions[role], `sessions.${role}`)
  const token = (role: string) => session(role).accessToken

  const invoiceEntry = journal.entries.find(entry => entry.label === 'invoice-a')
  const suffix = crypto.createHash('sha256').update(environment.runId).digest('hex').slice(0, 10)
  const invoiceNumber = `LOAD_${suffix.toUpperCase()}-A-202601`
  const context = {
    schemaVersion: 1,
    runId: environment.runId,
    tokens: {
      admin: token('appAdmin'),
      appAdmin: token('appAdmin'),
      hospitalAdmin: token('hospitalAdmin'),
      auditor: token('auditor'),
      doctor: token('doctor'),
      doctorOtherTenant: token('doctorOtherTenant'),
      patient: token('patient'),
      patientOtherTenant: token('patientOtherTenant'),
    },
    crossTenantMarkers: [
      `LT${suffix.toUpperCase()}B`,
      `load_${suffix} Doctor B1`,
      `load_${suffix} Patient B1`,
      session('patientOtherTenant').loginId,
    ],
    ids: {
      hospitalId: id('hospital-a'),
      doctorId: session('doctor').userId,
      reassignDoctorId: id('doctor-a-2-user'),
      patientId: session('patient').userId,
      patientOpNum: session('patient').loginId,
      patientOtherTenantOpNum: session('patientOtherTenant').loginId,
      patientOtherTenantId: session('patientOtherTenant').userId,
      doctorOtherTenantId: session('doctorOtherTenant').userId,
      userId: id('patient-a-2-user'),
      notificationId: id('patient-a-1-notification'),
      doctorUpdateEventId: id('patient-a-1-doctor-update'),
      eventId: id('patient-a-1-doctor-update'),
      reportId: objectId(environment.runId, 'patient-a-1-inr-1'),
      patientOtherTenantReportId: objectId(environment.runId, 'patient-b-1-inr-1'),
      invoiceId: required(invoiceEntry?.id, 'invoice-a'),
      tokenId: id('patient-a-1-device'),
      deviceTokenId: id('patient-a-1-device'),
      roleKey: 'auditor',
      alternateDoctorId: id('doctor-a-2-user'),
      disposableHospitalId: id('hospital-suspended'),
      disposableAdminUserId: id('admin-invalid-tenantless-user'),
      disposableUserId: id('patient-a-4-user'),
      disposableDoctorId: id('doctor-a-2-user'),
      disposablePatientId: id('patient-a-4-user'),
      billingPeriod: '2026-12',
    },
    payloads: {
      currentPassword: environment.fixturePassword,
      newPassword: 'VitaLink_Load_Test_Rotated_2026!',
    },
    files: {
      profilePicture: {
        filename: 'synthetic-load-test.png',
        contentType: 'image/png',
        base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      },
      report: {
        filename: 'synthetic-load-test.pdf',
        contentType: 'application/pdf',
        base64: 'JVBERi0xLjQKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyA+PiBlbmRvYmoKdHJhaWxlciA8PCAvUm9vdCAxIDAgUiA+PgolJUVPRgo=',
      },
    },
    doctor: {
      ids: {
        notificationId: id('doctor-a-1-notification'),
        patientOpNum: session('patient').loginId,
        reportId: objectId(environment.runId, 'patient-a-1-inr-1'),
        reassignDoctorId: id('doctor-a-2-user'),
      },
    },
    patient: {
      ids: {
        notificationId: id('patient-a-1-notification'),
        doctorUpdateEventId: id('patient-a-1-doctor-update'),
        reportId: objectId(environment.runId, 'patient-a-1-inr-1'),
      },
    },
    webhook: {
      invoiceNumber,
      sessionId: `load_${environment.runId}_checkout_session`,
      amount: 1000,
      currency: 'INR',
      eventId: `load_${environment.runId}_payment_event`,
      timestamp: '2026-01-15T10:00:00.000Z',
    },
  }

  const output = path.join(environment.stateDirectory, `${environment.runId}.scenario-context.json`)
  fs.writeFileSync(output, `${JSON.stringify(context, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  process.stdout.write(`${JSON.stringify({ status: 'created', runId: environment.runId, contextFile: output })}\n`)
  return output
}

if (require.main === module) {
  try {
    buildScenarioContext()
  } catch (error) {
    process.stderr.write(`Scenario context build failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
