import mongoose from 'mongoose'

export enum HospitalStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  INACTIVE = 'inactive',
}

const HospitalSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  location: {
    type: String,
    required: true,
    trim: true,
  },
  admin_email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },
  status: {
    type: String,
    enum: Object.values(HospitalStatus),
    default: HospitalStatus.ACTIVE,
  },
  /** Set false before suspension begins so new clinical assignments fail closed. */
  accepting_assignments: { type: Boolean, default: true },
  /**
   * Serializes tenant membership changes with hospital activation/suspension.
   * lifecycle_state remains SUSPENDING/ACTIVATING after an interrupted
   * transition so the externally visible status is never mistaken for a
   * hospital which is safe to accept new members.
   */
  lifecycle_state: {
    type: String,
    enum: ['STABLE', 'SUSPENDING', 'ACTIVATING'],
    default: 'STABLE',
  },
  lifecycle_generation: { type: Number, default: 0, min: 0 },
  lifecycle_lock: {
    lease_id: { type: String },
    mode: { type: String, enum: ['MEMBERSHIP', 'SUSPENDING', 'ACTIVATING'] },
    expires_at: { type: Date },
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
  },
}, { timestamps: true })

HospitalSchema.index({ status: 1, createdAt: -1 })
HospitalSchema.index({ location: 1 })

export interface HospitalDocument extends mongoose.InferSchemaType<typeof HospitalSchema> {}

export default mongoose.model<HospitalDocument>('Hospital', HospitalSchema)
