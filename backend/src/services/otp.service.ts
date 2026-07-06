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
import { TwilioVerifyClient, twilioVerifyService } from './twilio-verify.service'

export interface OtpPolicy {
  codeLength: number
  expiryMinutes: number
  maxAttempts: number
  resendCooldownSeconds: number
  maxResends: number
}

export interface OtpChallengeLike {
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
  PHONE_MISMATCH = 'PHONE_MISMATCH',
}

export enum OtpResendBlockReason {
  COOLDOWN = 'COOLDOWN',
  MAX_RESENDS = 'MAX_RESENDS',
  EXPIRED = 'EXPIRED',
  LOCKED = 'LOCKED',
  VERIFIED = 'VERIFIED',
  CANCELLED = 'CANCELLED',
  PHONE_MISMATCH = 'PHONE_MISMATCH',
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
  providerVerificationSid?: string
  providerStatus?: string
}) {
  const policy = input.policy || getDefaultOtpPolicy()
  const now = input.now || new Date()

  return {
    challenge: {
      user_id: input.userId,
      user_type: input.userType,
      purpose: input.purpose || OtpChallengePurpose.PHONE_FIRST_LOGIN,
      delivery_channel: OtpDeliveryChannel.SMS,
      phone_hash: hashPhoneNumber(input.phoneNumber),
      phone_last4: getPhoneLast4(input.phoneNumber),
      provider: 'twilio_verify',
      provider_verification_sid: input.providerVerificationSid,
      provider_status: input.providerStatus,
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

export function buildVerificationAttemptUpdate(
  challenge: OtpChallengeLike,
  approved: boolean,
  now = new Date()
): {
  verified: boolean
  result: OtpVerificationResult
  update: Partial<OtpChallengeLike>
} {
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

  if (approved) {
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

export function getVerificationPreflightBlock(
  challenge: OtpChallengeLike,
  now = new Date()
): {
  verified: boolean
  result: OtpVerificationResult
  update: Partial<OtpChallengeLike>
} | null {
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

  return null
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
  providerVerificationSid?: string,
  providerStatus?: string
) {
  const availability = getResendAvailability(challenge, now)
  if (!availability.allowed) {
    return {
      allowed: false,
      availability,
    }
  }

  return {
    allowed: true,
    availability,
    update: {
      provider_verification_sid: providerVerificationSid,
      provider_status: providerStatus,
      expires_at: new Date(now.getTime() + policy.expiryMinutes * 60 * 1000),
      attempt_count: 0,
      resend_count: challenge.resend_count + 1,
      resend_available_at: new Date(now.getTime() + policy.resendCooldownSeconds * 1000),
      last_sent_at: now,
      status: OtpChallengeStatus.PENDING,
    },
  }
}

export async function issuePhoneVerificationOtp(input: {
  userId: string | mongoose.Types.ObjectId
  userType: UserType.DOCTOR | UserType.PATIENT
  phoneNumber: string
  provider?: TwilioVerifyClient
  policy?: OtpPolicy
}) {
  const policy = input.policy || getDefaultOtpPolicy()
  const provider = input.provider || twilioVerifyService
  const verification = await provider.startVerification(input.phoneNumber, config.twilioVerifyChannel)
  const { challenge } = await buildOtpChallengeValues({
    userId: input.userId,
    userType: input.userType,
    phoneNumber: input.phoneNumber,
    policy,
    providerVerificationSid: verification.sid,
    providerStatus: verification.status,
  })

  return OtpChallenge.create(challenge)
}

export async function resendPhoneVerificationOtp(
  challengeId: string,
  phoneNumber: string,
  provider: TwilioVerifyClient = twilioVerifyService,
  now = new Date()
) {
  const challenge = await OtpChallenge.findById(challengeId)
  if (!challenge) return null

  if (challenge.phone_hash !== hashPhoneNumber(phoneNumber)) {
    return {
      allowed: false,
      availability: {
        allowed: false,
        reason: OtpResendBlockReason.PHONE_MISMATCH,
      },
    }
  }

  const availability = getResendAvailability(challenge, now)
  if (!availability.allowed) {
    return { allowed: false, availability }
  }

  const verification = await provider.startVerification(phoneNumber, config.twilioVerifyChannel)
  const result = await buildOtpResendUpdate(
    challenge,
    getDefaultOtpPolicy(),
    now,
    verification.sid,
    verification.status
  )

  if (result.allowed && result.update) {
    challenge.set(result.update)
    await challenge.save()
  }

  return result
}

export async function verifyOtpChallenge(
  challengeId: string,
  phoneNumber: string,
  candidate: string,
  provider: TwilioVerifyClient = twilioVerifyService,
  now = new Date()
) {
  const challenge = await OtpChallenge.findById(challengeId)
  if (!challenge) return null

  if (challenge.phone_hash !== hashPhoneNumber(phoneNumber)) {
    return {
      verified: false,
      result: OtpVerificationResult.PHONE_MISMATCH,
      update: {},
    }
  }

  const preflight = getVerificationPreflightBlock(challenge, now)
  if (preflight) {
    if (Object.keys(preflight.update).length > 0) {
      challenge.set(preflight.update)
      await challenge.save()
    }
    return preflight
  }

  const verification = await provider.checkVerification(phoneNumber, candidate)
  const result = buildVerificationAttemptUpdate(
    challenge,
    verification.valid === true || verification.status === 'approved',
    now
  )

  if (Object.keys(result.update).length > 0) {
    challenge.set(result.update)
    if (verification.status) {
      challenge.set({ provider_status: verification.status })
    }
    await challenge.save()
  }

  return result
}
