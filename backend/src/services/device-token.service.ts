import { StatusCodes } from 'http-status-codes'
import DeviceToken from '@alias/models/DeviceToken.model'
import { ApiError } from '@alias/utils'

export type DevicePlatform = 'android' | 'ios' | 'web'

function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: number }).code === 11000
  )
}

function ownershipUpdate(input: {
  userId: string
  fcmToken: string
  platform: DevicePlatform
  appVersion?: string | null
}) {
  return {
    $set: {
      user_id: input.userId,
      fcm_token: input.fcmToken,
      platform: input.platform,
      app_version: input.appVersion ?? null,
      is_active: true,
      last_refreshed_at: new Date(),
    },
  }
}

/** Claim filter: same owner, inactive token, or no owner yet (upsert path). */
function claimableTokenFilter(userId: string, fcmToken: string) {
  return {
    fcm_token: fcmToken,
    $or: [
      { user_id: userId },
      { is_active: { $ne: true } },
      { user_id: null },
      { user_id: { $exists: false } },
    ],
  }
}

async function assertNotActiveForeignToken(userId: string, fcmToken: string) {
  const existing = await DeviceToken.findOne({ fcm_token: fcmToken }).lean()
  if (
    existing
    && existing.is_active
    && String(existing.user_id) !== String(userId)
  ) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      'Device token is already registered to another active account',
    )
  }
  return existing
}

export async function registerDeviceToken(input: {
  userId: string
  fcmToken: string
  platform: DevicePlatform
  appVersion?: string | null
}) {
  // Atomic claim: only same-user or inactive/unowned tokens may be written.
  // Active tokens owned by another user never match the filter; upsert then
  // collides on the unique fcm_token index and is mapped to 409 below.
  let token
  try {
    token = await DeviceToken.findOneAndUpdate(
      claimableTokenFilter(input.userId, input.fcmToken),
      ownershipUpdate(input),
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error

    await assertNotActiveForeignToken(input.userId, input.fcmToken)

    token = await DeviceToken.findOneAndUpdate(
      claimableTokenFilter(input.userId, input.fcmToken),
      ownershipUpdate(input),
      { new: true },
    )
    if (!token) {
      throw new ApiError(
        StatusCodes.CONFLICT,
        'Device token is already registered to another active account',
      )
    }
  }

  if (!token) {
    await assertNotActiveForeignToken(input.userId, input.fcmToken)
    throw new ApiError(
      StatusCodes.CONFLICT,
      'Device token is already registered to another active account',
    )
  }

  // One active physical device per user+platform: deactivate siblings after ownership is settled.
  await DeviceToken.updateMany(
    { user_id: input.userId, platform: input.platform, fcm_token: { $ne: input.fcmToken } },
    { $set: { is_active: false } },
  )
  return token
}

export async function deactivateDeviceToken(userId: string, fcmToken: string) {
  return DeviceToken.findOneAndUpdate(
    { user_id: userId, fcm_token: fcmToken },
    { $set: { is_active: false } },
    { new: true },
  )
}

export async function listActiveTokensForUser(userId: string) {
  return DeviceToken.find({ user_id: userId, is_active: true }).lean()
}
