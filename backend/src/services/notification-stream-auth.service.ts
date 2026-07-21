import type { Request } from 'express'
import { StatusCodes } from 'http-status-codes'
import { User } from '@alias/models'
import { UserType } from '@alias/validators'
import { ApiError } from '@alias/utils'
import { extractTokenFromHeader } from '@alias/utils/jwt.utils'
import { validateAuthToken } from '@alias/middlewares/authProvider.middleware'
import {
  consumeStreamTicketJti,
  verifyNotificationStreamTicket,
} from '@alias/services/notification-stream-ticket.service'
import { findActiveSessionForAccessToken } from '@alias/services/auth-session.service'
import { getPasswordPolicyState } from '@alias/services/password.service'

type HospitalAccessFn = (user: {
  is_active?: boolean
  user_type?: unknown
  profile_id?: unknown
}) => Promise<boolean>

/**
 * Resolve the stream principal from either a bearer access token or a single-use
 * stream ticket, applying the same session, hospital, and password-policy gates
 * as normal authentication.
 */
export async function resolveStreamUserOrThrow(
  req: Request,
  expectedType: UserType,
  hasHospitalAccess: HospitalAccessFn,
) {
  const headerToken = extractTokenFromHeader(req.headers.authorization)
  if (headerToken) {
    const { user } = await validateAuthToken(headerToken, expectedType)
    return user
  }

  const ticket = typeof req.query.ticket === 'string' ? req.query.ticket : null
  const payload = ticket ? verifyNotificationStreamTicket(ticket, expectedType) : null
  if (!payload) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Missing authentication token')
  }

  const consumed = await consumeStreamTicketJti(payload.jti)
  if (!consumed) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid or expired stream ticket')
  }

  const user = await User.findById(payload.user_id)
    .select('is_active user_type profile_id must_change_password password_changed_at createdAt security_version')
    .lean()
  if (!user?.is_active || user.user_type !== expectedType) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid or expired stream ticket')
  }
  if (Number(user.security_version || 0) !== Number(payload.security_version || 0)) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid or expired stream ticket')
  }

  const session = await findActiveSessionForAccessToken({
    sessionId: payload.session_id,
    tokenId: payload.token_id,
    userId: payload.user_id,
    userType: expectedType,
    securityVersion: Number(user.security_version || 0),
  })
  if (!session) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid or expired stream ticket')
  }
  if (!await hasHospitalAccess(user)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Hospital is suspended or inactive. Please contact support.')
  }

  const passwordState = getPasswordPolicyState(user)
  if (passwordState.must_change_password) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Password change is required before continuing.')
  }
  return user
}
