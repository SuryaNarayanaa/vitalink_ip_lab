import DeviceToken from '@alias/models/DeviceToken.model'
import { registerDeviceToken } from '@alias/services/device-token.service'
import { sendPushToUser } from '@alias/services/fcm.service'
import * as firebaseConfig from '@alias/config/firebase.config'
import User from '@alias/models/user.model'
import * as hospitalAccess from '@alias/services/hospital-access.service'
import * as configService from '@alias/services/config.service'

describe('Device token ownership', () => {
  beforeEach(() => {
    jest.spyOn(User, 'findById').mockImplementation((() => ({
      select() { return this },
      lean: async () => ({ is_active: true, user_type: 'PATIENT', profile_id: 'profile' }),
    })) as any)
    jest.spyOn(hospitalAccess, 'hasActiveClinicalHospitalAccess').mockResolvedValue(true)
    jest.spyOn(hospitalAccess, 'hasActiveHospitalAccess').mockResolvedValue(true)
    jest.spyOn(configService, 'isFeatureEnabled').mockResolvedValue(true)
  })
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

    expect(result.success).toBe(false)
    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe('permanent_token_failures')
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

  test('rechecks pause after the final recipient eligibility read', async () => {
    jest.spyOn(DeviceToken, 'find').mockReturnValue({
      lean: async () => [{ _id: 'device-a', fcm_token: 'token-a' }],
    } as any)
    const provider = jest.fn()
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({ sendEachForMulticast: provider } as any)
    let enabled = true
    jest.mocked(configService.isFeatureEnabled).mockImplementation(async () => enabled)
    let release!: () => void
    let reached!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    const entered = new Promise<void>(resolve => { reached = resolve })
    jest.mocked(hospitalAccess.hasActiveClinicalHospitalAccess).mockImplementationOnce(async () => {
      reached()
      await blocked
      return true
    })

    const sending = sendPushToUser('user-a', { title: 'Clinical', body: 'Private' }, [], undefined, 'clinical')
    await entered
    enabled = false
    release()

    await expect(sending).resolves.toMatchObject({ skipped: true, skipReason: 'notifications_paused' })
    expect(provider).not.toHaveBeenCalled()
  })

  test('rechecks expiry after the final recipient eligibility read', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-14T00:00:00.000Z'))
    try {
      jest.spyOn(DeviceToken, 'find').mockReturnValue({
        lean: async () => [{ _id: 'device-a', fcm_token: 'token-a' }],
      } as any)
      const provider = jest.fn()
      jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({ sendEachForMulticast: provider } as any)
      let release!: () => void
      let reached!: () => void
      const blocked = new Promise<void>(resolve => { release = resolve })
      const entered = new Promise<void>(resolve => { reached = resolve })
      jest.mocked(hospitalAccess.hasActiveClinicalHospitalAccess).mockImplementationOnce(async () => {
        reached()
        await blocked
        return true
      })
      const deadline = new Date(Date.now() + 1_000)
      const sending = sendPushToUser('user-a', { title: 'Clinical', body: 'Private' }, [], deadline, 'clinical')
      await entered
      jest.setSystemTime(new Date(Date.now() + 2_000))
      release()

      await expect(sending).resolves.toMatchObject({ skipped: true, skipReason: 'expired_notification' })
      expect(provider).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })

  test('uses general eligibility for nonclinical global-admin pushes', async () => {
    jest.spyOn(DeviceToken, 'find').mockReturnValue({
      lean: async () => [{ _id: 'device-a', fcm_token: 'token-a' }],
    } as any)
    jest.mocked(hospitalAccess.hasActiveClinicalHospitalAccess).mockResolvedValue(false)
    jest.mocked(hospitalAccess.hasActiveHospitalAccess).mockResolvedValue(true)
    const provider = jest.fn(async () => ({
      responses: [{ success: true, messageId: 'message-a' }], successCount: 1, failureCount: 0,
    }))
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({ sendEachForMulticast: provider } as any)

    await expect(sendPushToUser(
      'user-a', { title: 'System', body: 'Maintenance window' }, [], undefined, 'general',
    )).resolves.toMatchObject({ success: true, skipped: false })
    expect(hospitalAccess.hasActiveHospitalAccess).toHaveBeenCalled()
    expect(hospitalAccess.hasActiveClinicalHospitalAccess).not.toHaveBeenCalled()
    expect(provider).toHaveBeenCalledTimes(1)
  })
})
