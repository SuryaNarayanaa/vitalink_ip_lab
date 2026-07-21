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
  cancelNotificationPush,
  createPushDeliveryOutbox,
  claimDeliveryForProcessing,
  enqueueNotificationPush,
  processNotificationDelivery,
  reconcileMissingPushOutboxes,
  recoverDueDeliveries,
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
import AdminProfile from '@alias/models/adminprofile.model'
import DoctorProfile from '@alias/models/doctorprofile.model'
import Hospital from '@alias/models/hospital.model'
import SystemConfig from '@alias/models/systemconfig.model'
import { clearSystemConfigCache, updateSystemConfig } from '@alias/services/config.service'
import { createDoctorUpdateNotification } from '@alias/services/doctor-update-notification.service'
import * as realtimeNotifications from '@alias/services/realtime-notification.service'

describe('Notification delivery durability', () => {
  let mongoContainer: StartedTestContainer
  let redisContainer: StartedTestContainer | null = null
  const originalRedisUrl = config.redisUrl
  const originalDeliveryEnabled = config.notificationDeliveryEnabled
  const originalMaxAttempts = config.notificationDeliveryMaxAttempts
  const originalBackoff = config.notificationDeliveryBaseBackoffMs
  const originalProcessingLeaseMs = config.notificationDeliveryProcessingLeaseMs

  beforeAll(async () => {
    mongoContainer = await new GenericContainer('mongo:7.0')
      .withExposedPorts(27017)
      .start()
    const mongoUri = `mongodb://${mongoContainer.getHost()}:${mongoContainer.getMappedPort(27017)}/notification_delivery_test`
    await mongoose.connect(mongoUri)
    await NotificationDelivery.init()

    try {
      redisContainer = await new GenericContainer('redis:7-alpine')
        .withExposedPorts(6379)
        .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
        .start()
      const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`
      ;(config as any).redisUrl = redisUrl
      ;(config as any).notificationDeliveryEnabled = true
      resetNotificationQueueStateForTests()
    } catch {
      redisContainer = null
      ;(config as any).redisUrl = ''
      ;(config as any).notificationDeliveryEnabled = true
    }
  }, 120_000)

  afterAll(async () => {
    await stopNotificationDeliveryWorker()
    await closeNotificationDeliveryQueue()
    resetNotificationQueueStateForTests()
    ;(config as any).redisUrl = originalRedisUrl
    ;(config as any).notificationDeliveryEnabled = originalDeliveryEnabled
    ;(config as any).notificationDeliveryMaxAttempts = originalMaxAttempts
    ;(config as any).notificationDeliveryBaseBackoffMs = originalBackoff
    ;(config as any).notificationDeliveryProcessingLeaseMs = originalProcessingLeaseMs

    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close()
    }
    if (mongoContainer) await mongoContainer.stop()
    if (redisContainer) await redisContainer.stop()
  }, 60_000)

  beforeEach(async () => {
    clearSystemConfigCache()
    resetDeliveryMetrics()
    ;(config as any).notificationDeliveryMaxAttempts = 5
    ;(config as any).notificationDeliveryBaseBackoffMs = 10
    ;(config as any).notificationDeliveryProcessingLeaseMs = 60_000
    await Promise.all([
      Notification.deleteMany({}),
      NotificationDelivery.deleteMany({}),
      DeviceToken.deleteMany({}),
      PatientProfile.deleteMany({}),
      AdminProfile.deleteMany({}),
      DoctorProfile.deleteMany({}),
      Hospital.deleteMany({}),
      SystemConfig.deleteMany({}),
      User.deleteMany({}),
    ])
    jest.restoreAllMocks()
  })

  async function seedNotification(userId = new mongoose.Types.ObjectId()) {
    if (!await User.exists({ _id: userId })) {
      const hospital = await Hospital.create({
        code: `NOTIFY_${String(userId).slice(-12)}`,
        name: 'Notification Hospital', location: 'Test',
        admin_email: `notify-${String(userId).slice(-12)}@example.com`,
      })
      const profile = await AdminProfile.create({
        name: 'Notification Recipient',
        admin_role: 'app_admin',
        permission: 'FULL_ACCESS',
        hospital_id: hospital._id,
      })
      await User.collection.insertOne({
        _id: userId,
        login_id: `notification-user-${userId}`,
        password: 'test-hash',
        salt: 'test-salt',
        user_type: 'ADMIN',
        user_type_model: 'AdminProfile',
        profile_id: profile._id,
        is_active: true,
      } as any)
    }
    return Notification.create({
      user_id: userId,
      type: 'DOCTOR_UPDATE',
      priority: 'HIGH',
      title: 'Dosage updated',
      message: 'Your dosage was changed',
      data: { change_type: 'DOSAGE_UPDATED' },
      push_delivery_required: true,
    })
  }

  test('reconciles a notification committed before its outbox row', async () => {
    const notification = await seedNotification()
    const queue = await import('@alias/jobs/notification-delivery.queue')
    jest.spyOn(queue, 'publishDeliveryJob').mockResolvedValue(false)

    expect(await NotificationDelivery.countDocuments()).toBe(0)
    expect(await reconcileMissingPushOutboxes()).toBe(1)

    const [delivery, persistedNotification] = await Promise.all([
      NotificationDelivery.findOne({ notification_id: notification._id }).lean(),
      Notification.findById(notification._id).lean(),
    ])
    expect(delivery?.status).toBe(NotificationDeliveryStatus.PENDING)
    expect(persistedNotification?.push_delivery_enqueued_at).toBeTruthy()

    // Also cover a crash after the outbox insert but before its notification
    // marker was persisted. The unique outbox key makes this repair idempotent.
    await Notification.updateOne(
      { _id: notification._id },
      { $unset: { push_delivery_enqueued_at: 1 } },
    )
    expect(await reconcileMissingPushOutboxes()).toBe(1)
    expect(await NotificationDelivery.countDocuments()).toBe(1)
    expect((await Notification.findById(notification._id).lean())?.push_delivery_enqueued_at).toBeTruthy()
  })

  test('dosage reminder creates exactly one notification and push delivery per due window', async () => {
    const monday = new Date(2026, 6, 13, 9, 0, 0)
    const hospital = await Hospital.create({ code: 'DOSE_ONE', name: 'Dose One', location: 'Test', admin_email: 'dose-one@example.com' })
    const profile = await PatientProfile.create({
      demographics: { name: 'Reminder Patient' },
      hospital_id: hospital._id,
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
    const hospital = await Hospital.create({ code: 'DOSE_REPAIR', name: 'Dose Repair', location: 'Test', admin_email: 'dose-repair@example.com' })
    const profile = await PatientProfile.create({
      demographics: { name: 'Retry Patient' },
      hospital_id: hospital._id,
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

  test('expired dosage work is skipped before recovery publication while same-day work can deliver', async () => {
    const hospital = await Hospital.create({ code: 'DOSE_VALID', name: 'Dose Validity', location: 'Test', admin_email: 'dose-valid@example.com' })
    const now = new Date()
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: config.dosageReminderTimezone, weekday: 'long',
    }).format(now).toLowerCase()
    const profile = await PatientProfile.create({
      demographics: { name: 'Validity Patient' }, hospital_id: hospital._id,
      medical_config: { therapy_drug: 'Warfarin' }, weekly_dosage: { [weekday]: 5 }, account_status: 'Active',
    })
    const user = await User.create({
      login_id: 'validity-patient', password: 'x', salt: 'x', user_type: 'PATIENT',
      user_type_model: 'PatientProfile', profile_id: profile._id, is_active: true,
    })
    await DeviceToken.create({ user_id: user._id, fcm_token: 'validity-token', platform: 'android', is_active: true })
    const provider = jest.fn(async () => ({
      responses: [{ success: true, messageId: 'same-day-message' }], successCount: 1, failureCount: 0,
    }))
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({ sendEachForMulticast: provider } as any)
    const enqueue = async (input: Parameters<typeof enqueueNotificationPush>[0]) => {
      await createPushDeliveryOutbox(input)
      return true
    }

    expect((await runDosageReminderPass(now, enqueue, jest.fn())).created).toBe(1)
    const sameDay = await NotificationDelivery.findOne({ user_id: user._id })
    expect(sameDay?.delivery_valid_until.getTime()).toBeGreaterThan(now.getTime())
    expect((await processNotificationDelivery(String(sameDay?._id))).outcome).toBe('succeeded')
    expect(provider).toHaveBeenCalledTimes(1)

    const oldNotification = await Notification.create({
      user_id: user._id, type: 'DOSAGE_REMINDER', priority: 'HIGH', title: 'Old dose',
      message: 'Take an obsolete dose', push_delivery_required: true,
      delivery_valid_until: new Date(Date.now() - 1_000),
    })
    const { delivery: oldDelivery } = await createPushDeliveryOutbox({
      notificationId: String(oldNotification._id), userId: String(user._id), title: oldNotification.title,
      body: oldNotification.message, deliveryValidUntil: oldNotification.delivery_valid_until,
    })
    const queue = await import('@alias/jobs/notification-delivery.queue')
    const publish = jest.spyOn(queue, 'publishDeliveryJob').mockResolvedValue(true)
    await recoverDueDeliveries()
    const expired = await NotificationDelivery.findById(oldDelivery._id).lean()
    expect(expired?.status).toBe(NotificationDeliveryStatus.SKIPPED)
    expect(expired?.last_error).toBe('skipped:expired_notification')
    expect(publish).not.toHaveBeenCalled()
    expect(provider).toHaveBeenCalledTimes(1)
  })

  test('suspended hospitals produce no scheduled clinical persistence, outbox, or realtime disclosure', async () => {
    const now = new Date('2026-07-13T09:00:00.000Z')
    const hospital = await Hospital.create({
      code: 'SUSPENDED_REMINDERS', name: 'Suspended Reminders', location: 'Test',
      admin_email: 'suspended-reminders@example.com', status: 'suspended',
    })
    const profile = await PatientProfile.create({
      demographics: { name: 'Suspended Patient' }, hospital_id: hospital._id,
      medical_config: { therapy_start_date: new Date('2026-05-01T00:00:00.000Z'), taken_doses: [] },
      weekly_dosage: { monday: 5, saturday: 5, sunday: 5 }, account_status: 'Active',
    })
    await User.create({
      login_id: 'suspended-reminder-patient', password: 'x', salt: 'x', user_type: 'PATIENT',
      user_type_model: 'PatientProfile', profile_id: profile._id, is_active: true,
    })
    const realtime = jest.spyOn(realtimeNotifications, 'publishNotificationToUser')
    const dosagePublish = jest.fn()

    await runDosageReminderPass(now, enqueueNotificationPush, dosagePublish as any)
    await runClinicalReminderPass(now)

    expect(await Notification.countDocuments()).toBe(0)
    expect(await NotificationDelivery.countDocuments()).toBe(0)
    expect(dosagePublish).not.toHaveBeenCalled()
    expect(realtime).not.toHaveBeenCalled()
  })

  test('doctor updates retract their unpublished record when tenant suspension wins after creation', async () => {
    const hospital = await Hospital.create({
      code: 'DOCTOR_UPDATE_RACE', name: 'Doctor Update Race', location: 'Test',
      admin_email: 'doctor-update-race@example.com',
    })
    const profile = await PatientProfile.create({
      demographics: { name: 'Update Patient' }, hospital_id: hospital._id, account_status: 'Active',
    })
    const patient = await User.create({
      login_id: 'doctor-update-race-patient', password: 'x', salt: 'x', user_type: 'PATIENT',
      user_type_model: 'PatientProfile', profile_id: profile._id, is_active: true,
    })
    const originalFindById = User.findById.bind(User)
    let patientReads = 0
    jest.spyOn(User, 'findById').mockImplementation(((...args: any[]) => {
      const query = originalFindById(...args)
      const originalLean = query.lean.bind(query)
      query.lean = (async (...leanArgs: any[]) => {
        const value = await originalLean(...leanArgs)
        patientReads += 1
        if (patientReads === 2) {
          await Hospital.updateOne({ _id: hospital._id }, {
            $set: { status: 'suspended', lifecycle_state: 'SUSPENDING', accepting_assignments: false },
          })
        }
        return value
      }) as any
      return query
    }) as any)
    const rawPublish = jest.spyOn(realtimeNotifications, 'publishNotificationToUser')

    await expect(createDoctorUpdateNotification({
      patientUserId: patient._id,
      changedByDoctorId: new mongoose.Types.ObjectId(),
      changeType: 'DOSAGE_UPDATED', title: 'Dose changed', message: 'Private dose update',
    })).resolves.toBeNull()

    const cancelled = await Notification.findOne({ user_id: patient._id }).lean()
    expect(cancelled?.push_delivery_required).toBe(false)
    expect(cancelled?.push_delivery_cancelled_at).toBeTruthy()
    expect(await NotificationDelivery.countDocuments({ user_id: patient._id })).toBe(0)
    expect(rawPublish).not.toHaveBeenCalled()
  })

  test('doctor updates create no outbox and retract persistence when final clinical SSE eligibility fails', async () => {
    const existing = await seedNotification()
    const countBefore = await Notification.countDocuments()
    jest.spyOn(realtimeNotifications, 'publishClinicalNotificationToUser').mockResolvedValue(false)

    await expect(createDoctorUpdateNotification({
      patientUserId: existing.user_id,
      changedByDoctorId: new mongoose.Types.ObjectId(),
      changeType: 'INSTRUCTIONS_UPDATED', title: 'Instructions changed', message: 'Private instructions',
    })).resolves.toBeNull()

    expect(await Notification.countDocuments()).toBe(countBefore + 1)
    const cancelled = await Notification.findOne({
      user_id: existing.user_id, type: 'DOCTOR_UPDATE', _id: { $ne: existing._id },
    }).lean()
    expect(cancelled?.push_delivery_required).toBe(false)
    expect(cancelled?.push_delivery_cancelled_at).toBeTruthy()
    expect(await NotificationDelivery.countDocuments()).toBe(0)
  })

  test('revalidates tenant eligibility after token lookup before FCM disclosure', async () => {
    const notification = await seedNotification()
    const user = await User.findById(notification.user_id).lean()
    const profile = await AdminProfile.findById(user?.profile_id).lean()
    await DeviceToken.create({
      user_id: notification.user_id, fcm_token: 'suspension-race-token', platform: 'android', is_active: true,
    })
    const provider = jest.fn()
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({ sendEachForMulticast: provider } as any)
    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id), userId: String(notification.user_id),
      title: notification.title, body: notification.message,
    })
    const originalFind = DeviceToken.find.bind(DeviceToken)
    let resume!: () => void
    let reached!: () => void
    const reachedLookup = new Promise<void>(resolve => { reached = resolve })
    const resumeLookup = new Promise<void>(resolve => { resume = resolve })
    jest.spyOn(DeviceToken, 'find').mockImplementation(((...args: any[]) => {
      const query = originalFind(...args)
      const originalLean = query.lean.bind(query)
      query.lean = (async (...leanArgs: any[]) => {
        const rows = await originalLean(...leanArgs)
        reached()
        await resumeLookup
        return rows
      }) as any
      return query
    }) as any)

    const processing = processNotificationDelivery(String(delivery._id))
    await reachedLookup
    await Hospital.updateOne({ _id: profile?.hospital_id }, {
      $set: { status: 'suspended', lifecycle_state: 'SUSPENDING', accepting_assignments: false },
    })
    resume()

    expect((await processing).outcome).toBe('skipped')
    expect(provider).not.toHaveBeenCalled()
    expect((await NotificationDelivery.findById(delivery._id).lean())?.last_error)
      .toBe('skipped:recipient_unavailable')
  })

  test('fail-closes undated legacy scheduled outboxes and adopts only trustworthy due windows', async () => {
    const recipient = await seedNotification()
    const userId = recipient.user_id
    const localToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: config.dosageReminderTimezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())
    const base = {
      user_id: userId, priority: 'HIGH', push_delivery_required: true,
    }
    const [expiredNotification, currentNotification, unknownNotification, impossibleNotification] = await Notification.create([
      { ...base, type: 'DOSAGE_REMINDER', title: 'Old dose', message: 'Old dose', data: { dueWindow: '2020-01-01' } },
      { ...base, type: 'DOSAGE_REMINDER', title: 'Current dose', message: 'Current dose', data: { dueWindow: localToday } },
      { ...base, type: 'INR_REMINDER', title: 'Unknown INR', message: 'Unknown INR' },
      { ...base, type: 'DOSAGE_REMINDER', title: 'Impossible date', message: 'Impossible date', data: { dueWindow: '2026-02-31' } },
    ])
    const makeLegacy = (notification: any) => NotificationDelivery.create({
      notification_id: notification._id, user_id: userId, status: NotificationDeliveryStatus.PENDING,
      attempts: 0, max_attempts: 5, next_attempt_at: new Date(Date.now() - 1_000),
      idempotency_key: buildIdempotencyKey(String(notification._id)),
      title: notification.title, body: notification.message,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })
    const [expired, current, unknown, impossible] = await Promise.all([
      makeLegacy(expiredNotification), makeLegacy(currentNotification), makeLegacy(unknownNotification), makeLegacy(impossibleNotification),
    ])

    await recoverDueDeliveries()
    const [expiredRow, currentRow, unknownRow, impossibleRow] = await Promise.all([
      NotificationDelivery.findById(expired._id).lean(),
      NotificationDelivery.findById(current._id).lean(),
      NotificationDelivery.findById(unknown._id).lean(),
      NotificationDelivery.findById(impossible._id).lean(),
    ])
    expect(expiredRow?.status).toBe(NotificationDeliveryStatus.SKIPPED)
    expect(expiredRow?.last_error).toBe('skipped:expired_notification')
    expect(currentRow?.delivery_valid_until).toBeTruthy()
    expect(currentRow?.delivery_valid_until?.getTime()).toBeGreaterThan(Date.now())
    expect(unknownRow?.status).toBe(NotificationDeliveryStatus.SKIPPED)
    expect(unknownRow?.last_error).toBe('skipped:missing_delivery_validity')
    expect(impossibleRow?.status).toBe(NotificationDeliveryStatus.SKIPPED)
    expect(impossibleRow?.last_error).toBe('skipped:missing_delivery_validity')
  })

  test('delivers nonclinical system announcements to an active tenantless global admin', async () => {
    const profile = await AdminProfile.create({
      name: 'Global Admin', admin_role: 'app_admin', permission: 'FULL_ACCESS',
    })
    const user = await User.create({
      login_id: 'global-notification-admin', password: 'x', salt: 'x', user_type: 'ADMIN',
      user_type_model: 'AdminProfile', profile_id: profile._id, is_active: true,
    })
    const notification = await Notification.create({
      user_id: user._id, type: 'SYSTEM_ANNOUNCEMENT', priority: 'MEDIUM',
      title: 'Maintenance', message: 'A maintenance window is scheduled.', push_delivery_required: true,
    })
    await DeviceToken.create({
      user_id: user._id, fcm_token: 'global-admin-system-token', platform: 'ios', is_active: true,
    })
    const provider = jest.fn(async () => ({
      responses: [{ success: true, messageId: 'global-admin-system-message' }], successCount: 1, failureCount: 0,
    }))
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({ sendEachForMulticast: provider } as any)
    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id), userId: String(user._id),
      title: notification.title, body: notification.message,
    })

    expect((await processNotificationDelivery(String(delivery._id))).outcome).toBe('succeeded')
    expect(provider).toHaveBeenCalledTimes(1)
  })

  test('missing parents and parent type mutation cannot authorize cached outbox payloads', async () => {
    const profile = await AdminProfile.create({ name: 'Global', admin_role: 'app_admin', permission: 'FULL_ACCESS' })
    const user = await User.create({
      login_id: 'immutable-policy-admin', password: 'x', salt: 'x', user_type: 'ADMIN',
      user_type_model: 'AdminProfile', profile_id: profile._id, is_active: true,
    })
    await DeviceToken.create({ user_id: user._id, fcm_token: 'immutable-policy-token', platform: 'ios', is_active: true })
    const provider = jest.fn(async () => ({ responses: [{ success: true, messageId: 'unsafe' }], successCount: 1, failureCount: 0 }))
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({ sendEachForMulticast: provider } as any)

    const clinical = await Notification.create({
      user_id: user._id, type: 'DOCTOR_UPDATE', title: 'Clinical', message: 'Private', push_delivery_required: true,
    })
    const first = await createPushDeliveryOutbox({
      notificationId: String(clinical._id), userId: String(user._id), title: clinical.title, body: clinical.message,
    })
    await Notification.updateOne({ _id: clinical._id }, { $set: { type: 'SYSTEM_ANNOUNCEMENT' } })
    expect((await processNotificationDelivery(String(first.delivery._id))).outcome).toBe('skipped')

    const general = await Notification.create({
      user_id: user._id, type: 'SYSTEM_ANNOUNCEMENT', title: 'General', message: 'Message', push_delivery_required: true,
    })
    const second = await createPushDeliveryOutbox({
      notificationId: String(general._id), userId: String(user._id), title: general.title, body: general.message,
    })
    await Notification.deleteOne({ _id: general._id })
    expect((await processNotificationDelivery(String(second.delivery._id))).outcome).toBe('skipped')
    expect(provider).not.toHaveBeenCalled()
  })

  test('cancellation at the final provider gate prevents a racing FCM disclosure', async () => {
    const notification = await seedNotification()
    await DeviceToken.create({ user_id: notification.user_id, fcm_token: 'cancel-race-token', platform: 'ios', is_active: true })
    const provider = jest.fn()
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({ sendEachForMulticast: provider } as any)
    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id), userId: String(notification.user_id),
      title: notification.title, body: notification.message,
    })
    const originalFindById = Notification.findById.bind(Notification)
    let parentReads = 0
    jest.spyOn(Notification, 'findById').mockImplementation(((...args: any[]) => {
      const query = originalFindById(...args)
      const originalLean = query.lean.bind(query)
      query.lean = (async (...leanArgs: any[]) => {
        parentReads += 1
        if (parentReads === 2) {
          await Notification.updateOne({ _id: notification._id }, {
            $set: { push_delivery_required: false, push_delivery_cancelled_at: new Date() },
          })
        }
        return originalLean(...leanArgs)
      }) as any
      return query
    }) as any)

    expect((await processNotificationDelivery(String(delivery._id))).outcome).toBe('skipped')
    expect(provider).not.toHaveBeenCalled()
  })

  test('provider handoff wins cancellation without falsifying the delivery outcome', async () => {
    const notification = await seedNotification()
    await DeviceToken.create({ user_id: notification.user_id, fcm_token: 'handoff-token', platform: 'ios', is_active: true })
    let providerEntered!: () => void
    let releaseProvider!: () => void
    const entered = new Promise<void>(resolve => { providerEntered = resolve })
    const blocked = new Promise<void>(resolve => { releaseProvider = resolve })
    const provider = jest.fn(async () => {
      providerEntered()
      await blocked
      return { responses: [{ success: true, messageId: 'handoff-message' }], successCount: 1, failureCount: 0 }
    })
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({ sendEachForMulticast: provider } as any)
    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id), userId: String(notification.user_id),
      title: 'untrusted caller title', body: 'untrusted caller body',
    })

    const processing = processNotificationDelivery(String(delivery._id))
    await entered
    await cancelNotificationPush(String(notification._id), 'race_after_provider_handoff')
    expect((await NotificationDelivery.findById(delivery._id).lean())?.status)
      .toBe(NotificationDeliveryStatus.PROCESSING)
    releaseProvider()

    expect((await processing).outcome).toBe('succeeded')
    expect((await NotificationDelivery.findById(delivery._id).lean())?.status)
      .toBe(NotificationDeliveryStatus.SUCCEEDED)
    expect(provider).toHaveBeenCalledTimes(1)
  })

  test('recovery cannot overwrite a live provider handoff after its deadline crosses', async () => {
    const notification = await seedNotification()
    const deadline = new Date(Date.now() + 60_000)
    await Notification.updateOne({ _id: notification._id }, { $set: { delivery_valid_until: deadline } })
    await DeviceToken.create({ user_id: notification.user_id, fcm_token: 'deadline-handoff-token', platform: 'ios', is_active: true })
    let providerEntered!: () => void
    let releaseProvider!: () => void
    const entered = new Promise<void>(resolve => { providerEntered = resolve })
    const blocked = new Promise<void>(resolve => { releaseProvider = resolve })
    const provider = jest.fn(async () => {
      providerEntered()
      await blocked
      return { responses: [{ success: true, messageId: 'deadline-handoff-message' }], successCount: 1, failureCount: 0 }
    })
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({ sendEachForMulticast: provider } as any)
    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id), userId: String(notification.user_id),
      title: notification.title, body: notification.message,
    })

    const processing = processNotificationDelivery(String(delivery._id))
    await entered
    await NotificationDelivery.updateOne({ _id: delivery._id }, {
      $set: { delivery_valid_until: new Date(Date.now() - 1_000) },
    })
    await recoverDueDeliveries()
    const duringSend = await NotificationDelivery.findById(delivery._id).lean()
    expect(duringSend?.status).toBe(NotificationDeliveryStatus.PROCESSING)
    expect(duringSend?.provider_handoff_at).toBeTruthy()
    releaseProvider()

    expect((await processing).outcome).toBe('succeeded')
    expect((await NotificationDelivery.findById(delivery._id).lean())?.status)
      .toBe(NotificationDeliveryStatus.SUCCEEDED)
  })

  test('provider exception after handoff is terminal unknown outcome and is never retried', async () => {
    const notification = await seedNotification()
    await DeviceToken.create({ user_id: notification.user_id, fcm_token: 'unknown-outcome-token', platform: 'ios', is_active: true })
    const provider = jest.fn(async () => { throw new Error('provider timeout after request write') })
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({ sendEachForMulticast: provider } as any)
    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id), userId: String(notification.user_id),
      title: notification.title, body: notification.message,
    })

    expect((await processNotificationDelivery(String(delivery._id))).outcome).toBe('dead_letter')
    const terminal = await NotificationDelivery.findById(delivery._id).lean()
    expect(terminal?.status).toBe(NotificationDeliveryStatus.DEAD_LETTER)
    expect(terminal?.last_error).toMatch(/provider_outcome_unknown_after_handoff/)
    expect(await recoverDueDeliveries()).toBe(0)
    expect(provider).toHaveBeenCalledTimes(1)
  })

  test('post-handoff exception preserves prior partial evidence without retry', async () => {
    const notification = await seedNotification()
    const [prior, remaining] = await DeviceToken.create([
      { user_id: notification.user_id, fcm_token: 'prior-accepted-token', platform: 'ios', is_active: true },
      { user_id: notification.user_id, fcm_token: 'remaining-unknown-token', platform: 'android', is_active: true },
    ])
    const provider = jest.fn(async () => { throw new Error('provider response lost') })
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({ sendEachForMulticast: provider } as any)
    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id), userId: String(notification.user_id),
      title: notification.title, body: notification.message,
    })
    await NotificationDelivery.updateOne({ _id: delivery._id }, {
      $addToSet: { delivered_device_token_ids: prior._id },
    })

    expect((await processNotificationDelivery(String(delivery._id))).outcome).toBe('succeeded')
    const terminal = await NotificationDelivery.findById(delivery._id).lean()
    expect(terminal?.status).toBe(NotificationDeliveryStatus.SUCCEEDED)
    expect(terminal?.last_error).toMatch(/provider_outcome_unknown_after_handoff/)
    expect(terminal?.delivered_device_token_ids?.map(String)).toContain(String(prior._id))
    expect(terminal?.delivered_device_token_ids?.map(String)).not.toContain(String(remaining._id))
    expect(provider).toHaveBeenCalledTimes(1)
  })

  test('outbox content is copied only from the durable parent notification', async () => {
    const notification = await seedNotification()
    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id), userId: String(notification.user_id),
      title: 'Injected title', body: 'Injected body', data: { change_type: 'INJECTED' },
    })
    const persisted = await NotificationDelivery.findById(delivery._id).lean()
    expect(persisted?.title).toBe(notification.title)
    expect(persisted?.body).toBe(notification.message)
    expect(Object.fromEntries((persisted?.data as any)?.entries?.() ?? Object.entries(persisted?.data ?? {})))
      .toEqual({ change_type: 'DOSAGE_UPDATED' })
  })

  test('review reminders remain deliverable after the first lead-window midnight', async () => {
    const actualNow = new Date()
    const schedulerNow = new Date(actualNow.getTime() - 36 * 60 * 60 * 1000)
    const reviewDate = new Date(actualNow.getTime() + 36 * 60 * 60 * 1000)
    const hospital = await Hospital.create({
      code: 'REVIEW_VALIDITY', name: 'Review Validity', location: 'Test',
      admin_email: 'review-validity@example.com',
    })
    const profile = await PatientProfile.create({
      demographics: { name: 'Review Patient' }, hospital_id: hospital._id,
      medical_config: { next_review_date: reviewDate },
      inr_history: [{ inr_value: 2.5, test_date: actualNow }], weekly_dosage: {}, account_status: 'Active',
    })
    const user = await User.create({
      login_id: 'review-validity-patient', password: 'x', salt: 'x', user_type: 'PATIENT',
      user_type_model: 'PatientProfile', profile_id: profile._id, is_active: true,
    })
    await DeviceToken.create({ user_id: user._id, fcm_token: 'review-validity-token', platform: 'ios', is_active: true })
    const provider = jest.fn(async () => ({
      responses: [{ success: true, messageId: 'review-validity-message' }], successCount: 1, failureCount: 0,
    }))
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({ sendEachForMulticast: provider } as any)

    await runClinicalReminderPass(schedulerNow)
    const notification = await Notification.findOne({ user_id: user._id, type: 'APPOINTMENT_REMINDER' }).lean()
    const delivery = await NotificationDelivery.findOne({ notification_id: notification?._id }).lean()
    expect(delivery?.delivery_valid_until?.getTime()).toBeGreaterThan(actualNow.getTime())
    expect((await processNotificationDelivery(String(delivery?._id))).outcome).toBe('succeeded')
    expect(provider).toHaveBeenCalledTimes(1)
  })

  test('clinical reminder pass creates INR, review, and patient/doctor missed-dose reminders once', async () => {
    const now = new Date('2026-07-13T09:00:00.000Z')
    const hospital = await Hospital.create({ code: 'CLINICAL', name: 'Clinical', location: 'Test', admin_email: 'clinical@example.com' })
    const doctorProfile = await DoctorProfile.create({ name: 'Clinical Doctor', hospital_id: hospital._id })
    const doctorProfileId = doctorProfile._id
    const doctorUserId = new mongoose.Types.ObjectId()
    const profile = await PatientProfile.create({
      demographics: { name: 'Escalation Patient' },
      assigned_doctor_id: doctorUserId,
      hospital_id: hospital._id,
      medical_config: {
        therapy_start_date: new Date('2026-05-01T00:00:00.000Z'),
        next_review_date: new Date('2026-07-15T00:00:00.000Z'),
        taken_doses: [],
      },
      weekly_dosage: { monday: 5, tuesday: 5, wednesday: 5, thursday: 5, friday: 5, saturday: 5, sunday: 5 },
      account_status: 'Active',
    })
    const patientUserId = new mongoose.Types.ObjectId()
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

  test('clinical reminder pass supports legacy doctor profile IDs during migration', async () => {
    const now = new Date('2026-07-13T09:00:00.000Z')
    const hospital = await Hospital.create({ code: 'LEGACY', name: 'Legacy', location: 'Test', admin_email: 'legacy@example.com' })
    const doctorProfile = await DoctorProfile.create({ name: 'Legacy Doctor', hospital_id: hospital._id })
    const doctorProfileId = doctorProfile._id
    const doctorUserId = new mongoose.Types.ObjectId()
    const profile = await PatientProfile.create({
      demographics: { name: 'Legacy Assignment Patient' },
      assigned_doctor_id: doctorProfileId,
      hospital_id: hospital._id,
      medical_config: { taken_doses: [] },
      weekly_dosage: { saturday: 5, sunday: 5 },
      account_status: 'Active',
    })
    const patientUserId = new mongoose.Types.ObjectId()
    await User.collection.insertMany([
      { _id: patientUserId, login_id: 'legacy-clinical-patient', password: 'x', salt: 'x', user_type: 'PATIENT', user_type_model: 'PatientProfile', profile_id: profile._id, is_active: true },
      { _id: doctorUserId, login_id: 'legacy-clinical-doctor', password: 'x', salt: 'x', user_type: 'DOCTOR', user_type_model: 'DoctorProfile', profile_id: doctorProfileId, is_active: true },
    ] as any)

    const result = await runClinicalReminderPass(now)

    expect(result).toEqual({ created: 2, skipped: 0, failed: 0 })
    expect(await Notification.countDocuments({ user_id: patientUserId, type: 'CRITICAL_ALERT' })).toBe(1)
    expect(await Notification.countDocuments({ user_id: doctorUserId, type: 'CRITICAL_ALERT' })).toBe(1)
  })

  test('missed-dose escalation never crosses hospital boundaries from a corrupt assignment', async () => {
    const now = new Date('2026-07-13T09:00:00.000Z')
    const [patientHospital, doctorHospital] = await Hospital.create([
      { code: 'PATIENT_TENANT', name: 'Patient Tenant', location: 'Test', admin_email: 'patient-tenant@example.com' },
      { code: 'DOCTOR_TENANT', name: 'Doctor Tenant', location: 'Test', admin_email: 'doctor-tenant@example.com' },
    ])
    const doctorProfile = await DoctorProfile.create({ name: 'Wrong Tenant Doctor', hospital_id: doctorHospital._id })
    const doctorUserId = new mongoose.Types.ObjectId()
    const patientProfile = await PatientProfile.create({
      demographics: { name: 'Private Patient' },
      assigned_doctor_id: doctorUserId,
      hospital_id: patientHospital._id,
      medical_config: { taken_doses: [] },
      weekly_dosage: { saturday: 5, sunday: 5 },
      account_status: 'Active',
    })
    const patientUserId = new mongoose.Types.ObjectId()
    await User.collection.insertMany([
      { _id: patientUserId, login_id: 'private-patient', password: 'x', salt: 'x', user_type: 'PATIENT', user_type_model: 'PatientProfile', profile_id: patientProfile._id, is_active: true },
      { _id: doctorUserId, login_id: 'wrong-tenant-doctor', password: 'x', salt: 'x', user_type: 'DOCTOR', user_type_model: 'DoctorProfile', profile_id: doctorProfile._id, is_active: true },
    ] as any)

    const result = await runClinicalReminderPass(now)

    expect(result).toEqual({ created: 1, skipped: 0, failed: 0 })
    expect(await Notification.countDocuments({ user_id: patientUserId, type: 'CRITICAL_ALERT' })).toBe(1)
    expect(await Notification.countDocuments({ user_id: doctorUserId })).toBe(0)
  })

  test('missed-dose escalation never discloses to a doctor without proven tenant context', async () => {
    const now = new Date('2026-07-13T09:00:00.000Z')
    const hospital = await Hospital.create({
      code: 'PATIENT_ONLY_TENANT',
      name: 'Patient Only Tenant',
      location: 'Test',
      admin_email: 'patient-only-tenant@example.com',
    })
    const tenantlessDoctorProfile = await DoctorProfile.create({ name: 'Tenantless Doctor' })
    const tenantlessDoctorUserId = new mongoose.Types.ObjectId()
    await User.collection.insertOne({
      _id: tenantlessDoctorUserId,
      login_id: 'tenantless-reminder-doctor',
      password: 'x',
      salt: 'x',
      user_type: 'DOCTOR',
      user_type_model: 'DoctorProfile',
      profile_id: tenantlessDoctorProfile._id,
      is_active: true,
    } as any)

    const patients = await PatientProfile.create([
      {
        demographics: { name: 'Tenantless Patient' },
        assigned_doctor_id: tenantlessDoctorUserId,
        medical_config: { taken_doses: [] },
        weekly_dosage: { saturday: 5, sunday: 5 },
        account_status: 'Active',
      },
      {
        demographics: { name: 'Tenant Patient Missing Doctor Tenant' },
        assigned_doctor_id: tenantlessDoctorUserId,
        hospital_id: hospital._id,
        medical_config: { taken_doses: [] },
        weekly_dosage: { saturday: 5, sunday: 5 },
        account_status: 'Active',
      },
    ])
    const patientUserIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()]
    await User.collection.insertMany(patients.map((profile, index) => ({
      _id: patientUserIds[index],
      login_id: `tenant-context-patient-${index}`,
      password: 'x',
      salt: 'x',
      user_type: 'PATIENT',
      user_type_model: 'PatientProfile',
      profile_id: profile._id,
      is_active: true,
    })) as any)

    await runClinicalReminderPass(now)

    expect(await Notification.countDocuments({ user_id: tenantlessDoctorUserId })).toBe(0)
    // The tenantless patient is now also fail-closed; only the proven active
    // tenant patient receives their own clinical reminder.
    expect(await Notification.countDocuments({ user_id: { $in: patientUserIds }, type: 'CRITICAL_ALERT' })).toBe(1)
    expect(await NotificationDelivery.countDocuments({ user_id: tenantlessDoctorUserId })).toBe(0)
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
    expect(updated?.delivered_device_token_ids?.map(String)).toContain(
      String((await DeviceToken.findOne({ user_id: notification.user_id }).lean())?._id)
    )
    expect(updated?.attempts).toBe(1)
    expect(updated?.completed_at).toBeTruthy()
    expect(getDeliveryMetrics().succeeded).toBe(1)
  })

  test('reports a stale lease when recovery reassigns a delivery before its result is persisted', async () => {
    const notification = await seedNotification()
    await DeviceToken.create({
      user_id: notification.user_id,
      fcm_token: 'stale-lease-token',
      platform: 'android',
      is_active: true,
    })

    let releaseSend: (() => void) | undefined
    let signalSendStarted: (() => void) | undefined
    const sendStarted = new Promise<void>(resolve => { signalSendStarted = resolve })
    const sendRelease = new Promise<void>(resolve => { releaseSend = resolve })
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({
      sendEachForMulticast: jest.fn(async () => {
        signalSendStarted?.()
        await sendRelease
        return {
          responses: [{ success: true, messageId: 'stale-lease-message' }],
          successCount: 1,
          failureCount: 0,
        }
      }),
    } as any)

    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id),
      userId: String(notification.user_id),
      title: notification.title,
      body: notification.message,
    })

    const processing = processNotificationDelivery(String(delivery._id))
    await sendStarted
    await NotificationDelivery.updateOne(
      { _id: delivery._id },
      { $set: { processing_lease_id: 'reclaimed-by-recovery' } }
    )
    releaseSend?.()

    expect((await processing).outcome).toBe('stale_lease')
    const row = await NotificationDelivery.findById(delivery._id).lean()
    expect(row?.status).toBe(NotificationDeliveryStatus.PROCESSING)
    expect(row?.processing_lease_id).toBe('reclaimed-by-recovery')
    expect(getDeliveryMetrics().succeeded).toBe(0)
    expect(getDeliveryMetrics().stale_lease).toBe(1)
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

  test('partial retry sends only to devices that have not already succeeded', async () => {
    const notification = await seedNotification()
    const firstDevice = await DeviceToken.create({
      user_id: notification.user_id,
      fcm_token: 'already-delivered-token',
      platform: 'android',
      is_active: true,
    })
    await DeviceToken.create({
      user_id: notification.user_id,
      fcm_token: 'retry-only-token',
      platform: 'ios',
      is_active: true,
    })

    const send = jest
      .fn()
      .mockResolvedValueOnce({
        responses: [
          { success: true, messageId: 'partial-success' },
          { success: false, error: { code: 'messaging/server-unavailable', message: 'retry' } },
        ],
        successCount: 1,
        failureCount: 1,
      })
      .mockResolvedValueOnce({
        responses: [{ success: true, messageId: 'retry-success' }],
        successCount: 1,
        failureCount: 0,
      })
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({ sendEachForMulticast: send } as any)

    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id),
      userId: String(notification.user_id),
      title: notification.title,
      body: notification.message,
    })

    expect((await processNotificationDelivery(String(delivery._id))).outcome).toBe('retryable')
    let row = await NotificationDelivery.findById(delivery._id).lean()
    expect(row?.delivered_device_token_ids?.map(String)).toContain(String(firstDevice._id))
    await NotificationDelivery.updateOne(
      { _id: delivery._id },
      { $set: { next_attempt_at: new Date(Date.now() - 1000) } },
    )

    expect((await processNotificationDelivery(String(delivery._id))).outcome).toBe('succeeded')
    expect(send).toHaveBeenNthCalledWith(1, expect.objectContaining({
      tokens: ['already-delivered-token', 'retry-only-token'],
    }))
    expect(send).toHaveBeenNthCalledWith(2, expect.objectContaining({
      tokens: ['retry-only-token'],
    }))
  })

  test('records success when prior devices received a push and remaining tokens disappear', async () => {
    const notification = await seedNotification()
    const firstDevice = await DeviceToken.create({
      user_id: notification.user_id,
      fcm_token: 'partial-delivered-token',
      platform: 'android',
      is_active: true,
    })
    const secondDevice = await DeviceToken.create({
      user_id: notification.user_id,
      fcm_token: 'partial-remaining-token',
      platform: 'ios',
      is_active: true,
    })
    const send = jest.fn().mockResolvedValueOnce({
      responses: [
        { success: true, messageId: 'partial-success' },
        { success: false, error: { code: 'messaging/server-unavailable', message: 'retry' } },
      ],
      successCount: 1,
      failureCount: 1,
    })
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({ sendEachForMulticast: send } as any)
    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id), userId: String(notification.user_id),
      title: notification.title, body: notification.message,
    })

    expect((await processNotificationDelivery(String(delivery._id))).outcome).toBe('retryable')
    await Promise.all([
      DeviceToken.updateOne({ _id: secondDevice._id }, { $set: { is_active: false } }),
      NotificationDelivery.updateOne(
        { _id: delivery._id },
        { $set: { next_attempt_at: new Date(Date.now() - 1_000) } },
      ),
    ])

    expect((await processNotificationDelivery(String(delivery._id))).outcome).toBe('succeeded')
    const row = await NotificationDelivery.findById(delivery._id).lean()
    expect(row?.status).toBe(NotificationDeliveryStatus.SUCCEEDED)
    expect(row?.delivered_device_token_ids?.map(String)).toContain(String(firstDevice._id))
    expect(send).toHaveBeenCalledTimes(1)
  })

  test('notification kill switch pauses queued delivery and suppresses doctor updates', async () => {
    const notification = await seedNotification()
    await DeviceToken.create({
      user_id: notification.user_id,
      fcm_token: 'paused-token',
      platform: 'android',
      is_active: true,
    })
    const send = jest.fn()
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({ sendEachForMulticast: send } as any)
    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id), userId: String(notification.user_id),
      title: notification.title, body: notification.message,
    })

    await updateSystemConfig({ feature_flags: { notifications_enabled: false } })
    expect((await processNotificationDelivery(String(delivery._id))).outcome).toBe('paused')
    expect((await NotificationDelivery.findById(delivery._id).lean())?.attempts).toBe(0)
    expect(send).not.toHaveBeenCalled()

    const countBefore = await Notification.countDocuments()
    await expect(createDoctorUpdateNotification({
      patientUserId: notification.user_id,
      changedByDoctorId: new mongoose.Types.ObjectId(),
      changeType: 'DOSAGE_UPDATED',
      title: 'Must not publish',
      message: 'Must not publish',
    })).resolves.toBeNull()
    expect(await Notification.countDocuments()).toBe(countBefore)
  })

  test('clinical SSE rechecks the kill switch after awaited eligibility reads', async () => {
    const notification = await seedNotification()
    const writes: string[] = []
    const response = {
      setHeader: jest.fn(), flushHeaders: jest.fn(), writableEnded: false, destroyed: false,
      write: jest.fn((value: string) => { writes.push(value); return true }),
      on: jest.fn(),
    } as any
    const registered = realtimeNotifications.registerUserNotificationStream(String(notification.user_id), response)
    expect(registered.ok).toBe(true)
    const cleanup = registered.ok ? registered.cleanup : () => undefined
    writes.length = 0

    const originalFindById = User.findById.bind(User)
    let resume!: () => void
    let reached!: () => void
    const blocked = new Promise<void>(resolve => { resume = resolve })
    const entered = new Promise<void>(resolve => { reached = resolve })
    const spy = jest.spyOn(User, 'findById').mockImplementation(((...args: any[]) => {
      const query = originalFindById(...args)
      const originalLean = query.lean.bind(query)
      query.lean = (async (...leanArgs: any[]) => {
        const value = await originalLean(...leanArgs)
        reached()
        await blocked
        return value
      }) as any
      return query
    }) as any)
    try {
      const publishing = realtimeNotifications.publishClinicalNotificationToUser(
        String(notification.user_id), 'notification', { title: 'Private update' },
      )
      await entered
      await updateSystemConfig({ feature_flags: { notifications_enabled: false } })
      resume()

      await expect(publishing).resolves.toBe(false)
      expect(writes).toEqual([])
    } finally {
      resume?.()
      spy.mockRestore()
      cleanup()
    }
  })

  test('general SSE revalidates recipient activity while preserving tenantless app admins', async () => {
    const profile = await AdminProfile.create({ name: 'Tenantless SSE Admin', admin_role: 'app_admin', permission: 'FULL_ACCESS' })
    const user = await User.create({
      login_id: 'tenantless-sse-admin', password: 'x', salt: 'x', user_type: 'ADMIN',
      user_type_model: 'AdminProfile', profile_id: profile._id, is_active: true,
    })
    const writes: string[] = []
    const response = {
      setHeader: jest.fn(), flushHeaders: jest.fn(), writableEnded: false, destroyed: false,
      write: jest.fn((value: string) => { writes.push(value); return true }), on: jest.fn(),
    } as any
    const registered = realtimeNotifications.registerUserNotificationStream(String(user._id), response)
    expect(registered.ok).toBe(true)
    const cleanup = registered.ok ? registered.cleanup : () => undefined
    writes.length = 0
    try {
      await expect(realtimeNotifications.publishGeneralNotificationToUser(
        String(user._id), 'notification', { title: 'Allowed general event' },
      )).resolves.toBe(true)
      expect(writes.join('')).toContain('Allowed general event')

      writes.length = 0
      await User.updateOne({ _id: user._id }, { $set: { is_active: false } })
      await expect(realtimeNotifications.publishGeneralNotificationToUser(
        String(user._id), 'notification', { title: 'Blocked event' },
      )).resolves.toBe(false)
      expect(writes).toEqual([])
    } finally {
      cleanup()
    }
  })

  test('refunds the claimed attempt when notifications are disabled during recipient lookup', async () => {
    const notification = await seedNotification()
    await DeviceToken.create({
      user_id: notification.user_id, fcm_token: 'mid-claim-pause-token', platform: 'android', is_active: true,
    })
    const send = jest.fn()
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({ sendEachForMulticast: send } as any)
    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id), userId: String(notification.user_id),
      title: notification.title, body: notification.message,
    })

    const originalFindById = User.findById.bind(User)
    let resume!: () => void
    let reached!: () => void
    const reachedLookup = new Promise<void>(resolve => { reached = resolve })
    const resumeLookup = new Promise<void>(resolve => { resume = resolve })
    const spy = jest.spyOn(User, 'findById').mockImplementation(((...args: any[]) => {
      const query = originalFindById(...args)
      const originalLean = query.lean.bind(query)
      query.lean = (async (...leanArgs: any[]) => {
        reached()
        await resumeLookup
        return originalLean(...leanArgs)
      }) as any
      return query
    }) as any)
    try {
      const processing = processNotificationDelivery(String(delivery._id))
      await reachedLookup
      await updateSystemConfig({ feature_flags: { notifications_enabled: false } })
      resume()
      expect((await processing).outcome).toBe('paused')
      const row = await NotificationDelivery.findById(delivery._id).lean()
      expect(row?.status).toBe(NotificationDeliveryStatus.PENDING)
      expect(row?.attempts).toBe(0)
      expect(send).not.toHaveBeenCalled()
    } finally {
      resume?.()
      spy.mockRestore()
    }
  })

  test('rechecks the kill switch after device lookup immediately before FCM disclosure', async () => {
    const notification = await seedNotification()
    await DeviceToken.create({
      user_id: notification.user_id,
      fcm_token: 'provider-boundary-pause-token',
      platform: 'android',
      is_active: true,
    })
    const send = jest.fn()
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({ sendEachForMulticast: send } as any)
    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id),
      userId: String(notification.user_id),
      title: notification.title,
      body: notification.message,
    })

    const originalFind = DeviceToken.find.bind(DeviceToken)
    let resume!: () => void
    let reached!: () => void
    const reachedLookup = new Promise<void>(resolve => { reached = resolve })
    const resumeLookup = new Promise<void>(resolve => { resume = resolve })
    const spy = jest.spyOn(DeviceToken, 'find').mockImplementation(((...args: any[]) => {
      const query = originalFind(...args)
      const originalLean = query.lean.bind(query)
      query.lean = (async (...leanArgs: any[]) => {
        const rows = await originalLean(...leanArgs)
        reached()
        await resumeLookup
        return rows
      }) as any
      return query
    }) as any)
    try {
      const processing = processNotificationDelivery(String(delivery._id))
      await reachedLookup
      await updateSystemConfig({ feature_flags: { notifications_enabled: false } })
      resume()

      expect((await processing).outcome).toBe('paused')
      const row = await NotificationDelivery.findById(delivery._id).lean()
      expect(row?.status).toBe(NotificationDeliveryStatus.PENDING)
      expect(row?.attempts).toBe(0)
      expect(send).not.toHaveBeenCalled()
    } finally {
      resume?.()
      spy.mockRestore()
    }
  })

  test('refunds the attempt when notifications pause during an empty device lookup', async () => {
    const notification = await seedNotification()
    const send = jest.fn()
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({ sendEachForMulticast: send } as any)
    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id),
      userId: String(notification.user_id),
      title: notification.title,
      body: notification.message,
    })

    const originalFind = DeviceToken.find.bind(DeviceToken)
    let resume!: () => void
    let reached!: () => void
    const reachedLookup = new Promise<void>(resolve => { reached = resolve })
    const resumeLookup = new Promise<void>(resolve => { resume = resolve })
    const spy = jest.spyOn(DeviceToken, 'find').mockImplementation(((...args: any[]) => {
      const query = originalFind(...args)
      const originalLean = query.lean.bind(query)
      query.lean = (async (...leanArgs: any[]) => {
        const rows = await originalLean(...leanArgs)
        reached()
        await resumeLookup
        return rows
      }) as any
      return query
    }) as any)
    try {
      const processing = processNotificationDelivery(String(delivery._id))
      await reachedLookup
      await updateSystemConfig({ feature_flags: { notifications_enabled: false } })
      resume()

      expect((await processing).outcome).toBe('paused')
      const row = await NotificationDelivery.findById(delivery._id).lean()
      expect(row?.status).toBe(NotificationDeliveryStatus.PENDING)
      expect(row?.attempts).toBe(0)
      expect(send).not.toHaveBeenCalled()
    } finally {
      resume?.()
      spy.mockRestore()
    }
  })

  test('records success when a prior partial delivery is followed by recipient deactivation', async () => {
    const notification = await seedNotification()
    const deliveredDevice = await DeviceToken.create({
      user_id: notification.user_id, fcm_token: 'prior-recipient-token', platform: 'android', is_active: true,
    })
    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id), userId: String(notification.user_id),
      title: notification.title, body: notification.message,
    })
    await Promise.all([
      NotificationDelivery.updateOne({ _id: delivery._id }, {
        $set: { delivered_device_token_ids: [deliveredDevice._id] },
      }),
      User.updateOne({ _id: notification.user_id }, { $set: { is_active: false } }),
    ])
    expect((await processNotificationDelivery(String(delivery._id))).outcome).toBe('succeeded')
    expect((await NotificationDelivery.findById(delivery._id).lean())?.status).toBe(NotificationDeliveryStatus.SUCCEEDED)
  })

  test('terminalizes final-attempt partial provider success accurately', async () => {
    ;(config as any).notificationDeliveryMaxAttempts = 1
    const notification = await seedNotification()
    const first = await DeviceToken.create({
      user_id: notification.user_id, fcm_token: 'final-partial-a', platform: 'android', is_active: true,
    })
    await DeviceToken.create({
      user_id: notification.user_id, fcm_token: 'final-partial-b', platform: 'ios', is_active: true,
    })
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({
      sendEachForMulticast: jest.fn().mockResolvedValue({
        responses: [
          { success: true, messageId: 'final-partial-success' },
          { success: false, error: { code: 'messaging/server-unavailable', message: 'retry exhausted' } },
        ],
        successCount: 1,
        failureCount: 1,
      }),
    } as any)
    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id), userId: String(notification.user_id),
      title: notification.title, body: notification.message,
    })
    expect((await processNotificationDelivery(String(delivery._id))).outcome).toBe('succeeded')
    const row = await NotificationDelivery.findById(delivery._id).lean()
    expect(row?.status).toBe(NotificationDeliveryStatus.SUCCEEDED)
    expect(row?.delivered_device_token_ids?.map(String)).toContain(String(first._id))
    expect(row?.last_error).toMatch(/partially_delivered/i)
  })

  test('records prior partial delivery as success when the final provider call throws', async () => {
    ;(config as any).notificationDeliveryMaxAttempts = 1
    const notification = await seedNotification()
    const delivered = await DeviceToken.create({
      user_id: notification.user_id,
      fcm_token: 'prior-throw-delivered',
      platform: 'android',
      is_active: false,
    })
    await DeviceToken.create({
      user_id: notification.user_id,
      fcm_token: 'final-throw-token',
      platform: 'ios',
      is_active: true,
    })
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({
      sendEachForMulticast: jest.fn().mockRejectedValue(new Error('provider unavailable')),
    } as any)
    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id),
      userId: String(notification.user_id),
      title: notification.title,
      body: notification.message,
    })
    await NotificationDelivery.updateOne(
      { _id: delivery._id },
      { $set: { delivered_device_token_ids: [delivered._id] } },
    )

    expect((await processNotificationDelivery(String(delivery._id))).outcome).toBe('succeeded')
    const row = await NotificationDelivery.findById(delivery._id).lean()
    expect(row?.status).toBe(NotificationDeliveryStatus.SUCCEEDED)
    expect(row?.last_error).toMatch(/partially_delivered:provider_outcome_unknown_after_handoff:provider unavailable/)
  })

  test('persists successful device evidence when other device failures are permanent', async () => {
    const notification = await seedNotification()
    const accepted = await DeviceToken.create({
      user_id: notification.user_id,
      fcm_token: 'accepted-permanent-mix',
      platform: 'android',
      is_active: true,
    })
    await DeviceToken.create({
      user_id: notification.user_id,
      fcm_token: 'invalid-permanent-mix',
      platform: 'ios',
      is_active: true,
    })
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({
      sendEachForMulticast: jest.fn().mockResolvedValue({
        responses: [
          { success: true, messageId: 'accepted-message' },
          { success: false, error: { code: 'messaging/registration-token-not-registered' } },
        ],
        successCount: 1,
        failureCount: 1,
      }),
    } as any)
    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id),
      userId: String(notification.user_id),
      title: notification.title,
      body: notification.message,
    })

    expect((await processNotificationDelivery(String(delivery._id))).outcome).toBe('succeeded')
    const row = await NotificationDelivery.findById(delivery._id).lean()
    expect(row?.delivered_device_token_ids?.map(String)).toContain(String(accepted._id))
    expect(row?.last_error).toBe('partially_delivered:permanent_failures:1')
  })

  test('records all-permanent zero-acceptance as terminal non-delivery', async () => {
    const notification = await seedNotification()
    await DeviceToken.create({
      user_id: notification.user_id,
      fcm_token: 'all-invalid-token',
      platform: 'android',
      is_active: true,
    })
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({
      sendEachForMulticast: jest.fn().mockResolvedValue({
        responses: [{
          success: false,
          error: { code: 'messaging/registration-token-not-registered' },
        }],
        successCount: 0,
        failureCount: 1,
      }),
    } as any)
    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id),
      userId: String(notification.user_id),
      title: notification.title,
      body: notification.message,
    })

    expect((await processNotificationDelivery(String(delivery._id))).outcome).toBe('skipped')
    const row = await NotificationDelivery.findById(delivery._id).lean()
    expect(row?.status).toBe(NotificationDeliveryStatus.SKIPPED)
    expect(row?.last_error).toBe('skipped:permanent_token_failures')
    expect(row?.delivered_device_token_ids).toHaveLength(0)
  })

  test('preserves accepted-device evidence when invalid-token cleanup fails', async () => {
    const notification = await seedNotification()
    const accepted = await DeviceToken.create({
      user_id: notification.user_id,
      fcm_token: 'cleanup-failure-accepted',
      platform: 'android',
      is_active: true,
    })
    await DeviceToken.create({
      user_id: notification.user_id,
      fcm_token: 'cleanup-failure-invalid',
      platform: 'ios',
      is_active: true,
    })
    await DeviceToken.create({
      user_id: notification.user_id,
      fcm_token: 'cleanup-failure-transient',
      platform: 'web',
      is_active: true,
    })
    const send = jest.fn()
      .mockResolvedValueOnce({
        responses: [
          { success: true, messageId: 'cleanup-accepted-message' },
          { success: false, error: { code: 'messaging/registration-token-not-registered' } },
          { success: false, error: { code: 'messaging/server-unavailable' } },
        ],
        successCount: 1,
        failureCount: 2,
      })
      .mockResolvedValueOnce({
        responses: [
          { success: false, error: { code: 'messaging/registration-token-not-registered' } },
          { success: true, messageId: 'cleanup-retry-message' },
        ],
        successCount: 1,
        failureCount: 1,
      })
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({ sendEachForMulticast: send } as any)
    const cleanup = jest.spyOn(DeviceToken, 'updateOne').mockImplementation(((filter: any, ...args: any[]) => {
      if (filter?.fcm_token === 'cleanup-failure-invalid') {
        return Promise.reject(new Error('database cleanup unavailable'))
      }
      return (DeviceToken.collection as any).updateOne(filter, ...args)
    }) as any)
    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id),
      userId: String(notification.user_id),
      title: notification.title,
      body: notification.message,
    })

    try {
      expect((await processNotificationDelivery(String(delivery._id))).outcome).toBe('retryable')
      let row = await NotificationDelivery.findById(delivery._id).lean()
      expect(row?.delivered_device_token_ids?.map(String)).toContain(String(accepted._id))

      await NotificationDelivery.updateOne(
        { _id: delivery._id },
        { $set: { next_attempt_at: new Date(0) } },
      )
      expect((await processNotificationDelivery(String(delivery._id))).outcome).toBe('succeeded')
      row = await NotificationDelivery.findById(delivery._id).lean()
      expect(row?.status).toBe(NotificationDeliveryStatus.SUCCEEDED)
      expect(row?.delivered_device_token_ids?.map(String)).toContain(String(accepted._id))
      expect(send.mock.calls[1][0].tokens).not.toContain('cleanup-failure-accepted')
    } finally {
      cleanup.mockRestore()
    }
  })

  test('paused recovery performs no notification or delivery scan', async () => {
    await updateSystemConfig({ feature_flags: { notifications_enabled: false } })
    const notificationFind = jest.spyOn(Notification, 'find')
    const deliveryFind = jest.spyOn(NotificationDelivery, 'find')
    expect(await reconcileMissingPushOutboxes()).toBe(0)
    expect(await recoverDueDeliveries()).toBe(0)
    expect(notificationFind).not.toHaveBeenCalled()
    expect(deliveryFind).not.toHaveBeenCalled()
  })

  test('does not deliver a queued notification after the recipient is deactivated', async () => {
    const notification = await seedNotification()
    await User.updateOne({ _id: notification.user_id }, { $set: { is_active: false } })
    await DeviceToken.create({
      user_id: notification.user_id,
      fcm_token: 'inactive-recipient-token',
      platform: 'android',
      is_active: true,
    })
    const send = jest.fn()
    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({ sendEachForMulticast: send } as any)
    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id),
      userId: String(notification.user_id),
      title: notification.title,
      body: notification.message,
    })

    expect((await processNotificationDelivery(String(delivery._id))).outcome).toBe('skipped')
    expect(send).not.toHaveBeenCalled()
    const row = await NotificationDelivery.findById(delivery._id).lean()
    expect(row?.last_error).toBe('skipped:recipient_inactive_or_unavailable')
  })

  test('invalid tokens are disabled only for the current token owner', async () => {
    const ownerA = new mongoose.Types.ObjectId()
    const ownerB = new mongoose.Types.ObjectId()
    await seedNotification(ownerA)

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

    expect(result.success).toBe(false)
    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe('permanent_token_failures')
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

    // A provider exception after the durable handoff is ambiguous: retrying
    // could duplicate a clinical notification, so it terminalizes immediately.
    const outcome = await processNotificationDelivery(String(delivery._id))
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
    const publishSpy = jest.spyOn(
      await import('@alias/jobs/notification-delivery.queue'),
      'publishDeliveryJob'
    ).mockResolvedValue(false)
    try {
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
    } finally {
      publishSpy.mockRestore()
    }
  })

  test('queue publication fails promptly when Redis is unreachable', async () => {
    const workingRedisUrl = config.redisUrl
    await closeNotificationDeliveryQueue()
    resetNotificationQueueStateForTests()
    ;(config as any).redisUrl = 'redis://127.0.0.1:1'
    const startedAt = Date.now()
    try {
      await expect(publishDeliveryJob(new mongoose.Types.ObjectId().toString())).resolves.toBe(false)
      expect(Date.now() - startedAt).toBeLessThan(5_000)
    } finally {
      await closeNotificationDeliveryQueue()
      resetNotificationQueueStateForTests()
      ;(config as any).redisUrl = workingRedisUrl
    }
  }, 10_000)

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

  test('recovery reclaims an expired processing lease', async () => {
    const notification = await seedNotification()
    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id),
      userId: String(notification.user_id),
      title: notification.title,
      body: notification.message,
    })
    await claimDeliveryForProcessing(String(delivery._id))
    await NotificationDelivery.updateOne(
      { _id: delivery._id },
      { $set: { processing_started_at: new Date(Date.now() - 61_000) } }
    )

    const queue = await import('@alias/jobs/notification-delivery.queue')
    jest.spyOn(queue, 'isNotificationQueueAvailable').mockReturnValue(true)
    jest.spyOn(queue, 'publishDeliveryJob').mockResolvedValue(true)

    expect(await recoverDueDeliveries()).toBe(1)
    const recovered = await NotificationDelivery.findById(delivery._id).lean()
    expect(recovered?.status).toBe(NotificationDeliveryStatus.QUEUED)
    expect(recovered?.last_error).toBe('processing_lease_expired')
    expect(recovered?.processing_started_at).toBeUndefined()
    expect(recovered?.processing_lease_id).toBeUndefined()
  })

  test('expired exhausted processing lease with prior delivery terminalizes as success', async () => {
    ;(config as any).notificationDeliveryMaxAttempts = 1
    const notification = await seedNotification()
    const delivered = await DeviceToken.create({
      user_id: notification.user_id,
      fcm_token: 'recovery-prior-success',
      platform: 'android',
      is_active: false,
    })
    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id),
      userId: String(notification.user_id),
      title: notification.title,
      body: notification.message,
    })
    await claimDeliveryForProcessing(String(delivery._id))
    await NotificationDelivery.updateOne(
      { _id: delivery._id },
      {
        $set: {
          processing_started_at: new Date(Date.now() - 61_000),
          delivered_device_token_ids: [delivered._id],
        },
      },
    )

    expect(await recoverDueDeliveries()).toBe(0)
    const row = await NotificationDelivery.findById(delivery._id).lean()
    expect(row?.status).toBe(NotificationDeliveryStatus.SUCCEEDED)
    expect(row?.last_error).toBe('partially_delivered:processing_lease_expired')
  })

  test('pause during inline recovery releases its reservation for immediate resume', async () => {
    const notification = await seedNotification()
    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id),
      userId: String(notification.user_id),
      title: notification.title,
      body: notification.message,
    })
    const queue = await import('@alias/jobs/notification-delivery.queue')
    jest.spyOn(queue, 'isNotificationQueueAvailable').mockReturnValue(false)
    const configService = await import('@alias/services/config.service')
    const feature = jest.spyOn(configService, 'isFeatureEnabled')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    expect(await recoverDueDeliveries()).toBe(1)
    const paused = await NotificationDelivery.findById(delivery._id).lean()
    expect(paused?.status).toBe(NotificationDeliveryStatus.PENDING)
    expect(paused?.recovery_lease_id).toBeUndefined()
    expect(paused?.recovery_lease_expires_at).toBeUndefined()

    feature.mockRestore()
    jest.spyOn(queue, 'isNotificationQueueAvailable').mockReturnValue(true)
    jest.spyOn(queue, 'publishDeliveryJob').mockResolvedValue(true)
    expect(await recoverDueDeliveries()).toBe(1)
    expect((await NotificationDelivery.findById(delivery._id).lean())?.status)
      .toBe(NotificationDeliveryStatus.QUEUED)
  })

  test('recovery does not steal a recently claimed delivery', async () => {
    const notification = await seedNotification()
    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id),
      userId: String(notification.user_id),
      title: notification.title,
      body: notification.message,
    })
    await claimDeliveryForProcessing(String(delivery._id))

    expect(await recoverDueDeliveries()).toBe(0)
    const unchanged = await NotificationDelivery.findById(delivery._id).lean()
    expect(unchanged?.status).toBe(NotificationDeliveryStatus.PROCESSING)
    expect(unchanged?.processing_started_at).toBeTruthy()
  })

  test('concurrent recovery workers reclaim an expired processing lease only once', async () => {
    const notification = await seedNotification()
    const { delivery } = await createPushDeliveryOutbox({
      notificationId: String(notification._id),
      userId: String(notification.user_id),
      title: notification.title,
      body: notification.message,
    })
    await claimDeliveryForProcessing(String(delivery._id))
    await NotificationDelivery.updateOne(
      { _id: delivery._id },
      { $set: { processing_started_at: new Date(Date.now() - 61_000) } }
    )

    const queue = await import('@alias/jobs/notification-delivery.queue')
    jest.spyOn(queue, 'isNotificationQueueAvailable').mockReturnValue(true)
    const publish = jest.spyOn(queue, 'publishDeliveryJob').mockResolvedValue(true)

    const recovered = await Promise.all([recoverDueDeliveries(), recoverDueDeliveries()])
    expect(recovered[0] + recovered[1]).toBe(1)
    expect(publish).toHaveBeenCalledTimes(1)
    const row = await NotificationDelivery.findById(delivery._id).lean()
    expect(row?.status).toBe(NotificationDeliveryStatus.QUEUED)
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

    resetNotificationQueueStateForTests()
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
