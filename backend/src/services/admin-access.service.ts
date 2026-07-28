import { StatusCodes } from 'http-status-codes'
import {
  ADMIN_POLICY_SCHEMA_VERSION,
  type AdminRoleKey,
  isAdminRoleKey,
  normalizeAdminCapabilityMap,
} from '@alias/constants/admin-capabilities'
import AdminProfile from '@alias/models/adminprofile.model'
import Hospital, { HospitalStatus } from '@alias/models/hospital.model'
import User from '@alias/models/user.model'
import type { AuthUserSnapshot } from '@alias/types/auth-user'
import type { AdminAccessContext, AdminRolePolicySnapshot } from '@alias/types/admin-access'
import { ApiError } from '@alias/utils'
import { getAdminRolePolicy } from './admin-role-policy.service'

export type AdminAccessUserRecord = {
  _id: unknown
  user_type: unknown
  profile_id?: unknown
  is_active: unknown
}

export type AdminAccessProfileRecord = {
  _id?: unknown
  admin_role?: unknown
  hospital_id?: unknown
}

export type AdminAccessHospitalRecord = {
  _id: unknown
  code?: unknown
  status?: unknown
}

function forbidden(message = 'Valid active administrator access is required'): ApiError {
  return new ApiError(StatusCodes.FORBIDDEN, message)
}

function objectIdString(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'object' && value) {
    const objectIdLike = value as { _id?: unknown; toHexString?: () => string }
    if (typeof objectIdLike.toHexString === 'function') {
      const hex = objectIdLike.toHexString()
      return hex || undefined
    }
    if ('_id' in objectIdLike && objectIdLike._id !== value) {
      return objectIdString(objectIdLike._id)
    }
  }
  if (typeof value === 'object') return undefined
  const result = String(value)
  return result && result !== 'undefined' && result !== 'null' && result !== '[object Object]'
    ? result
    : undefined
}

export function buildAdminAccessContext(input: {
  user: AdminAccessUserRecord
  profile: AdminAccessProfileRecord
  hospital?: AdminAccessHospitalRecord | null
  policy: AdminRolePolicySnapshot
}): AdminAccessContext {
  const { user, profile, hospital, policy } = input
  if (!user || user.user_type !== 'ADMIN' || user.is_active !== true) throw forbidden()
  if (!profile || !isAdminRoleKey(profile.admin_role)) throw forbidden()

  const role = profile.admin_role as AdminRoleKey
  if (
    policy.roleKey !== role
    || policy.schemaVersion !== ADMIN_POLICY_SCHEMA_VERSION
    || !Number.isSafeInteger(policy.policyVersion)
    || policy.policyVersion < 1
  ) {
    throw forbidden('Administrative role policy is unavailable')
  }

  let permissions
  try {
    permissions = normalizeAdminCapabilityMap(role, policy.capabilities)
  } catch {
    throw forbidden('Administrative role policy is unavailable')
  }

  const assignedHospitalId = objectIdString(profile.hospital_id)
  if (role === 'hospital_admin') {
    const activeHospitalId = objectIdString(hospital?._id)
    if (!assignedHospitalId || !hospital || activeHospitalId !== assignedHospitalId || hospital.status !== HospitalStatus.ACTIVE) {
      throw forbidden('Hospital Admin must be assigned to one active hospital')
    }
    if (typeof hospital.code !== 'string' || !hospital.code.trim()) {
      throw forbidden('Hospital Admin must be assigned to one active hospital')
    }
    return {
      userId: String(user._id),
      role,
      scope: 'tenant',
      hospitalId: assignedHospitalId,
      hospitalCode: hospital.code,
      permissions,
      policyVersion: policy.policyVersion,
      readOnly: false,
    }
  }

  if (assignedHospitalId) {
    throw forbidden(`${role === 'auditor' ? 'System Auditor' : 'Application Admin'} must not be assigned to a hospital`)
  }
  if (role === 'app_admin' && policy.protected !== true) {
    throw forbidden('Administrative role policy is unavailable')
  }

  return {
    userId: String(user._id),
    role,
    scope: 'global',
    permissions,
    policyVersion: policy.policyVersion,
    readOnly: role === 'auditor',
  }
}

export async function resolveAdminAccessContext(
  userId: string | undefined,
  options: { authUser?: AuthUserSnapshot } = {},
): Promise<AdminAccessContext> {
  if (!userId) throw forbidden()

  let user: AdminAccessUserRecord | null
  if (options.authUser) {
    if (String(options.authUser._id) !== String(userId)) throw forbidden()
    user = options.authUser
  } else {
    user = await User.findById(userId)
      .select('_id user_type profile_id is_active')
      .lean() as AdminAccessUserRecord | null
  }
  if (!user || user.user_type !== 'ADMIN' || user.is_active !== true || !user.profile_id) throw forbidden()

  const profile = await AdminProfile.findById(user.profile_id)
    .select('_id admin_role hospital_id')
    .lean() as AdminAccessProfileRecord | null
  if (!profile || !isAdminRoleKey(profile.admin_role)) throw forbidden()

  const hospitalId = objectIdString(profile.hospital_id)
  let hospital: AdminAccessHospitalRecord | null = null
  if (profile.admin_role === 'hospital_admin') {
    if (!hospitalId) throw forbidden('Hospital Admin must be assigned to one active hospital')
    hospital = await Hospital.findById(hospitalId)
      .select('_id code status')
      .lean() as AdminAccessHospitalRecord | null
  } else if (hospitalId) {
    throw forbidden(`${profile.admin_role === 'auditor' ? 'System Auditor' : 'Application Admin'} must not be assigned to a hospital`)
  }

  const policy = await getAdminRolePolicy(profile.admin_role)
  return buildAdminAccessContext({ user, profile, hospital, policy })
}

export const getAdminAccessContext = resolveAdminAccessContext
