import { Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import { asyncHandler, ApiError, ApiResponse } from '@alias/utils'
import { AuditLog, DoctorProfile, OtpChallenge, PatientProfile, User } from '@alias/models'
import {
  OtpChallengePurpose,
  OtpChallengeStatus,
} from '@alias/models/otpchallenge.model'
import { AuthSessionRevocationReason } from '@alias/models/authsession.model'
import { AuditAction } from '@alias/models/auditlog.model'
import { comparePasswords } from '@alias/utils'
import { UserType } from '@alias/validators'
import { ActivateAdminTotpInput, ChangePasswordInput, LoginInput, RefreshTokenInput, ResendLoginOtpInput, RevokeTokenInput, VerifyLoginOtpInput, VerifyLoginTotpInput } from '@alias/validators/user.validator'
import { config } from '@alias/config'
import {
  activateAdminTotpEnrollment,
  createAdminMfaLoginChallenge,
  createAdminTotpEnrollment,
  getAdminTotpStatus,
  isAdminTotpEnabled,
  isAdminTotpRequiredForUnenrolledAdmins,
  verifyAdminMfaLoginChallenge,
} from '@alias/services/admin-totp.service'
import {
  hashPhoneNumber,
  issuePhoneVerificationOtp,
  OtpResendBlockReason,
  OtpVerificationResult,
  resendPhoneVerificationOtp,
  verifyOtpChallenge,
} from '@alias/services/otp.service'
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
  isVerified: boolean
}> => {
  if (user.user_type === UserType.DOCTOR) {
    const profile = await DoctorProfile.findById(user.profile_id).select('contact_number phone_verification')
    return {
      phoneNumber: profile?.contact_number,
      isVerified: profile?.phone_verification?.status === 'VERIFIED',
    }
  }

  if (user.user_type === UserType.PATIENT) {
    const profile = await PatientProfile.findById(user.profile_id).select('demographics.phone demographics.phone_verification')
    return {
      phoneNumber: profile?.demographics?.phone,
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

const buildAdminTotpChallengeResponse = (challenge: any) => ({
  auth_status: 'TOTP_REQUIRED',
  challenge: {
    challenge_id: challenge._id.toString(),
    factor_type: 'AUTHENTICATOR_APP',
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

  const { phoneNumber, isVerified } = await getRegisteredPhoneState(user)
  if (!phoneNumber) {
    throw new ApiError(StatusCodes.CONFLICT, 'Registered phone number is required for OTP verification')
  }

  if (isVerified) {
    throw new ApiError(StatusCodes.CONFLICT, 'Registered phone number is already verified')
  }

  if (challenge.phone_hash !== hashPhoneNumber(phoneNumber)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'OTP challenge does not match the registered phone number')
  }

  return { challenge, user, phoneNumber }
}

const markRegisteredPhoneVerified = async (user: any, phoneNumber: string, verifiedAt: Date) => {
  if (user.user_type === UserType.DOCTOR) {
    const result = await DoctorProfile.updateOne(
      {
        _id: user.profile_id,
        contact_number: phoneNumber,
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
        'demographics.phone': phoneNumber,
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
    await createAuthAuditLog(
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
    await createAuthAuditLog(
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
    await createAuthAuditLog(
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

  if (!isPasswordValid) {
    const failedAt = new Date()
    const lockedUntil = new Date(failedAt.getTime() + config.accountLockoutMinutes * 60 * 1000)
    const updatedUser = await User.findOneAndUpdate(
      { _id: user._id, is_active: true },
      [
        {
          $set: {
            failed_login_attempts: { $add: [{ $ifNull: ['$failed_login_attempts', 0] }, 1] },
            last_failed_login_at: failedAt,
          },
        },
        {
          $set: {
            locked_until: {
              $cond: [
                { $gte: ['$failed_login_attempts', config.maxFailedLoginAttempts] },
                lockedUntil,
                '$locked_until',
              ],
            },
          },
        },
      ],
      { new: true, updatePipeline: true },
    )
    const failedAttempts = updatedUser?.failed_login_attempts ?? (user.failed_login_attempts ?? 0) + 1
    user.failed_login_attempts = failedAttempts
    user.last_failed_login_at = failedAt
    user.locked_until = updatedUser?.locked_until

    await createAuthAuditLog(
      req,
      user,
      AuditAction.LOGIN_FAILED,
      false,
      'Login failed due to invalid credentials',
      failedAttempts >= config.maxFailedLoginAttempts ? 'Account locked after repeated failed attempts' : 'Invalid credentials',
      loginAttemptMetadata(failedAttempts >= config.maxFailedLoginAttempts ? 'locked_after_failure' : 'invalid_credentials', {
        failed_login_attempts: failedAttempts,
        account_locked: failedAttempts >= config.maxFailedLoginAttempts,
      })
    )

    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid credentials')
  }

  user.failed_login_attempts = 0
  user.locked_until = undefined
  await user.save()

  if (OTP_ELIGIBLE_USER_TYPES.has(user.user_type as UserType)) {
    const { phoneNumber, isVerified } = await getRegisteredPhoneState(user)
    if (!phoneNumber) {
      throw new ApiError(StatusCodes.CONFLICT, 'Registered phone number is required for OTP verification')
    }

    if (!isVerified) {
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

      await createAuthAuditLog(
        req,
        user,
        AuditAction.LOGIN_CHALLENGE,
        true,
        'Password accepted; phone OTP verification required',
        undefined,
        loginAttemptMetadata('otp_required')
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
      await createAuthAuditLog(
        req,
        user,
        AuditAction.LOGIN_CHALLENGE,
        true,
        'Admin password accepted; authenticator MFA challenge issued',
        undefined,
        loginAttemptMetadata('totp_required')
      )
      res.status(StatusCodes.ACCEPTED).json(new ApiResponse(
        StatusCodes.ACCEPTED,
        'Admin authenticator MFA required',
        buildAdminTotpChallengeResponse(challenge)
      ))
      return
    }

    if (isAdminTotpRequiredForUnenrolledAdmins()) {
      await createAuthAuditLog(
        req,
        user,
        AuditAction.LOGIN_FAILED,
        false,
        'Admin login blocked because authenticator MFA enrollment is required',
        'Authenticator MFA enrollment required',
        loginAttemptMetadata('totp_enrollment_required')
      )
      throw new ApiError(StatusCodes.FORBIDDEN, 'Admin authenticator MFA enrollment is required before login')
    }
  }

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
    const { challenge, user, phoneNumber } = await ensurePendingLoginChallengeForRegisteredPhone(challenge_id)
    const result = await verifyOtpChallenge(challenge._id.toString(), phoneNumber, code)

    if (!result) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'OTP challenge not found')
    }

    if (!result.verified) {
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
    const phoneVerified = await markRegisteredPhoneVerified(user, phoneNumber, verifiedAt)
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
