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
  metadata: {
    type: mongoose.Schema.Types.Mixed,
  },
}, { timestamps: true })

HospitalSchema.index({ status: 1, createdAt: -1 })
HospitalSchema.index({ location: 1 })

export interface HospitalDocument extends mongoose.InferSchemaType<typeof HospitalSchema> {}

export default mongoose.model<HospitalDocument>('Hospital', HospitalSchema)
