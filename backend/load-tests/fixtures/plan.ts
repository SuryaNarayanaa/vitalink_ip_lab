import crypto from 'node:crypto'
import { hashPassword } from '../../src/utils/auth.utils'
import type { FixturePlan, FixtureResourceKind, OwnershipSignature, PlannedFixture } from './types'

export const FIXTURE_VERSION = 'vitalink-load-fixtures-v1'

function objectId(runId: string, label: string): string {
  return crypto.createHash('sha256').update(`${FIXTURE_VERSION}:${runId}:${label}`).digest('hex').slice(0, 24)
}

function shortHash(runId: string): string {
  return crypto.createHash('sha256').update(runId).digest('hex').slice(0, 10)
}

function resource(
  runId: string,
  kind: FixtureResourceKind,
  collection: string,
  label: string,
  signature: OwnershipSignature,
  document: Record<string, unknown>,
): PlannedFixture {
  const id = objectId(runId, label)
  return { kind, collection, id, label, signature, document: { _id: id, ...document } }
}

export async function buildFixturePlan(runId: string, password: string): Promise<FixturePlan> {
  const suffix = shortHash(runId)
  const prefix = `load_${suffix}`
  const resources: PlannedFixture[] = []
  const sessionCredentials: FixturePlan['sessionCredentials'] = []
  const now = new Date('2026-01-15T10:00:00.000Z')
  const due = new Date('2026-02-15T10:00:00.000Z')

  const ids = (label: string) => objectId(runId, label)
  const add = (
    kind: FixtureResourceKind,
    collection: string,
    label: string,
    signature: OwnershipSignature,
    document: Record<string, unknown>,
  ) => resources.push(resource(runId, kind, collection, label, signature, document))

  add('runSentinel', 'loadtestruns', 'run-sentinel', { path: 'run_id', value: runId }, {
    run_id: runId,
    fixture_version: FIXTURE_VERSION,
    status: 'seeded',
    created_at: now,
  })

  const hospitals = [
    ['hospital-a', 'A', 'active', true],
    ['hospital-b', 'B', 'active', true],
    ['hospital-suspended', 'S', 'suspended', false],
    ['hospital-inactive', 'I', 'inactive', false],
  ] as const
  for (const [label, code, status, accepting] of hospitals) {
    const hospitalCode = `LT${suffix.toUpperCase()}${code}`
    add('hospital', 'hospitals', label, { path: 'code', value: hospitalCode }, {
      code: hospitalCode,
      name: `${prefix} synthetic hospital ${code}`,
      location: 'Synthetic load-test locality',
      admin_email: `${prefix}.${code.toLowerCase()}@invalid.example`,
      status,
      accepting_assignments: accepting,
      lifecycle_state: 'STABLE',
      lifecycle_generation: 0,
      metadata: { load_test_run_id: runId, synthetic: true },
      createdAt: now,
      updatedAt: now,
    })
  }

  add('systemConfig', 'systemconfigs', 'system-config', { path: 'feature_flags.load_test_fixture', value: true }, {
    inr_thresholds: { critical_low: 1.5, critical_high: 4.5 },
    session_timeout_minutes: 30,
    rate_limit: { max_requests: 10000, window_minutes: 15 },
    feature_flags: {
      maintenance_mode: false,
      patient_registration_enabled: true,
      notifications_enabled: true,
      load_test_fixture: true,
    },
    is_active: true,
    createdAt: now,
    updatedAt: now,
  })

  const admins = [
    ['admin-app', 'App Admin', 'FULL_ACCESS', 'app_admin', undefined],
    ['admin-global-auditor', 'Global Auditor', 'READ_ONLY', 'auditor', undefined],
    ['admin-a', 'Hospital A Admin', 'FULL_ACCESS', 'hospital_admin', ids('hospital-a')],
    ['auditor-a', 'Hospital A Auditor', 'READ_ONLY', 'auditor', ids('hospital-a')],
    ['admin-b', 'Hospital B Admin', 'LIMITED_ACCESS', 'hospital_admin', ids('hospital-b')],
    ['admin-invalid-tenantless', 'Invalid Tenantless Admin', 'LIMITED_ACCESS', 'hospital_admin', undefined],
  ] as const
  for (const [label, title, permission, role, hospitalId] of admins) {
    const name = `${prefix} ${title}`
    add('adminProfile', 'adminprofiles', `${label}-profile`, { path: 'name', value: name }, {
      name,
      permission,
      admin_role: role,
      ...(hospitalId ? { hospital_id: hospitalId } : {}),
      createdAt: now,
      updatedAt: now,
    })
  }

  for (const tenant of ['a', 'b']) {
    for (let index = 1; index <= 2; index += 1) {
      const label = `doctor-${tenant}-${index}`
      const name = `${prefix} Doctor ${tenant.toUpperCase()}${index}`
      add('doctorProfile', 'doctorprofiles', `${label}-profile`, { path: 'name', value: name }, {
        name,
        department: index === 1 ? 'Cardiology' : 'Internal Medicine',
        contact_number: `+9199${suffix.slice(0, 6)}${tenant === 'a' ? '1' : '2'}${index}`.slice(0, 13),
        phone_verification: { status: 'VERIFIED', verified_at: now },
        hospital_id: ids(`hospital-${tenant}`),
        doctor_operation_fence: 0,
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  const patientStatuses = ['Active', 'Active', 'Discharged', 'Deceased'] as const
  for (const tenant of ['a', 'b']) {
    for (let index = 1; index <= patientStatuses.length; index += 1) {
      const label = `patient-${tenant}-${index}`
      const name = `${prefix} Patient ${tenant.toUpperCase()}${index}`
      const doctorLabel = `doctor-${tenant}-${index % 2 === 0 ? 2 : 1}`
      add('patientProfile', 'patientprofiles', `${label}-profile`, { path: 'demographics.name', value: name }, {
        assigned_doctor_id: ids(`${doctorLabel}-user`),
        assigned_doctor_fence: 0,
        hospital_id: ids(`hospital-${tenant}`),
        demographics: {
          name,
          age: 30 + index,
          gender: index % 3 === 0 ? 'Other' : index % 2 === 0 ? 'Female' : 'Male',
          phone: `+9188${suffix.slice(0, 6)}${tenant === 'a' ? '1' : '2'}${index}`.slice(0, 13),
          phone_verification: { status: 'VERIFIED', verified_at: now },
        },
        medical_config: {
          diagnosis: 'Synthetic anticoagulation fixture',
          therapy_drug: 'Warfarin',
          therapy_start_date: now,
          target_inr: { min: 2, max: 3 },
          instructions: ['Synthetic data only'],
          taken_doses: [],
        },
        weekly_dosage: {
          monday: 2, tuesday: 2, wednesday: 2, thursday: 2,
          friday: 2, saturday: 1, sunday: 1,
        },
        inr_history: [{
          _id: ids(`${label}-inr-1`), test_date: now, uploaded_at: now,
          inr_value: 2.4, is_critical: false, notes: 'Synthetic baseline report',
        }],
        health_logs: [{ _id: ids(`${label}-health-1`), date: now, type: 'LIFESTYLE', description: 'Synthetic baseline log' }],
        account_status: patientStatuses[index - 1],
        file_operation_leases: [],
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  const saltFor = (label: string) => crypto.createHash('sha256').update(`${runId}:${label}:salt`).digest('hex').slice(0, 32)
  const addUser = async (label: string, userType: 'ADMIN' | 'DOCTOR' | 'PATIENT', profileLabel: string) => {
    const loginId = `${prefix}_${label}`.toLowerCase()
    const salt = saltFor(label)
    add('user', 'users', `${label}-user`, { path: 'login_id', value: loginId }, {
      login_id: loginId,
      password: await hashPassword(password, salt),
      salt,
      user_type: userType,
      profile_id: ids(`${profileLabel}-profile`),
      user_type_model: userType === 'ADMIN' ? 'AdminProfile' : userType === 'DOCTOR' ? 'DoctorProfile' : 'PatientProfile',
      is_active: true,
      security_version: 0,
      doctor_operation_fence: 0,
      must_change_password: false,
      password_changed_at: now,
      password_history: [],
      failed_login_attempts: 0,
      admin_mfa: { totp: { status: 'DISABLED', factor_generation: 0 } },
      createdAt: now,
      updatedAt: now,
    })
    return loginId
  }

  const accountLoginIds: string[] = []
  for (const [label] of admins) accountLoginIds.push(await addUser(label, 'ADMIN', label))
  for (const tenant of ['a', 'b']) {
    for (let index = 1; index <= 2; index += 1) {
      const label = `doctor-${tenant}-${index}`
      accountLoginIds.push(await addUser(label, 'DOCTOR', label))
    }
    for (let index = 1; index <= patientStatuses.length; index += 1) {
      const label = `patient-${tenant}-${index}`
      accountLoginIds.push(await addUser(label, 'PATIENT', label))
    }
  }

  const sessionOwners = [
    ['appAdmin', 'admin-app', 'ADMIN'],
    ['hospitalAdmin', 'admin-a', 'ADMIN'],
    ['auditor', 'admin-global-auditor', 'ADMIN'],
    ['doctor', 'doctor-a-1', 'DOCTOR'],
    ['doctorOtherTenant', 'doctor-b-1', 'DOCTOR'],
    ['patient', 'patient-a-1', 'PATIENT'],
    ['patientOtherTenant', 'patient-b-1', 'PATIENT'],
  ] as const
  for (const [role, label, userType] of sessionOwners) {
    const sessionLabel = `${label}-session`
    const accessTokenId = crypto.createHash('sha256').update(`${runId}:${sessionLabel}:access`).digest('hex').slice(0, 32)
    const refreshToken = crypto.createHmac('sha256', password).update(`${runId}:${sessionLabel}:refresh`).digest('base64url')
    const userAgent = `VitaLink synthetic load fixture ${runId} ${role}`
    add('authSession', 'authsessions', sessionLabel, { path: 'user_agent', value: userAgent }, {
      user_id: ids(`${label}-user`),
      user_type: userType,
      security_version: 0,
      access_token_id: accessTokenId,
      refresh_token_hash: crypto.createHash('sha256').update(refreshToken).digest('hex'),
      refresh_token_history_hashes: [],
      expires_at: new Date('2030-01-01T00:00:00.000Z'),
      access_expires_at: new Date('2030-01-01T00:00:00.000Z'),
      last_used_at: now,
      ip_address: '127.0.0.1',
      user_agent: userAgent,
      createdAt: now,
      updatedAt: now,
    })
    sessionCredentials.push({
      role,
      loginId: `${prefix}_${label}`.toLowerCase(),
      userId: ids(`${label}-user`),
      userType,
      sessionId: ids(sessionLabel),
      accessTokenId,
      refreshToken,
    })
  }

  for (const label of ['doctor-a-1', 'patient-a-1', 'doctor-b-1', 'patient-b-1']) {
    const title = `${prefix} notification for ${label}`
    add('notification', 'notifications', `${label}-notification`, { path: 'title', value: title }, {
      user_id: ids(`${label}-user`),
      type: 'GENERAL',
      priority: 'MEDIUM',
      title,
      message: 'Synthetic load-test notification',
      data: { load_test_run_id: runId },
      is_read: false,
      push_delivery_required: false,
      createdAt: now,
      updatedAt: now,
    })

    const fcmToken = `${prefix}_${label}_synthetic_fcm_token`
    add('deviceToken', 'devicetokens', `${label}-device`, { path: 'fcm_token', value: fcmToken }, {
      user_id: ids(`${label}-user`),
      fcm_token: fcmToken,
      platform: 'android',
      app_version: 'load-test',
      is_active: true,
      last_refreshed_at: now,
      createdAt: now,
      updatedAt: now,
    })
  }

  const doctorUpdateTitle = `${prefix} doctor update for patient-a-1`
  add('notification', 'notifications', 'patient-a-1-doctor-update', { path: 'title', value: doctorUpdateTitle }, {
    user_id: ids('patient-a-1-user'),
    type: 'DOCTOR_UPDATE',
    priority: 'MEDIUM',
    title: doctorUpdateTitle,
    message: 'Synthetic doctor-update event for load testing',
    data: {
      load_test_run_id: runId,
      change_type: 'DOSAGE_UPDATED',
      changed_fields: ['weekly_dosage'],
      doctor_name: `${prefix} Doctor A1`,
    },
    is_read: false,
    push_delivery_required: false,
    createdAt: now,
    updatedAt: now,
  })

  for (const tenant of ['a', 'b']) {
    const invoiceNumber = `${prefix.toUpperCase()}-${tenant.toUpperCase()}-202601`
    add('invoice', 'invoices', `invoice-${tenant}`, { path: 'invoice_number', value: invoiceNumber }, {
      invoice_number: invoiceNumber,
      hospital_id: ids(`hospital-${tenant}`),
      billing_period: '2026-01',
      plan: 'Synthetic load-test plan',
      amount: 1000,
      status: 'Pending',
      issued_date: now,
      due_date: due,
      payment_metadata: { load_test_run_id: runId, synthetic: true },
      createdAt: now,
      updatedAt: now,
    })

    const description = `${prefix} fixture seed audit ${tenant}`
    add('auditLog', 'auditlogs', `audit-${tenant}`, { path: 'description', value: description }, {
      user_id: ids(`admin-${tenant}-user`),
      user_type: 'ADMIN',
      action: 'USER_CREATE',
      description,
      resource_type: 'LoadTestFixture',
      resource_id: runId,
      success: true,
      metadata: { load_test_run_id: runId, synthetic: true },
      createdAt: now,
      updatedAt: now,
    })
  }

  return { fixtureVersion: FIXTURE_VERSION, runId, prefix, resources, accountLoginIds, sessionCredentials }
}
