import { Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import { asyncHandler, ApiError, ApiResponse, generateToken } from '@alias/utils'
import { AuditLog, DoctorProfile, OtpChallenge, PatientProfile, User } from '@alias/models'
import {
  OtpChallengePurpose,
  OtpChallengeStatus,
} from '@alias/models/otpchallenge.model'
import { AuditAction } from '@alias/models/auditlog.model'
import { comparePasswords } from '@alias/utils'
import { UserType } from '@alias/validators'
import { ActivateAdminTotpInput, ChangePasswordInput, LoginInput, ResendLoginOtpInput, VerifyLoginOtpInput, VerifyLoginTotpInput } from '@alias/validators/user.validator'
import { config } from '@alias/config'
import {
  activateAdminTotpEnrollment,
  createAdminMfaLoginChallenge,
  createAdminTotpEnrollment,
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

const createAuthAuditLog = async (
  req: Request,
  user: any,
  action: AuditAction.LOGIN | AuditAction.LOGOUT | AuditAction.LOGIN_FAILED,
  success: boolean,
  description: string,
  errorMessage?: string
) => {
  if (!user?._id || !user?.user_type) return

  await AuditLog.create({
    user_id: user._id,
    user_type: user.user_type,
    action,
    description,
    resource_type: 'Auth',
    resource_id: String(user._id),
    ip_address: req.ip || req.socket?.remoteAddress,
    user_agent: req.headers['user-agent'],
    success,
    error_message: errorMessage,
  })
}

const OTP_ELIGIBLE_USER_TYPES = new Set<UserType>([UserType.DOCTOR, UserType.PATIENT])

const sanitizeAuthUser = (user: any) => {
  if (!user) return user
  const safeUser = typeof user.toObject === 'function' ? user.toObject() : { ...user }
  delete safeUser.password
  delete safeUser.salt
  delete safeUser.admin_mfa
  return safeUser
}

const getSessionPayload = async (user: any) => {
  const token = generateToken({ user_id: user._id.toString(), user_type: user.user_type as UserType })
  const populatedUser = await User.findById(user._id)
    .populate({ path: 'profile_id', populate: { path: 'hospital_id' } })
    .select('-password -salt')

  return { token, user: sanitizeAuthUser(populatedUser) }
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

  const user = await User.findOne({
    _id: challenge.user_id,
    user_type: challenge.user_type,
    is_active: true,
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

  const matchedUsers = await User.find({ login_id: normalizedLoginId }).limit(2)
  if (matchedUsers.length === 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User Doesn't exist")
  }
  if (matchedUsers.length > 1) {
    throw new ApiError(StatusCodes.CONFLICT, 'Multiple accounts found for this login ID. Please contact support.')
  }

  const user = matchedUsers[0]
  if (!user.is_active) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Account is inactive. Please contact support.')
  }

  const lockedUntil = user.locked_until ? new Date(user.locked_until) : null
  if (lockedUntil && lockedUntil.getTime() > Date.now()) {
    await createAuthAuditLog(
      req,
      user,
      AuditAction.LOGIN_FAILED,
      false,
      'Login blocked because account is temporarily locked',
      'Account locked'
    )
    throw new ApiError(StatusCodes.LOCKED, 'Account is temporarily locked due to repeated failed login attempts. Please try again later.')
  }

  const isPasswordValid = await comparePasswords({
    password,
    salt: user.salt,
    hashedPassword: user.password,
  })

  if (!isPasswordValid) {
    const failedAttempts = (user.failed_login_attempts ?? 0) + 1
    user.failed_login_attempts = failedAttempts
    user.last_failed_login_at = new Date()

    if (failedAttempts >= config.maxFailedLoginAttempts) {
      user.locked_until = new Date(Date.now() + config.accountLockoutMinutes * 60 * 1000)
    }
    await user.save()

    await createAuthAuditLog(
      req,
      user,
      AuditAction.LOGIN_FAILED,
      false,
      'Login failed due to invalid credentials',
      failedAttempts >= config.maxFailedLoginAttempts ? 'Account locked after repeated failed attempts' : 'Invalid credentials'
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
      })

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
      res.status(StatusCodes.ACCEPTED).json(new ApiResponse(
        StatusCodes.ACCEPTED,
        'Admin authenticator MFA required',
        buildAdminTotpChallengeResponse(challenge)
      ))
      return
    }

    if (isAdminTotpRequiredForUnenrolledAdmins()) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'Admin authenticator MFA enrollment is required before login')
    }
  }

  user.last_login_at = new Date()
  await user.save()

  await createAuthAuditLog(req, user, AuditAction.LOGIN, true, 'User logged in successfully')

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, "User logged in successfully", await getSessionPayload(user)))
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

    await createAuthAuditLog(req, user, AuditAction.LOGIN, true, 'User logged in successfully after phone OTP verification')

    res.status(StatusCodes.OK).json(new ApiResponse(
      StatusCodes.OK,
      'Phone OTP verified and user logged in successfully',
      await getSessionPayload(user)
    ))
  }
)

export const verifyLoginTotpController = asyncHandler(
  async (req: Request<{}, {}, VerifyLoginTotpInput["body"]>, res: Response) => {
    const { challenge_id, code } = req.body
    const user = await verifyAdminMfaLoginChallenge(challenge_id, code)

    await createAuthAuditLog(req, user, AuditAction.LOGIN, true, 'Admin logged in successfully after authenticator MFA verification')

    res.status(StatusCodes.OK).json(new ApiResponse(
      StatusCodes.OK,
      'Admin authenticator MFA verified and user logged in successfully',
      await getSessionPayload(user)
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
  if (req.user?.user_id) {
    const user = await User.findById(req.user.user_id).select('_id user_type')
    if (user) {
      await createAuthAuditLog(req, user, AuditAction.LOGOUT, true, 'User logged out successfully')
    }
  }

  res.status(StatusCodes.OK).json({
    success: true,
    message: 'Logout successful. Please clear the token from client-side.',
  })
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

    const user = await User.findById(req.user.user_id)
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
      throw new ApiError(StatusCodes.UNAUTHORIZED, 'Current password is incorrect')
    }

    user.password = new_password
    user.must_change_password = false
    await user.save()

    res.status(StatusCodes.OK).json(
      new ApiResponse(StatusCodes.OK, 'Password changed successfully', {
        must_change_password: user.must_change_password,
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

  const enrollment = await createAdminTotpEnrollment(user)

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Admin TOTP setup started', {
    factor_type: 'AUTHENTICATOR_APP',
    secret: enrollment.secret,
    otpauth_url: enrollment.otpauth_url,
  }))
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

    await activateAdminTotpEnrollment(user, req.body.code)

    res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Admin TOTP activated', {
      factor_type: 'AUTHENTICATOR_APP',
      status: 'ENABLED',
    }))
  }
)
