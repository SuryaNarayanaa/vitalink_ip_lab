import crypto from 'crypto'
import { StatusCodes } from 'http-status-codes'
import { config } from '@alias/config'
import { AdminMfaChallenge, User } from '@alias/models'
import { AdminMfaChallengeStatus } from '@alias/models/adminmfachallenge.model'
import { ApiError } from '@alias/utils'
import { UserType } from '@alias/validators'

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

  const secret = generateAdminTotpSecret()
  const encrypted = encryptSecret(secret)
  const result = await User.updateOne(
    {
      _id: currentUser._id,
      user_type: UserType.ADMIN,
      'admin_mfa.totp.status': { $ne: 'ENABLED' },
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
  if (result.matchedCount === 0) {
    throw new ApiError(StatusCodes.CONFLICT, 'Admin TOTP is already enabled')
  }

  const issuer = 'VitaLink'
  const accountName = encodeURIComponent(currentUser.login_id)
  const otpauth_url = `otpauth://totp/${issuer}:${accountName}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`
  return { secret, otpauth_url }
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
  await User.updateOne(
    { _id: freshUser._id, user_type: UserType.ADMIN },
    {
      $set: {
        'admin_mfa.totp.status': 'ENABLED',
        'admin_mfa.totp.secret_ciphertext': encrypted.ciphertext,
        'admin_mfa.totp.secret_iv': encrypted.iv,
        'admin_mfa.totp.secret_auth_tag': encrypted.authTag,
        'admin_mfa.totp.activated_at': activatedAt,
        'admin_mfa.totp.last_verified_at': activatedAt,
      },
      $unset: {
        'admin_mfa.totp.pending_secret_ciphertext': '',
        'admin_mfa.totp.pending_secret_iv': '',
        'admin_mfa.totp.pending_secret_auth_tag': '',
      },
    }
  )
}

export const createAdminMfaLoginChallenge = async (user: any) => {
  await AdminMfaChallenge.updateMany(
    {
      user_id: user._id,
      status: AdminMfaChallengeStatus.PENDING,
    },
    { $set: { status: AdminMfaChallengeStatus.CANCELLED } }
  )

  return AdminMfaChallenge.create({
    user_id: user._id,
    user_type: UserType.ADMIN,
    expires_at: new Date(Date.now() + config.adminTotpChallengeExpiryMinutes * 60 * 1000),
    max_attempts: config.adminTotpMaxAttempts,
  })
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
  const matchingStep = findMatchingTimeStep(secret, code)
  const lastVerifiedStep = getTotpSlot(user).last_verified_time_step
  if (matchingStep === null || (typeof lastVerifiedStep === 'number' && matchingStep <= lastVerifiedStep)) {
    challenge.attempt_count += 1
    if (challenge.attempt_count >= challenge.max_attempts) {
      challenge.status = AdminMfaChallengeStatus.LOCKED
    }
    await challenge.save()
    throw new ApiError(
      challenge.status === AdminMfaChallengeStatus.LOCKED ? StatusCodes.LOCKED : StatusCodes.UNAUTHORIZED,
      'Invalid TOTP code'
    )
  }

  const verifiedAt = new Date()
  challenge.status = AdminMfaChallengeStatus.VERIFIED
  challenge.verified_at = verifiedAt
  await challenge.save()

  user.set('admin_mfa.totp.last_verified_at', verifiedAt)
  user.set('admin_mfa.totp.last_verified_time_step', matchingStep)
  user.last_login_at = verifiedAt
  user.failed_login_attempts = 0
  user.locked_until = undefined
  await user.save()

  return user
}
