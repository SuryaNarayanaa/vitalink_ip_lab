import {
  buildOtpChallengeValues,
  buildOtpResendUpdate,
  buildVerificationAttemptUpdate,
  compareOtpCode,
  generateOtpCode,
  getVerificationPreflightBlock,
  getResendAvailability,
  hashOtpCode,
  isOtpExpired,
  OtpResendBlockReason,
  OtpVerificationResult,
} from '@alias/services/otp.service'
import { OtpChallengeStatus } from '@alias/models/otpchallenge.model'
import { UserType } from '@alias/validators'

const policy = {
  codeLength: 6,
  expiryMinutes: 10,
  maxAttempts: 3,
  resendCooldownSeconds: 60,
  maxResends: 2,
}

describe('OTP service metadata and policy helpers', () => {
  test('generates fixed-length numeric OTP codes for standalone utility coverage', () => {
    const code = generateOtpCode(6)

    expect(code).toMatch(/^\d{6}$/)
  })

  test('hashes and verifies OTP codes without storing raw values', async () => {
    const { hash, salt } = await hashOtpCode('123456')

    expect(hash).not.toBe('123456')
    await expect(compareOtpCode('123456', salt, hash)).resolves.toBe(true)
    await expect(compareOtpCode('654321', salt, hash)).resolves.toBe(false)
  })

  test('builds Twilio Verify challenge metadata without local OTP storage', async () => {
    const now = new Date('2026-07-06T10:00:00.000Z')
    const { challenge } = await buildOtpChallengeValues({
      userId: '64f000000000000000000001',
      userType: UserType.DOCTOR,
      phoneNumber: '+91 98765 43210',
      now,
      policy,
      providerVerificationSid: 'test-verification-id',
      providerStatus: 'pending',
    })

    expect(challenge.phone_hash).not.toContain('9876543210')
    expect(challenge.phone_last4).toBe('3210')
    expect(challenge).not.toHaveProperty('otp_hash')
    expect(challenge).not.toHaveProperty('otp_salt')
    expect(challenge.provider).toBe('twilio_verify')
    expect(challenge.provider_verification_sid).toBe('test-verification-id')
    expect(challenge.provider_status).toBe('pending')
    expect(challenge.expires_at.toISOString()).toBe('2026-07-06T10:10:00.000Z')
    expect(challenge.resend_available_at.toISOString()).toBe('2026-07-06T10:01:00.000Z')
    expect(challenge.max_attempts).toBe(3)
    expect(challenge.max_resends).toBe(2)
  })

  test('marks challenge verified after Twilio approves the verification check', async () => {
    const now = new Date('2026-07-06T10:00:00.000Z')
    const { challenge } = await buildOtpChallengeValues({
      userId: '64f000000000000000000001',
      userType: UserType.PATIENT,
      phoneNumber: '9876543210',
      now,
      policy,
    })

    const result = buildVerificationAttemptUpdate(challenge, true, now)

    expect(result.verified).toBe(true)
    expect(result.result).toBe(OtpVerificationResult.VERIFIED)
    expect(result.update.status).toBe(OtpChallengeStatus.VERIFIED)
    expect(result.update.verified_at).toBe(now)
  })

  test('increments app-side attempts and locks at max attempts after Twilio rejects checks', async () => {
    const now = new Date('2026-07-06T10:00:00.000Z')
    const { challenge } = await buildOtpChallengeValues({
      userId: '64f000000000000000000001',
      userType: UserType.DOCTOR,
      phoneNumber: '9876543210',
      now,
      policy,
    })

    const first = buildVerificationAttemptUpdate(challenge, false, now)
    expect(first.result).toBe(OtpVerificationResult.INVALID)
    expect(first.update.attempt_count).toBe(1)

    const almostLocked = { ...challenge, attempt_count: 2 }
    const second = buildVerificationAttemptUpdate(almostLocked, false, now)
    expect(second.result).toBe(OtpVerificationResult.LOCKED)
    expect(second.update.attempt_count).toBe(3)
    expect(second.update.status).toBe(OtpChallengeStatus.LOCKED)
  })

  test('allows the final app-side attempt to reach Twilio before locking on rejection', async () => {
    const now = new Date('2026-07-06T10:00:00.000Z')
    const { challenge } = await buildOtpChallengeValues({
      userId: '64f000000000000000000001',
      userType: UserType.DOCTOR,
      phoneNumber: '9876543210',
      now,
      policy,
    })
    const almostLocked = { ...challenge, attempt_count: 2 }

    expect(getVerificationPreflightBlock(almostLocked, now)).toBeNull()

    const rejected = buildVerificationAttemptUpdate(almostLocked, false, now)
    expect(rejected.result).toBe(OtpVerificationResult.LOCKED)
    expect(rejected.update.attempt_count).toBe(3)
  })

  test('expires app-side challenge metadata at the configured expiry time', async () => {
    const now = new Date('2026-07-06T10:00:00.000Z')
    const { challenge } = await buildOtpChallengeValues({
      userId: '64f000000000000000000001',
      userType: UserType.PATIENT,
      phoneNumber: '9876543210',
      now,
      policy,
    })
    const expiredAt = new Date('2026-07-06T10:10:00.000Z')

    expect(isOtpExpired(challenge, expiredAt)).toBe(true)

    const result = buildVerificationAttemptUpdate(challenge, true, expiredAt)
    expect(result.verified).toBe(false)
    expect(result.result).toBe(OtpVerificationResult.EXPIRED)
    expect(result.update.status).toBe(OtpChallengeStatus.EXPIRED)
  })

  test('enforces resend cooldowns and max resend limits before calling Twilio', async () => {
    const now = new Date('2026-07-06T10:00:00.000Z')
    const { challenge } = await buildOtpChallengeValues({
      userId: '64f000000000000000000001',
      userType: UserType.DOCTOR,
      phoneNumber: '9876543210',
      now,
      policy,
    })

    const cooldown = getResendAvailability(challenge, new Date('2026-07-06T10:00:30.000Z'))
    expect(cooldown.allowed).toBe(false)
    expect(cooldown.reason).toBe(OtpResendBlockReason.COOLDOWN)
    expect(cooldown.retryAfterSeconds).toBe(30)

    const maxed = getResendAvailability(
      { ...challenge, resend_count: 2, resend_available_at: new Date('2026-07-06T09:59:00.000Z') },
      now
    )
    expect(maxed.allowed).toBe(false)
    expect(maxed.reason).toBe(OtpResendBlockReason.MAX_RESENDS)
  })

  test('builds resend metadata updates after Twilio starts a fresh verification', async () => {
    const now = new Date('2026-07-06T10:00:00.000Z')
    const { challenge } = await buildOtpChallengeValues({
      userId: '64f000000000000000000001',
      userType: UserType.PATIENT,
      phoneNumber: '9876543210',
      now,
      policy,
    })

    const resendAt = new Date('2026-07-06T10:01:01.000Z')
    const result = await buildOtpResendUpdate(
      challenge,
      policy,
      resendAt,
      'test-resend-verification-id',
      'pending'
    )

    expect(result.allowed).toBe(true)
    expect(result.update?.provider_verification_sid).toBe('test-resend-verification-id')
    expect(result.update?.provider_status).toBe('pending')
    expect(result.update?.attempt_count).toBe(0)
    expect(result.update?.resend_count).toBe(1)
    expect(result.update?.expires_at.toISOString()).toBe('2026-07-06T10:11:01.000Z')
    expect(result.update?.resend_available_at.toISOString()).toBe('2026-07-06T10:02:01.000Z')
  })
})
