import mongoose from 'mongoose'

const SystemConfigSchema = new mongoose.Schema({
  inr_thresholds: {
    critical_low: { type: Number, default: 1.5, min: Number.MIN_VALUE, validate: Number.isFinite },
    critical_high: { type: Number, default: 4.5, min: Number.MIN_VALUE, validate: Number.isFinite },
  },
  session_timeout_minutes: {
    type: Number,
    default: 30,
    min: 1,
    max: 1440,
  },
  rate_limit: {
    max_requests: { type: Number, default: 100 },
    window_minutes: { type: Number, default: 15 },
  },
  feature_flags: {
    type: Map,
    of: Boolean,
    default: {
      maintenance_mode: false,
      patient_registration_enabled: true,
      notifications_enabled: true,
    },
  },
  is_active: {
    type: Boolean,
    default: true,
  },
}, { timestamps: true })

SystemConfigSchema.index(
  { is_active: 1 },
  { unique: true, partialFilterExpression: { is_active: true } },
)

export interface SystemConfigDocument extends mongoose.InferSchemaType<typeof SystemConfigSchema> {}

export default mongoose.model<SystemConfigDocument>('SystemConfig', SystemConfigSchema)
