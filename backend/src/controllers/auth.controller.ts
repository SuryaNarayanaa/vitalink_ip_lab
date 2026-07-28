import { Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import { asyncHandler, ApiError, ApiResponse } from '@alias/utils'
import { AdminMfaChallenge, AuditLog, DoctorProfile, OtpChallenge, PatientProfile, User } from '@alias/models'
import {
  OtpChallengePurpose,
  OtpChallengeStatus,
} from '@alias/models/otpchallenge.model'
import { AuthSessionRevocationReason } from '@alias/models/authsession.model'
import { AuditAction } from '@alias/models/auditlog.model'
import { AdminMfaChallengeStatus } from '@alias/models/adminmfachallenge.model'
import { comparePasswords } from '@alias/utils'
import { UserType } from '@alias/validators'
import { ActivateAdminTotpInput, ChangePasswordInput, LoginInput, RefreshTokenInput, ResendLoginOtpInput, RevokeTokenInput, VerifyLoginOtpInput, VerifyLoginTotpInput } from '@alias/validators/user.validator'
import { config } from '@alias/config'
import {
  activateAdminTotpEnrollment,
  createAdminMfaEnrollmentChallenge,
  createAdminMfaLoginChallenge,
  createAdminTotpEnrollment,
  getAdminMfaEnrollmentChallengeOrThrow,
  getOrCreateAdminTotpEnrollmentForLoginChallenge,
  getAdminTotpStatus,
  isAdminTotpEnabled,
  isAdminTotpRequiredForUnenrolledAdmins,
  verifyAdminMfaLoginChallenge,
} from '@alias/services/admin-totp.service'
import {
  accountLockoutWindowStart,
  clearLoginFailures,
  recordFailedLoginAttempt,
} from '@alias/services/login-lockout.service'
import {
  hashPhoneNumber,
  issuePhoneVerificationOtp,
  OtpResendBlockReason,
  OtpVerificationResult,
  resendPhoneVerificationOtp,
  verifyOtpChallenge,
} from '@alias/services/otp.service'
import { normalizeIndianPrimaryPhoneNumber } from '@alias/validators/phone.validator'
import { maskPhoneNumber } from '@alias/services/twilio-verify.service'
import {
  createAuthSession,
  bestEffortRevokeSessionsAfterSecurityVersionBump,
  refreshAuthSession,
  revokeActiveAuthSessionsForUser,
  revokeAuthSessionById,
  revokeAuthSessionByRefreshToken,
} from '@alias/services/auth-session.service'
import { hasActiveHospitalAccess } from '@alias/services/hospital-access.service'
import {
  getPasswordPolicyState,
  setUserPasswordWithPolicy,
} from '@alias/services/password.service'
import logger from '@alias/utils/logger'
import crypto from 'crypto'

const getRequestIp = (req: Request) => req.ip || req.socket?.remoteAddress

const normalizeLoginTelemetryId = (loginId?: string) => (loginId || '').trim().toLowerCase()

const getLoginAttemptMetadata = (req: Request, loginId?: string, extra: Record<string, unknown> = {}) => ({
  login_attempt: {
    ip_address: getRequestIp(req),
    normalized_login_id: normalizeLoginTelemetryId(loginId),
    request_id: (req as any).requestId,
    ...extra,
  },
})

const createAuthAuditLog = async (
  req: Request,
  user: any,
  action: AuditAction.LOGIN | AuditAction.LOGIN_CHALLENGE | AuditAction.LOGOUT | AuditAction.LOGIN_FAILED |
    AuditAction.PASSWORD_CHANGE | AuditAction.MFA_SETUP | AuditAction.MFA_ACTIVATE,
  success: boolean,
  description: string,
  errorMessage?: string,
  metadata?: Record<string, unknown>
) => {
  if (!user?._id || !user?.user_type) return

  await AuditLog.create({
    user_id: user._id,
    user_type: user.user_type,
    action,
    description,
    resource_type: 'Auth',
    resource_id: String(user._id),
    ip_address: getRequestIp(req),
    user_agent: req.headers['user-agent'],
    success,
    error_message: errorMessage,
    metadata,
  })
}

const logUnmatchedLoginAttempt = (req: Request, loginId: string, outcome: string) => {
  const loginIdFingerprint = crypto
    .createHash('sha256')
    .update(normalizeLoginTelemetryId(loginId))
    .digest('hex')
    .slice(0, 16)
  logger.warn('Login attempt could not be associated with a user', {
    event: 'auth.login_attempt',
    outcome,
    ip_address: getRequestIp(req),
    login_id_fingerprint: loginIdFingerprint,
    request_id: (req as any).requestId,
  })
}

const OTP_ELIGIBLE_USER_TYPES = new Set<UserType>([UserType.DOCTOR, UserType.PATIENT])
const DUMMY_PASSWORD_SALT = '00000000000000000000000000000000'
const DUMMY_PASSWORD_HASH = '0'.repeat(128)

const sanitizeAuthUser = (user: any) => {
  if (!user) return user
  const safeUser = typeof user.toObject === 'function' ? user.toObject() : { ...user }
  delete safeUser.password
  delete safeUser.salt
  delete safeUser.password_history
  delete safeUser.admin_mfa
  delete safeUser.failed_login_attempts
  delete safeUser.locked_until
  delete safeUser.last_failed_login_at
  Object.assign(safeUser, getPasswordPolicyState(safeUser))
  return safeUser
}

const getSessionPayload = async (req: Request, user: any) => {
  const sessionPayload = await createAuthSession({
    user,
    ipAddress: req.ip || req.socket?.remoteAddress,
    userAgent: req.headers['user-agent'],
  })
  if (!sessionPayload) throw new ApiError(StatusCodes.UNAUTHORIZED, 'Account state changed before session creation')
  const populatedUser = await User.findById(user._id)
    .populate({ path: 'profile_id', populate: { path: 'hospital_id', select: 'code name status' } })
    .select('-password -salt')

  return { ...sessionPayload, user: sanitizeAuthUser(populatedUser) }
}

const bestEffortCreateAuthAuditLog = async (...args: Parameters<typeof createAuthAuditLog>) => {
  try {
    await createAuthAuditLog(...args)
  } catch (error) {
    logger.error('Failed-login audit persistence failed', {
      event: 'auth.login_failure_audit_failed',
      user_id: String(args[1]?._id ?? ''),
      error: error instanceof Error ? error.message : 'unknown_error',
    })
  }
}

const auditIssuedLoginChallenge = async (
  req: Request,
  user: any,
  challengeId: string,
  description: string,
  metadata: Record<string, unknown>,
  cancel: () => Promise<unknown>,
) => {
  try {
    await createAuthAuditLog(req, user, AuditAction.LOGIN_CHALLENGE, true, description, undefined, metadata)
  } catch (error) {
    try {
      await cancel()
    } catch (cleanupError) {
      logger.error('Failed to cancel an unaudited login challenge', {
        event: 'auth.login_challenge_audit_cleanup_failed',
        user_id: String(user._id), challenge_id: challengeId,
        error: cleanupError instanceof Error ? cleanupError.message : 'unknown_error',
      })
    }
    logger.error('Login challenge cancelled because audit persistence failed', {
      event: 'auth.login_challenge_audit_failed',
      user_id: String(user._id), challenge_id: challengeId,
      error: error instanceof Error ? error.message : 'unknown_error',
    })
    throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'Unable to complete login securely')
  }
}

const getAuditedSessionPayload = async (
  req: Request,
  user: any,
  description: string,
  metadata?: Record<string, unknown>,
) => {
  const payload = await getSessionPayload(req, user)
  try {
    await createAuthAuditLog(req, user, AuditAction.LOGIN, true, description, undefined, metadata)
  } catch (error) {
    // A successful LOGIN audit is part of completing authentication. If the
    // immutable record cannot be written, retire the just-created session so
    // the client does not receive usable credentials for an unaudited login.
    try {
      await revokeAuthSessionById(
        payload.session.session_id,
        AuthSessionRevocationReason.USER_REVOKED,
      )
    } catch (revocationError) {
      logger.error('Failed to retire an unaudited authentication session', {
        event: 'auth.login_audit_cleanup_failed',
        user_id: String(user._id),
        session_id: payload.session.session_id,
        error: revocationError instanceof Error ? revocationError.message : 'unknown_error',
      })
    }
    logger.error('Authentication session retired because LOGIN audit persistence failed', {
      event: 'auth.login_audit_failed',
      user_id: String(user._id),
      session_id: payload.session.session_id,
      error: error instanceof Error ? error.message : 'unknown_error',
    })
    throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'Unable to complete login securely')
  }
  return payload
}

const getRegisteredPhoneState = async (user: any): Promise<{
  phoneNumber?: string
  storedPhoneNumber?: string
  isVerified: boolean
}> => {
  if (user.user_type === UserType.DOCTOR) {
    const profile = await DoctorProfile.findById(user.profile_id).select('contact_number phone_verification')
    const storedPhoneNumber = profile?.contact_number
    return {
      phoneNumber: storedPhoneNumber ? normalizeIndianPrimaryPhoneNumber(storedPhoneNumber) : undefined,
      storedPhoneNumber,
      isVerified: profile?.phone_verification?.status === 'VERIFIED',
    }
  }

  if (user.user_type === UserType.PATIENT) {
    const profile = await PatientProfile.findById(user.profile_id).select('demographics.phone demographics.phone_verification')
    const storedPhoneNumber = profile?.demographics?.phone
    return {
      phoneNumber: storedPhoneNumber ? normalizeIndianPrimaryPhoneNumber(storedPhoneNumber) : undefined,
      storedPhoneNumber,
      isVerified: profile?.demographics?.phone_verification?.status === 'VERIFIED',
    }
  }

  return { isVerified: true }
}

const buildOtpChallengeResponse = (challenge: any, phoneNumber: string) => ({
  auth_status: 'OTP_REQUIRED',
  challenge: {
    challenge_id: challenge._id.toString(),
    purpose: challenge.purpose,
    delivery_channel: challenge.delivery_channel,
    phone: {
      masked: maskPhoneNumber(phoneNumber),
      last4: challenge.phone_last4,
    },
    expires_at: challenge.expires_at,
    resend_available_at: challenge.resend_available_at,
    attempts_remaining: Math.max(challenge.max_attempts - challenge.attempt_count, 0),
    max_attempts: challenge.max_attempts,
    resend_count: challenge.resend_count,
    max_resends: challenge.max_resends,
  },
})

const buildAdminMfaChallengeResponse = (
  challenge: any,
  authStatus: 'TOTP_REQUIRED' | 'TOTP_ENROLLMENT_REQUIRED',
  purpose?: 'ENROLLMENT' | 'LOGIN',
) => ({
  auth_status: authStatus,
  challenge: {
    challenge_id: challenge._id.toString(),
    factor_type: 'AUTHENTICATOR_APP',
    ...(purpose ? { purpose } : {}),
    expires_at: challenge.expires_at,
    attempts_remaining: Math.max(challenge.max_attempts - challenge.attempt_count, 0),
    max_attempts: challenge.max_attempts,
  },
})

const ensurePendingLoginChallengeForRegisteredPhone = async (challengeId: string) => {
  const challenge = await OtpChallenge.findById(challengeId)
  if (!challenge) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'OTP challenge not found')
  }

  if (challenge.purpose !== OtpChallengePurpose.PHONE_FIRST_LOGIN) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid OTP challenge')
  }
  if (typeof challenge.security_version !== 'number' || !challenge.profile_id) {
    throw new ApiError(StatusCodes.GONE, 'OTP challenge is no longer available')
  }

  const user = await User.findOne({
    _id: challenge.user_id,
    user_type: challenge.user_type,
    is_active: true,
    security_version: challenge.security_version,
    profile_id: challenge.profile_id,
  })

  if (!user || !OTP_ELIGIBLE_USER_TYPES.has(user.user_type as UserType)) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'OTP challenge not found')
  }

  const { phoneNumber, storedPhoneNumber, isVerified } = await getRegisteredPhoneState(user)
  if (!phoneNumber) {
    throw new ApiError(StatusCodes.CONFLICT, 'Registered phone number is required for OTP verification')
  }
  if (!/^\+91\d{10}$/.test(phoneNumber) || !storedPhoneNumber) {
    throw new ApiError(StatusCodes.CONFLICT, 'Registered phone number must be updated before OTP verification')
  }

  if (isVerified) {
    throw new ApiError(StatusCodes.CONFLICT, 'Registered phone number is already verified')
  }

  if (challenge.phone_hash !== hashPhoneNumber(phoneNumber)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'OTP challenge does not match the registered phone number')
  }

  return { challenge, user, phoneNumber, storedPhoneNumber }
}

const markRegisteredPhoneVerified = async (user: any, storedPhoneNumber: string, verifiedAt: Date) => {
  if (user.user_type === UserType.DOCTOR) {
    const result = await DoctorProfile.updateOne(
      {
        _id: user.profile_id,
        contact_number: storedPhoneNumber,
        'phone_verification.status': { $ne: 'VERIFIED' },
      },
      {
        $set: {
          'phone_verification.status': 'VERIFIED',
          'phone_verification.verified_at': verifiedAt,
        },
      }
    )
    return result.matchedCount > 0 && result.modifiedCount > 0
  }

  if (user.user_type === UserType.PATIENT) {
    const result = await PatientProfile.updateOne(
      {
        _id: user.profile_id,
        'demographics.phone': storedPhoneNumber,
        'demographics.phone_verification.status': { $ne: 'VERIFIED' },
      },
      {
        $set: {
          'demographics.phone_verification.status': 'VERIFIED',
          'demographics.phone_verification.verified_at': verifiedAt,
        },
      }
    )
    return result.matchedCount > 0 && result.modifiedCount > 0
  }

  return false
}

export const loginController = asyncHandler(async (req: Request<{}, {}, LoginInput["body"]>, res: Response) => {
  const { login_id, password } = req.body;
  const normalizedLoginId = login_id.trim()
  const loginAttemptMetadata = (outcome: string, extra: Record<string, unknown> = {}) =>
    getLoginAttemptMetadata(req, normalizedLoginId, { outcome, ...extra })

  const matchedUsers = await User.find({ login_id: normalizedLoginId }).limit(2)
  if (matchedUsers.length === 0) {
    // Keep the expensive password path comparable for unknown and known IDs.
    await comparePasswords({ password, salt: DUMMY_PASSWORD_SALT, hashedPassword: DUMMY_PASSWORD_HASH })
    logUnmatchedLoginAttempt(req, normalizedLoginId, 'unknown_login_id')
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid credentials')
  }
  if (matchedUsers.length > 1) {
    logUnmatchedLoginAttempt(req, normalizedLoginId, 'duplicate_login_id')
    throw new ApiError(StatusCodes.CONFLICT, 'Multiple accounts found for this login ID. Please contact support.')
  }

  const user = matchedUsers[0]
  const isPasswordValid = await comparePasswords({
    password,
    salt: user.salt,
    hashedPassword: user.password,
  })
  // Do not disclose account/hospital/lock state to a caller that has not
  // demonstrated knowledge of the password.
  if (!user.is_active) {
    await bestEffortCreateAuthAuditLog(
      req,
      user,
      AuditAction.LOGIN_FAILED,
      false,
      'Login blocked because account is inactive',
      'Account inactive',
      loginAttemptMetadata('inactive_account')
    )
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid credentials')
  }
  const hasHospitalAccess = await hasActiveHospitalAccess(user)
  if (!hasHospitalAccess) {
    await bestEffortCreateAuthAuditLog(
      req,
      user,
      AuditAction.LOGIN_FAILED,
      false,
      'Login blocked because hospital is suspended or inactive',
      'Hospital inactive',
      loginAttemptMetadata('inactive_hospital')
    )
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid credentials')
  }

  const lockedUntil = user.locked_until ? new Date(user.locked_until) : null
  if (lockedUntil && lockedUntil.getTime() > Date.now()) {
    await bestEffortCreateAuthAuditLog(
      req,
      user,
      AuditAction.LOGIN_FAILED,
      false,
      'Login blocked because account is temporarily locked',
      'Account locked',
      loginAttemptMetadata('locked')
    )
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid credentials')
  }
  // Lockout window elapsed: restore the failure budget so the next mistakes
  // start from zero rather than re-locking on the first post-expiry failure.
  if (lockedUntil && lockedUntil.getTime() <= Date.now()) {
    await clearLoginFailures(user._id)
    user.failed_login_attempts = 0
    user.locked_until = undefined
  }

  if (!isPasswordValid) {
    const { failedAttempts, accountLocked } = await recordFailedLoginAttempt(user._id)
    user.failed_login_attempts = failedAttempts

    await bestEffortCreateAuthAuditLog(
      req,
      user,
      AuditAction.LOGIN_FAILED,
      false,
      'Login failed due to invalid credentials',
      accountLocked ? 'Account locked after repeated failed attempts' : 'Invalid credentials',
      loginAttemptMetadata(accountLocked ? 'locked_after_failure' : 'invalid_credentials', {
        failed_login_attempts: failedAttempts,
        account_locked: accountLocked,
      })
    )

    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid credentials')
  }

  // Do not clear failed_login_attempts / locked_until until second-factor
  // verification succeeds (or password-only login completes below).

  if (OTP_ELIGIBLE_USER_TYPES.has(user.user_type as UserType)) {
    const { phoneNumber, isVerified } = await getRegisteredPhoneState(user)
    if (!phoneNumber) {
      throw new ApiError(StatusCodes.CONFLICT, 'Registered phone number is required for OTP verification')
    }
    if (!isVerified) {
      if (!/^\+91\d{10}$/.test(phoneNumber)) {
        throw new ApiError(StatusCodes.CONFLICT, 'Registered phone number must be updated before OTP verification')
      }

      // Reuse an unexpired pending challenge so password re-login cannot bypass
      // resend_count, cooldown, or max-resend limits by cancelling and re-issuing.
      const now = new Date()
      const phoneHash = hashPhoneNumber(phoneNumber)

      // A recently LOCKED challenge means the OTP attempt budget is exhausted;
      // refuse to mint a fresh challenge until the account lockout window ends.
      const recentLocked = await OtpChallenge.findOne({
        user_id: user._id,
        purpose: OtpChallengePurpose.PHONE_FIRST_LOGIN,
        status: OtpChallengeStatus.LOCKED,
        updatedAt: { $gte: accountLockoutWindowStart(now) },
      }).sort({ updatedAt: -1 })
      if (recentLocked) {
        // Do not mutate account lockout here: the challenge is already locked;
        // password re-login must not burn extra durable failure budget.
        await bestEffortCreateAuthAuditLog(
          req,
          user,
          AuditAction.LOGIN_FAILED,
          false,
          'Login blocked because phone OTP challenge is locked',
          'OTP challenge locked',
          loginAttemptMetadata('otp_locked')
        )
        throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid credentials')
      }

      const existingPending = await OtpChallenge.findOne({
        user_id: user._id,
        purpose: OtpChallengePurpose.PHONE_FIRST_LOGIN,
        status: OtpChallengeStatus.PENDING,
        phone_hash: phoneHash,
        expires_at: { $gt: now },
      }).sort({ createdAt: -1 })

      if (existingPending) {
        await auditIssuedLoginChallenge(
          req,
          user,
          String(existingPending._id),
          'Password accepted; existing phone OTP challenge reused',
          loginAttemptMetadata('otp_required'),
          async () => undefined,
        )

        res.status(StatusCodes.ACCEPTED).json(new ApiResponse(
          StatusCodes.ACCEPTED,
          'Phone OTP verification required',
          buildOtpChallengeResponse(existingPending, phoneNumber)
        ))
        return
      }

      // Cancel only expired or non-matching leftovers before issuing a new challenge.
      await OtpChallenge.updateMany(
        {
          user_id: user._id,
          purpose: OtpChallengePurpose.PHONE_FIRST_LOGIN,
          status: OtpChallengeStatus.PENDING,
        },
        { $set: { status: OtpChallengeStatus.CANCELLED } }
      )

      const challenge = await issuePhoneVerificationOtp({
        userId: user._id,
        userType: user.user_type as UserType.DOCTOR | UserType.PATIENT,
        phoneNumber,
        securityVersion: Number(user.security_version || 0),
        profileId: user.profile_id,
      })

      await auditIssuedLoginChallenge(
        req,
        user,
        String(challenge._id),
        'Password accepted; phone OTP verification required',
        loginAttemptMetadata('otp_required'),
        () => OtpChallenge.updateOne(
          { _id: challenge._id, status: OtpChallengeStatus.PENDING },
          { $set: { status: OtpChallengeStatus.CANCELLED } },
        ),
      )

      res.status(StatusCodes.ACCEPTED).json(new ApiResponse(
        StatusCodes.ACCEPTED,
        'Phone OTP verification required',
        buildOtpChallengeResponse(challenge, phoneNumber)
      ))
      return
    }
  }

  if (user.user_type === UserType.ADMIN) {
    if (isAdminTotpEnabled(user)) {
      const challenge = await createAdminMfaLoginChallenge(user)
      await auditIssuedLoginChallenge(
        req,
        user,
        String(challenge._id),
        'Admin password accepted; authenticator MFA challenge issued',
        loginAttemptMetadata('totp_required'),
        () => AdminMfaChallenge.updateOne(
          { _id: challenge._id, status: AdminMfaChallengeStatus.PENDING },
          { $set: { status: AdminMfaChallengeStatus.CANCELLED } },
        ),
      )
      res.status(StatusCodes.ACCEPTED).json(new ApiResponse(
        StatusCodes.ACCEPTED,
        'Admin authenticator MFA required',
        buildAdminMfaChallengeResponse(challenge, 'TOTP_REQUIRED')
      ))
      return
    }

    if (isAdminTotpRequiredForUnenrolledAdmins()) {
      // Password-bound enrollment challenge: setup/activate without a full session.
      const challenge = await createAdminMfaEnrollmentChallenge(user)
      await auditIssuedLoginChallenge(
        req,
        user,
        String(challenge._id),
        'Admin password accepted; authenticator MFA enrollment required',
        loginAttemptMetadata('totp_enrollment_required'),
        () => AdminMfaChallenge.updateOne(
          { _id: challenge._id, status: AdminMfaChallengeStatus.PENDING },
          { $set: { status: AdminMfaChallengeStatus.CANCELLED } },
        ),
      )
      res.status(StatusCodes.ACCEPTED).json(new ApiResponse(
        StatusCodes.ACCEPTED,
        'Admin authenticator MFA enrollment is required',
        buildAdminMfaChallengeResponse(challenge, 'TOTP_ENROLLMENT_REQUIRED', 'ENROLLMENT')
      ))
      return
    }
  }

  user.failed_login_attempts = 0
  user.locked_until = undefined
  user.last_login_at = new Date()
  await user.save()

  const sessionPayload = await getAuditedSessionPayload(
    req,
    user,
    'User logged in successfully',
    loginAttemptMetadata('success'),
  )
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, "User logged in successfully", sessionPayload))
})

export const verifyLoginOtpController = asyncHandler(
  async (req: Request<{}, {}, VerifyLoginOtpInput["body"]>, res: Response) => {
    const { challenge_id, code } = req.body
    const { challenge, user, phoneNumber, storedPhoneNumber } = await ensurePendingLoginChallengeForRegisteredPhone(challenge_id)
    const result = await verifyOtpChallenge(challenge._id.toString(), phoneNumber, code)

    if (!result) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'OTP challenge not found')
    }

    if (!result.verified) {
      // Only count genuine wrong codes against the account budget. LOCKED is a
      // terminal challenge state (already budget-exhausted) and must not double-count.
      if (result.result === OtpVerificationResult.INVALID) {
        await recordFailedLoginAttempt(user._id)
      }
      const statusByResult: Partial<Record<OtpVerificationResult, StatusCodes>> = {
        [OtpVerificationResult.INVALID]: StatusCodes.UNAUTHORIZED,
        [OtpVerificationResult.EXPIRED]: StatusCodes.GONE,
        [OtpVerificationResult.LOCKED]: StatusCodes.LOCKED,
        [OtpVerificationResult.CANCELLED]: StatusCodes.GONE,
        [OtpVerificationResult.PHONE_MISMATCH]: StatusCodes.FORBIDDEN,
        [OtpVerificationResult.ALREADY_VERIFIED]: StatusCodes.CONFLICT,
        [OtpVerificationResult.IN_PROGRESS]: StatusCodes.TOO_MANY_REQUESTS,
      }

      throw new ApiError(statusByResult[result.result] || StatusCodes.BAD_REQUEST, 'OTP verification failed')
    }

    const verifiedAt = (result.update as { verified_at?: Date }).verified_at || new Date()
    const phoneVerified = await markRegisteredPhoneVerified(user, storedPhoneNumber, verifiedAt)
    if (!phoneVerified) {
      throw new ApiError(StatusCodes.CONFLICT, 'Registered phone number changed during OTP verification')
    }

    user.last_login_at = new Date()
    user.failed_login_attempts = 0
    user.locked_until = undefined
    await user.save()

    const sessionPayload = await getAuditedSessionPayload(
      req,
      user,
      'User logged in successfully after phone OTP verification',
    )
    res.status(StatusCodes.OK).json(new ApiResponse(
      StatusCodes.OK,
      'Phone OTP verified and user logged in successfully',
      sessionPayload
    ))
  }
)

export const verifyLoginTotpController = asyncHandler(
  async (req: Request<{}, {}, VerifyLoginTotpInput["body"]>, res: Response) => {
    const { challenge_id, code } = req.body
    const user = await verifyAdminMfaLoginChallenge(challenge_id, code)

    const sessionPayload = await getAuditedSessionPayload(
      req,
      user,
      'Admin logged in successfully after authenticator MFA verification',
    )
    res.status(StatusCodes.OK).json(new ApiResponse(
      StatusCodes.OK,
      'Admin authenticator MFA verified and user logged in successfully',
      sessionPayload
    ))
  }
)

export const refreshTokenController = asyncHandler(
  async (req: Request<{}, {}, RefreshTokenInput["body"]>, res: Response) => {
    const refreshed = await refreshAuthSession({
      refreshToken: req.body.refresh_token,
      ipAddress: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'],
    })

    if (!refreshed) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid or expired refresh token')
    }

    res.status(StatusCodes.OK).json(new ApiResponse(
      StatusCodes.OK,
      'Session refreshed successfully',
      refreshed
    ))
  }
)

export const revokeTokenController = asyncHandler(
  async (req: Request<{}, {}, RevokeTokenInput["body"]>, res: Response) => {
    await revokeAuthSessionByRefreshToken(req.body.refresh_token, AuthSessionRevocationReason.USER_REVOKED)

    res.status(StatusCodes.OK).json(new ApiResponse(
      StatusCodes.OK,
      'Session revoked successfully'
    ))
  }
)

export const resendLoginOtpController = asyncHandler(
  async (req: Request<{}, {}, ResendLoginOtpInput["body"]>, res: Response) => {
    const { challenge_id } = req.body
    const { challenge, phoneNumber } = await ensurePendingLoginChallengeForRegisteredPhone(challenge_id)
    const result = await resendPhoneVerificationOtp(challenge._id.toString(), phoneNumber)

    if (!result) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'OTP challenge not found')
    }

    if (!result.allowed) {
      const statusByReason: Partial<Record<OtpResendBlockReason, StatusCodes>> = {
        [OtpResendBlockReason.COOLDOWN]: StatusCodes.TOO_MANY_REQUESTS,
        [OtpResendBlockReason.MAX_RESENDS]: StatusCodes.TOO_MANY_REQUESTS,
        [OtpResendBlockReason.EXPIRED]: StatusCodes.GONE,
        [OtpResendBlockReason.LOCKED]: StatusCodes.LOCKED,
        [OtpResendBlockReason.VERIFIED]: StatusCodes.CONFLICT,
        [OtpResendBlockReason.CANCELLED]: StatusCodes.GONE,
        [OtpResendBlockReason.PHONE_MISMATCH]: StatusCodes.FORBIDDEN,
      }

      const availability = result.availability as {
        reason?: OtpResendBlockReason
        retryAfterSeconds?: number
      }
      res.status(statusByReason[availability.reason!] || StatusCodes.BAD_REQUEST).json(new ApiResponse(
        statusByReason[availability.reason!] || StatusCodes.BAD_REQUEST,
        'OTP resend is not available',
        {
          reason: availability.reason,
          retry_after_seconds: availability.retryAfterSeconds,
        }
      ))
      return
    }

    const updatedChallenge = await OtpChallenge.findById(challenge._id)
    res.status(StatusCodes.OK).json(new ApiResponse(
      StatusCodes.OK,
      'Phone OTP resent successfully',
      buildOtpChallengeResponse(updatedChallenge || challenge, phoneNumber)
    ))
  }
)

export const logoutController = asyncHandler(async (req: Request, res: Response) => {
  // Authentication already established this immutable audit identity. Avoid a
  // pre-revocation user lookup: an unrelated read outage must not block logout.
  const user = req.user?.user_id && req.user?.user_type
    ? { _id: req.user.user_id, user_type: req.user.user_type }
    : null
  try {
    await revokeAuthSessionById(req.user?.session_id, AuthSessionRevocationReason.LOGOUT)
  } catch (error) {
    if (user) {
      try {
        await createAuthAuditLog(req, user, AuditAction.LOGOUT, false, 'Logout session revocation failed', 'session_revocation_failed')
      } catch (auditError) {
        logger.error('logout failure audit persistence failed', {
          event: 'auth.logout_failure_audit_failed', user_id: String(user._id),
          error: auditError instanceof Error ? auditError.message : 'unknown_error',
        })
      }
    }
    throw error
  }
  if (user) {
    try {
      await createAuthAuditLog(req, user, AuditAction.LOGOUT, true, 'User logged out successfully')
    } catch (error) {
      // Revocation is already committed. An audit outage must not make logout
      // appear to have failed or leave the session active.
      logger.error('logout success audit persistence failed', {
        event: 'auth.logout_success_audit_failed', user_id: String(user._id),
        error: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  }

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Logout successful. Please clear the token from client-side.'))
})

export const getMeController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User not authenticated')
  }

  const user = await User.findById(req.user.user_id).populate('profile_id').select('-password -salt').lean()
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found')
  }

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'User profile retrieved successfully', { user: sanitizeAuthUser(user) }))
})

export const changePasswordController = asyncHandler(
  async (req: Request<{}, {}, ChangePasswordInput["body"]>, res: Response) => {
    if (!req.user) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, 'User not authenticated')
    }

    const user = await User.findById(req.user.user_id).select('+password_history')
    if (!user) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'User not found')
    }

    if (!user.is_active) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'Account is inactive. Please contact support.')
    }

    const { current_password, new_password } = req.body

    const isCurrentPasswordValid = await comparePasswords({
      password: current_password,
      salt: user.salt,
      hashedPassword: user.password,
    })

    if (!isCurrentPasswordValid) {
      try {
        await createAuthAuditLog(req, user, AuditAction.PASSWORD_CHANGE, false, 'Password change rejected', 'current_password_invalid')
      } catch {
        logger.error('password change rejection audit persistence failed', { user_id: String(user._id) })
      }
      throw new ApiError(StatusCodes.UNAUTHORIZED, 'Current password is incorrect')
    }

    try {
      await setUserPasswordWithPolicy(user, new_password, { mustChangePassword: false })
    } catch (error) {
      try {
        await createAuthAuditLog(req, user, AuditAction.PASSWORD_CHANGE, false, 'Password change failed', 'password_change_failed')
      } catch (auditError) {
        logger.error('password change failure audit persistence failed', { user_id: String(user._id) })
      }
      throw error
    }
    const invalidatedSessionResult = await bestEffortRevokeSessionsAfterSecurityVersionBump(
      user._id.toString(),
      AuthSessionRevocationReason.PASSWORD_CHANGED
    )
    let auditRecorded = true
    try {
      await createAuthAuditLog(req, user, AuditAction.PASSWORD_CHANGE, true, 'Password changed successfully', undefined, {
        target_user_id: String(user._id),
        security_version: Number(user.security_version || 0),
        invalidated_sessions: invalidatedSessionResult.modifiedCount || 0,
        revocation_cleanup_completed: invalidatedSessionResult.cleanupCompleted,
      })
    } catch (error) {
      auditRecorded = false
      logger.error('password change success audit persistence failed', { user_id: String(user._id) })
    }

    res.status(StatusCodes.OK).json(
      new ApiResponse(StatusCodes.OK, 'Password changed successfully', {
        must_change_password: user.must_change_password,
        password_expired: false,
        password_changed_at: user.password_changed_at,
        password_expires_at: getPasswordPolicyState(user).password_expires_at,
        invalidated_sessions: invalidatedSessionResult.modifiedCount || 0,
        revocation_cleanup_completed: invalidatedSessionResult.cleanupCompleted,
        audit_recorded: auditRecorded,
      })
    )
  }
)

/**
 * Password-bound enrollment setup for production/staging admins that cannot
 * obtain a session until MFA is enrolled. Authenticated by enrollment challenge_id.
 */
export const setupAdminTotpEnrollmentController = asyncHandler(async (req: Request, res: Response) => {
  const challengeId = String((req.body as { challenge_id?: string })?.challenge_id || '')
  const { challenge, user } = await getAdminMfaEnrollmentChallengeOrThrow(challengeId)

  let enrollment
  try {
    // Idempotent for the same challenge: reuses pending secret so retries do not
    // rotate material already shown to the administrator.
    enrollment = await getOrCreateAdminTotpEnrollmentForLoginChallenge(user)
  } catch (error) {
    try {
      await createAuthAuditLog(req, user, AuditAction.MFA_SETUP, false, 'Admin TOTP enrollment setup failed', 'mfa_enrollment_setup_failed')
    } catch { logger.error('MFA enrollment setup failure audit persistence failed', { user_id: String(user._id) }) }
    throw error
  }

  let auditRecorded = true
  // Only audit first-time setup materialization; secret reuses are silent.
  if (!enrollment.reused) {
    try {
      await createAuthAuditLog(req, user, AuditAction.MFA_SETUP, true, 'Admin TOTP enrollment setup started', undefined, {
        target_user_id: String(user._id),
        factor_type: 'AUTHENTICATOR_APP',
        challenge_id: String(challenge._id),
        enrollment_via: 'login_challenge',
      })
    } catch {
      auditRecorded = false
      logger.error('MFA enrollment setup success audit persistence failed', { user_id: String(user._id) })
    }
  }

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Admin TOTP enrollment setup started', {
    factor_type: 'AUTHENTICATOR_APP',
    secret: enrollment.secret,
    otpauth_url: enrollment.otpauth_url,
    challenge_id: String(challenge._id),
    reused: enrollment.reused,
    audit_recorded: enrollment.reused ? true : auditRecorded,
  }))
})

/**
 * Completes password-bound enrollment and issues a session when the TOTP code
 * matches the pending enrollment secret.
 */
export const activateAdminTotpEnrollmentController = asyncHandler(async (req: Request, res: Response) => {
  const { challenge_id: challengeId, code } = req.body as { challenge_id: string; code: string }
  const { challenge, user } = await getAdminMfaEnrollmentChallengeOrThrow(challengeId)

  // Reject while the account is lockout-blocked so enrollment cannot mint a
  // session that password auth would refuse.
  const lockedUntil = user.locked_until ? new Date(user.locked_until) : null
  if (lockedUntil && lockedUntil.getTime() > Date.now()) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid credentials')
  }

  // Consume the enrollment challenge first so only one concurrent activator
  // proceeds; activation of the TOTP factor runs only after this CAS succeeds.
  const factorGeneration = Number(challenge.factor_generation || 0)
  const securityVersion = Number(challenge.security_version || 0)
  const verifiedAt = new Date()
  const consumed = await AdminMfaChallenge.findOneAndUpdate(
    {
      _id: challenge._id,
      status: AdminMfaChallengeStatus.PENDING,
      expires_at: { $gt: new Date() },
      $expr: { $lt: ['$attempt_count', '$max_attempts'] },
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
    throw new ApiError(StatusCodes.GONE, 'Admin MFA enrollment challenge is no longer available')
  }

  let invalidatedSessionResult
  try {
    // Re-check lockout after consume so a concurrent lock wins before factor enablement.
    const lockedNow = await User.findById(user._id).select('locked_until is_active').lean()
    if (
      !lockedNow?.is_active
      || (lockedNow.locked_until && new Date(lockedNow.locked_until).getTime() > Date.now())
    ) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid credentials')
    }
    invalidatedSessionResult = await activateAdminTotpEnrollment(user, code)
  } catch (caught) {
    // Always surface the activation failure; compensation must never mask it.
    let error: unknown = caught
    try {
      const freshUser = await User.findById(user._id)
      const factorEnabled = freshUser ? isAdminTotpEnabled(freshUser) : false
      if (!factorEnabled) {
        const chargeAttempt = error instanceof ApiError
          && error.statusCode === StatusCodes.UNAUTHORIZED
        // Single atomic write from the VERIFIED claim this handler owns: reopen
        // to PENDING (or LOCKED) and optionally charge an attempt so concurrent
        // activators cannot slip a consume between reopen and increment.
        const updatedChallenge = await AdminMfaChallenge.findOneAndUpdate(
          {
            _id: challenge._id,
            status: AdminMfaChallengeStatus.VERIFIED,
            verified_at: verifiedAt,
            factor_generation: factorGeneration,
            security_version: securityVersion,
            expires_at: { $gt: new Date() },
            ...(chargeAttempt
              ? { $expr: { $lt: ['$attempt_count', '$max_attempts'] } }
              : {}),
          },
          chargeAttempt
            ? [
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
              { $unset: 'verified_at' },
            ]
            : [
              { $set: { status: AdminMfaChallengeStatus.PENDING } },
              { $unset: 'verified_at' },
            ],
          { new: true },
        )
        if (chargeAttempt) {
          await recordFailedLoginAttempt(user._id)
          if (updatedChallenge?.status === AdminMfaChallengeStatus.LOCKED) {
            error = new ApiError(StatusCodes.LOCKED, 'Invalid TOTP code')
          }
        }
      }
    } catch (compensationError) {
      logger.error('MFA enrollment challenge compensation failed', {
        user_id: String(user._id),
        challenge_id: String(challenge._id),
        error: compensationError instanceof Error ? compensationError.message : 'unknown_error',
      })
    }
    try {
      await createAuthAuditLog(req, user, AuditAction.MFA_ACTIVATE, false, 'Admin TOTP enrollment activation failed', 'mfa_enrollment_activation_failed')
    } catch { logger.error('MFA enrollment activation failure audit persistence failed', { user_id: String(user._id) }) }
    throw error
  }

  const loggedInAt = new Date()
  await User.updateOne(
    { _id: user._id },
    {
      $set: { failed_login_attempts: 0, last_login_at: loggedInAt },
      $unset: { locked_until: 1 },
    },
  )
  user.last_login_at = loggedInAt
  user.failed_login_attempts = 0
  user.locked_until = undefined

  let auditRecorded = true
  try {
    await createAuthAuditLog(req, user, AuditAction.MFA_ACTIVATE, true, 'Admin TOTP enrollment activated', undefined, {
      target_user_id: String(user._id),
      factor_type: 'AUTHENTICATOR_APP',
      challenge_id: String(challenge._id),
      invalidated_sessions: invalidatedSessionResult.modifiedCount || 0,
      revocation_cleanup_completed: invalidatedSessionResult.cleanupCompleted,
    })
  } catch {
    auditRecorded = false
    logger.error('MFA enrollment activation success audit persistence failed', { user_id: String(user._id) })
  }

  const sessionPayload = await getAuditedSessionPayload(
    req,
    user,
    'Admin logged in successfully after authenticator MFA enrollment',
  )
  res.status(StatusCodes.OK).json(new ApiResponse(
    StatusCodes.OK,
    'Admin authenticator MFA enrolled and user logged in successfully',
    {
      ...sessionPayload,
      factor_type: 'AUTHENTICATOR_APP',
      status: 'ENABLED',
      invalidated_sessions: invalidatedSessionResult.modifiedCount || 0,
      revocation_cleanup_completed: invalidatedSessionResult.cleanupCompleted,
      audit_recorded: auditRecorded,
    },
  ))
})

export const setupAdminTotpController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || req.user.user_type !== UserType.ADMIN) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Admin access is required')
  }

  const user = await User.findById(req.user.user_id)
  if (!user || !user.is_active) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found')
  }

  let enrollment
  try {
    enrollment = await createAdminTotpEnrollment(user)
  } catch (error) {
    try {
      await createAuthAuditLog(req, user, AuditAction.MFA_SETUP, false, 'Admin TOTP setup failed', 'mfa_setup_failed')
    } catch { logger.error('MFA setup failure audit persistence failed', { user_id: String(user._id) }) }
    throw error
  }
  let auditRecorded = true
  try {
    await createAuthAuditLog(req, user, AuditAction.MFA_SETUP, true, 'Admin TOTP setup started', undefined, {
      target_user_id: String(user._id), factor_type: 'AUTHENTICATOR_APP',
    })
  } catch {
    auditRecorded = false
    logger.error('MFA setup success audit persistence failed', { user_id: String(user._id) })
  }

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Admin TOTP setup started', {
    factor_type: 'AUTHENTICATOR_APP',
    secret: enrollment.secret,
    otpauth_url: enrollment.otpauth_url,
    audit_recorded: auditRecorded,
  }))
})

export const getAdminTotpStatusController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || req.user.user_type !== UserType.ADMIN) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Admin access is required')
  }

  const user = await User.findById(req.user.user_id)
  if (!user || !user.is_active) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found')
  }

  res.status(StatusCodes.OK).json(new ApiResponse(
    StatusCodes.OK,
    'Admin TOTP status retrieved',
    getAdminTotpStatus(user)
  ))
})

export const activateAdminTotpController = asyncHandler(
  async (req: Request<{}, {}, ActivateAdminTotpInput["body"]>, res: Response) => {
    if (!req.user || req.user.user_type !== UserType.ADMIN) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'Admin access is required')
    }

    const user = await User.findById(req.user.user_id)
    if (!user || !user.is_active) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'User not found')
    }

    let invalidatedSessionResult
    try {
      invalidatedSessionResult = await activateAdminTotpEnrollment(user, req.body.code)
    } catch (error) {
      try {
        await createAuthAuditLog(req, user, AuditAction.MFA_ACTIVATE, false, 'Admin TOTP activation failed', 'mfa_activation_failed')
      } catch { logger.error('MFA activation failure audit persistence failed', { user_id: String(user._id) }) }
      throw error
    }
    let auditRecorded = true
    try {
      await createAuthAuditLog(req, user, AuditAction.MFA_ACTIVATE, true, 'Admin TOTP activated', undefined, {
        target_user_id: String(user._id), factor_type: 'AUTHENTICATOR_APP',
        security_version: Number(user.security_version || 0) + 1,
        invalidated_sessions: invalidatedSessionResult.modifiedCount || 0,
        revocation_cleanup_completed: invalidatedSessionResult.cleanupCompleted,
      })
    } catch {
      auditRecorded = false
      logger.error('MFA activation success audit persistence failed', { user_id: String(user._id) })
    }

    res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Admin TOTP activated', {
      factor_type: 'AUTHENTICATOR_APP',
      status: 'ENABLED',
      invalidated_sessions: invalidatedSessionResult.modifiedCount || 0,
      revocation_cleanup_completed: invalidatedSessionResult.cleanupCompleted,
      audit_recorded: auditRecorded,
    }))
  }
)
