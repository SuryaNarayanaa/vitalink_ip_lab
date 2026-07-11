import DeviceToken from '@alias/models/DeviceToken.model'
import { registerDeviceToken } from '@alias/services/device-token.service'
import { sendPushToUser } from '@alias/services/fcm.service'
import * as firebaseConfig from '@alias/config/firebase.config'

describe('Device token ownership', () => {
  afterEach(() => jest.restoreAllMocks())

  test('globally unique token registration transfers delivery from the previous user', async () => {
    const records = new Map<string, any>()
    ;(jest.spyOn(DeviceToken, 'findOneAndUpdate') as any).mockImplementation(async (query: any, update: any) => {
      const current = records.get(query.fcm_token) || { _id: 'token-id' }
      Object.assign(current, update.$set)
      records.set(query.fcm_token, current)
      return current
    })
    ;(jest.spyOn(DeviceToken, 'updateMany') as any).mockImplementation(async (query: any) => {
      for (const record of records.values()) {
        if (
          String(record.user_id) === String(query.user_id) &&
          record.platform === query.platform &&
          record.fcm_token !== query.fcm_token.$ne
        ) record.is_active = false
      }
      return { acknowledged: true, modifiedCount: 0 } as any
    })

    await registerDeviceToken({ userId: 'user-a', fcmToken: 'physical-token', platform: 'android' })
    await registerDeviceToken({ userId: 'user-b', fcmToken: 'physical-token', platform: 'android' })

    expect(records.size).toBe(1)
    expect(records.get('physical-token').user_id).toBe('user-b')

    jest.spyOn(DeviceToken, 'find').mockImplementation((query: any) => ({
      lean: async () => Array.from(records.values())
        .filter(record => String(record.user_id) === String(query.user_id) && record.is_active)
        .map(record => ({ fcm_token: record.fcm_token })),
    }) as any)
    const sendEachForMulticast = jest.fn(async () => ({
      responses: [{ success: true }], successCount: 1, failureCount: 0,
    }))
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({ sendEachForMulticast } as any)

    const resultA = await sendPushToUser('user-a', { title: 'Private update', body: 'A' })
    const resultB = await sendPushToUser('user-b', { title: 'Private update', body: 'B' })

    expect(resultA.skipped).toBe(true)
    expect(resultA.skipReason).toBe('no_tokens')
    expect(resultB.success).toBe(true)
    expect(resultB.skipped).toBe(false)
    expect(sendEachForMulticast).toHaveBeenCalledTimes(1)
    expect(sendEachForMulticast).toHaveBeenCalledWith(expect.objectContaining({ tokens: ['physical-token'] }))
  })

  test('dead-token cleanup for a previous owner cannot deactivate a transferred token', async () => {
    const records = new Map<string, any>([
      ['physical-token', {
        _id: 'token-id',
        user_id: 'user-b',
        fcm_token: 'physical-token',
        platform: 'android',
        is_active: true,
      }],
    ])

    // Stale send path still lists the token under user A after ownership moved to B.
    jest.spyOn(DeviceToken, 'find').mockImplementation((query: any) => ({
      lean: async () => {
        if (String(query.user_id) === 'user-a' && query.is_active === true) {
          return [{ fcm_token: 'physical-token' }]
        }
        return Array.from(records.values())
          .filter(record => String(record.user_id) === String(query.user_id) && record.is_active)
          .map(record => ({ fcm_token: record.fcm_token }))
      },
    }) as any)

    ;(jest.spyOn(DeviceToken, 'updateOne') as any).mockImplementation(async (query: any, update: any) => {
      const record = records.get(query.fcm_token)
      if (
        record &&
        String(record.user_id) === String(query.user_id) &&
        record.is_active === true &&
        (query.is_active === undefined || record.is_active === query.is_active)
      ) {
        Object.assign(record, update.$set)
        return { matchedCount: 1, modifiedCount: 1 }
      }
      return { matchedCount: 0, modifiedCount: 0 }
    })

    const sendEachForMulticast = jest.fn(async () => ({
      responses: [{
        success: false,
        error: { code: 'messaging/registration-token-not-registered' },
      }],
      successCount: 0,
      failureCount: 1,
    }))
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({ sendEachForMulticast } as any)

    const result = await sendPushToUser('user-a', { title: 'Stale push', body: 'should not disable B' })

    expect(result.success).toBe(true)
    expect(result.permanentFailures).toBe(1)
    expect(records.get('physical-token').user_id).toBe('user-b')
    expect(records.get('physical-token').is_active).toBe(true)
    expect(DeviceToken.updateOne).toHaveBeenCalledWith(
      { fcm_token: 'physical-token', user_id: 'user-a', is_active: true },
      { $set: { is_active: false } }
    )
  })

  test('retries registration after concurrent unique-index upsert race', async () => {
    let attempts = 0
    const duplicateKeyError = Object.assign(new Error('E11000 duplicate key error'), { code: 11000 })

    ;(jest.spyOn(DeviceToken, 'findOneAndUpdate') as any).mockImplementation(
      async (_query: any, update: any, options: any) => {
        attempts += 1
        if (attempts === 1 && options?.upsert) {
          throw duplicateKeyError
        }
        return { _id: 'token-id', ...update.$set }
      }
    )
    ;(jest.spyOn(DeviceToken, 'updateMany') as any).mockResolvedValue({
      acknowledged: true,
      modifiedCount: 0,
    } as any)

    const token = await registerDeviceToken({
      userId: 'user-a',
      fcmToken: 'raced-token',
      platform: 'ios',
    })

    expect(attempts).toBe(2)
    expect(token.user_id).toBe('user-a')
    expect(token.fcm_token).toBe('raced-token')
    expect(token.is_active).toBe(true)
  })

  test('declares a globally unique FCM token index', () => {
    expect(DeviceToken.schema.indexes()).toContainEqual([{ fcm_token: 1 }, { unique: true }])
  })
})
