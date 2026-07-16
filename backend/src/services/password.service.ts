import { StatusCodes } from 'http-status-codes'
import { randomInt } from 'crypto'
import { User, AuditLog } from '@alias/models'
import { AuditAction } from '@alias/models/auditlog.model'
import { AuthSessionRevocationReason } from '@alias/models/authsession.model'
import { comparePasswords, ApiError, generateSalt, hashPassword } from '@alias/utils'
import { config } from '@alias/config'
import { bestEffortRevokeSessionsAfterSecurityVersionBump } from './auth-session.service'
import logger, { sanitizeLogText } from '@alias/utils/logger'

type PasswordHistoryEntry = {
  password: string
  salt: string
  changed_at: Date
}

export function assertStrongPassword(password: string) {
  const failures = [
    password.length < 8 && 'Password must be at least 8 characters',
    !/[A-Z]/.test(password) && 'Password must contain at least one uppercase letter',
    !/[a-z]/.test(password) && 'Password must contain at least one lowercase letter',
    !/[0-9]/.test(password) && 'Password must contain at least one digit',
    !/[^A-Za-z0-9]/.test(password) && 'Password must contain at least one special character',
  ].filter(Boolean) as string[]

  if (failures.length > 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, failures[0])
  }
}

export function getPasswordPolicy() {
  return {
    expiry_days: config.passwordExpiryDays,
    history_count: config.passwordHistoryCount,
  }
}

export function getPasswordExpiresAt(user: any): Date | undefined {
  if (config.passwordExpiryDays <= 0) return undefined
  const changedAt = user?.password_changed_at || user?.updatedAt || user?.createdAt
  if (!changedAt) return undefined

  return new Date(new Date(changedAt).getTime() + config.passwordExpiryDays * 24 * 60 * 60 * 1000)
}

export function isPasswordExpired(user: any, now = new Date()): boolean {
  const expiresAt = getPasswordExpiresAt(user)
  return Boolean(expiresAt && expiresAt.getTime() <= now.getTime())
}

export function getPasswordPolicyState(user: any) {
  const expiresAt = getPasswordExpiresAt(user)
  const expired = isPasswordExpired(user)

  return {
    must_change_password: Boolean(user?.must_change_password || expired),
    password_expired: expired,
    password_changed_at: user?.password_changed_at,
    password_expires_at: expiresAt,
    password_policy: getPasswordPolicy(),
  }
}

function getRandomChar(charset: string): string {
  return charset[randomInt(0, charset.length)]
}

export function generateTemporaryPassword(length = 16): string {
  const normalizedLength = Math.max(length, 12)
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const numbers = '23456789'
  const symbols = '!@#$%^&*()-_=+'
  const all = upper + lower + numbers + symbols

  const passwordChars = [
    getRandomChar(upper),
    getRandomChar(lower),
    getRandomChar(numbers),
    getRandomChar(symbols),
  ]

  for (let i = passwordChars.length; i < normalizedLength; i++) {
    passwordChars.push(getRandomChar(all))
  }

  for (let i = passwordChars.length - 1; i > 0; i--) {
    const swapIndex = randomInt(0, i + 1)
    const temp = passwordChars[i]
    passwordChars[i] = passwordChars[swapIndex]
    passwordChars[swapIndex] = temp
  }

  return passwordChars.join('')
}

async function ensurePasswordCanBeUsed(user: any, newPassword: string) {
  const checks: PasswordHistoryEntry[] = [
    {
      password: user.password,
      salt: user.salt,
      changed_at: user.password_changed_at || user.updatedAt || user.createdAt || new Date(),
    },
  ]

  const historyLimit = config.passwordHistoryCount
  if (historyLimit > 0) {
    const recentHistory = ((user.password_history || []) as PasswordHistoryEntry[])
      .slice()
      .sort((a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime())
      .slice(0, historyLimit)
    checks.push(...recentHistory)
  }

  for (const entry of checks) {
    const matchesPreviousPassword = await comparePasswords({
      password: newPassword,
      salt: entry.salt,
      hashedPassword: entry.password,
    })

    if (matchesPreviousPassword) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'New password cannot match a recently used password')
    }
  }
}

export async function validatePasswordChangeForUser(user: any, newPassword: string) {
  assertStrongPassword(newPassword)
  await ensurePasswordCanBeUsed(user, newPassword)
}

export async function setUserPasswordWithPolicy(
  user: any,
  newPassword: string,
  options: { mustChangePassword?: boolean } = {}
) {
  await validatePasswordChangeForUser(user, newPassword)

  const existingHistory = ((user.password_history || []) as PasswordHistoryEntry[])
    .slice()
    .sort((a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime())

  const previousPassword: PasswordHistoryEntry = {
    password: user.password,
    salt: user.salt,
    changed_at: user.password_changed_at || user.updatedAt || user.createdAt || new Date(),
  }

  const historyLimit = config.passwordHistoryCount
  const passwordHistory = historyLimit > 0
    ? [previousPassword, ...existingHistory].slice(0, historyLimit)
    : []
  const expectedSecurityVersion = Number(user.security_version || 0)
  const salt = generateSalt()
  const password = await hashPassword(newPassword, salt)
  const passwordChangedAt = new Date()
  const coupledUserFields: Record<string, unknown> = {}
  // Admin update workflows may combine account activation with a password
  // reset. Preserve that pre-existing contract in the same atomic boundary.
  if (typeof user.isModified === 'function' && user.isModified('is_active')) {
    coupledUserFields.is_active = user.is_active
  }
  const updatedUser = await User.findOneAndUpdate(
    {
      _id: user._id,
      password: user.password,
      salt: user.salt,
      security_version: expectedSecurityVersion,
    },
    {
      $set: {
        password,
        salt,
        password_history: passwordHistory,
        password_changed_at: passwordChangedAt,
        must_change_password: Boolean(options.mustChangePassword),
        ...coupledUserFields,
      },
      $inc: { security_version: 1 },
    },
    { new: true, runValidators: true },
  ).select('+password_history')
  if (!updatedUser) {
    throw new ApiError(StatusCodes.CONFLICT, 'Password changed concurrently; please retry')
  }

  // Existing callers use the loaded document for response metadata and
  // request-scoped compensation. Keep that instance aligned with the atomic
  // persisted result without issuing a second write.
  user.set(updatedUser.toObject())
}

export async function adminResetPassword(
  adminUserId: string,
  targetUserId: string,
  newPassword?: string
) {
  const targetUser = await User.findById(targetUserId).select('+password_history')
  if (!targetUser) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Target user not found')
  }

  const password = newPassword?.trim() || generateTemporaryPassword()
  await setUserPasswordWithPolicy(targetUser, password, { mustChangePassword: true })
  const invalidatedSessionResult = await bestEffortRevokeSessionsAfterSecurityVersionBump(
    targetUserId,
    AuthSessionRevocationReason.PASSWORD_RESET
  )
  const invalidatedSessionCount = invalidatedSessionResult.modifiedCount || 0

  // The security-version bump is the authoritative invalidation boundary.
  // Audit persistence must not turn a completed reset into a misleading error
  // that withholds the generated one-time credential from the administrator.
  let auditRecorded = true
  try {
    await AuditLog.create({
      user_id: adminUserId,
      user_type: 'ADMIN',
      action: AuditAction.PASSWORD_RESET,
      description: `Admin reset password for user ${targetUser.login_id} and invalidated active sessions`,
      resource_type: 'User',
      resource_id: targetUserId,
      success: true,
      metadata: {
        invalidated_sessions: invalidatedSessionCount,
        revocation_reason: AuthSessionRevocationReason.PASSWORD_RESET,
      },
    })
  } catch (error) {
    auditRecorded = false
    logger.error('password_reset.audit_persistence_failed', {
      adminUserId,
      targetUserId,
      error: sanitizeLogText(error),
    })
  }

  return {
    message: 'Password reset successfully',
    user_id: targetUserId,
    login_id: targetUser.login_id,
    temporary_password: password,
    must_change_password: true,
    invalidated_sessions: invalidatedSessionCount,
    audit_recorded: auditRecorded,
    revocation_cleanup_completed: invalidatedSessionResult.cleanupCompleted,
  }
}
