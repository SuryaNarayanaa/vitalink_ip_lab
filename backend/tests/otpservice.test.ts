import {
  buildOtpChallengeValues,
  buildOtpResendUpdate,
  buildVerificationAttemptUpdate,
  getResendAvailability,
  maskPhoneNumber,
  OtpResendBlockReason,
  OtpVerificationResult,
} from '@alias/services/otp.service'
import { OtpChallengeStatus } from '@alias/models/otpchallenge.model'
import { UserType } from '@alias/validators'

const policy = {
  expiryMinutes: 10,
  maxAttempts: 3,
  resendCooldownSeconds: 60,
  maxResends: 2,
}

describe('Firebase phone challenge policy helpers', () => {
  test('builds Firebase challenge metadata without storing an SMS code', async () => {
    const now = new Date('2026-07-06T10:00:00.000Z')
    const { challenge } = await buildOtpChallengeValues({
      userId: '64f000000000000000000001',
      userType: UserType.DOCTOR,
      phoneNumber: '+91 98765 43210',
      now,
      policy,
      providerStatus: 'awaiting_client_verification',
    })

    expect(challenge.phone_hash).not.toContain('9876543210')
    expect(challenge.phone_last4).toBe('3210')
    expect(challenge).not.toHaveProperty('otp_hash')
    expect(challenge.provider).toBe('firebase_auth')
    expect(challenge.provider_status).toBe('awaiting_client_verification')
    expect(challenge.expires_at.toISOString()).toBe('2026-07-06T10:10:00.000Z')
  })

  test('masks phone numbers without exposing more than the final four digits', () => {
    expect(maskPhoneNumber('+91 98765 43210')).toBe('********3210')
    expect(maskPhoneNumber('123')).toBe('****')
  })

  test('marks an approved challenge verified and locks rejected final attempts', async () => {
    const now = new Date('2026-07-06T10:00:00.000Z')
    const { challenge } = await buildOtpChallengeValues({
      userId: '64f000000000000000000001',
      userType: UserType.PATIENT,
      phoneNumber: '9876543210',
      now,
      policy,
    })

    const approved = buildVerificationAttemptUpdate(challenge, true, now)
    expect(approved.result).toBe(OtpVerificationResult.VERIFIED)
    expect(approved.update.status).toBe(OtpChallengeStatus.VERIFIED)

    const rejected = buildVerificationAttemptUpdate({ ...challenge, attempt_count: 2 }, false, now)
    expect(rejected.result).toBe(OtpVerificationResult.LOCKED)
    expect(rejected.update.attempt_count).toBe(3)
  })

  test('enforces resend cooldown and produces Firebase resend metadata', async () => {
    const now = new Date('2026-07-06T10:00:00.000Z')
    const { challenge } = await buildOtpChallengeValues({
      userId: '64f000000000000000000001',
      userType: UserType.DOCTOR,
      phoneNumber: '9876543210',
      now,
      policy,
    })

    const cooldown = getResendAvailability(challenge, new Date('2026-07-06T10:00:30.000Z'))
    expect(cooldown.reason).toBe(OtpResendBlockReason.COOLDOWN)

    const resend = await buildOtpResendUpdate(
      challenge,
      policy,
      new Date('2026-07-06T10:01:01.000Z'),
      'awaiting_client_resend'
    )
    expect(resend.allowed).toBe(true)
    expect(resend.update?.provider_status).toBe('awaiting_client_resend')
    expect(resend.update?.resend_count).toBe(1)
  })
})
