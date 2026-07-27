import mongoose from 'mongoose'
import { StatusCodes } from 'http-status-codes'
import { AdminProfile, Hospital, User } from '@alias/models'
import { AdminRole } from '@alias/models/adminprofile.model'
import { AuthSessionRevocationReason } from '@alias/models/authsession.model'
import { HospitalStatus } from '@alias/models/hospital.model'
import type { AdminAccessContext } from '@alias/types/admin-access'
import { hasAdminCapability } from '@alias/types/admin-access'
import { ApiError } from '@alias/utils'
import { UserType } from '@alias/validators'
import { generateTemporaryPassword } from './password.service'
import { replaceAdminTotpForRecovery } from './admin-totp.service'
import { bestEffortRevokeSessionsAfterSecurityVersionBump } from './auth-session.service'
import { resolveAdminAccessContext } from './admin-access.service'
import { acquireHospitalMembershipGuard, acquireHospitalMembershipGuards } from './doctor-assignment.service'
import logger from '@alias/utils/logger'

export type AdminAccountActor = string | AdminAccessContext
export type EditableAdminRole = AdminRole.HOSPITAL_ADMIN | AdminRole.AUDITOR

export type CreateAdminAccountInput = {
  name: string
  email?: string
  login_id?: string
  role: EditableAdminRole | string
  hospital_id?: string
  hospital?: string
}

export type UpdateAdminAccountInput = {
  name?: string
  role?: EditableAdminRole | string
  hospital_id?: string
  hospital?: string
  is_active?: boolean
  status?: 'active' | 'inactive' | string
}

const EDITABLE_ADMIN_ROLES = new Set<string>([
  AdminRole.HOSPITAL_ADMIN,
  AdminRole.AUDITOR,
])

function isAdminAccessContext(value: AdminAccountActor): value is AdminAccessContext {
  return typeof value === 'object' && value !== null && typeof value.userId === 'string'
}

async function resolveActor(actor: AdminAccountActor | undefined): Promise<AdminAccessContext> {
  if (!actor) throw new ApiError(StatusCodes.FORBIDDEN, 'Application Admin access is required')
  return isAdminAccessContext(actor) ? actor : resolveAdminAccessContext(actor)
}

function requireApplicationAdmin(
  actor: AdminAccessContext,
  capability: 'platform.admin_accounts.read' | 'platform.admin_accounts.manage',
) {
  if (
    actor.role !== AdminRole.APP_ADMIN
    || actor.scope !== 'global'
    || actor.readOnly
    || !hasAdminCapability(actor, capability)
  ) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Application Admin access is required')
  }
}

export function assertEditableAdminRole(role: unknown): asserts role is EditableAdminRole {
  if (!EDITABLE_ADMIN_ROLES.has(String(role || ''))) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Administrator accounts may only use the hospital_admin or auditor role',
    )
  }
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const allowedSet = new Set(allowed)
  const unsupported = Object.keys(value).filter(key => !allowedSet.has(key))
  if (unsupported.length) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Unsupported administrator account field: ${unsupported[0]}`)
  }
}

function requestedHospital(input: { hospital_id?: string; hospital?: string }): string | undefined {
  const hospitalId = input.hospital_id?.trim()
  const hospitalCode = input.hospital?.trim()
  if (hospitalId && hospitalCode && hospitalId !== hospitalCode) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Provide only one hospital identifier')
  }
  return hospitalId || hospitalCode
}

export function assertAdminRoleScopePayload(
  role: unknown,
  input: { hospital_id?: string; hospital?: string },
) {
  assertEditableAdminRole(role)
  const hospital = requestedHospital(input)
  if (role === AdminRole.HOSPITAL_ADMIN && !hospital) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Hospital Admin must be assigned to one active hospital')
  }
  if (role === AdminRole.AUDITOR && hospital) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'System Auditor must not be assigned to a hospital')
  }
}

function isStrictObjectId(value: string): boolean {
  return /^[a-fA-F0-9]{24}$/.test(value)
}

async function resolveActiveHospital(identifier: string) {
  const trimmed = identifier.trim()
  if (!trimmed) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Hospital must be active and accepting members')
  }
  // mongoose.Types.ObjectId.isValid accepts 12-byte strings; require 24-hex so
  // short hospital codes are never misinterpreted as `_id` lookups.
  const identity = isStrictObjectId(trimmed)
    ? { _id: trimmed }
    : { code: trimmed.toUpperCase() }
  const hospital = await Hospital.findOne({
    ...identity,
    status: HospitalStatus.ACTIVE,
    accepting_assignments: { $ne: false },
    lifecycle_state: { $in: ['STABLE', null] },
  }).select('_id code name status accepting_assignments lifecycle_state').lean()
  if (!hospital) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Hospital must be active and accepting members')
  }
  return hospital as any
}

function hospitalIdentity(hospital: any) {
  if (!hospital) return null
  return {
    id: String(hospital._id),
    code: String(hospital.code),
    name: hospital.name ? String(hospital.name) : undefined,
  }
}

function isMfaEnabled(user: any) {
  const totp = user?.admin_mfa?.totp
  return Boolean(
    totp?.status === 'ENABLED'
    && totp?.secret_ciphertext
    && totp?.secret_iv
    && totp?.secret_auth_tag,
  )
}

function formatAdminAccount(user: any, profile: any, hospital?: any) {
  assertEditableAdminRole(profile?.admin_role)
  if (profile.admin_role === AdminRole.HOSPITAL_ADMIN && !hospital) {
    throw new ApiError(StatusCodes.CONFLICT, 'Hospital Admin account is not assigned to an active hospital')
  }
  if (profile.admin_role === AdminRole.AUDITOR && profile.hospital_id) {
    throw new ApiError(StatusCodes.CONFLICT, 'System Auditor account has an invalid hospital assignment')
  }
  return {
    id: String(user._id),
    login_id: user.login_id,
    loginId: user.login_id,
    email: user.login_id,
    name: profile.name || user.login_id,
    role: profile.admin_role,
    hospital: profile.admin_role === AdminRole.HOSPITAL_ADMIN ? hospitalIdentity(hospital) : null,
    is_active: Boolean(user.is_active),
    mfa_enabled: isMfaEnabled(user),
    created_at: user.createdAt,
    updated_at: user.updatedAt,
  }
}

async function loadAdminAccount(userId: string) {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Administrator account not found')
  }
  const user = await User.findOne({ _id: userId, user_type: UserType.ADMIN })
    .select('_id login_id user_type profile_id is_active security_version admin_mfa createdAt updatedAt')
    .lean() as any
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'Administrator account not found')

  const profile = await AdminProfile.findById(user.profile_id)
    .select('_id name admin_role hospital_id')
    .lean() as any
  if (!profile) throw new ApiError(StatusCodes.NOT_FOUND, 'Administrator profile not found')
  if (profile.admin_role === AdminRole.APP_ADMIN) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Application Admin accounts cannot be managed through the portal')
  }
  assertEditableAdminRole(profile.admin_role)
  return { user, profile }
}

async function loadHospitalForProfile(profile: any) {
  if (profile.admin_role !== AdminRole.HOSPITAL_ADMIN) return undefined
  if (!profile.hospital_id) {
    throw new ApiError(StatusCodes.CONFLICT, 'Hospital Admin account is not assigned to an active hospital')
  }
  const hospital = await Hospital.findOne({ _id: profile.hospital_id, status: HospitalStatus.ACTIVE })
    .select('_id code name status')
    .lean()
  if (!hospital) {
    throw new ApiError(StatusCodes.CONFLICT, 'Hospital Admin account is not assigned to an active hospital')
  }
  return hospital
}

function unsupportedTransaction(error: unknown) {
  return /Transaction numbers are only allowed|replica set member|Transaction support/i.test(
    String((error as any)?.message || error),
  )
}

async function createAdminPair(input: {
  name: string
  loginId: string
  role: EditableAdminRole
  hospitalId?: unknown
  temporaryPassword: string
}) {
  const create = async (session?: mongoose.ClientSession) => {
    const [profile] = await AdminProfile.create([{
      name: input.name,
      admin_role: input.role,
      ...(input.hospitalId ? { hospital_id: input.hospitalId } : {}),
    }], session ? { session } : undefined)
    try {
      const [user] = await User.create([{
        login_id: input.loginId,
        password: input.temporaryPassword,
        user_type: UserType.ADMIN,
        profile_id: profile._id,
        user_type_model: 'AdminProfile',
        must_change_password: true,
      }], session ? { session } : undefined)
      return { user, profile }
    } catch (error) {
      if (!session) await profile.deleteOne()
      throw error
    }
  }

  const session = await mongoose.startSession()
  try {
    let created: Awaited<ReturnType<typeof create>> | undefined
    await session.withTransaction(async () => {
      created = await create(session)
    })
    return created!
  } catch (error) {
    if (!unsupportedTransaction(error)) throw error
    return create()
  } finally {
    await session.endSession()
  }
}

export async function listAdminAccounts(actorInput: AdminAccountActor) {
  const actor = await resolveActor(actorInput)
  requireApplicationAdmin(actor, 'platform.admin_accounts.read')

  const profiles = await AdminProfile.find({
    admin_role: { $in: [AdminRole.HOSPITAL_ADMIN, AdminRole.AUDITOR] },
  }).select('_id name admin_role hospital_id').lean() as any[]
  const profileById = new Map(profiles.map(profile => [String(profile._id), profile]))
  const hospitalIds = profiles
    .filter(profile => profile.admin_role === AdminRole.HOSPITAL_ADMIN && profile.hospital_id)
    .map(profile => profile.hospital_id)
  const hospitals = hospitalIds.length
    ? await Hospital.find({ _id: { $in: hospitalIds }, status: HospitalStatus.ACTIVE })
      .select('_id code name status').lean() as any[]
    : []
  const hospitalById = new Map(hospitals.map(hospital => [String(hospital._id), hospital]))
  const users = profiles.length
    ? await User.find({
      user_type: UserType.ADMIN,
      profile_id: { $in: profiles.map(profile => profile._id) },
    }).select('_id login_id profile_id is_active admin_mfa createdAt updatedAt')
      .sort({ createdAt: -1 })
      .lean() as any[]
    : []

  return {
    admin_accounts: users.map(user => {
      const profile = profileById.get(String(user.profile_id))
      return formatAdminAccount(
        user,
        profile,
        profile?.hospital_id ? hospitalById.get(String(profile.hospital_id)) : undefined,
      )
    }),
  }
}

export async function createAdminAccount(
  data: CreateAdminAccountInput,
  actorInput: AdminAccountActor,
) {
  assertAllowedKeys(data as Record<string, unknown>, ['name', 'email', 'login_id', 'role', 'hospital_id', 'hospital'])
  assertAdminRoleScopePayload(data.role, data)
  const loginId = (data.email || data.login_id || '').trim()
  if (!loginId) throw new ApiError(StatusCodes.BAD_REQUEST, 'Administrator email is required')
  if (!data.name?.trim()) throw new ApiError(StatusCodes.BAD_REQUEST, 'Administrator name is required')

  const actor = await resolveActor(actorInput)
  requireApplicationAdmin(actor, 'platform.admin_accounts.manage')

  const hospital = data.role === AdminRole.HOSPITAL_ADMIN
    ? await resolveActiveHospital(requestedHospital(data)!)
    : undefined
  const existing = await User.exists({ login_id: loginId })
  if (existing) throw new ApiError(StatusCodes.CONFLICT, 'A user with this login ID already exists')

  const membershipGuard = hospital ? await acquireHospitalMembershipGuard(hospital._id) : undefined
  const temporaryPassword = generateTemporaryPassword()
  let created: Awaited<ReturnType<typeof createAdminPair>> | undefined
  try {
    await membershipGuard?.assertOwned()
    created = await createAdminPair({
      name: data.name.trim(),
      loginId,
      role: data.role as EditableAdminRole,
      hospitalId: hospital?._id,
      temporaryPassword,
    })
    await membershipGuard?.assertOwned()
    return {
      admin_account: formatAdminAccount(created.user, created.profile, hospital),
      temporary_password: temporaryPassword,
      must_change_password: true,
    }
  } catch (error) {
    if (created) {
      await User.updateOne(
        { _id: created.user._id, is_active: true },
        { $set: { is_active: false }, $inc: { security_version: 1 } },
      )
      await bestEffortRevokeSessionsAfterSecurityVersionBump(
        String(created.user._id),
        AuthSessionRevocationReason.ACCOUNT_DISABLED,
      )
    }
    throw error
  } finally {
    await membershipGuard?.release()
  }
}

function exactOptional(path: string, value: unknown) {
  return value === undefined || value === null
    ? { [path]: { $exists: false } }
    : { [path]: value }
}

async function compensateProfileMutation(
  profileId: unknown,
  original: any,
  expected: { role: EditableAdminRole; name: string; hospitalId?: unknown },
) {
  const $set: Record<string, unknown> = {
    admin_role: original.admin_role,
    name: original.name,
  }
  const $unset: Record<string, 1> = {}
  if (original.hospital_id) $set.hospital_id = original.hospital_id
  else $unset.hospital_id = 1
  const restored = await AdminProfile.updateOne(
    {
      _id: profileId,
      admin_role: expected.role,
      name: expected.name,
      ...exactOptional('hospital_id', expected.hospitalId),
    },
    { $set, ...(Object.keys($unset).length ? { $unset } : {}) },
  )
  return restored.matchedCount === 1
}

export async function updateAdminAccount(
  userId: string,
  data: UpdateAdminAccountInput,
  actorInput: AdminAccountActor,
) {
  assertAllowedKeys(data as Record<string, unknown>, ['name', 'role', 'hospital_id', 'hospital', 'is_active', 'status'])
  if (!Object.keys(data).length) throw new ApiError(StatusCodes.BAD_REQUEST, 'At least one field is required')
  if (data.role !== undefined) assertEditableAdminRole(data.role)
  if (data.status !== undefined && !['active', 'inactive'].includes(data.status)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Administrator status must be active or inactive')
  }
  if (data.status !== undefined && data.is_active !== undefined && (data.status === 'active') !== data.is_active) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Conflicting administrator account status values')
  }

  const actor = await resolveActor(actorInput)
  requireApplicationAdmin(actor, 'platform.admin_accounts.manage')
  const { user, profile } = await loadAdminAccount(userId)

  const resultingRole = (data.role || profile.admin_role) as EditableAdminRole
  const suppliedHospital = requestedHospital(data)
  if (resultingRole === AdminRole.AUDITOR && suppliedHospital) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'System Auditor must not be assigned to a hospital')
  }
  let hospital: any
  if (resultingRole === AdminRole.HOSPITAL_ADMIN) {
    const hospitalKey = suppliedHospital
      || (profile.hospital_id ? String(profile.hospital_id) : '')
    if (!hospitalKey) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Hospital Admin must be assigned to one active hospital')
    }
    hospital = await resolveActiveHospital(hospitalKey)
  }

  const requestedActive = data.is_active !== undefined
    ? data.is_active
    : data.status !== undefined
      ? data.status === 'active'
      : Boolean(user.is_active)
  const roleChanged = resultingRole !== profile.admin_role
  const currentHospitalId = profile.hospital_id ? String(profile.hospital_id) : undefined
  const resultingHospitalId = hospital ? String(hospital._id) : undefined
  const scopeChanged = currentHospitalId !== resultingHospitalId
  const statusChanged = Boolean(user.is_active) !== requestedActive
  const securityBoundaryChanged = roleChanged || scopeChanged || statusChanged
  const resultingName = data.name?.trim() || profile.name
  if (!resultingName) throw new ApiError(StatusCodes.BAD_REQUEST, 'Administrator name is required')

  const membershipGuards = await acquireHospitalMembershipGuards([
    profile.hospital_id,
    hospital?._id,
  ])
  let profileMutated = false
  let securityBoundaryCommitted = false
  try {
    for (const guard of membershipGuards) await guard.assertOwned()
    if (roleChanged || scopeChanged || resultingName !== profile.name) {
      const profileUpdate: any = {
        $set: {
          admin_role: resultingRole,
          name: resultingName,
          ...(hospital ? { hospital_id: hospital._id } : {}),
        },
        ...(!hospital ? { $unset: { hospital_id: 1 } } : {}),
      }
      const changedProfile = await AdminProfile.findOneAndUpdate(
        {
          _id: profile._id,
          admin_role: profile.admin_role,
          name: profile.name,
          ...exactOptional('hospital_id', profile.hospital_id),
        },
        profileUpdate,
        { new: true, runValidators: true },
      ) as any
      if (!changedProfile) {
        throw new ApiError(StatusCodes.CONFLICT, 'Administrator profile changed concurrently')
      }
      profileMutated = true
    }

    let updatedUser = user
    if (securityBoundaryChanged) {
      for (const guard of membershipGuards) await guard.assertOwned()
      updatedUser = await User.findOneAndUpdate(
        {
          _id: user._id,
          user_type: UserType.ADMIN,
          profile_id: user.profile_id,
          is_active: user.is_active,
          security_version: Number(user.security_version || 0),
        },
        {
          $set: { is_active: requestedActive },
          $inc: { security_version: 1 },
        },
        { new: true, runValidators: true },
      ).select('_id login_id profile_id is_active security_version admin_mfa createdAt updatedAt').lean() as any
      if (!updatedUser) {
        throw new ApiError(StatusCodes.CONFLICT, 'Administrator account changed concurrently')
      }
      securityBoundaryCommitted = true
      for (const guard of membershipGuards) await guard.assertOwned()
    }

    const revocation = securityBoundaryChanged
      ? await bestEffortRevokeSessionsAfterSecurityVersionBump(
        String(user._id),
        requestedActive
          ? AuthSessionRevocationReason.USER_REVOKED
          : AuthSessionRevocationReason.ACCOUNT_DISABLED,
      )
      : { modifiedCount: 0, cleanupCompleted: true }

    const responseProfile = {
      ...profile,
      name: resultingName,
      admin_role: resultingRole,
      hospital_id: hospital?._id,
    }
    return {
      admin_account: formatAdminAccount(updatedUser, responseProfile, hospital),
      invalidated_sessions: revocation.modifiedCount || 0,
      revocation_cleanup_completed: revocation.cleanupCompleted,
      security_version_bumped: securityBoundaryChanged,
    }
  } catch (error) {
    let compensationFailed = false
    if (profileMutated) {
      try {
        const restored = await compensateProfileMutation(profile._id, profile, {
          role: resultingRole,
          name: resultingName,
          hospitalId: hospital?._id,
        })
        compensationFailed = !restored
      } catch {
        compensationFailed = true
      }
    }
    if (securityBoundaryCommitted) {
      try {
        const restoredUser = await User.updateOne(
          {
            _id: user._id,
            user_type: UserType.ADMIN,
            profile_id: user.profile_id,
            is_active: requestedActive,
            security_version: Number(user.security_version || 0) + 1,
          },
          {
            $set: { is_active: Boolean(user.is_active) },
            $inc: { security_version: 1 },
          },
        )
        compensationFailed = compensationFailed || restoredUser.matchedCount !== 1
      } catch {
        compensationFailed = true
      }
      await bestEffortRevokeSessionsAfterSecurityVersionBump(
        String(user._id),
        user.is_active
          ? AuthSessionRevocationReason.USER_REVOKED
          : AuthSessionRevocationReason.ACCOUNT_DISABLED,
      )
    }
    if (compensationFailed) {
      // A compensation CAS miss usually means another concurrent request already
      // advanced the account successfully. Force-disabling that account would lock
      // out a valid administrator. Only disable when our security-boundary write is
      // still the current document state and could not be reversed.
      let forceDisabled = false
      if (securityBoundaryCommitted) {
        try {
          const current = await User.findById(user._id)
            .select('_id is_active security_version')
            .lean() as any
          const stillOwnedByThisAttempt = Boolean(current)
            && Boolean(current.is_active) === requestedActive
            && Number(current.security_version || 0) === Number(user.security_version || 0) + 1
          if (stillOwnedByThisAttempt) {
            await User.updateOne(
              {
                _id: user._id,
                is_active: requestedActive,
                security_version: Number(user.security_version || 0) + 1,
              },
              { $set: { is_active: false }, $inc: { security_version: 1 } },
            )
            forceDisabled = true
            await bestEffortRevokeSessionsAfterSecurityVersionBump(
              String(user._id),
              AuthSessionRevocationReason.ACCOUNT_DISABLED,
            )
          }
        } catch {
          forceDisabled = false
        }
      }
      if (forceDisabled) {
        logger.error('admin_account.update_compensation_failed', {
          user_id: String(user._id),
          force_disabled: true,
        })
      } else {
        logger.warn('admin_account.update_compensation_skipped_concurrent', {
          user_id: String(user._id),
          profile_mutated: profileMutated,
          security_boundary_committed: securityBoundaryCommitted,
        })
      }
    }
    throw error
  } finally {
    for (const guard of membershipGuards.reverse()) await guard.release()
  }
}

export async function resetAdminAccountMfa(
  userId: string,
  actorInput: AdminAccountActor,
) {
  const actor = await resolveActor(actorInput)
  requireApplicationAdmin(actor, 'platform.admin_accounts.manage')
  const { user, profile } = await loadAdminAccount(userId)
  if (!user.is_active) {
    throw new ApiError(StatusCodes.CONFLICT, 'Cannot reset MFA for an inactive administrator')
  }
  const hospital = await loadHospitalForProfile(profile)
  if (profile.admin_role === AdminRole.AUDITOR && profile.hospital_id) {
    throw new ApiError(StatusCodes.CONFLICT, 'System Auditor account has an invalid hospital assignment')
  }

  const enrollment = await replaceAdminTotpForRecovery(user)
  const revocation = await bestEffortRevokeSessionsAfterSecurityVersionBump(
    String(user._id),
    AuthSessionRevocationReason.MFA_RESET,
  )
  const refreshed = await User.findById(user._id)
    .select('_id login_id profile_id is_active security_version admin_mfa createdAt updatedAt')
    .lean() as any

  return {
    admin_account: formatAdminAccount(refreshed || user, profile, hospital),
    factor_type: 'AUTHENTICATOR_APP',
    setup: enrollment,
    invalidated_sessions: revocation.modifiedCount || 0,
    revocation_cleanup_completed: revocation.cleanupCompleted,
    challenge_cleanup_completed: enrollment.challenge_cleanup_completed,
  }
}
