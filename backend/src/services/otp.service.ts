import crypto from 'crypto'
import mongoose from 'mongoose'
import { config } from '@alias/config'
import { OtpChallenge } from '@alias/models'
import {
  OtpChallengePurpose,
  OtpChallengeStatus,
  OtpDeliveryChannel,
} from '@alias/models/otpchallenge.model'
import { UserType } from '@alias/validators'

export interface OtpPolicy {
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
    expiryMinutes: config.otpExpiryMinutes,
    maxAttempts: config.otpMaxAttempts,
    resendCooldownSeconds: config.otpResendCooldownSeconds,
    maxResends: config.otpMaxResends,
  }
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
export function maskPhoneNumber(phoneNumber: string): string {
  const digits = normalizePhoneNumber(phoneNumber)
  if (digits.length <= 4) return '****'
  return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`
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
      provider: 'firebase_auth',
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
/** Creates the backend half of a Firebase phone challenge without sending an SMS. */
export async function issueFirebasePhoneVerificationChallenge(input: {
  userId: string | mongoose.Types.ObjectId
  userType: UserType.DOCTOR | UserType.PATIENT
  phoneNumber: string
  policy?: OtpPolicy
}) {
  const { challenge } = await buildOtpChallengeValues({
    ...input,
    providerStatus: 'awaiting_client_verification',
  })
  return OtpChallenge.create(challenge)
}

/** Reserves app-level resend quota; the Flutter Firebase SDK performs the send. */
export async function resendFirebasePhoneVerificationChallenge(
  challengeId: string,
  phoneNumber: string,
  now = new Date()
) {
  const policy = getDefaultOtpPolicy()
  const phoneHash = hashPhoneNumber(phoneNumber)
  const challenge = await OtpChallenge.findById(challengeId)
  if (!challenge) return null
  if (challenge.phone_hash !== phoneHash) {
    return { allowed: false, availability: { allowed: false, reason: OtpResendBlockReason.PHONE_MISMATCH } }
  }

  const resend = await buildOtpResendUpdate(
    challenge,
    policy,
    now,
    'awaiting_client_resend'
  )
  if (!resend.allowed || !resend.update) return resend

  const updated = await OtpChallenge.findOneAndUpdate(
    {
      _id: challengeId,
      phone_hash: phoneHash,
      provider: 'firebase_auth',
      status: OtpChallengeStatus.PENDING,
      resend_count: challenge.resend_count,
    },
    { $set: resend.update },
    { new: true }
  )

  return {
    allowed: Boolean(updated),
    availability: updated ? { allowed: true } : { allowed: false, reason: OtpResendBlockReason.CANCELLED },
    challenge: updated,
  }
}

/** Atomically consumes a challenge after Firebase has authenticated its phone. */
export async function completeFirebasePhoneVerificationChallenge(
  challengeId: string,
  phoneNumber: string,
  firebaseUid: string,
  now = new Date()
) {
  const updated = await OtpChallenge.findOneAndUpdate(
    {
      _id: challengeId,
      phone_hash: hashPhoneNumber(phoneNumber),
      provider: 'firebase_auth',
      status: OtpChallengeStatus.PENDING,
      expires_at: { $gt: now },
    },
    {
      $set: {
        status: OtpChallengeStatus.VERIFIED,
        verified_at: now,
        provider_status: 'verified',
        'metadata.firebase_uid': firebaseUid,
      },
    },
    { new: true }
  )

  if (updated) {
    return { verified: true, result: OtpVerificationResult.VERIFIED, update: { verified_at: now } }
  }

  const challenge = await OtpChallenge.findById(challengeId)
  if (!challenge) return null
  if (challenge.phone_hash !== hashPhoneNumber(phoneNumber)) {
    return { verified: false, result: OtpVerificationResult.PHONE_MISMATCH, update: {} }
  }
  const blocked = getVerificationPreflightBlock(challenge, now)
  return blocked || { verified: false, result: OtpVerificationResult.ALREADY_VERIFIED, update: {} }
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
