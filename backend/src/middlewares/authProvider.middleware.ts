import { Request, Response, NextFunction } from 'express'
import { StatusCodes } from 'http-status-codes'
import mongoose from 'mongoose'
import { verifyToken, extractTokenFromHeader } from '@alias/utils/jwt.utils'
import { JWTPayload, UserType } from '@alias/validators'
import { User } from '@alias/models'
import { findActiveSessionForAccessToken } from '@alias/services/auth-session.service'
import { hasActiveHospitalAccess } from '@alias/services/hospital-access.service'
import { ApiError } from '@alias/utils'

/**
 * Extend Express Request to include user data
 */
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload
    }
  }
}

export const validateAuthToken = async (token: string, expectedUserType?: UserType) => {
  const payload = verifyToken(token)

  if (
    !payload ||
    !mongoose.Types.ObjectId.isValid(payload.user_id) ||
    (expectedUserType && payload.user_type !== expectedUserType)
  ) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid or expired authentication token.')
  }

  const user = await User.findById(payload.user_id).select('is_active user_type profile_id').lean()
  if (!user || !user.is_active || user.user_type !== payload.user_type) {
    throw new ApiError(
      !user || user.user_type !== payload.user_type ? StatusCodes.UNAUTHORIZED : StatusCodes.FORBIDDEN,
      !user || user.user_type !== payload.user_type
        ? 'Invalid or expired authentication token.'
        : 'Account is inactive. Please contact support.'
    )
  }

  if (!await hasActiveHospitalAccess(user)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Hospital is suspended or inactive. Please contact support.')
  }

  const session = await findActiveSessionForAccessToken({
    sessionId: payload.session_id,
    tokenId: payload.token_id,
    userId: payload.user_id,
    userType: payload.user_type,
  })
  if (!session) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid or expired authentication token.')
  }

  return { payload, user }
}

/**
 * Authenticate middleware - verifies JWT token from Authorization header
 * Attaches user data to req.user if valid
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization
    const token = extractTokenFromHeader(authHeader)

    if (!token) {
      res.status(StatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'Missing authentication token. Please provide Authorization header with Bearer token.',
      })
      return
    }

    const { payload } = await validateAuthToken(token)
    req.user = payload
    next()
  } catch (error) {
    if (error instanceof ApiError) {
      res.status(error.statusCode).json({
        success: false,
        message: error.message,
      })
      return
    }

    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error during authentication.',
    })
  }
}

/**
 * Authorization middleware factory - restricts access to specific user roles
 * @param allowedRoles - Array of UserType values that are allowed
 * @returns Middleware function
 */
export const authorize = (allowedRoles: UserType[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Check if authenticate middleware has been applied
    if (!req.user) {
      res.status(StatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'Authentication required.',
      })
      return
    }

    // Check if user role is in allowed roles
    if (!allowedRoles.includes(req.user.user_type)) {
      res.status(StatusCodes.FORBIDDEN).json({
        success: false,
        message: 'Insufficient permissions. Your role does not have access to this resource.',
      })
      return
    }

    next()
  }
}
