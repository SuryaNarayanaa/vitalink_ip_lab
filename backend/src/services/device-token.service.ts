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

export async function registerDeviceToken(input: {
  userId: string
  fcmToken: string
  platform: DevicePlatform
  appVersion?: string | null
}) {
  // Active tokens belonging to another user cannot be claimed by knowledge of
  // the FCM string alone. Inactive/unowned tokens may be reassigned.
  const existing = await DeviceToken.findOne({ fcm_token: input.fcmToken }).lean()
  if (
    existing
    && existing.is_active
    && String(existing.user_id) !== String(input.userId)
  ) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      'Device token is already registered to another active account',
    )
  }

  let token
  try {
    token = await DeviceToken.findOneAndUpdate(
      { fcm_token: input.fcmToken },
      ownershipUpdate(input),
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
  } catch (error) {
    // Concurrent first-time upserts of the same new fcm_token can race the unique index (E11000).
    if (!isDuplicateKeyError(error)) throw error

    const raced = await DeviceToken.findOne({ fcm_token: input.fcmToken }).lean()
    if (
      raced
      && raced.is_active
      && String(raced.user_id) !== String(input.userId)
    ) {
      throw new ApiError(
        StatusCodes.CONFLICT,
        'Device token is already registered to another active account',
      )
    }

    token = await DeviceToken.findOneAndUpdate(
      {
        fcm_token: input.fcmToken,
        $or: [
          { user_id: input.userId },
          { is_active: false },
        ],
      },
      ownershipUpdate(input),
      { new: true }
    )
    if (!token) throw error
  }

  // One active physical device per user+platform: deactivate siblings after ownership is settled.
  await DeviceToken.updateMany(
    { user_id: input.userId, platform: input.platform, fcm_token: { $ne: input.fcmToken } },
    { $set: { is_active: false } }
  )
  return token
}

export async function deactivateDeviceToken(userId: string, fcmToken: string) {
  return DeviceToken.findOneAndUpdate(
    { user_id: userId, fcm_token: fcmToken },
    { $set: { is_active: false } },
    { new: true }
  )
}

export async function listActiveTokensForUser(userId: string) {
  return DeviceToken.find({ user_id: userId, is_active: true }).lean()
}
