import mongoose from 'mongoose'
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers'
import Notification from '@alias/models/notification.model'
import NotificationDelivery, {
  NotificationDeliveryStatus,
} from '@alias/models/notificationdelivery.model'
import DeviceToken from '@alias/models/DeviceToken.model'
import * as firebaseConfig from '@alias/config/firebase.config'
import {
  buildIdempotencyKey,
  createPushDeliveryOutbox,
  enqueueNotificationPush,
  processNotificationDelivery,
  sanitizeDeliveryError,
} from '@alias/services/notification-delivery.service'
import {
  getDeliveryMetrics,
  resetDeliveryMetrics,
} from '@alias/services/notification-delivery.metrics'
import { sendPushToUser } from '@alias/services/fcm.service'
import {
  closeNotificationDeliveryQueue,
  publishDeliveryJob,
  resetNotificationQueueStateForTests,
} from '@alias/jobs/notification-delivery.queue'
import {
  startNotificationDeliveryWorker,
  stopNotificationDeliveryWorker,
} from '@alias/jobs/notification-delivery.worker'
import { config } from '@alias/config'
import PatientProfile from '@alias/models/patientprofile.model'
import User from '@alias/models/user.model'
import { runDosageReminderPass } from '@alias/jobs/dosage.scheduler'
import { runClinicalReminderPass } from '@alias/jobs/clinical-reminder.scheduler'

describe('Notification delivery durability', () => {
  let mongoContainer: StartedTestContainer
  let redisContainer: StartedTestContainer | null = null
  const originalRedisUrl = config.redisUrl
  const originalDeliveryEnabled = config.notificationDeliveryEnabled
  const originalMaxAttempts = config.notificationDeliveryMaxAttempts
  const originalBackoff = config.notificationDeliveryBaseBackoffMs

  beforeAll(async () => {
    mongoContainer = await new GenericContainer('mongo:7.0')
      .withExposedPorts(27017)
      .start()
    const mongoUri = `mongodb://${mongoContainer.getHost()}:${mongoContainer.getMappedPort(27017)}/notification_delivery_test`
    await mongoose.connect(mongoUri)

    try {
      redisContainer = await new GenericContainer('redis:7-alpine')
        .withExposedPorts(6379)
        .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
        .start()
      const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`
      ;(config as any).redisUrl = redisUrl
      ;(config as any).notificationDeliveryEnabled = true
      await resetNotificationQueueStateForTests()
    } catch {
      redisContainer = null
      ;(config as any).redisUrl = ''
      ;(config as any).notificationDeliveryEnabled = true
    }
  }, 120_000)

  afterAll(async () => {
    await stopNotificationDeliveryWorker()
    await closeNotificationDeliveryQueue()
    await resetNotificationQueueStateForTests()
    ;(config as any).redisUrl = originalRedisUrl
    ;(config as any).notificationDeliveryEnabled = originalDeliveryEnabled
    ;(config as any).notificationDeliveryMaxAttempts = originalMaxAttempts
    ;(config as any).notificationDeliveryBaseBackoffMs = originalBackoff

    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close()
    }
    if (mongoContainer) await mongoContainer.stop()
    if (redisContainer) await redisContainer.stop()
  }, 60_000)

  beforeEach(async () => {
    resetDeliveryMetrics()
    ;(config as any).notificationDeliveryMaxAttempts = 5
    ;(config as any).notificationDeliveryBaseBackoffMs = 10
    await Promise.all([
      Notification.deleteMany({}),
      NotificationDelivery.deleteMany({}),
      DeviceToken.deleteMany({}),
      PatientProfile.deleteMany({}),
      User.deleteMany({}),
    ])
    jest.restoreAllMocks()
  })

  async function seedNotification(userId = new mongoose.Types.ObjectId()) {
    return Notification.create({
      user_id: userId,
      type: 'DOCTOR_UPDATE',
      priority: 'HIGH',
      title: 'Dosage updated',
      message: 'Your dosage was changed',
      data: { change_type: 'DOSAGE_UPDATED' },
    })
  }

  test('dosage reminder creates exactly one notification and push delivery per due window', async () => {
    const monday = new Date(2026, 6, 13, 9, 0, 0)
    const profile = await PatientProfile.create({
      demographics: { name: 'Reminder Patient' },
      medical_config: { therapy_drug: 'Warfarin' },
      weekly_dosage: { monday: 5 },
      account_status: 'Active',
    })
    const userId = new mongoose.Types.ObjectId()
    await User.collection.insertOne({
      _id: userId,
      login_id: 'reminder-patient',
      password: 'test-hash',
      salt: 'test-salt',
      user_type: 'PATIENT',
      user_type_model: 'PatientProfile',
      profile_id: profile._id,
      is_active: true,
    } as any)

    const enqueue = async (input: Parameters<typeof enqueueNotificationPush>[0]) => {
      await createPushDeliveryOutbox(input)
      return true
    }
    const publish = jest.fn()
    const [first, duplicate] = await Promise.all([
      runDosageReminderPass(monday, enqueue, publish),
      runDosageReminderPass(monday, enqueue, publish),
    ])

    expect(first.created + duplicate.created).toBe(1)
    expect(first.skipped + duplicate.skipped).toBe(1)
    expect(first.failed + duplicate.failed).toBe(0)
    expect(await Notification.countDocuments({ type: 'DOSAGE_REMINDER' })).toBe(1)
    expect(await NotificationDelivery.countDocuments()).toBe(1)

    const notification = await Notification.findOne({ type: 'DOSAGE_REMINDER' }).lean()
    expect(notification?.reminder_key).toBe(`dosage:${userId}:2026-07-13`)
    expect(notification?.data).toMatchObject({ dueWindow: '2026-07-13' })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith(
      String(userId),
      'notification',
      expect.objectContaining({
        type: 'DOSAGE_REMINDER',
        data: expect.objectContaining({ route: 'patient-take-dosage' }),
      })
    )
  })

  test('dosage reminder repairs a missing outbox on a repeated pass', async () => {
    const monday = new Date(2026, 6, 13, 9, 0, 0)
    const profile = await PatientProfile.create({
      demographics: { name: 'Retry Patient' },
      medical_config: { therapy_drug: 'Warfarin' },
      weekly_dosage: { monday: 5 },
      account_status: 'Active',
    })
    const userId = new mongoose.Types.ObjectId()
    await User.collection.insertOne({
      _id: userId,
      login_id: 'retry-reminder-patient',
      password: 'test-hash',
      salt: 'test-salt',
      user_type: 'PATIENT',
      user_type_model: 'PatientProfile',
      profile_id: profile._id,
      is_active: true,
    } as any)

    const failed = await runDosageReminderPass(monday, async () => false)
    expect(failed).toEqual({ created: 0, skipped: 0, failed: 1 })
    expect(await Notification.countDocuments({ type: 'DOSAGE_REMINDER' })).toBe(1)
    expect(await NotificationDelivery.countDocuments()).toBe(0)

    const repaired = await runDosageReminderPass(monday, async (input) => {
      await createPushDeliveryOutbox(input)
      return true
    })
    expect(repaired).toEqual({ created: 0, skipped: 1, failed: 0 })
    expect(await Notification.countDocuments({ type: 'DOSAGE_REMINDER' })).toBe(1)
    expect(await NotificationDelivery.countDocuments()).toBe(1)
  })

  test('clinical reminder pass creates INR, review, and patient/doctor missed-dose reminders once', async () => {
    const now = new Date('2026-07-13T09:00:00.000Z')
    const doctorProfileId = new mongoose.Types.ObjectId()
    const profile = await PatientProfile.create({
      demographics: { name: 'Escalation Patient' },
      assigned_doctor_id: doctorProfileId,
      medical_config: {
        therapy_start_date: new Date('2026-05-01T00:00:00.000Z'),
        next_review_date: new Date('2026-07-15T00:00:00.000Z'),
        taken_doses: [],
      },
      weekly_dosage: { monday: 5, tuesday: 5, wednesday: 5, thursday: 5, friday: 5, saturday: 5, sunday: 5 },
      account_status: 'Active',
    })
    const patientUserId = new mongoose.Types.ObjectId()
    const doctorUserId = new mongoose.Types.ObjectId()
    await User.collection.insertMany([
      { _id: patientUserId, login_id: 'clinical-patient', password: 'x', salt: 'x', user_type: 'PATIENT', user_type_model: 'PatientProfile', profile_id: profile._id, is_active: true },
      { _id: doctorUserId, login_id: 'clinical-doctor', password: 'x', salt: 'x', user_type: 'DOCTOR', user_type_model: 'DoctorProfile', profile_id: doctorProfileId, is_active: true },
    ] as any)

    const first = await runClinicalReminderPass(now)
    const repeat = await runClinicalReminderPass(now)

    expect(first).toEqual({ created: 4, skipped: 0, failed: 0 })
    expect(repeat).toEqual({ created: 0, skipped: 4, failed: 0 })
    expect(await Notification.countDocuments({ user_id: patientUserId })).toBe(3)
    expect(await Notification.countDocuments({ user_id: doctorUserId })).toBe(1)
    expect(await NotificationDelivery.countDocuments()).toBe(4)
  })

  test('sanitizeDeliveryError redacts long tokens and truncates', () => {
    const longToken = 'a'.repeat(200)
    const sanitized = sanitizeDeliveryError(`Bearer ${longToken} boom`)
    expect(sanitized).not.toContain(longToken)
    expect(sanitized.length).toBeLessThanOrEqual(500)
    expect(sanitized).toMatch(/redacted/i)
  })

  test('outbox write is idempotent for the same notification', async () => {
    const notification = await seedNotification()
    const input = {
      notificationId: String(notification._id),
      userId: String(notification.user_id),
      title: notification.title,
      body: notification.message,
      data: { change_type: 'DOSAGE_UPDATED' },
    }

    const first = await createPushDeliveryOutbox(input)
    const second = await createPushDeliveryOutbox(input)

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(String(first.delivery._id)).toBe(String(second.delivery._id))
    expect(await NotificationDelivery.countDocuments()).toBe(1)
    expect(getDeliveryMetrics().duplicate_suppressed).toBe(1)
    expect(buildIdempotencyKey(String(notification._id))).toBe(
      first.delivery.idempotency_key
    )
  })

  test('successful FCM delivery marks SUCCEEDED with provider message id', async () => {
    const notification = await seedNotification()
    const userId = String(notification.user_id)

    await DeviceToken.create({
      user_id: notification.user_id,
      fcm_token: 'active-token',
      platform: 'android',
      is_active: true,
    })

    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({
      sendEachForMulticast: jest.fn(async () => ({
        responses: [{ success: true, messageId: 'projects/x/messages/1' }],
        successCount: 1,
        failureCount: 0,
      })),
    } as any)

    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id),
      userId,
      title: notification.title,
      body: notification.message,
    })

    const result = await processNotificationDelivery(String(delivery._id))
    expect(result.outcome).toBe('succeeded')

    const updated = await NotificationDelivery.findById(delivery._id)
    expect(updated?.status).toBe(NotificationDeliveryStatus.SUCCEEDED)
    expect(updated?.provider_message_id).toBe('projects/x/messages/1')
    expect(updated?.attempts).toBe(1)
    expect(updated?.completed_at).toBeTruthy()
    expect(getDeliveryMetrics().succeeded).toBe(1)
  })

  test('transient provider failure retries without creating duplicate in-app notifications', async () => {
    const notification = await seedNotification()
    const userId = String(notification.user_id)

    await DeviceToken.create({
      user_id: notification.user_id,
      fcm_token: 'retry-token',
      platform: 'android',
      is_active: true,
    })

    const send = jest
      .fn()
      .mockResolvedValueOnce({
        responses: [{
          success: false,
          error: { code: 'messaging/server-unavailable', message: 'try again' },
        }],
        successCount: 0,
        failureCount: 1,
      })
      .mockResolvedValueOnce({
        responses: [{ success: true, messageId: 'msg-retry-ok' }],
        successCount: 1,
        failureCount: 0,
      })

    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({
      sendEachForMulticast: send,
    } as any)

    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id),
      userId,
      title: notification.title,
      body: notification.message,
    })

    const first = await processNotificationDelivery(String(delivery._id))
    expect(first.outcome).toBe('retryable')

    let row = await NotificationDelivery.findById(delivery._id)
    expect(row?.status).toBe(NotificationDeliveryStatus.FAILED_RETRYABLE)
    expect(row?.attempts).toBe(1)
    expect(row?.last_error).toMatch(/try again|server-unavailable/i)

    // Make due for immediate retry
    await NotificationDelivery.updateOne(
      { _id: delivery._id },
      { $set: { next_attempt_at: new Date(Date.now() - 1000) } }
    )

    const second = await processNotificationDelivery(String(delivery._id))
    expect(second.outcome).toBe('succeeded')

    row = await NotificationDelivery.findById(delivery._id)
    expect(row?.status).toBe(NotificationDeliveryStatus.SUCCEEDED)
    expect(row?.attempts).toBe(2)
    expect(await Notification.countDocuments()).toBe(1)
  })

  test('invalid tokens are disabled only for the current token owner', async () => {
    const ownerA = new mongoose.Types.ObjectId()
    const ownerB = new mongoose.Types.ObjectId()

    await DeviceToken.create({
      user_id: ownerB,
      fcm_token: 'shared-physical-token',
      platform: 'android',
      is_active: true,
    })

    // Stale path: send still targets the token under A after ownership moved to B.
    jest.spyOn(DeviceToken, 'find').mockImplementation((query: any) => ({
      lean: async () => {
        if (String(query.user_id) === String(ownerA) && query.is_active === true) {
          return [{ fcm_token: 'shared-physical-token' }]
        }
        return []
      },
    }) as any)

    const updateOne = jest.spyOn(DeviceToken, 'updateOne')

    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({
      sendEachForMulticast: jest.fn(async () => ({
        responses: [{
          success: false,
          error: { code: 'messaging/registration-token-not-registered' },
        }],
        successCount: 0,
        failureCount: 1,
      })),
    } as any)

    const result = await sendPushToUser(String(ownerA), {
      title: 'Stale',
      body: 'should not disable B',
    })

    expect(result.success).toBe(true)
    expect(result.permanentFailures).toBe(1)
    expect(updateOne).toHaveBeenCalledWith(
      { fcm_token: 'shared-physical-token', user_id: String(ownerA), is_active: true },
      { $set: { is_active: false } }
    )

    // Token still active under B in the real collection.
    const token = await DeviceToken.findOne({ fcm_token: 'shared-physical-token' })
    expect(token?.is_active).toBe(true)
    expect(String(token?.user_id)).toBe(String(ownerB))
  })

  test('exhausted deliveries enter dead-letter with sanitized error and no sensitive payload', async () => {
    ;(config as any).notificationDeliveryMaxAttempts = 2
    const notification = await seedNotification()
    const secret = `Bearer ${'x'.repeat(180)}`

    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({
      sendEachForMulticast: jest.fn(async () => {
        throw new Error(`FCM blew up with ${secret}`)
      }),
    } as any)

    await DeviceToken.create({
      user_id: notification.user_id,
      fcm_token: 'dead-letter-token',
      platform: 'ios',
      is_active: true,
    })

    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id),
      userId: String(notification.user_id),
      title: notification.title,
      body: notification.message,
    })

    // Force next_attempt due between retries
    let outcome = await processNotificationDelivery(String(delivery._id))
    expect(outcome.outcome).toBe('retryable')

    await NotificationDelivery.updateOne(
      { _id: delivery._id },
      { $set: { next_attempt_at: new Date(Date.now() - 1000) } }
    )

    outcome = await processNotificationDelivery(String(delivery._id))
    expect(outcome.outcome).toBe('dead_letter')

    const row = await NotificationDelivery.findById(delivery._id).lean()
    expect(row?.status).toBe(NotificationDeliveryStatus.DEAD_LETTER)
    expect(row?.last_error).toBeTruthy()
    expect(row?.last_error).not.toContain('x'.repeat(50))
    expect(row?.last_error).not.toMatch(/Bearer\s+x{20,}/i)
    // Ensure we never persisted the raw FCM multicast request payload.
    expect(JSON.stringify(row)).not.toContain('private_key')
    expect(getDeliveryMetrics().dead_letter).toBe(1)

    // Dead-letter rows are queryable by status.
    const dead = await NotificationDelivery.find({
      status: NotificationDeliveryStatus.DEAD_LETTER,
    })
    expect(dead).toHaveLength(1)
  })

  test('enqueueNotificationPush remains best-effort when queue publish fails', async () => {
    const notification = await seedNotification()
    jest.spyOn(
      await import('@alias/jobs/notification-delivery.queue'),
      'publishDeliveryJob'
    ).mockResolvedValue(false)

    await enqueueNotificationPush({
      notificationId: String(notification._id),
      userId: String(notification.user_id),
      title: notification.title,
      body: notification.message,
    })

    const row = await NotificationDelivery.findOne({
      notification_id: notification._id,
    })
    expect(row).not.toBeNull()
    expect(row?.status).toBe(NotificationDeliveryStatus.PENDING)
    // Only one in-app notification exists.
    expect(await Notification.countDocuments()).toBe(1)
  })

  test('duplicate process on terminal delivery is a no-op', async () => {
    const notification = await seedNotification()
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue(null as any)

    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id),
      userId: String(notification.user_id),
      title: notification.title,
      body: notification.message,
    })

    const first = await processNotificationDelivery(String(delivery._id))
    expect(first.outcome).toBe('skipped')

    const second = await processNotificationDelivery(String(delivery._id))
    expect(second.outcome).toBe('already_terminal')
    expect((await NotificationDelivery.findById(delivery._id))?.attempts).toBe(1)
  })

  test('BullMQ worker processes a published delivery when Redis is available', async () => {
    if (!redisContainer || !config.redisUrl) {
      console.warn('Skipping BullMQ worker integration — Redis container unavailable')
      return
    }

    const notification = await seedNotification()
    await DeviceToken.create({
      user_id: notification.user_id,
      fcm_token: 'worker-token',
      platform: 'android',
      is_active: true,
    })

    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({
      sendEachForMulticast: jest.fn(async () => ({
        responses: [{ success: true, messageId: 'worker-msg-1' }],
        successCount: 1,
        failureCount: 0,
      })),
    } as any)

    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id),
      userId: String(notification.user_id),
      title: notification.title,
      body: notification.message,
    })

    await resetNotificationQueueStateForTests()
    startNotificationDeliveryWorker()
    const published = await publishDeliveryJob(String(delivery._id))
    expect(published).toBe(true)

    // Wait for worker to finish
    const deadline = Date.now() + 15_000
    let row = await NotificationDelivery.findById(delivery._id)
    while (Date.now() < deadline && row?.status !== NotificationDeliveryStatus.SUCCEEDED) {
      await new Promise((r) => setTimeout(r, 200))
      row = await NotificationDelivery.findById(delivery._id)
    }

    expect(row?.status).toBe(NotificationDeliveryStatus.SUCCEEDED)
    expect(row?.provider_message_id).toBe('worker-msg-1')
    await stopNotificationDeliveryWorker()
  }, 30_000)
})
