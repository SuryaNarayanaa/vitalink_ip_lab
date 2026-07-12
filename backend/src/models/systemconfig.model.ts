import mongoose from 'mongoose'

const SystemConfigSchema = new mongoose.Schema({
  inr_thresholds: {
    critical_low: { type: Number, default: 1.5 },
    critical_high: { type: Number, default: 4.5 },
  },
  session_timeout_minutes: {
    type: Number,
    default: 30,
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

export interface SystemConfigDocument extends mongoose.InferSchemaType<typeof SystemConfigSchema> {}

export default mongoose.model<SystemConfigDocument>('SystemConfig', SystemConfigSchema)
