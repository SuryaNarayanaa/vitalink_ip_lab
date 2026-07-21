import crypto from 'crypto'
import { StatusCodes } from 'http-status-codes'
import { config } from '@alias/config'
import { AdminMfaChallenge, User } from '@alias/models'
import { AdminMfaChallengeStatus } from '@alias/models/adminmfachallenge.model'
import { AuthSessionRevocationReason } from '@alias/models/authsession.model'
import { ApiError } from '@alias/utils'
import { UserType } from '@alias/validators'
import { bestEffortRevokeSessionsAfterSecurityVersionBump } from './auth-session.service'
import logger, { sanitizeLogText } from '@alias/utils/logger'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const TOTP_PERIOD_SECONDS = 30
const TOTP_DIGITS = 6
const SECRET_BYTES = 20
const WINDOW_STEPS = 1

type EncryptedSecret = {
  ciphertext: string
  iv: string
  authTag: string
}

type TotpSlot = {
  secret_ciphertext?: string
  secret_iv?: string
  secret_auth_tag?: string
  pending_secret_ciphertext?: string
  pending_secret_iv?: string
  pending_secret_auth_tag?: string
  status?: string
  last_verified_time_step?: number
  enrolled_at?: Date
  activated_at?: Date
  last_verified_at?: Date
  last_verified_challenge_id?: unknown
  factor_generation?: number
}

export const isAdminTotpRequiredForUnenrolledAdmins = () =>
  ['production', 'staging'].includes(config.nodeEnv)

const getEncryptionKey = (): Buffer => {
  const configured = config.adminTotpEncryptionKey?.trim()
  const source = configured || config.jwtSecret
  if (!source) {
    throw new Error('Admin TOTP encryption key is not configured')
  }

  const decoded = Buffer.from(source, 'base64')
  if (decoded.length === 32) {
    return decoded
  }

  const hex = Buffer.from(source, 'hex')
  if (hex.length === 32) {
    return hex
  }

  return crypto.createHash('sha256').update(source).digest()
}

const encryptSecret = (secret: string): EncryptedSecret => {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  }
}

const decryptSecret = (encrypted: EncryptedSecret): string => {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(encrypted.iv, 'base64')
  )
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

const base32Encode = (buffer: Buffer): string => {
  let bits = ''
  for (const byte of buffer) {
    bits += byte.toString(2).padStart(8, '0')
  }

  let output = ''
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0')
    output += BASE32_ALPHABET[Number.parseInt(chunk, 2)]
  }
  return output
}

const base32Decode = (secret: string): Buffer => {
  const normalized = secret.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase()
  let bits = ''
  for (const char of normalized) {
    const value = BASE32_ALPHABET.indexOf(char)
    if (value === -1) {
      throw new Error('Invalid TOTP secret encoding')
    }
    bits += value.toString(2).padStart(5, '0')
  }

  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2))
  }
  return Buffer.from(bytes)
}

export const generateAdminTotpSecret = (): string => base32Encode(crypto.randomBytes(SECRET_BYTES))

export const generateTotpCode = (secret: string, timeStep = Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS)): string => {
  const key = base32Decode(secret)
  const counter = Buffer.alloc(8)
  counter.writeUInt32BE(0, 0)
  counter.writeUInt32BE(timeStep, 4)

  const hmac = crypto.createHmac('sha1', key).update(counter).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0')
}

const findMatchingTimeStep = (secret: string, code: string): number | null => {
  if (!/^\d{6}$/.test(code)) {
    return null
  }

  const currentStep = Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS)
  for (let offset = -WINDOW_STEPS; offset <= WINDOW_STEPS; offset += 1) {
    const candidateStep = currentStep + offset
    const candidateCode = generateTotpCode(secret, candidateStep)
    const matches = crypto.timingSafeEqual(Buffer.from(candidateCode), Buffer.from(code))
    if (matches) {
      return candidateStep
    }
  }
  return null
}

const getTotpSlot = (user: any): TotpSlot => user.admin_mfa?.totp || {}

const exactOptional = (path: string, value: unknown) =>
  value === undefined || value === null ? { [path]: { $exists: false } } : { [path]: value }

const exactFactorSnapshot = (totp: TotpSlot) => ({
  ...exactOptional('admin_mfa.totp.status', totp.status),
  ...exactOptional('admin_mfa.totp.secret_ciphertext', totp.secret_ciphertext),
  ...exactOptional('admin_mfa.totp.secret_iv', totp.secret_iv),
  ...exactOptional('admin_mfa.totp.secret_auth_tag', totp.secret_auth_tag),
  ...exactOptional('admin_mfa.totp.pending_secret_ciphertext', totp.pending_secret_ciphertext),
  ...exactOptional('admin_mfa.totp.pending_secret_iv', totp.pending_secret_iv),
  ...exactOptional('admin_mfa.totp.pending_secret_auth_tag', totp.pending_secret_auth_tag),
})

const getActiveSecret = (user: any): string => {
  const totp = getTotpSlot(user)
  if (!totp.secret_ciphertext || !totp.secret_iv || !totp.secret_auth_tag) {
    throw new ApiError(StatusCodes.CONFLICT, 'Admin TOTP is not enrolled')
  }

  return decryptSecret({
    ciphertext: totp.secret_ciphertext,
    iv: totp.secret_iv,
    authTag: totp.secret_auth_tag,
  })
}

const getPendingSecret = (user: any): string => {
  const totp = getTotpSlot(user)
  if (!totp.pending_secret_ciphertext || !totp.pending_secret_iv || !totp.pending_secret_auth_tag) {
    throw new ApiError(StatusCodes.CONFLICT, 'Admin TOTP setup has not been started')
  }

  return decryptSecret({
    ciphertext: totp.pending_secret_ciphertext,
    iv: totp.pending_secret_iv,
    authTag: totp.pending_secret_auth_tag,
  })
}

export const isAdminTotpEnabled = (user: any): boolean => {
  const totp = getTotpSlot(user)
  return totp.status === 'ENABLED' && Boolean(totp.secret_ciphertext && totp.secret_iv && totp.secret_auth_tag)
}

export const getAdminTotpStatus = (user: any) => {
  const totp = getTotpSlot(user)
  const enabled = isAdminTotpEnabled(user)
  const hasPendingSetup = Boolean(
    totp.pending_secret_ciphertext &&
    totp.pending_secret_iv &&
    totp.pending_secret_auth_tag
  )

  return {
    factor_type: 'AUTHENTICATOR_APP',
    status: enabled ? 'ENABLED' : hasPendingSetup ? 'PENDING' : 'DISABLED',
    enabled,
    enrolled_at: totp.enrolled_at,
    activated_at: totp.activated_at,
    last_verified_at: totp.last_verified_at,
  }
}

export const createAdminTotpEnrollment = async (user: any) => {
  if (user.user_type !== UserType.ADMIN) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Admin MFA enrollment is only available for admins')
  }

  const currentUser = await User.findOne({ _id: user._id, user_type: UserType.ADMIN, is_active: true })
  if (!currentUser) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found')
  }

  if (isAdminTotpEnabled(currentUser)) {
    throw new ApiError(StatusCodes.CONFLICT, 'Admin TOTP is already enabled')
  }
  if (getTotpSlot(currentUser).status === 'PENDING') {
    throw new ApiError(StatusCodes.CONFLICT, 'Admin TOTP enrollment is already in progress')
  }

  const secret = generateAdminTotpSecret()
  const encrypted = encryptSecret(secret)
  const result = await User.updateOne(
    {
      _id: currentUser._id,
      user_type: UserType.ADMIN,
      is_active: true,
      security_version: Number(currentUser.security_version || 0),
      'admin_mfa.totp.factor_generation': Number(getTotpSlot(currentUser).factor_generation || 0),
      ...exactFactorSnapshot(getTotpSlot(currentUser)),
    },
    {
      $set: {
        'admin_mfa.totp.status': 'PENDING',
        'admin_mfa.totp.pending_secret_ciphertext': encrypted.ciphertext,
        'admin_mfa.totp.pending_secret_iv': encrypted.iv,
        'admin_mfa.totp.pending_secret_auth_tag': encrypted.authTag,
        'admin_mfa.totp.enrolled_at': new Date(),
      },
    }
  )
  if (result.modifiedCount !== 1) {
    throw new ApiError(StatusCodes.CONFLICT, 'Admin TOTP setup changed concurrently; please retry')
  }

  const issuer = 'VitaLink'
  const accountName = encodeURIComponent(currentUser.login_id)
  const otpauth_url = `otpauth://totp/${issuer}:${accountName}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`
  return { secret, otpauth_url }
}

/**
 * Starts (or safely restarts) enrollment for an operations-bootstrapped admin.
 * Unlike the authenticated enrollment flow, an abandoned PENDING factor may
 * be replaced. An ENABLED factor is never rotated by this path.
 */
export const createAdminTotpBootstrapEnrollment = async (user: any) => {
  if (user.user_type !== UserType.ADMIN) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Admin MFA bootstrap is only available for admins')
  }
  if (!config.adminTotpEncryptionKey?.trim()) {
    throw new Error('ADMIN_TOTP_ENCRYPTION_KEY is required for admin bootstrap')
  }

  const currentUser = await User.findOne({ _id: user._id, user_type: UserType.ADMIN, is_active: true })
  if (!currentUser) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Active admin user not found')
  }

  const currentTotp = getTotpSlot(currentUser)
  const status = currentTotp.status || 'DISABLED'
  if (status === 'ENABLED') {
    throw new ApiError(StatusCodes.CONFLICT, 'Admin TOTP is already enabled')
  }
  if (!['DISABLED', 'PENDING'].includes(status)) {
    throw new ApiError(StatusCodes.CONFLICT, 'Admin TOTP is not in a bootstrap-safe state')
  }

  const secret = generateAdminTotpSecret()
  const encrypted = encryptSecret(secret)
  const result = await User.updateOne(
    {
      _id: currentUser._id,
      user_type: UserType.ADMIN,
      is_active: true,
      security_version: Number(currentUser.security_version || 0),
      'admin_mfa.totp.factor_generation': Number(currentTotp.factor_generation || 0),
      ...exactFactorSnapshot(currentTotp),
    },
    {
      $set: {
        'admin_mfa.totp.status': 'PENDING',
        'admin_mfa.totp.pending_secret_ciphertext': encrypted.ciphertext,
        'admin_mfa.totp.pending_secret_iv': encrypted.iv,
        'admin_mfa.totp.pending_secret_auth_tag': encrypted.authTag,
        'admin_mfa.totp.enrolled_at': new Date(),
      },
      $unset: {
        'admin_mfa.totp.secret_ciphertext': '',
        'admin_mfa.totp.secret_iv': '',
        'admin_mfa.totp.secret_auth_tag': '',
        'admin_mfa.totp.activated_at': '',
        'admin_mfa.totp.last_verified_at': '',
        'admin_mfa.totp.last_verified_time_step': '',
        'admin_mfa.totp.last_verified_challenge_id': '',
      },
    },
  )
  if (result.modifiedCount !== 1) {
    throw new ApiError(StatusCodes.CONFLICT, 'Admin TOTP bootstrap changed concurrently; please retry')
  }

  const issuer = 'VitaLink'
  const accountName = encodeURIComponent(currentUser.login_id)
  const otpauth_url = `otpauth://totp/${issuer}:${accountName}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`
  return { secret, otpauth_url }
}

/**
 * Replaces an administrator's authenticator factor during a supervised
 * recovery. The caller must deliver the returned URI directly to the new
 * device; it is deliberately never persisted in plaintext.
 */
export const replaceAdminTotpForRecovery = async (user: any) => {
  if (user.user_type !== UserType.ADMIN) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Authenticator reset is only available for admins')
  }

  const currentUser = await User.findOne({ _id: user._id, user_type: UserType.ADMIN, is_active: true })
  if (!currentUser) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Active admin user not found')
  }

  const secret = generateAdminTotpSecret()
  const encrypted = encryptSecret(secret)
  const now = new Date()
  const currentTotp = getTotpSlot(currentUser)
  const factorGeneration = Number(currentTotp.factor_generation || 0)
  const replacement = await User.updateOne(
    {
      _id: currentUser._id,
      user_type: UserType.ADMIN,
      is_active: true,
      security_version: Number(currentUser.security_version || 0),
      'admin_mfa.totp.factor_generation': factorGeneration,
      ...exactFactorSnapshot(currentTotp),
    },
    {
      $set: {
        'admin_mfa.totp.status': 'ENABLED',
        'admin_mfa.totp.secret_ciphertext': encrypted.ciphertext,
        'admin_mfa.totp.secret_iv': encrypted.iv,
        'admin_mfa.totp.secret_auth_tag': encrypted.authTag,
        'admin_mfa.totp.enrolled_at': now,
        'admin_mfa.totp.activated_at': now,
      },
      $inc: {
        'admin_mfa.totp.factor_generation': 1,
        security_version: 1,
      },
      $unset: {
        'admin_mfa.totp.pending_secret_ciphertext': '',
        'admin_mfa.totp.pending_secret_iv': '',
        'admin_mfa.totp.pending_secret_auth_tag': '',
        'admin_mfa.totp.last_verified_at': '',
        'admin_mfa.totp.last_verified_time_step': '',
        'admin_mfa.totp.last_verified_challenge_id': '',
      },
    }
  )
  if (replacement.modifiedCount !== 1) {
    throw new ApiError(StatusCodes.CONFLICT, 'Admin authenticator changed concurrently; please retry')
  }

  // The factor/security generation bump above is the authoritative boundary:
  // an old challenge cannot authenticate even if physical cleanup is delayed.
  // Never withhold the only plaintext replacement secret after that commit.
  let challengeCleanupCompleted = true
  try {
    await AdminMfaChallenge.updateMany(
      { user_id: currentUser._id, status: AdminMfaChallengeStatus.PENDING },
      { $set: { status: AdminMfaChallengeStatus.CANCELLED } }
    )
  } catch (error) {
    challengeCleanupCompleted = false
    logger.error('admin_mfa.recovery_challenge_cleanup_failed', {
      user_id: String(currentUser._id),
      error: sanitizeLogText(error),
    })
  }

  const issuer = 'VitaLink'
  const accountName = encodeURIComponent(currentUser.login_id)
  const otpauth_url = `otpauth://totp/${issuer}:${accountName}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`
  return { secret, otpauth_url, challenge_cleanup_completed: challengeCleanupCompleted }
}

export const activateAdminTotpEnrollment = async (user: any, code: string) => {
  if (user.user_type !== UserType.ADMIN) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Admin MFA enrollment is only available for admins')
  }

  const freshUser = await User.findById(user._id)
  if (!freshUser) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found')
  }

  const secret = getPendingSecret(freshUser)
  const matchingStep = findMatchingTimeStep(secret, code)
  if (matchingStep === null) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid TOTP code')
  }

  const encrypted = encryptSecret(secret)
  const activatedAt = new Date()
  const activation = await User.updateOne(
    {
      _id: freshUser._id,
      user_type: UserType.ADMIN,
      is_active: true,
      'admin_mfa.totp.status': 'PENDING',
      'admin_mfa.totp.pending_secret_ciphertext': getTotpSlot(freshUser).pending_secret_ciphertext,
      'admin_mfa.totp.pending_secret_iv': getTotpSlot(freshUser).pending_secret_iv,
      'admin_mfa.totp.pending_secret_auth_tag': getTotpSlot(freshUser).pending_secret_auth_tag,
      'admin_mfa.totp.factor_generation': Number(getTotpSlot(freshUser).factor_generation || 0),
      security_version: Number(freshUser.security_version || 0),
    },
    {
      $set: {
        'admin_mfa.totp.status': 'ENABLED',
        'admin_mfa.totp.secret_ciphertext': encrypted.ciphertext,
        'admin_mfa.totp.secret_iv': encrypted.iv,
        'admin_mfa.totp.secret_auth_tag': encrypted.authTag,
        'admin_mfa.totp.activated_at': activatedAt,
        'admin_mfa.totp.last_verified_at': activatedAt,
        'admin_mfa.totp.last_verified_time_step': matchingStep,
      },
      $inc: { 'admin_mfa.totp.factor_generation': 1, security_version: 1 },
      $unset: {
        'admin_mfa.totp.pending_secret_ciphertext': '',
        'admin_mfa.totp.pending_secret_iv': '',
        'admin_mfa.totp.pending_secret_auth_tag': '',
      },
    }
  )
  if (!activation.modifiedCount) {
    throw new ApiError(StatusCodes.CONFLICT, 'Admin MFA enrollment changed while it was being activated')
  }
  return bestEffortRevokeSessionsAfterSecurityVersionBump(
    freshUser._id.toString(),
    AuthSessionRevocationReason.MFA_RESET,
  )
}

export const createAdminMfaLoginChallenge = async (user: any) => {
  const factorGeneration = Number(getTotpSlot(user).factor_generation || 0)
  const securityVersion = Number(user.security_version || 0)
  await AdminMfaChallenge.updateMany(
    {
      user_id: user._id,
      status: AdminMfaChallengeStatus.PENDING,
      $or: [
        { expires_at: { $lte: new Date() } },
        { factor_generation: { $ne: factorGeneration } },
        { security_version: { $ne: securityVersion } },
      ],
    },
    { $set: { status: AdminMfaChallengeStatus.EXPIRED } }
  )

  const existing = await AdminMfaChallenge.findOne({
    user_id: user._id,
    status: AdminMfaChallengeStatus.PENDING,
    expires_at: { $gt: new Date() },
    factor_generation: factorGeneration,
    security_version: securityVersion,
  })
  if (existing) return existing

  try {
    return await AdminMfaChallenge.create({
      user_id: user._id,
      user_type: UserType.ADMIN,
      expires_at: new Date(Date.now() + config.adminTotpChallengeExpiryMinutes * 60 * 1000),
      max_attempts: config.adminTotpMaxAttempts,
      factor_generation: factorGeneration,
      security_version: securityVersion,
    })
  } catch (error: any) {
    if (error?.code !== 11000) throw error
    const pending = await AdminMfaChallenge.findOne({
      user_id: user._id,
      status: AdminMfaChallengeStatus.PENDING,
      expires_at: { $gt: new Date() },
      factor_generation: factorGeneration,
      security_version: securityVersion,
    })
    if (!pending) throw error
    return pending
  }
}

export const verifyAdminMfaLoginChallenge = async (challengeId: string, code: string) => {
  const challenge = await AdminMfaChallenge.findById(challengeId)
  if (!challenge) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Admin MFA challenge not found')
  }

  if (challenge.status !== AdminMfaChallengeStatus.PENDING) {
    const status = challenge.status === AdminMfaChallengeStatus.LOCKED ? StatusCodes.LOCKED : StatusCodes.GONE
    throw new ApiError(status, 'Admin MFA challenge is no longer available')
  }

  if (challenge.expires_at.getTime() <= Date.now()) {
    challenge.status = AdminMfaChallengeStatus.EXPIRED
    await challenge.save()
    throw new ApiError(StatusCodes.GONE, 'Admin MFA challenge expired')
  }

  const user = await User.findOne({ _id: challenge.user_id, user_type: UserType.ADMIN, is_active: true })
  if (!user || !isAdminTotpEnabled(user)) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Admin MFA challenge not found')
  }

  const secret = getActiveSecret(user)
  const factorGeneration = Number(getTotpSlot(user).factor_generation || 0)
  const securityVersion = Number(user.security_version || 0)
  if (
    challenge.security_version === undefined ||
    Number(challenge.security_version) !== securityVersion ||
    Number(challenge.factor_generation || 0) !== factorGeneration
  ) {
    throw new ApiError(StatusCodes.GONE, 'Admin MFA challenge is no longer available')
  }
  const matchingStep = findMatchingTimeStep(secret, code)
  const lastVerifiedStep = getTotpSlot(user).last_verified_time_step
  if (matchingStep === null || (typeof lastVerifiedStep === 'number' && matchingStep <= lastVerifiedStep)) {
    const updatedChallenge = await AdminMfaChallenge.findOneAndUpdate(
      {
        _id: challenge._id,
        status: AdminMfaChallengeStatus.PENDING,
        expires_at: { $gt: new Date() },
        $expr: { $lt: ['$attempt_count', '$max_attempts'] },
      },
      [
        { $set: { attempt_count: { $add: ['$attempt_count', 1] } } },
        {
          $set: {
            status: {
              $cond: [
                { $gte: ['$attempt_count', '$max_attempts'] },
                AdminMfaChallengeStatus.LOCKED,
                AdminMfaChallengeStatus.PENDING,
              ],
            },
          },
        },
      ],
      { new: true, updatePipeline: true },
    )
    if (!updatedChallenge) {
      throw new ApiError(StatusCodes.GONE, 'Admin MFA challenge is no longer available')
    }
    throw new ApiError(
      updatedChallenge.status === AdminMfaChallengeStatus.LOCKED ? StatusCodes.LOCKED : StatusCodes.UNAUTHORIZED,
      'Invalid TOTP code'
    )
  }

  const verifiedAt = new Date()
  // Advance the user replay guard first. Distinct challenges using the same
  // time step now have one winner before any challenge is recorded VERIFIED.
  const updatedUser = await User.findOneAndUpdate(
    {
      _id: user._id,
      user_type: UserType.ADMIN,
      is_active: true,
      'admin_mfa.totp.factor_generation': factorGeneration,
      security_version: securityVersion,
      'admin_mfa.totp.secret_ciphertext': getTotpSlot(user).secret_ciphertext,
      $or: [
        { 'admin_mfa.totp.last_verified_time_step': { $exists: false } },
        { 'admin_mfa.totp.last_verified_time_step': { $lt: matchingStep } },
      ],
    },
    {
      $set: {
        'admin_mfa.totp.last_verified_at': verifiedAt,
        'admin_mfa.totp.last_verified_time_step': matchingStep,
        'admin_mfa.totp.last_verified_challenge_id': challenge._id,
      },
    },
    { new: true },
  )
  if (!updatedUser) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid TOTP code')
  }

  const consumed = await AdminMfaChallenge.findOneAndUpdate(
    {
      _id: challenge._id,
      status: AdminMfaChallengeStatus.PENDING,
      expires_at: { $gt: verifiedAt },
      attempt_count: { $lt: challenge.max_attempts },
      factor_generation: factorGeneration,
      security_version: securityVersion,
    },
    {
      $set: {
        status: AdminMfaChallengeStatus.VERIFIED,
        verified_at: verifiedAt,
      },
    },
    { new: true },
  )
  if (!consumed) {
    const previousTotp = getTotpSlot(user)
    const restoreSet: Record<string, unknown> = {}
    const restoreUnset: Record<string, 1> = {}
    const restore = (path: string, value: unknown) => {
      if (value === undefined || value === null) restoreUnset[path] = 1
      else restoreSet[path] = value
    }
    restore('admin_mfa.totp.last_verified_at', previousTotp.last_verified_at)
    restore('admin_mfa.totp.last_verified_time_step', previousTotp.last_verified_time_step)
    restore('admin_mfa.totp.last_verified_challenge_id', previousTotp.last_verified_challenge_id)
    await User.updateOne(
      {
        _id: user._id,
        'admin_mfa.totp.last_verified_challenge_id': challenge._id,
        'admin_mfa.totp.last_verified_time_step': matchingStep,
        'admin_mfa.totp.factor_generation': factorGeneration,
        security_version: securityVersion,
        'admin_mfa.totp.secret_ciphertext': getTotpSlot(user).secret_ciphertext,
      },
      {
        $set: restoreSet,
        ...(Object.keys(restoreUnset).length ? { $unset: restoreUnset } : {}),
      },
    )
    throw new ApiError(StatusCodes.GONE, 'Admin MFA challenge is no longer available')
  }

  // Account login state changes only after the one-time challenge is consumed.
  // This avoids compensation clobbering a concurrent password lockout update.
  const authenticatedUser = await User.findOneAndUpdate(
    {
      _id: user._id,
      is_active: true,
      'admin_mfa.totp.factor_generation': factorGeneration,
      security_version: securityVersion,
      'admin_mfa.totp.secret_ciphertext': getTotpSlot(user).secret_ciphertext,
      'admin_mfa.totp.last_verified_challenge_id': challenge._id,
      'admin_mfa.totp.last_verified_time_step': matchingStep,
    },
    {
      $set: { last_login_at: verifiedAt, failed_login_attempts: 0 },
      $unset: { locked_until: 1 },
    },
    { new: true },
  )
  if (!authenticatedUser) {
    // The proof was valid, but its account/factor generation retired before
    // authentication could commit. Do not retain a misleading VERIFIED audit
    // state: no session was authorized by this challenge.
    await AdminMfaChallenge.updateOne(
      {
        _id: challenge._id,
        status: AdminMfaChallengeStatus.VERIFIED,
        verified_at: verifiedAt,
        security_version: securityVersion,
        factor_generation: factorGeneration,
      },
      { $set: { status: AdminMfaChallengeStatus.CANCELLED } },
    )
    throw new ApiError(StatusCodes.GONE, 'Admin MFA challenge is no longer available')
  }

  return authenticatedUser
}
