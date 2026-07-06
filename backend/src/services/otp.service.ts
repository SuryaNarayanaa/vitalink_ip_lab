import crypto, { randomInt } from 'crypto'
import mongoose from 'mongoose'
import { config } from '@alias/config'
import { OtpChallenge } from '@alias/models'
import {
  OtpChallengePurpose,
  OtpChallengeStatus,
  OtpDeliveryChannel,
} from '@alias/models/otpchallenge.model'
import { UserType } from '@alias/validators'
import { comparePasswords, generateSalt, hashPassword } from '@alias/utils'
import { SmsProvider, smsProvider } from './sms-provider.service'

export interface OtpPolicy {
  codeLength: number
  expiryMinutes: number
  maxAttempts: number
  resendCooldownSeconds: number
  maxResends: number
}

export interface OtpChallengeLike {
  otp_hash: string
  otp_salt: string
  expires_at: Date
  attempt_count: number
  max_attempts: number
  resend_count: number
  max_resends: number
  resend_available_at?: Date
  status: OtpChallengeStatus
  verified_at?: Date
}

export enum OtpVerificationResult {
  VERIFIED = 'VERIFIED',
  INVALID = 'INVALID',
  EXPIRED = 'EXPIRED',
  LOCKED = 'LOCKED',
  ALREADY_VERIFIED = 'ALREADY_VERIFIED',
  CANCELLED = 'CANCELLED',
}

export enum OtpResendBlockReason {
  COOLDOWN = 'COOLDOWN',
  MAX_RESENDS = 'MAX_RESENDS',
  EXPIRED = 'EXPIRED',
  LOCKED = 'LOCKED',
  VERIFIED = 'VERIFIED',
  CANCELLED = 'CANCELLED',
}

export function getDefaultOtpPolicy(): OtpPolicy {
  return {
    codeLength: config.otpCodeLength,
    expiryMinutes: config.otpExpiryMinutes,
    maxAttempts: config.otpMaxAttempts,
    resendCooldownSeconds: config.otpResendCooldownSeconds,
    maxResends: config.otpMaxResends,
  }
}

export function generateOtpCode(length = config.otpCodeLength): string {
  const normalizedLength = Math.min(Math.max(1, length), 10)
  const upperBound = 10 ** normalizedLength
  return randomInt(0, upperBound).toString().padStart(normalizedLength, '0')
}

export async function hashOtpCode(code: string, salt = generateSalt()) {
  return {
    hash: await hashPassword(code.trim(), salt),
    salt,
  }
}

export async function compareOtpCode(code: string, salt: string, hashedOtp: string): Promise<boolean> {
  return comparePasswords({
    password: code.trim(),
    salt,
    hashedPassword: hashedOtp,
  })
}

export function normalizePhoneNumber(phoneNumber: string): string {
  return phoneNumber.replace(/\D/g, '')
}

export function hashPhoneNumber(phoneNumber: string): string {
  return crypto
    .createHmac('sha256', config.jwtSecret)
    .update(normalizePhoneNumber(phoneNumber))
    .digest('hex')
}

export function getPhoneLast4(phoneNumber: string): string {
  return normalizePhoneNumber(phoneNumber).slice(-4)
}

export function isOtpExpired(challenge: Pick<OtpChallengeLike, 'expires_at'>, now = new Date()): boolean {
  return challenge.expires_at.getTime() <= now.getTime()
}

export async function buildOtpChallengeValues(input: {
  userId: string | mongoose.Types.ObjectId
  userType: UserType.DOCTOR | UserType.PATIENT
  phoneNumber: string
  purpose?: OtpChallengePurpose
  now?: Date
  policy?: OtpPolicy
  code?: string
}) {
  const policy = input.policy || getDefaultOtpPolicy()
  const now = input.now || new Date()
  const code = input.code || generateOtpCode(policy.codeLength)
  const hashedOtp = await hashOtpCode(code)

  return {
    code,
    challenge: {
      user_id: input.userId,
      user_type: input.userType,
      purpose: input.purpose || OtpChallengePurpose.PHONE_FIRST_LOGIN,
      delivery_channel: OtpDeliveryChannel.SMS,
      phone_hash: hashPhoneNumber(input.phoneNumber),
      phone_last4: getPhoneLast4(input.phoneNumber),
      otp_hash: hashedOtp.hash,
      otp_salt: hashedOtp.salt,
      expires_at: new Date(now.getTime() + policy.expiryMinutes * 60 * 1000),
      attempt_count: 0,
      max_attempts: policy.maxAttempts,
      resend_count: 0,
      max_resends: policy.maxResends,
      resend_available_at: new Date(now.getTime() + policy.resendCooldownSeconds * 1000),
      last_sent_at: now,
      status: OtpChallengeStatus.PENDING,
    },
  }
}

export async function verifyOtpCandidate(
  challenge: OtpChallengeLike,
  candidate: string,
  now = new Date()
): Promise<{
  verified: boolean
  result: OtpVerificationResult
  update: Partial<OtpChallengeLike>
}> {
  if (challenge.status === OtpChallengeStatus.VERIFIED || challenge.verified_at) {
    return { verified: false, result: OtpVerificationResult.ALREADY_VERIFIED, update: {} }
  }

  if (challenge.status === OtpChallengeStatus.CANCELLED) {
    return { verified: false, result: OtpVerificationResult.CANCELLED, update: {} }
  }

  if (challenge.status === OtpChallengeStatus.LOCKED || challenge.attempt_count >= challenge.max_attempts) {
    return {
      verified: false,
      result: OtpVerificationResult.LOCKED,
      update: { status: OtpChallengeStatus.LOCKED },
    }
  }

  if (isOtpExpired(challenge, now)) {
    return {
      verified: false,
      result: OtpVerificationResult.EXPIRED,
      update: { status: OtpChallengeStatus.EXPIRED },
    }
  }

  const isValid = await compareOtpCode(candidate, challenge.otp_salt, challenge.otp_hash)
  if (isValid) {
    return {
      verified: true,
      result: OtpVerificationResult.VERIFIED,
      update: {
        status: OtpChallengeStatus.VERIFIED,
        verified_at: now,
      },
    }
  }

  const nextAttemptCount = challenge.attempt_count + 1
  return {
    verified: false,
    result: nextAttemptCount >= challenge.max_attempts
      ? OtpVerificationResult.LOCKED
      : OtpVerificationResult.INVALID,
    update: {
      attempt_count: nextAttemptCount,
      status: nextAttemptCount >= challenge.max_attempts
        ? OtpChallengeStatus.LOCKED
        : OtpChallengeStatus.PENDING,
    },
  }
}

export function getResendAvailability(challenge: OtpChallengeLike, now = new Date()): {
  allowed: boolean
  reason?: OtpResendBlockReason
  retryAfterSeconds?: number
} {
  if (challenge.status === OtpChallengeStatus.VERIFIED || challenge.verified_at) {
    return { allowed: false, reason: OtpResendBlockReason.VERIFIED }
  }

  if (challenge.status === OtpChallengeStatus.CANCELLED) {
    return { allowed: false, reason: OtpResendBlockReason.CANCELLED }
  }

  if (challenge.status === OtpChallengeStatus.LOCKED || challenge.attempt_count >= challenge.max_attempts) {
    return { allowed: false, reason: OtpResendBlockReason.LOCKED }
  }

  if (isOtpExpired(challenge, now)) {
    return { allowed: false, reason: OtpResendBlockReason.EXPIRED }
  }

  if (challenge.resend_count >= challenge.max_resends) {
    return { allowed: false, reason: OtpResendBlockReason.MAX_RESENDS }
  }

  if (challenge.resend_available_at && challenge.resend_available_at.getTime() > now.getTime()) {
    return {
      allowed: false,
      reason: OtpResendBlockReason.COOLDOWN,
      retryAfterSeconds: Math.ceil((challenge.resend_available_at.getTime() - now.getTime()) / 1000),
    }
  }

  return { allowed: true }
}

export async function buildOtpResendUpdate(
  challenge: OtpChallengeLike,
  policy = getDefaultOtpPolicy(),
  now = new Date(),
  code = generateOtpCode(policy.codeLength)
) {
  const availability = getResendAvailability(challenge, now)
  if (!availability.allowed) {
    return {
      allowed: false,
      availability,
    }
  }

  const hashedOtp = await hashOtpCode(code)
  return {
    allowed: true,
    code,
    availability,
    update: {
      otp_hash: hashedOtp.hash,
      otp_salt: hashedOtp.salt,
      expires_at: new Date(now.getTime() + policy.expiryMinutes * 60 * 1000),
      attempt_count: 0,
      resend_count: challenge.resend_count + 1,
      resend_available_at: new Date(now.getTime() + policy.resendCooldownSeconds * 1000),
      last_sent_at: now,
      status: OtpChallengeStatus.PENDING,
    },
  }
}

export function buildOtpSmsBody(code: string, expiryMinutes = config.otpExpiryMinutes): string {
  return `Your VitaLink verification code is ${code}. It expires in ${expiryMinutes} minutes.`
}

export async function issuePhoneVerificationOtp(input: {
  userId: string | mongoose.Types.ObjectId
  userType: UserType.DOCTOR | UserType.PATIENT
  phoneNumber: string
  provider?: SmsProvider
  policy?: OtpPolicy
}) {
  const policy = input.policy || getDefaultOtpPolicy()
  const { code, challenge } = await buildOtpChallengeValues({
    userId: input.userId,
    userType: input.userType,
    phoneNumber: input.phoneNumber,
    policy,
  })

  const createdChallenge = await OtpChallenge.create(challenge)
  await (input.provider || smsProvider).send({
    to: input.phoneNumber,
    body: buildOtpSmsBody(code, policy.expiryMinutes),
    metadata: {
      challengeId: createdChallenge._id.toString(),
      purpose: createdChallenge.purpose,
      userType: createdChallenge.user_type,
    },
  })

  return createdChallenge
}

export async function verifyOtpChallenge(challengeId: string, candidate: string, now = new Date()) {
  const challenge = await OtpChallenge.findById(challengeId)
  if (!challenge) return null

  const result = await verifyOtpCandidate(challenge, candidate, now)
  if (Object.keys(result.update).length > 0) {
    challenge.set(result.update)
    await challenge.save()
  }

  return result
}
