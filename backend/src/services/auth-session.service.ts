import crypto from 'crypto'
import mongoose from 'mongoose'
import { AuthSession, User } from '@alias/models'
import { AuthSessionRevocationReason } from '@alias/models/authsession.model'
import { generateToken } from '@alias/utils/jwt.utils'
import { UserType } from '@alias/validators'
import { hasActiveHospitalAccess } from './hospital-access.service'
import { getSessionTimeoutMinutes, MAX_SESSION_TIMEOUT_MINUTES } from './config.service'

const REFRESH_TOKEN_BYTES = 48
export const SESSION_ACCESS_TOKEN_LIFETIME_SECONDS = MAX_SESSION_TIMEOUT_MINUTES * 60

const hashRefreshToken = (refreshToken: string) =>
  crypto.createHash('sha256').update(refreshToken).digest('hex')

export const getSessionExpiry = (timeoutMinutes: number) =>
  new Date(Date.now() + timeoutMinutes * 60 * 1000)

export const createAuthSession = async ({
  user,
  ipAddress,
  userAgent,
}: {
  user: { _id: mongoose.Types.ObjectId | string; user_type: UserType | string }
  ipAddress?: string
  userAgent?: string | string[]
}) => {
  const accessTokenId = crypto.randomUUID()
  const refreshToken = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('base64url')
  const timeoutMinutes = await getSessionTimeoutMinutes()
  const expiresAt = getSessionExpiry(timeoutMinutes)

  const session = await AuthSession.create({
    user_id: user._id,
    user_type: user.user_type,
    access_token_id: accessTokenId,
    refresh_token_hash: hashRefreshToken(refreshToken),
    expires_at: expiresAt,
    ip_address: ipAddress,
    user_agent: Array.isArray(userAgent) ? userAgent.join(', ') : userAgent,
  })

  const accessToken = generateToken({
    user_id: user._id.toString(),
    user_type: user.user_type as UserType,
    session_id: session._id.toString(),
    token_id: accessTokenId,
  // Session validation is authoritative and checked on every request. Keep the
  // JWT valid for the largest allowed session duration so increasing the admin
  // setting can extend an existing session immediately as well.
  }, SESSION_ACCESS_TOKEN_LIFETIME_SECONDS)

  return {
    token: accessToken,
    refresh_token: refreshToken,
    session: {
      session_id: session._id.toString(),
      refresh_expires_at: expiresAt,
    },
  }
}

export const findActiveSessionForAccessToken = async ({
  sessionId,
  tokenId,
  userId,
  userType,
}: {
  sessionId?: string
  tokenId?: string
  userId: string
  userType: UserType
}) => {
  if (!sessionId || !tokenId || !mongoose.Types.ObjectId.isValid(sessionId)) {
    return null
  }

  const session = await AuthSession.findOne({
    _id: sessionId,
    access_token_id: tokenId,
    user_id: userId,
    user_type: userType,
    revoked_at: { $exists: false },
    expires_at: { $gt: new Date() },
  })

  if (session) {
    session.last_used_at = new Date()
    await session.save()
  }

  return session
}

export const refreshAuthSession = async ({
  refreshToken,
  ipAddress,
  userAgent,
}: {
  refreshToken: string
  ipAddress?: string
  userAgent?: string | string[]
}) => {
  const session = await AuthSession.findOne({
    refresh_token_hash: hashRefreshToken(refreshToken),
    revoked_at: { $exists: false },
    expires_at: { $gt: new Date() },
  })

  if (!session) {
    return null
  }

  const user = await User.findById(session.user_id).select('is_active user_type profile_id').lean()
  if (!user || !user.is_active || user.user_type !== session.user_type || !await hasActiveHospitalAccess(user)) {
    return null
  }

  session.access_token_id = crypto.randomUUID()
  const replacementRefreshToken = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('base64url')
  session.refresh_token_hash = hashRefreshToken(replacementRefreshToken)
  const timeoutMinutes = await getSessionTimeoutMinutes()
  session.expires_at = getSessionExpiry(timeoutMinutes)
  session.last_used_at = new Date()
  session.ip_address = ipAddress
  session.user_agent = Array.isArray(userAgent) ? userAgent.join(', ') : userAgent
  await session.save()

  const accessToken = generateToken({
    user_id: session.user_id.toString(),
    user_type: session.user_type as UserType,
    session_id: session._id.toString(),
    token_id: session.access_token_id,
  }, SESSION_ACCESS_TOKEN_LIFETIME_SECONDS)

  return {
    token: accessToken,
    refresh_token: replacementRefreshToken,
    session: {
      session_id: session._id.toString(),
      refresh_expires_at: session.expires_at,
    },
  }
}

export const revokeAuthSessionByRefreshToken = async (
  refreshToken: string,
  reason: AuthSessionRevocationReason = AuthSessionRevocationReason.USER_REVOKED
) => {
  const session = await AuthSession.findOne({
    refresh_token_hash: hashRefreshToken(refreshToken),
    revoked_at: { $exists: false },
  })

  if (!session) {
    return null
  }

  session.revoked_at = new Date()
  session.revoked_reason = reason
  await session.save()
  return session
}

export const revokeAuthSessionById = async (
  sessionId: string | undefined,
  reason: AuthSessionRevocationReason = AuthSessionRevocationReason.LOGOUT
) => {
  if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
    return null
  }

  return AuthSession.findOneAndUpdate(
    {
      _id: sessionId,
      revoked_at: { $exists: false },
    },
    {
      $set: {
        revoked_at: new Date(),
        revoked_reason: reason,
      },
    },
    { new: true }
  )
}

export const revokeActiveAuthSessionsForUser = async (
  userId: string,
  reason: AuthSessionRevocationReason = AuthSessionRevocationReason.USER_REVOKED
) => {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return { modifiedCount: 0 }
  }

  return AuthSession.updateMany(
    {
      user_id: userId,
      revoked_at: { $exists: false },
      expires_at: { $gt: new Date() },
    },
    {
      $set: {
        revoked_at: new Date(),
        revoked_reason: reason,
      },
    }
  )
}

export const revokeActiveAuthSessionsForUsers = async (
  userIds: Array<string | mongoose.Types.ObjectId>,
  reason: AuthSessionRevocationReason = AuthSessionRevocationReason.USER_REVOKED
) => {
  const validUserIds = userIds.filter(id => mongoose.Types.ObjectId.isValid(String(id)))
  if (!validUserIds.length) return { modifiedCount: 0 }

  return AuthSession.updateMany(
    {
      user_id: { $in: validUserIds },
      revoked_at: { $exists: false },
      expires_at: { $gt: new Date() },
    },
    {
      $set: {
        revoked_at: new Date(),
        revoked_reason: reason,
      },
    }
  )
}
