import { StatusCodes } from 'http-status-codes'
import { randomInt } from 'crypto'
import { User, AuditLog } from '@alias/models'
import { AuditAction } from '@alias/models/auditlog.model'
import { AuthSessionRevocationReason } from '@alias/models/authsession.model'
import { comparePasswords, ApiError } from '@alias/utils'
import { config } from '@alias/config'
import { revokeActiveAuthSessionsForUser } from './auth-session.service'

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

export async function setUserPasswordWithPolicy(
  user: any,
  newPassword: string,
  options: { mustChangePassword?: boolean } = {}
) {
  assertStrongPassword(newPassword)
  await ensurePasswordCanBeUsed(user, newPassword)

  const existingHistory = ((user.password_history || []) as PasswordHistoryEntry[])
    .slice()
    .sort((a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime())

  const previousPassword: PasswordHistoryEntry = {
    password: user.password,
    salt: user.salt,
    changed_at: user.password_changed_at || user.updatedAt || user.createdAt || new Date(),
  }

  const historyLimit = config.passwordHistoryCount
  user.password_history = historyLimit > 0
    ? [previousPassword, ...existingHistory].slice(0, historyLimit)
    : []
  user.password = newPassword
  user.must_change_password = Boolean(options.mustChangePassword)
  await user.save()
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
  const invalidatedSessionResult = await revokeActiveAuthSessionsForUser(
    targetUserId,
    AuthSessionRevocationReason.PASSWORD_RESET
  )
  const invalidatedSessionCount = invalidatedSessionResult.modifiedCount || 0

  // Log the action
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

  return {
    message: 'Password reset successfully',
    user_id: targetUserId,
    login_id: targetUser.login_id,
    temporary_password: password,
    must_change_password: true,
    invalidated_sessions: invalidatedSessionCount,
  }
}
