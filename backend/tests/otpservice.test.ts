import {
  buildOtpChallengeValues,
  buildOtpResendUpdate,
  buildVerificationAttemptUpdate,
  getVerificationPreflightBlock,
  getResendAvailability,
  isOtpExpired,
  OtpResendBlockReason,
  OtpVerificationResult,
  resendPhoneVerificationOtp,
  verifyOtpChallenge,
} from '@alias/services/otp.service'
import { OtpChallenge } from '@alias/models'
import { OtpChallengeStatus } from '@alias/models/otpchallenge.model'
import { UserType } from '@alias/validators'

const policy = {
  expiryMinutes: 10,
  maxAttempts: 3,
  resendCooldownSeconds: 60,
  maxResends: 2,
}

describe('OTP service metadata and policy helpers', () => {
  test('builds Twilio Verify challenge metadata without local OTP storage', async () => {
    const now = new Date('2026-07-06T10:00:00.000Z')
    const { challenge } = await buildOtpChallengeValues({
      userId: '64f000000000000000000001',
      userType: UserType.DOCTOR,
      phoneNumber: 'patient-channel-ending-3210',
      now,
      policy,
      providerVerificationSid: 'test-verification-id',
      providerStatus: 'pending',
    })

    expect(challenge.phone_hash).not.toContain('patient-channel-ending-3210')
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
      phoneNumber: 'patient-channel-ending-3210',
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
      phoneNumber: 'patient-channel-ending-3210',
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
      phoneNumber: 'patient-channel-ending-3210',
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
      phoneNumber: 'patient-channel-ending-3210',
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
      phoneNumber: 'patient-channel-ending-3210',
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
      phoneNumber: 'patient-channel-ending-3210',
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

  test('reserves resend quota atomically before starting Twilio verification', async () => {
    const now = new Date('2026-07-06T10:00:00.000Z')
    const reservedChallenge = {
      _id: 'challenge-id',
      resend_count: 1,
      attempt_count: 0,
      max_attempts: 3,
      max_resends: 2,
      expires_at: new Date('2026-07-06T10:10:00.000Z'),
      status: OtpChallengeStatus.PENDING,
    }
    const finalizedChallenge = {
      ...reservedChallenge,
      provider_status: 'pending',
    }
    const findOneAndUpdate = jest.spyOn(OtpChallenge, 'findOneAndUpdate')
      .mockResolvedValueOnce(reservedChallenge as any)
      .mockResolvedValueOnce(finalizedChallenge as any)
    const provider = {
      startVerification: jest.fn().mockResolvedValue({
        sid: 'test-verification-id',
        status: 'pending',
      }),
      checkVerification: jest.fn(),
    }

    const result = await resendPhoneVerificationOtp(
      'challenge-id',
      'patient-channel-ending-3210',
      provider,
      now
    )

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: 'challenge-id',
        status: OtpChallengeStatus.PENDING,
        $expr: expect.any(Object),
      }),
      expect.objectContaining({
        $inc: { resend_count: 1 },
      }),
      { new: true }
    )
    expect(provider.startVerification).toHaveBeenCalledTimes(1)
    expect(findOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        _id: 'challenge-id',
        status: OtpChallengeStatus.PENDING,
        provider_status: expect.stringMatching(/^send_reserved:/),
      }),
      expect.objectContaining({ $set: expect.objectContaining({ provider_status: 'pending' }) }),
      { new: true }
    )
    expect(result?.allowed).toBe(true)

    findOneAndUpdate.mockRestore()
  })

  test('does not let stale resend finalizer reopen a terminal challenge', async () => {
    const now = new Date('2026-07-06T10:00:00.000Z')
    const reservedChallenge = {
      _id: 'challenge-id',
      resend_count: 1,
      attempt_count: 0,
      max_attempts: 3,
      max_resends: 2,
      expires_at: new Date('2026-07-06T10:10:00.000Z'),
      status: OtpChallengeStatus.PENDING,
    }
    const findOneAndUpdate = jest.spyOn(OtpChallenge, 'findOneAndUpdate')
      .mockResolvedValueOnce(reservedChallenge as any)
      .mockResolvedValueOnce(null)
    const provider = {
      startVerification: jest.fn().mockResolvedValue({
        sid: 'test-verification-id',
        status: 'pending',
      }),
      checkVerification: jest.fn(),
    }

    const result = await resendPhoneVerificationOtp(
      'challenge-id',
      'patient-channel-ending-3210',
      provider,
      now
    )

    expect(findOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        _id: 'challenge-id',
        status: OtpChallengeStatus.PENDING,
        provider_status: expect.stringMatching(/^send_reserved:/),
      }),
      expect.objectContaining({ $set: expect.objectContaining({ status: OtpChallengeStatus.PENDING }) }),
      { new: true }
    )
    expect(result?.allowed).toBe(false)

    findOneAndUpdate.mockRestore()
  })

  test('reserves verification attempt atomically before checking Twilio code', async () => {
    const now = new Date('2026-07-06T10:00:00.000Z')
    const reservedChallenge = {
      _id: 'challenge-id',
      attempt_count: 1,
      max_attempts: 3,
      resend_count: 0,
      max_resends: 2,
      expires_at: new Date('2026-07-06T10:10:00.000Z'),
      status: OtpChallengeStatus.PENDING,
    }
    const finalizedChallenge = {
      ...reservedChallenge,
      status: OtpChallengeStatus.VERIFIED,
    }
    const findOneAndUpdate = jest.spyOn(OtpChallenge, 'findOneAndUpdate')
      .mockResolvedValueOnce(reservedChallenge as any)
      .mockResolvedValueOnce(finalizedChallenge as any)
    const provider = {
      startVerification: jest.fn(),
      checkVerification: jest.fn().mockResolvedValue({
        status: 'approved',
        valid: true,
      }),
    }

    const result = await verifyOtpChallenge(
      'challenge-id',
      'patient-channel-ending-3210',
      'candidate-code',
      provider,
      now
    )

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: 'challenge-id',
        status: OtpChallengeStatus.PENDING,
        $expr: expect.any(Object),
      }),
      expect.objectContaining({
        $inc: { attempt_count: 1 },
      }),
      { new: true }
    )
    expect(provider.checkVerification).toHaveBeenCalledTimes(1)
    expect(findOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        _id: 'challenge-id',
        status: OtpChallengeStatus.PENDING,
      }),
      expect.objectContaining({ $set: expect.objectContaining({ status: OtpChallengeStatus.VERIFIED }) }),
      { new: true }
    )
    expect(result?.verified).toBe(true)

    findOneAndUpdate.mockRestore()
  })

  test('does not let stale failed verification finalizer downgrade a terminal challenge', async () => {
    const now = new Date('2026-07-06T10:00:00.000Z')
    const reservedChallenge = {
      _id: 'challenge-id',
      attempt_count: 1,
      max_attempts: 3,
      resend_count: 0,
      max_resends: 2,
      expires_at: new Date('2026-07-06T10:10:00.000Z'),
      status: OtpChallengeStatus.PENDING,
    }
    const findOneAndUpdate = jest.spyOn(OtpChallenge, 'findOneAndUpdate')
      .mockResolvedValueOnce(reservedChallenge as any)
      .mockResolvedValueOnce(null)
    const provider = {
      startVerification: jest.fn(),
      checkVerification: jest.fn().mockResolvedValue({
        status: 'pending',
        valid: false,
      }),
    }

    const result = await verifyOtpChallenge(
      'challenge-id',
      'patient-channel-ending-3210',
      'candidate-code',
      provider,
      now
    )

    expect(findOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        _id: 'challenge-id',
        status: OtpChallengeStatus.PENDING,
        provider_status: expect.stringMatching(/^check_reserved:/),
      }),
      expect.objectContaining({ $set: expect.objectContaining({ status: OtpChallengeStatus.PENDING }) }),
      { new: true }
    )
    expect(result?.verified).toBe(false)
    expect(result?.result).toBe(OtpVerificationResult.ALREADY_VERIFIED)
    expect(result?.update).toEqual({})

    findOneAndUpdate.mockRestore()
  })
})
