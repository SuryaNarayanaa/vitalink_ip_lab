import mongoose from 'mongoose'
import crypto from 'crypto'
import { config } from '@alias/config'
import { Notification, PatientProfile, User } from '@alias/models'
import { NotificationPriority, NotificationType } from '@alias/models/notification.model'
import logger from '@alias/utils/logger'
import { UserType } from '@alias/validators'
type LegacyEvent = {
  changed_by_doctor_id?: unknown
  change_type?: string
  title?: string
  message?: string
  changed_fields?: string[]
  is_read?: boolean
  created_at?: Date
}

type CliOptions = { execute: boolean; limit?: number }

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = { execute: false }
  for (const arg of argv) {
    if (arg === '--execute') { options.execute = true; continue }
    if (arg === '--dry-run') { options.execute = false; continue }
    if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length))
      if (!Number.isInteger(value) || value <= 0) throw new Error('--limit must be a positive integer')
      options.limit = value
      continue
    }
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: ts-node src/scripts/migrateDoctorChangeEventsToNotifications.ts [--dry-run] [--execute] [--limit=<n>]')
      console.log('Defaults to dry-run. Processes each profile transactionally with stable idempotency keys.')
      process.exit(0)
    }
    throw new Error(`Unknown argument "${arg}"`)
  }
  return options
}

function eventIdempotencyKey(patientUserId: string, event: LegacyEvent, index: number): string {
  const stamp = event.created_at ? new Date(event.created_at).toISOString() : 'no-date'
  const material = [
    patientUserId,
    String(event.change_type || 'DOCTOR_UPDATE'),
    stamp,
    String(event.changed_by_doctor_id || ''),
    String(event.title || ''),
    String(index),
  ].join('|')
  return `legacy-doctor-change:${crypto.createHash('sha256').update(material).digest('hex').slice(0, 32)}`
}

async function run() {
  const options = parseCliArgs(process.argv.slice(2))
  await mongoose.connect(config.databaseUrl)
  logger.info('Connected to MongoDB for doctor-change-event migration', {
    mode: options.execute ? 'EXECUTE' : 'DRY_RUN',
  })

  const cursor = PatientProfile.collection.find({
    doctor_change_events: { $exists: true, $ne: [] },
  })

  let scanned = 0
  let insertedCount = 0
  let wouldInsert = 0
  let clearedCount = 0
  let wouldClear = 0
  let skippedNoUser = 0

  for await (const profile of cursor) {
    if (options.limit && scanned >= options.limit) break
    scanned += 1

    const patientUser = await User.findOne({
      profile_id: profile._id,
      user_type: UserType.PATIENT,
    }).select('_id')

    if (!patientUser) {
      skippedNoUser += 1
      continue
    }

    const events = Array.isArray((profile as any).doctor_change_events)
      ? ((profile as any).doctor_change_events as LegacyEvent[])
      : []
    if (events.length === 0) continue

    const docs = events.map((event, index) => {
      const idempotencyKey = eventIdempotencyKey(String(patientUser._id), event, index)
      return {
        user_id: patientUser._id,
        type: NotificationType.DOCTOR_UPDATE,
        priority: NotificationPriority.HIGH,
        title: event.title || 'Doctor update',
        message: event.message || '',
        reminder_key: idempotencyKey,
        data: {
          change_type: event.change_type || 'DOCTOR_UPDATE',
          changed_fields: Array.isArray(event.changed_fields) ? event.changed_fields : [],
          changed_by_doctor_id: event.changed_by_doctor_id,
          migrated_from_legacy: true,
          migration_idempotency_key: idempotencyKey,
        },
        is_read: event.is_read === true,
        read_at: event.is_read ? (event.created_at || new Date()) : undefined,
        createdAt: event.created_at || new Date(),
        updatedAt: event.created_at || new Date(),
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      }
    })

    if (!options.execute) {
      wouldInsert += docs.length
      wouldClear += 1
      continue
    }

    // Process each profile in a transaction: insert missing notifications by
    // stable reminder_key, then unset legacy events only after inserts succeed.
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        for (const doc of docs) {
          const existing = await Notification.findOne({ reminder_key: doc.reminder_key })
            .session(session)
            .select('_id')
            .lean()
          if (existing) continue
          try {
            // Disable schema timestamps so legacy event.created_at is preserved.
            await Notification.create([doc], { session, timestamps: false })
            insertedCount += 1
          } catch (error: any) {
            // Duplicate key on concurrent rerun is fine (idempotent).
            if (error?.code !== 11000) throw error
          }
        }
        await PatientProfile.collection.updateOne(
          { _id: profile._id },
          { $unset: { doctor_change_events: '' } },
          { session },
        )
        clearedCount += 1
      })
    } finally {
      await session.endSession()
    }
  }

  logger.info('Migration complete', {
    mode: options.execute ? 'EXECUTE' : 'DRY_RUN',
    scanned,
    inserted_notifications: options.execute ? insertedCount : wouldInsert,
    cleared_profiles: options.execute ? clearedCount : wouldClear,
    skipped_no_user: skippedNoUser,
  })
  await mongoose.connection.close()
}

run().catch(async (error) => {
  logger.error('Doctor change event migration failed', { error })
  await mongoose.connection.close()
  process.exit(1)
})
