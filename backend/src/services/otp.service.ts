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
import { TwilioVerifyClient, twilioVerifyService } from './twilio-verify.service'

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

const PROVIDER_RESERVATION_LEASE_MS = 60_000
const OTP_RESERVATION_OPERATION = {
  RESEND: 'resend',
  VERIFY: 'verify',
} as const

export enum OtpVerificationResult {
  VERIFIED = 'VERIFIED',
  INVALID = 'INVALID',
  EXPIRED = 'EXPIRED',
  LOCKED = 'LOCKED',
  ALREADY_VERIFIED = 'ALREADY_VERIFIED',
  CANCELLED = 'CANCELLED',
  PHONE_MISMATCH = 'PHONE_MISMATCH',
  IN_PROGRESS = 'IN_PROGRESS',
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

async function getLostVerificationReservationResult(challengeId: string, now: Date) {
  const challenge = await OtpChallenge.findById(challengeId)
  if (!challenge) return null

  const preflight = getVerificationPreflightBlock(challenge, now)
  if (preflight) return preflight

  return {
    verified: false,
    result: OtpVerificationResult.IN_PROGRESS,
    update: {},
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
  const policy = getDefaultOtpPolicy()
  const resendAvailableAt = new Date(now.getTime() + policy.resendCooldownSeconds * 1000)
  const phoneHash = hashPhoneNumber(phoneNumber)
  const reservationId = crypto.randomUUID()
  const reservationExpiresAt = new Date(now.getTime() + PROVIDER_RESERVATION_LEASE_MS)

  const reservedChallenge = await OtpChallenge.findOneAndUpdate(
    {
      _id: challengeId,
      phone_hash: phoneHash,
      status: OtpChallengeStatus.PENDING,
      expires_at: { $gt: now },
      $expr: {
        $and: [
          { $or: [
            { $eq: [{ $ifNull: ['$resend_available_at', null] }, null] },
            { $lte: ['$resend_available_at', now] },
          ] },
          { $or: [
            { $eq: [{ $ifNull: ['$provider_reservation_expires_at', null] }, null] },
            { $lte: ['$provider_reservation_expires_at', now] },
          ] },
          { $or: [
            { $and: [
              { $lt: ['$resend_count', '$max_resends'] },
              { $lt: ['$attempt_count', '$max_attempts'] },
            ] },
            { $and: [
              { $ne: [{ $ifNull: ['$provider_reservation_id', null] }, null] },
              { $lte: ['$provider_reservation_expires_at', now] },
              { $eq: ['$provider_reservation_operation', OTP_RESERVATION_OPERATION.RESEND] },
              { $lt: ['$attempt_count', '$max_attempts'] },
            ] },
            { $and: [
              { $ne: [{ $ifNull: ['$provider_reservation_id', null] }, null] },
              { $lte: ['$provider_reservation_expires_at', now] },
              { $eq: ['$provider_reservation_operation', OTP_RESERVATION_OPERATION.VERIFY] },
              { $lt: ['$resend_count', '$max_resends'] },
            ] },
          ] },
        ],
      },
    },
    [
      {
        $set: {
          resend_count: {
            $cond: [
              {
                $and: [
                  { $ne: [{ $ifNull: ['$provider_reservation_id', null] }, null] },
                  { $lte: ['$provider_reservation_expires_at', now] },
                  { $eq: ['$provider_reservation_operation', OTP_RESERVATION_OPERATION.RESEND] },
                ],
              },
              '$resend_count',
              { $add: ['$resend_count', 1] },
            ],
          },
          attempt_count: {
            $cond: [
              {
                $and: [
                  { $ne: [{ $ifNull: ['$provider_reservation_id', null] }, null] },
                  { $lte: ['$provider_reservation_expires_at', now] },
                  { $eq: ['$provider_reservation_operation', OTP_RESERVATION_OPERATION.VERIFY] },
                ],
              },
              { $subtract: ['$attempt_count', 1] },
              '$attempt_count',
            ],
          },
        resend_available_at: resendAvailableAt,
        last_sent_at: now,
        provider_reservation_id: reservationId,
        provider_reservation_expires_at: reservationExpiresAt,
        provider_reservation_operation: OTP_RESERVATION_OPERATION.RESEND,
        },
      },
    ],
    { new: true, updatePipeline: true }
  )

  if (!reservedChallenge) {
    const challenge = await OtpChallenge.findById(challengeId)
    if (!challenge) return null

    if (challenge.phone_hash !== phoneHash) {
      return {
        allowed: false,
        availability: {
          allowed: false,
          reason: OtpResendBlockReason.PHONE_MISMATCH,
        },
      }
    }

    return {
      allowed: false,
      availability: getResendAvailability(challenge, now),
    }
  }

  let verification: Awaited<ReturnType<TwilioVerifyClient['startVerification']>>
  try {
    verification = await provider.startVerification(phoneNumber, config.twilioVerifyChannel)
  } catch (error) {
    await OtpChallenge.findOneAndUpdate(
      {
        _id: reservedChallenge._id,
        status: OtpChallengeStatus.PENDING,
        provider_reservation_id: reservationId,
      },
      {
        $inc: { resend_count: -1 },
        $set: { resend_available_at: now },
        $unset: { provider_reservation_id: 1, provider_reservation_expires_at: 1, provider_reservation_operation: 1 },
      }
    )
    throw error
  }
  const update = {
    provider_verification_sid: verification.sid,
    provider_status: verification.status,
    expires_at: new Date(now.getTime() + policy.expiryMinutes * 60 * 1000),
    attempt_count: 0,
    resend_available_at: resendAvailableAt,
    last_sent_at: now,
    status: OtpChallengeStatus.PENDING,
  }

  const finalizedChallenge = await OtpChallenge.findOneAndUpdate(
    {
      _id: reservedChallenge._id,
      status: OtpChallengeStatus.PENDING,
      provider_reservation_id: reservationId,
    },
    {
      $set: update,
      $unset: { provider_reservation_id: 1, provider_reservation_expires_at: 1, provider_reservation_operation: 1 },
    },
    { new: true }
  )

  return {
    allowed: Boolean(finalizedChallenge),
    availability: { allowed: true },
    update: {
      ...(finalizedChallenge ? update : {}),
      resend_count: reservedChallenge.resend_count,
    },
  }
}

export async function verifyOtpChallenge(
  challengeId: string,
  phoneNumber: string,
  candidate: string,
  provider: TwilioVerifyClient = twilioVerifyService,
  now = new Date()
) {
  const phoneHash = hashPhoneNumber(phoneNumber)
  const reservationId = crypto.randomUUID()
  const reservationExpiresAt = new Date(now.getTime() + PROVIDER_RESERVATION_LEASE_MS)
  const reservedChallenge = await OtpChallenge.findOneAndUpdate(
    {
      _id: challengeId,
      phone_hash: phoneHash,
      status: OtpChallengeStatus.PENDING,
      expires_at: { $gt: now },
      $expr: {
        $and: [
          { $or: [
            { $eq: [{ $ifNull: ['$provider_reservation_expires_at', null] }, null] },
            { $lte: ['$provider_reservation_expires_at', now] },
          ] },
          { $or: [
            { $lt: ['$attempt_count', '$max_attempts'] },
            { $and: [
              { $ne: [{ $ifNull: ['$provider_reservation_id', null] }, null] },
              { $lte: ['$provider_reservation_expires_at', now] },
              { $eq: ['$provider_reservation_operation', OTP_RESERVATION_OPERATION.VERIFY] },
            ] },
            { $and: [
              { $ne: [{ $ifNull: ['$provider_reservation_id', null] }, null] },
              { $lte: ['$provider_reservation_expires_at', now] },
              { $eq: ['$provider_reservation_operation', OTP_RESERVATION_OPERATION.RESEND] },
              { $lt: ['$attempt_count', '$max_attempts'] },
            ] },
          ] },
        ],
      },
    },
    [
      {
        $set: {
          attempt_count: {
            $cond: [
              {
                $and: [
                  { $ne: [{ $ifNull: ['$provider_reservation_id', null] }, null] },
                  { $lte: ['$provider_reservation_expires_at', now] },
                  { $eq: ['$provider_reservation_operation', OTP_RESERVATION_OPERATION.VERIFY] },
                ],
              },
              '$attempt_count',
              { $add: ['$attempt_count', 1] },
            ],
          },
          resend_count: {
            $cond: [
              {
                $and: [
                  { $ne: [{ $ifNull: ['$provider_reservation_id', null] }, null] },
                  { $lte: ['$provider_reservation_expires_at', now] },
                  { $eq: ['$provider_reservation_operation', OTP_RESERVATION_OPERATION.RESEND] },
                ],
              },
              { $subtract: ['$resend_count', 1] },
              '$resend_count',
            ],
          },
        provider_reservation_id: reservationId,
        provider_reservation_expires_at: reservationExpiresAt,
        provider_reservation_operation: OTP_RESERVATION_OPERATION.VERIFY,
        },
      },
    ],
    { new: true, updatePipeline: true }
  )

  if (!reservedChallenge) {
    const challenge = await OtpChallenge.findById(challengeId)
    if (!challenge) return null

    if (challenge.phone_hash !== phoneHash) {
      return {
        verified: false,
        result: OtpVerificationResult.PHONE_MISMATCH,
        update: {},
      }
    }

    const preflight = getVerificationPreflightBlock(challenge, now)
    if (preflight) {
      if (Object.keys(preflight.update).length > 0) {
        await OtpChallenge.findByIdAndUpdate(challenge._id, { $set: preflight.update })
      }
      return preflight
    }

    return {
      verified: false,
      result: OtpVerificationResult.IN_PROGRESS,
      update: {},
    }
  }

  let verification: Awaited<ReturnType<TwilioVerifyClient['checkVerification']>>
  try {
    verification = await provider.checkVerification(phoneNumber, candidate)
  } catch (error) {
    await OtpChallenge.findOneAndUpdate(
      {
        _id: reservedChallenge._id,
        status: OtpChallengeStatus.PENDING,
        provider_reservation_id: reservationId,
      },
      {
        $inc: { attempt_count: -1 },
        $unset: { provider_reservation_id: 1, provider_reservation_expires_at: 1, provider_reservation_operation: 1 },
      }
    )
    throw error
  }
  const approved = verification.valid === true || verification.status === 'approved'

  if (approved) {
    const update = {
      status: OtpChallengeStatus.VERIFIED,
      verified_at: now,
      provider_status: verification.status,
    }
    const finalizedChallenge = await OtpChallenge.findOneAndUpdate(
      {
        _id: reservedChallenge._id,
        status: OtpChallengeStatus.PENDING,
        provider_reservation_id: reservationId,
      },
      {
        $set: update,
        $unset: { provider_reservation_id: 1, provider_reservation_expires_at: 1, provider_reservation_operation: 1 },
      },
      { new: true }
    )

    if (!finalizedChallenge) {
      return getLostVerificationReservationResult(reservedChallenge._id.toString(), now)
    }

    return {
      verified: true,
      result: OtpVerificationResult.VERIFIED,
      update,
    }
  }

  const isLocked = reservedChallenge.attempt_count >= reservedChallenge.max_attempts
  const update = {
    status: isLocked ? OtpChallengeStatus.LOCKED : OtpChallengeStatus.PENDING,
    provider_status: verification.status,
  }
  const finalizedChallenge = await OtpChallenge.findOneAndUpdate(
    {
      _id: reservedChallenge._id,
      status: OtpChallengeStatus.PENDING,
      provider_reservation_id: reservationId,
    },
    {
      $set: update,
      $unset: { provider_reservation_id: 1, provider_reservation_expires_at: 1, provider_reservation_operation: 1 },
    },
    { new: true }
  )

  if (!finalizedChallenge) {
    return getLostVerificationReservationResult(reservedChallenge._id.toString(), now)
  }

  return {
    verified: false,
    result: isLocked ? OtpVerificationResult.LOCKED : OtpVerificationResult.INVALID,
    update: {
      attempt_count: reservedChallenge.attempt_count,
      status: update.status,
    },
  }
}
