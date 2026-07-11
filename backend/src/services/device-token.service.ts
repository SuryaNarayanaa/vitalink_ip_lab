import DeviceToken from '@alias/models/DeviceToken.model'

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
  // The globally unique token document is the ownership record. Updating by token atomically transfers it.
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

    token = await DeviceToken.findOneAndUpdate(
      { fcm_token: input.fcmToken },
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
