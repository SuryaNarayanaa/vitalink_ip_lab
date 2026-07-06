import {
  buildOtpChallengeValues,
  buildOtpResendUpdate,
  compareOtpCode,
  generateOtpCode,
  getResendAvailability,
  hashOtpCode,
  isOtpExpired,
  OtpResendBlockReason,
  OtpVerificationResult,
  verifyOtpCandidate,
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

describe('OTP service', () => {
  test('generates fixed-length numeric OTP codes', () => {
    const code = generateOtpCode(6)

    expect(code).toMatch(/^\d{6}$/)
  })

  test('hashes and verifies OTP codes without storing raw values', async () => {
    const { hash, salt } = await hashOtpCode('123456')

    expect(hash).not.toBe('123456')
    await expect(compareOtpCode('123456', salt, hash)).resolves.toBe(true)
    await expect(compareOtpCode('654321', salt, hash)).resolves.toBe(false)
  })

  test('builds first-login phone challenge values with expiry and resend metadata', async () => {
    const now = new Date('2026-07-06T10:00:00.000Z')
    const { code, challenge } = await buildOtpChallengeValues({
      userId: '64f000000000000000000001',
      userType: UserType.DOCTOR,
      phoneNumber: '+91 98765 43210',
      now,
      policy,
      code: '111222',
    })

    expect(code).toBe('111222')
    expect(challenge.phone_hash).not.toContain('9876543210')
    expect(challenge.phone_last4).toBe('3210')
    expect(challenge.otp_hash).not.toBe('111222')
    expect(challenge.expires_at.toISOString()).toBe('2026-07-06T10:10:00.000Z')
    expect(challenge.resend_available_at.toISOString()).toBe('2026-07-06T10:01:00.000Z')
    expect(challenge.max_attempts).toBe(3)
    expect(challenge.max_resends).toBe(2)
  })

  test('verifies a valid candidate and marks challenge verified', async () => {
    const now = new Date('2026-07-06T10:00:00.000Z')
    const { challenge } = await buildOtpChallengeValues({
      userId: '64f000000000000000000001',
      userType: UserType.PATIENT,
      phoneNumber: '9876543210',
      now,
      policy,
      code: '222333',
    })

    const result = await verifyOtpCandidate(challenge, '222333', now)

    expect(result.verified).toBe(true)
    expect(result.result).toBe(OtpVerificationResult.VERIFIED)
    expect(result.update.status).toBe(OtpChallengeStatus.VERIFIED)
    expect(result.update.verified_at).toBe(now)
  })

  test('increments attempts and locks at max attempts', async () => {
    const now = new Date('2026-07-06T10:00:00.000Z')
    const { challenge } = await buildOtpChallengeValues({
      userId: '64f000000000000000000001',
      userType: UserType.DOCTOR,
      phoneNumber: '9876543210',
      now,
      policy,
      code: '222333',
    })

    const first = await verifyOtpCandidate(challenge, '000000', now)
    expect(first.result).toBe(OtpVerificationResult.INVALID)
    expect(first.update.attempt_count).toBe(1)

    const almostLocked = { ...challenge, attempt_count: 2 }
    const second = await verifyOtpCandidate(almostLocked, '000000', now)
    expect(second.result).toBe(OtpVerificationResult.LOCKED)
    expect(second.update.attempt_count).toBe(3)
    expect(second.update.status).toBe(OtpChallengeStatus.LOCKED)
  })

  test('expires challenges at the configured expiry time', async () => {
    const now = new Date('2026-07-06T10:00:00.000Z')
    const { challenge } = await buildOtpChallengeValues({
      userId: '64f000000000000000000001',
      userType: UserType.PATIENT,
      phoneNumber: '9876543210',
      now,
      policy,
      code: '222333',
    })
    const expiredAt = new Date('2026-07-06T10:10:00.000Z')

    expect(isOtpExpired(challenge, expiredAt)).toBe(true)

    const result = await verifyOtpCandidate(challenge, '222333', expiredAt)
    expect(result.verified).toBe(false)
    expect(result.result).toBe(OtpVerificationResult.EXPIRED)
    expect(result.update.status).toBe(OtpChallengeStatus.EXPIRED)
  })

  test('enforces resend cooldowns and max resend limits', async () => {
    const now = new Date('2026-07-06T10:00:00.000Z')
    const { challenge } = await buildOtpChallengeValues({
      userId: '64f000000000000000000001',
      userType: UserType.DOCTOR,
      phoneNumber: '9876543210',
      now,
      policy,
      code: '222333',
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

  test('builds resend updates with a new OTP hash and refreshed expiry', async () => {
    const now = new Date('2026-07-06T10:00:00.000Z')
    const { challenge } = await buildOtpChallengeValues({
      userId: '64f000000000000000000001',
      userType: UserType.PATIENT,
      phoneNumber: '9876543210',
      now,
      policy,
      code: '222333',
    })

    const resendAt = new Date('2026-07-06T10:01:01.000Z')
    const result = await buildOtpResendUpdate(challenge, policy, resendAt, '444555')

    expect(result.allowed).toBe(true)
    expect(result.code).toBe('444555')
    expect(result.update?.otp_hash).not.toBe(challenge.otp_hash)
    expect(result.update?.attempt_count).toBe(0)
    expect(result.update?.resend_count).toBe(1)
    expect(result.update?.expires_at.toISOString()).toBe('2026-07-06T10:11:01.000Z')
    expect(result.update?.resend_available_at.toISOString()).toBe('2026-07-06T10:02:01.000Z')
  })
})
