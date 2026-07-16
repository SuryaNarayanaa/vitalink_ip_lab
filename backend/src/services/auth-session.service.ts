import crypto from 'crypto'
import mongoose from 'mongoose'
import { AuthSession, User } from '@alias/models'
import { AuthSessionRevocationReason } from '@alias/models/authsession.model'
import { generateToken } from '@alias/utils/jwt.utils'
import { UserType } from '@alias/validators'
import { hasActiveHospitalAccess } from './hospital-access.service'
import { getSessionTimeoutMinutes, MAX_SESSION_TIMEOUT_MINUTES } from './config.service'
import { config } from '@alias/config'
import logger from '@alias/utils/logger'

const REFRESH_TOKEN_BYTES = 48
export const SESSION_ACCESS_TOKEN_LIFETIME_SECONDS = MAX_SESSION_TIMEOUT_MINUTES * 60

const hashRefreshToken = (refreshToken: string) =>
  crypto.createHash('sha256').update(refreshToken).digest('hex')

async function revokeSessionForRefreshTokenReuse(refreshTokenHash: string) {
  return AuthSession.findOneAndUpdate(
    {
      refresh_token_history_hashes: refreshTokenHash,
      revoked_at: { $exists: false },
      expires_at: { $gt: new Date() },
    },
    {
      $set: {
        revoked_at: new Date(),
        revoked_reason: AuthSessionRevocationReason.REFRESH_TOKEN_REUSE,
      },
    },
    { new: true },
  )
}

export const getSessionExpiry = (timeoutMinutes: number) =>
  new Date(Date.now() + timeoutMinutes * 60 * 1000)

export const getRefreshTokenExpiry = () =>
  new Date(Date.now() + config.refreshTokenExpiryDays * 24 * 60 * 60 * 1000)

export const createAuthSession = async ({
  user,
  ipAddress,
  userAgent,
}: {
  user: { _id: mongoose.Types.ObjectId | string; user_type: UserType | string; security_version?: number }
  ipAddress?: string
  userAgent?: string | string[]
}) => {
  const currentUser = await User.findOne({
    _id: user._id,
    user_type: user.user_type,
    is_active: true,
    security_version: Number(user.security_version || 0),
  }).select('security_version is_active user_type profile_id').lean()
  if (!currentUser || !await hasActiveHospitalAccess(currentUser)) return null
  const securityVersion = Number(currentUser.security_version || 0)

  const accessTokenId = crypto.randomUUID()
  const refreshToken = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('base64url')
  const timeoutMinutes = await getSessionTimeoutMinutes()
  const accessExpiresAt = getSessionExpiry(timeoutMinutes)
  const refreshExpiresAt = getRefreshTokenExpiry()

  const session = await AuthSession.create({
    user_id: user._id,
    user_type: user.user_type,
    security_version: securityVersion,
    access_token_id: accessTokenId,
    refresh_token_hash: hashRefreshToken(refreshToken),
    expires_at: refreshExpiresAt,
    access_expires_at: accessExpiresAt,
    ip_address: ipAddress,
    user_agent: Array.isArray(userAgent) ? userAgent.join(', ') : userAgent,
  })

  // Session persistence and tenant lifecycle are separate documents. Recheck
  // after persistence: a suspension that began before creation is caught here;
  // one that begins afterward will observe this row in its revocation scan.
  const finalUser = await User.findOne({
    _id: user._id,
    user_type: user.user_type,
    is_active: true,
    security_version: securityVersion,
  }).select('security_version is_active user_type profile_id').lean()
  if (!finalUser || !await hasActiveHospitalAccess(finalUser)) {
    await AuthSession.updateOne(
      { _id: session._id, revoked_at: { $exists: false } },
      { $set: { revoked_at: new Date(), revoked_reason: AuthSessionRevocationReason.ACCOUNT_DISABLED } },
    )
    return null
  }

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
      refresh_expires_at: refreshExpiresAt,
    },
  }
}

export const findActiveSessionForAccessToken = async ({
  sessionId,
  tokenId,
  userId,
  userType,
  securityVersion,
}: {
  sessionId?: string
  tokenId?: string
  userId: string
  userType: UserType
  securityVersion: number
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
    $and: [
      { $or: [
        { access_expires_at: { $gt: new Date() } },
        { access_expires_at: { $exists: false } },
      ] },
      securityVersion === 0
        ? { $or: [{ security_version: 0 }, { security_version: { $exists: false } }] }
        : { security_version: securityVersion },
    ],
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
  const refreshTokenHash = hashRefreshToken(refreshToken)
  const session = await AuthSession.findOne({
    refresh_token_hash: refreshTokenHash,
    revoked_at: { $exists: false },
    expires_at: { $gt: new Date() },
  })

  if (!session) {
    // A token that was valid before rotation is evidence that the session
    // family may have been copied. Revoke the current family instead of merely
    // returning 401 and leaving the attacker's newer token usable.
    await revokeSessionForRefreshTokenReuse(refreshTokenHash)
    return null
  }

  const user = await User.findById(session.user_id).select('is_active user_type profile_id security_version').lean()
  if (
    !user || !user.is_active || user.user_type !== session.user_type ||
    Number(user.security_version || 0) !== Number(session.security_version || 0) ||
    !await hasActiveHospitalAccess(user)
  ) {
    return null
  }

  const accessTokenId = crypto.randomUUID()
  const replacementRefreshToken = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('base64url')
  const replacementRefreshTokenHash = hashRefreshToken(replacementRefreshToken)
  const timeoutMinutes = await getSessionTimeoutMinutes()
  const accessExpiresAt = new Date(Math.min(
    getSessionExpiry(timeoutMinutes).getTime(),
    session.expires_at.getTime(),
  ))
  const rotatedSession = await AuthSession.findOneAndUpdate(
    {
      _id: session._id,
      refresh_token_hash: refreshTokenHash,
      revoked_at: { $exists: false },
      expires_at: { $gt: new Date() },
      ...(Number(user.security_version || 0) === 0
        ? { $or: [{ security_version: 0 }, { security_version: { $exists: false } }] }
        : { security_version: Number(user.security_version || 0) }),
    },
    {
      $set: {
        access_token_id: accessTokenId,
        refresh_token_hash: replacementRefreshTokenHash,
        access_expires_at: accessExpiresAt,
        last_used_at: new Date(),
        ip_address: ipAddress,
        user_agent: Array.isArray(userAgent) ? userAgent.join(', ') : userAgent,
      },
      $push: {
        refresh_token_history_hashes: {
          $each: [refreshTokenHash],
          $slice: -100,
        },
      },
    },
    { new: true }
  )

  if (!rotatedSession) {
    await revokeSessionForRefreshTokenReuse(refreshTokenHash)
    return null
  }

  const accessToken = generateToken({
    user_id: rotatedSession.user_id.toString(),
    user_type: rotatedSession.user_type as UserType,
    session_id: rotatedSession._id.toString(),
    token_id: accessTokenId,
  }, SESSION_ACCESS_TOKEN_LIFETIME_SECONDS)

  return {
    token: accessToken,
    refresh_token: replacementRefreshToken,
    session: {
      session_id: rotatedSession._id.toString(),
      refresh_expires_at: rotatedSession.expires_at,
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

/**
 * Password/MFA changes first bump User.security_version atomically with the
 * credential. Physical revocation is cleanup; failure cannot revive old
 * sessions and must not turn a completed credential change into ambiguity.
 */
export const bestEffortRevokeSessionsAfterSecurityVersionBump = async (
  userId: string,
  reason: AuthSessionRevocationReason,
) => {
  try {
    const result = await revokeActiveAuthSessionsForUser(userId, reason)
    return { modifiedCount: result.modifiedCount || 0, cleanupCompleted: true }
  } catch (error) {
    logger.error('auth_session.revocation_cleanup_failed', {
      userId,
      reason,
      error: error instanceof Error ? error.message : String(error),
    })
    return { modifiedCount: 0, cleanupCompleted: false }
  }
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
