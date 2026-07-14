import mongoose from 'mongoose'

export enum NotificationDeliveryChannel {
  FCM = 'FCM',
}

export enum NotificationDeliveryProvider {
  FIREBASE = 'FIREBASE',
}

export enum NotificationDeliveryStatus {
  PENDING = 'PENDING',
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED_RETRYABLE = 'FAILED_RETRYABLE',
  DEAD_LETTER = 'DEAD_LETTER',
  SKIPPED = 'SKIPPED',
}

export enum NotificationRecipientPolicy {
  CLINICAL = 'CLINICAL',
  GENERAL = 'GENERAL',
}

const NotificationDeliverySchema = new mongoose.Schema({
  notification_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Notification',
    required: true,
    index: true,
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  channel: {
    type: String,
    enum: Object.values(NotificationDeliveryChannel),
    default: NotificationDeliveryChannel.FCM,
    required: true,
  },
  provider: {
    type: String,
    enum: Object.values(NotificationDeliveryProvider),
    default: NotificationDeliveryProvider.FIREBASE,
    required: true,
  },
  /** Immutable authorization contract copied from the trusted parent notification. */
  recipient_policy: {
    type: String,
    enum: Object.values(NotificationRecipientPolicy),
  },
  notification_type: { type: String },
  status: {
    type: String,
    enum: Object.values(NotificationDeliveryStatus),
    default: NotificationDeliveryStatus.PENDING,
    required: true,
    index: true,
  },
  attempts: {
    type: Number,
    default: 0,
    min: 0,
  },
  max_attempts: {
    type: Number,
    default: 5,
    min: 1,
  },
  next_attempt_at: {
    type: Date,
    default: () => new Date(),
    index: true,
  },
  /** Lease metadata for a worker that has claimed this row. */
  processing_started_at: {
    type: Date,
  },
  processing_lease_id: {
    type: String,
  },
  /**
   * Irreversible handoff boundary owned by the processing lease. Once set,
   * cancellation must not overwrite the row; the sender owns recording the
   * provider outcome even if the parent notification is cancelled meanwhile.
   */
  provider_handoff_at: {
    type: Date,
  },
  /** Short-lived reservation held by a recovery pass while publishing work. */
  recovery_lease_id: {
    type: String,
  },
  recovery_lease_expires_at: {
    type: Date,
  },
  provider_message_id: {
    type: String,
  },
  /** Device-token document IDs already accepted by FCM on an earlier partial attempt. */
  delivered_device_token_ids: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeviceToken',
  }],
  last_error: {
    type: String,
    maxlength: 500,
  },
  /** Unique per notification+channel+provider to suppress duplicate outbox rows. */
  idempotency_key: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    required: true,
    maxlength: 200,
  },
  body: {
    type: String,
    required: true,
    maxlength: 1000,
  },
  /** FCM data payload — string values only; no tokens or secrets. */
  data: {
    type: Map,
    of: String,
  },
  completed_at: {
    type: Date,
  },
  /** Clinical validity boundary. Work after this instant must never be disclosed. */
  delivery_valid_until: {
    type: Date,
    index: true,
  },
  /** TTL retention for delivery history (MongoDB expireAfterSeconds). */
  expires_at: {
    type: Date,
    required: true,
  },
}, { timestamps: true })

NotificationDeliverySchema.index({ idempotency_key: 1 }, { unique: true })
NotificationDeliverySchema.index({ status: 1, next_attempt_at: 1 })
NotificationDeliverySchema.index({ status: 1, processing_started_at: 1 })
NotificationDeliverySchema.index({ recovery_lease_expires_at: 1 })
NotificationDeliverySchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 })
NotificationDeliverySchema.index({ user_id: 1, createdAt: -1 })

export interface NotificationDeliveryDocument
  extends mongoose.InferSchemaType<typeof NotificationDeliverySchema> {}

export default mongoose.model<NotificationDeliveryDocument>(
  'NotificationDelivery',
  NotificationDeliverySchema
)
