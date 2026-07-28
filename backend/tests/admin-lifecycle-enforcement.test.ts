import mongoose from 'mongoose'
import { AdminProfile, Hospital, User } from '@alias/models'
import type { AdminAccessContext } from '@alias/types/admin-access'
import { DEFAULT_ADMIN_ROLE_POLICIES } from '@alias/constants/admin-capabilities'
import {
  assertAdminRoleScopePayload,
  assertEditableAdminRole,
  createAdminAccount,
  listAdminAccounts,
  resetAdminAccountMfa,
  updateAdminAccount,
} from '@alias/services/admin-account.service'
import {
  assertOperationalAccountPayloadSafe,
  performBatchOperation,
  registerDoctor,
} from '@alias/services/admin.service'
import * as authSessionService from '@alias/services/auth-session.service'
import * as doctorAssignmentService from '@alias/services/doctor-assignment.service'
import {
  createDoctorSchema,
  createPatientSchema,
  updateDoctorSchema,
  updatePatientSchema,
} from '@alias/validators/admin.validator'

const appAdminContext: AdminAccessContext = {
  userId: new mongoose.Types.ObjectId().toString(),
  role: 'app_admin',
  scope: 'global',
  permissions: { ...DEFAULT_ADMIN_ROLE_POLICIES.app_admin },
  policyVersion: 2,
  readOnly: false,
}

const hospitalAdminContext: AdminAccessContext = {
  userId: new mongoose.Types.ObjectId().toString(),
  role: 'hospital_admin',
  scope: 'tenant',
  hospitalId: new mongoose.Types.ObjectId().toString(),
  hospitalCode: 'H001',
  permissions: { ...DEFAULT_ADMIN_ROLE_POLICIES.hospital_admin },
  policyVersion: 2,
  readOnly: false,
}

function queryResult<T>(value: T) {
  const query: any = {
    select: jest.fn(),
    sort: jest.fn(),
    lean: jest.fn().mockResolvedValue(value),
    populate: jest.fn(),
  }
  query.select.mockReturnValue(query)
  query.sort.mockReturnValue(query)
  query.populate.mockReturnValue(query)
  return query
}

function mockSupportedTransactionSession() {
  const session = {
    withTransaction: jest.fn(async (work: () => Promise<void>) => work()),
    endSession: jest.fn(async () => undefined),
  }
  jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as any)
  return session
}

function mockUnsupportedTransactionSession() {
  const session = {
    withTransaction: jest.fn().mockRejectedValue(
      new Error('Transaction numbers are only allowed on a replica set member'),
    ),
    endSession: jest.fn(async () => undefined),
  }
  jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as any)
  return session
}

describe('strict Doctor and Patient administrative payloads', () => {
  test.each([
    ['Doctor create password', createDoctorSchema, {
      body: {
        login_id: 'doctor-1',
        password: 'Forbidden1!',
        name: 'Doctor One',
        contact_number: '+919000000001',
      },
    }],
    ['Doctor update status', updateDoctorSchema, {
      params: { id: 'doctor-1' },
      body: { name: 'Doctor One', is_active: false },
    }],
    ['Patient create clinical configuration', createPatientSchema, {
      body: {
        login_id: 'patient-1',
        assigned_doctor_id: 'doctor-1',
        demographics: { name: 'Patient One', phone: '+919000000002' },
        medical_config: { diagnosis: 'Forbidden diagnosis' },
      },
    }],
    ['Patient update treatment data', updatePatientSchema, {
      params: { id: 'patient-1' },
      body: {
        demographics: { name: 'Patient One' },
        treatment_data: { dose: 2 },
      },
    }],
    ['Patient update assignment through generic route', updatePatientSchema, {
      params: { id: 'patient-1' },
      body: { assigned_doctor_id: 'doctor-2' },
    }],
  ])('%s is rejected as one request', async (_label, schema, payload) => {
    const result = await schema.safeParseAsync(payload)
    expect(result.success).toBe(false)
  })

  test('non-clinical administrative payloads remain valid', async () => {
    await expect(createDoctorSchema.parseAsync({
      body: {
        login_id: 'doctor-1',
        name: 'Doctor One',
        department: 'Cardiology',
        contact_number: '+919000000001',
      },
    })).resolves.toBeDefined()

    await expect(createPatientSchema.parseAsync({
      body: {
        login_id: 'patient-1',
        assigned_doctor_id: 'doctor-1',
        demographics: { name: 'Patient One', phone: '+919000000002' },
      },
    })).resolves.toBeDefined()
  })

  test('service preflight rejects nested security and clinical fields before model writes', async () => {
    const userLookup = jest.spyOn(User, 'findOne')
    await expect(registerDoctor({
      login_id: 'doctor-1',
      password: 'Forbidden1!',
      name: 'Doctor One',
      contact_number: '+919000000001',
    }, hospitalAdminContext as any)).rejects.toMatchObject({ statusCode: 400 })
    expect(userLookup).not.toHaveBeenCalled()

    expect(() => assertOperationalAccountPayloadSafe({
      demographics: { name: 'Patient One' },
      medical_config: { dosage_schedule: { monday: 2 } },
    }, { patient: true })).toThrow(/medical_config/)
    expect(() => assertOperationalAccountPayloadSafe({
      demographics: { name: 'Patient One' },
      security: { mfa_enabled: true },
    }, { patient: true })).toThrow(/security/)
  })
})

describe('dedicated administrator account lifecycle', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('accepts only Hospital Admin and Auditor with their fixed scope invariants', () => {
    expect(() => assertEditableAdminRole('app_admin')).toThrow(/only use/)
    expect(() => assertAdminRoleScopePayload('hospital_admin', {})).toThrow(/one active hospital/)
    expect(() => assertAdminRoleScopePayload('auditor', { hospital_id: 'H001' })).toThrow(/must not/)
    expect(() => assertAdminRoleScopePayload('hospital_admin', { hospital_id: 'H001' })).not.toThrow()
    expect(() => assertAdminRoleScopePayload('auditor', {})).not.toThrow()
  })

  test('hard-denies administrator lifecycle to a Hospital Admin before target access', async () => {
    const profileLookup = jest.spyOn(AdminProfile, 'find')
    const userLookup = jest.spyOn(User, 'findOne')
    await expect(listAdminAccounts(hospitalAdminContext)).rejects.toMatchObject({ statusCode: 403 })
    await expect(updateAdminAccount(
      new mongoose.Types.ObjectId().toString(),
      { status: 'inactive' },
      hospitalAdminContext,
    )).rejects.toMatchObject({ statusCode: 403 })
    expect(profileLookup).not.toHaveBeenCalled()
    expect(userLookup).not.toHaveBeenCalled()
  })

  test('listAdminAccounts soft-fails a hospital_admin with missing hospital instead of failing the whole list', async () => {
    const healthyProfileId = new mongoose.Types.ObjectId()
    const brokenProfileId = new mongoose.Types.ObjectId()
    const healthyHospitalId = new mongoose.Types.ObjectId()
    const missingHospitalId = new mongoose.Types.ObjectId()
    const healthyUserId = new mongoose.Types.ObjectId()
    const brokenUserId = new mongoose.Types.ObjectId()

    jest.spyOn(AdminProfile, 'find').mockReturnValue(queryResult([
      {
        _id: healthyProfileId,
        name: 'Healthy Admin',
        admin_role: 'hospital_admin',
        hospital_id: healthyHospitalId,
      },
      {
        _id: brokenProfileId,
        name: 'Broken Admin',
        admin_role: 'hospital_admin',
        hospital_id: missingHospitalId,
      },
    ]) as any)
    jest.spyOn(Hospital, 'find').mockReturnValue(queryResult([
      {
        _id: healthyHospitalId,
        code: 'HOK',
        name: 'Healthy Hospital',
        status: 'ACTIVE',
      },
    ]) as any)
    jest.spyOn(User, 'find').mockReturnValue(queryResult([
      {
        _id: healthyUserId,
        login_id: 'healthy@example.com',
        profile_id: healthyProfileId,
        is_active: true,
        admin_mfa: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        _id: brokenUserId,
        login_id: 'broken@example.com',
        profile_id: brokenProfileId,
        is_active: true,
        admin_mfa: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]) as any)

    const result = await listAdminAccounts(appAdminContext)
    expect(result.admin_accounts).toHaveLength(2)
    const healthy = result.admin_accounts.find((row: any) => row.login_id === 'healthy@example.com')
    const broken = result.admin_accounts.find((row: any) => row.login_id === 'broken@example.com')
    expect(healthy).toMatchObject({
      assignment_status: 'ok',
      hospital: { code: 'HOK' },
    })
    expect(broken).toMatchObject({
      assignment_status: 'invalid',
      hospital: null,
      assignment_error: expect.stringMatching(/active hospital/i),
    })
  })

  test('never creates an Application Admin through the portal lifecycle', async () => {
    const userLookup = jest.spyOn(User, 'exists')
    await expect(createAdminAccount({
      name: 'Another Root',
      email: 'another-root@example.com',
      role: 'app_admin',
    }, appAdminContext)).rejects.toMatchObject({ statusCode: 400 })
    expect(userLookup).not.toHaveBeenCalled()
  })

  test('never targets or promotes an Application Admin', async () => {
    const userId = new mongoose.Types.ObjectId()
    const profileId = new mongoose.Types.ObjectId()
    jest.spyOn(User, 'findOne').mockReturnValue(queryResult({
      _id: userId,
      login_id: 'root@example.com',
      user_type: 'ADMIN',
      profile_id: profileId,
      is_active: true,
      security_version: 4,
    }) as any)
    jest.spyOn(AdminProfile, 'findById').mockReturnValue(queryResult({
      _id: profileId,
      name: 'Root',
      admin_role: 'app_admin',
    }) as any)

    await expect(updateAdminAccount(
      userId.toString(),
      { role: 'auditor' },
      appAdminContext,
    )).rejects.toMatchObject({ statusCode: 403 })
    await expect(resetAdminAccountMfa(userId.toString(), appAdminContext))
      .rejects.toMatchObject({ statusCode: 403 })
    expect(() => assertEditableAdminRole('app_admin')).toThrow()
  })

  test('role and scope changes bump security_version and revoke active sessions', async () => {
    const userId = new mongoose.Types.ObjectId()
    const profileId = new mongoose.Types.ObjectId()
    const hospitalId = new mongoose.Types.ObjectId()
    const currentUser = {
      _id: userId,
      login_id: 'hospital-admin@example.com',
      user_type: 'ADMIN',
      profile_id: profileId,
      is_active: true,
      security_version: 5,
      admin_mfa: { totp: { status: 'DISABLED' } },
    }
    const currentProfile = {
      _id: profileId,
      name: 'Hospital Admin',
      admin_role: 'hospital_admin',
      hospital_id: hospitalId,
    }
    const session = mockSupportedTransactionSession()
    jest.spyOn(User, 'findOne').mockReturnValue(queryResult(currentUser) as any)
    jest.spyOn(AdminProfile, 'findById').mockReturnValue(queryResult(currentProfile) as any)
    const profileUpdate = jest.spyOn(AdminProfile, 'findOneAndUpdate').mockReturnValue(queryResult({
      ...currentProfile,
      admin_role: 'auditor',
      hospital_id: undefined,
    }) as any)
    const userUpdate = jest.spyOn(User, 'findOneAndUpdate').mockReturnValue(queryResult({
      ...currentUser,
      security_version: 6,
    }) as any)
    const revoke = jest.spyOn(authSessionService, 'bestEffortRevokeSessionsAfterSecurityVersionBump')
      .mockResolvedValue({ modifiedCount: 2, cleanupCompleted: true })
    jest.spyOn(doctorAssignmentService, 'acquireHospitalMembershipGuards').mockResolvedValue([{
      assertOwned: jest.fn(async () => undefined),
      release: jest.fn(async () => undefined),
    }] as any)

    const result = await updateAdminAccount(userId.toString(), { role: 'auditor' }, appAdminContext)

    expect(session.withTransaction).toHaveBeenCalledTimes(1)
    expect(session.endSession).toHaveBeenCalledTimes(1)
    expect(profileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: profileId,
        admin_role: 'hospital_admin',
        hospital_id: hospitalId,
      }),
      expect.objectContaining({
        $set: expect.objectContaining({ admin_role: 'auditor' }),
        $unset: { hospital_id: 1 },
      }),
      expect.objectContaining({ new: true, runValidators: true, session }),
    )
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: userId, security_version: 5 }),
      { $set: { is_active: true }, $inc: { security_version: 1 } },
      expect.objectContaining({ new: true, runValidators: true, session }),
    )
    expect(revoke).toHaveBeenCalledWith(userId.toString(), 'USER_REVOKED')
    expect(result).toMatchObject({
      security_version_bumped: true,
      invalidated_sessions: 2,
      admin_account: { role: 'auditor', hospital: null },
    })
  }, 15000)

  test('status changes atomically bump security_version and revoke sessions best effort', async () => {
    const userId = new mongoose.Types.ObjectId()
    const profileId = new mongoose.Types.ObjectId()
    const currentUser = {
      _id: userId,
      login_id: 'auditor@example.com',
      user_type: 'ADMIN',
      profile_id: profileId,
      is_active: true,
      security_version: 7,
      admin_mfa: { totp: { status: 'DISABLED' } },
    }
    const updatedUser = { ...currentUser, is_active: false, security_version: 8 }
    const session = mockSupportedTransactionSession()
    jest.spyOn(User, 'findOne').mockReturnValue(queryResult(currentUser) as any)
    jest.spyOn(AdminProfile, 'findById').mockReturnValue(queryResult({
      _id: profileId,
      name: 'Audit User',
      admin_role: 'auditor',
    }) as any)
    const userUpdate = jest.spyOn(User, 'findOneAndUpdate')
      .mockReturnValue(queryResult(updatedUser) as any)
    const revoke = jest.spyOn(authSessionService, 'bestEffortRevokeSessionsAfterSecurityVersionBump')
      .mockResolvedValue({ modifiedCount: 3, cleanupCompleted: true })

    const result = await updateAdminAccount(userId.toString(), { status: 'inactive' }, appAdminContext)

    expect(session.withTransaction).toHaveBeenCalledTimes(1)
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: userId,
        is_active: true,
        security_version: 7,
      }),
      {
        $set: { is_active: false },
        $inc: { security_version: 1 },
      },
      expect.objectContaining({ new: true, runValidators: true, session }),
    )
    expect(revoke).toHaveBeenCalledWith(userId.toString(), 'ACCOUNT_DISABLED')
    expect(result).toMatchObject({
      invalidated_sessions: 3,
      revocation_cleanup_completed: true,
      security_version_bumped: true,
      admin_account: { role: 'auditor', is_active: false },
    })
  })

  test('falls back to non-transactional CAS when MongoDB rejects transactions', async () => {
    const userId = new mongoose.Types.ObjectId()
    const profileId = new mongoose.Types.ObjectId()
    const hospitalId = new mongoose.Types.ObjectId()
    const currentUser = {
      _id: userId,
      login_id: 'hospital-admin@example.com',
      user_type: 'ADMIN',
      profile_id: profileId,
      is_active: true,
      security_version: 3,
      admin_mfa: { totp: { status: 'DISABLED' } },
    }
    const currentProfile = {
      _id: profileId,
      name: 'Hospital Admin',
      admin_role: 'hospital_admin',
      hospital_id: hospitalId,
    }
    const session = mockUnsupportedTransactionSession()
    jest.spyOn(User, 'findOne').mockReturnValue(queryResult(currentUser) as any)
    jest.spyOn(AdminProfile, 'findById').mockReturnValue(queryResult(currentProfile) as any)
    const profileUpdate = jest.spyOn(AdminProfile, 'findOneAndUpdate').mockReturnValue(queryResult({
      ...currentProfile,
      admin_role: 'auditor',
      hospital_id: undefined,
    }) as any)
    const userUpdate = jest.spyOn(User, 'findOneAndUpdate').mockReturnValue(queryResult({
      ...currentUser,
      security_version: 4,
    }) as any)
    jest.spyOn(authSessionService, 'bestEffortRevokeSessionsAfterSecurityVersionBump')
      .mockResolvedValue({ modifiedCount: 1, cleanupCompleted: true })
    jest.spyOn(doctorAssignmentService, 'acquireHospitalMembershipGuards').mockResolvedValue([{
      assertOwned: jest.fn(async () => undefined),
      release: jest.fn(async () => undefined),
    }] as any)

    const result = await updateAdminAccount(userId.toString(), { role: 'auditor' }, appAdminContext)

    expect(session.withTransaction).toHaveBeenCalledTimes(1)
    expect(session.endSession).toHaveBeenCalledTimes(1)
    // Fallback path must not attach a session option, and must not double-write
    // after a partial transactional probe.
    expect(profileUpdate).toHaveBeenCalledTimes(1)
    expect(userUpdate).toHaveBeenCalledTimes(1)
    expect(profileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: profileId }),
      expect.objectContaining({ $set: expect.objectContaining({ admin_role: 'auditor' }) }),
      { new: true, runValidators: true },
    )
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: userId, security_version: 3 }),
      { $set: { is_active: true }, $inc: { security_version: 1 } },
      { new: true, runValidators: true },
    )
    expect(result).toMatchObject({
      security_version_bumped: true,
      admin_account: { role: 'auditor', hospital: null },
    })
  })

  test('standalone compensation never force-disables when concurrent CAS already advanced the account', async () => {
    const userId = new mongoose.Types.ObjectId()
    const profileId = new mongoose.Types.ObjectId()
    const hospitalId = new mongoose.Types.ObjectId()
    const currentUser = {
      _id: userId,
      login_id: 'hospital-admin@example.com',
      user_type: 'ADMIN',
      profile_id: profileId,
      is_active: true,
      security_version: 9,
      admin_mfa: { totp: { status: 'DISABLED' } },
    }
    const currentProfile = {
      _id: profileId,
      name: 'Hospital Admin',
      admin_role: 'hospital_admin',
      hospital_id: hospitalId,
    }
    mockUnsupportedTransactionSession()
    jest.spyOn(User, 'findOne').mockReturnValue(queryResult(currentUser) as any)
    jest.spyOn(AdminProfile, 'findById').mockReturnValue(queryResult(currentProfile) as any)
    jest.spyOn(AdminProfile, 'findOneAndUpdate').mockReturnValue(queryResult({
      ...currentProfile,
      admin_role: 'auditor',
      hospital_id: undefined,
    }) as any)
    // Both CAS writes succeed; post-user membership re-check fails so compensation runs.
    jest.spyOn(User, 'findOneAndUpdate').mockReturnValue(queryResult({
      ...currentUser,
      security_version: 10,
    }) as any)
    const assertOwned = jest.fn()
      .mockResolvedValueOnce(undefined) // outer preflight
      .mockResolvedValueOnce(undefined) // after profile CAS (role/scope)
      .mockResolvedValueOnce(undefined) // pre user-write
      .mockRejectedValueOnce(new Error('membership lease lost')) // post user-write
    jest.spyOn(doctorAssignmentService, 'acquireHospitalMembershipGuards').mockResolvedValue([{
      assertOwned,
      release: jest.fn(async () => undefined),
    }] as any)
    jest.spyOn(AdminProfile, 'updateOne').mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    } as any)
    // User restore CAS misses because a concurrent request already advanced the account.
    // Version N+1 with the same is_active must NOT be force-disabled — that state can
    // belong to the concurrent winner (discussion_r3658443887).
    const userUpdateOne = jest.spyOn(User, 'updateOne').mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    } as any)
    jest.spyOn(User, 'findById').mockReturnValue(queryResult({
      _id: userId,
      is_active: true,
      // Concurrent winner advanced by exactly one from the post-write version.
      security_version: 11,
    }) as any)
    jest.spyOn(authSessionService, 'bestEffortRevokeSessionsAfterSecurityVersionBump')
      .mockResolvedValue({ modifiedCount: 0, cleanupCompleted: true })

    await expect(updateAdminAccount(userId.toString(), { role: 'auditor' }, appAdminContext))
      .rejects.toThrow(/membership lease lost/)

    // Restore attempted once only; never a second force-disable CAS.
    expect(userUpdateOne).toHaveBeenCalledTimes(1)
    expect(userUpdateOne.mock.calls[0][1]).toEqual(expect.objectContaining({
      $set: { is_active: true },
      $inc: { security_version: 1 },
    }))
    // No disable payload on any User.updateOne call.
    for (const call of userUpdateOne.mock.calls) {
      expect(call[1]).not.toEqual(expect.objectContaining({
        $set: expect.objectContaining({ is_active: false }),
      }))
    }
  })
})

describe('generic and batch lifecycle target-class enforcement', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('Hospital Admin batch operations fail closed for administrator-class targets', async () => {
    const targetId = new mongoose.Types.ObjectId().toString()
    jest.spyOn(User, 'findById').mockResolvedValue({
      _id: targetId,
      user_type: 'ADMIN',
      profile_id: new mongoose.Types.ObjectId(),
      is_active: true,
    } as any)

    const result = await performBatchOperation('deactivate', [targetId], hospitalAdminContext as any)

    expect(result.successful).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.results[0]).toMatchObject({
      userId: targetId,
      success: false,
      message: expect.stringMatching(/Administrator-class accounts/),
    })
  })
})
