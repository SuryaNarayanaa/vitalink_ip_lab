import mongoose from 'mongoose'

export enum NotificationType {
  DOCTOR_UPDATE = 'DOCTOR_UPDATE',
  INR_REMINDER = 'INR_REMINDER',
  DOSAGE_REMINDER = 'DOSAGE_REMINDER',
  CRITICAL_ALERT = 'CRITICAL_ALERT',
  APPOINTMENT_REMINDER = 'APPOINTMENT_REMINDER',
  SYSTEM_ANNOUNCEMENT = 'SYSTEM_ANNOUNCEMENT',
  PATIENT_REASSIGNED = 'PATIENT_REASSIGNED',
  REPORT_AVAILABLE = 'REPORT_AVAILABLE',
  GENERAL = 'GENERAL',
}

export enum NotificationPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

const NotificationSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: Object.values(NotificationType),
    required: true,
  },
  priority: {
    type: String,
    enum: Object.values(NotificationPriority),
    default: NotificationPriority.MEDIUM,
  },
  title: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
  },
  is_read: {
    type: Boolean,
    default: false,
  },
  read_at: {
    type: Date,
  },
  action_url: {
    type: String,
  },
  /** Stable key for idempotent scheduled-notification creation. */
  reminder_key: {
    type: String,
  },
  expires_at: {
    type: Date,
  },
}, { timestamps: true })

// TTL index for auto-expiry
NotificationSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 })
NotificationSchema.index({ user_id: 1, is_read: 1, createdAt: -1 })
NotificationSchema.index({ reminder_key: 1 }, { unique: true, sparse: true })

export interface NotificationDocument extends mongoose.InferSchemaType<typeof NotificationSchema> {}

export default mongoose.model<NotificationDocument>('Notification', NotificationSchema)
