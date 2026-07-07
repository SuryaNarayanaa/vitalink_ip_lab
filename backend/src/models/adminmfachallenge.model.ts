import mongoose from 'mongoose'
import { UserType } from '@alias/validators'

export enum AdminMfaChallengeStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  EXPIRED = 'EXPIRED',
  LOCKED = 'LOCKED',
  CANCELLED = 'CANCELLED',
}

const AdminMfaChallengeSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    index: true,
  },
  user_type: {
    type: String,
    enum: [UserType.ADMIN],
    required: true,
    default: UserType.ADMIN,
  },
  status: {
    type: String,
    enum: Object.values(AdminMfaChallengeStatus),
    default: AdminMfaChallengeStatus.PENDING,
    index: true,
  },
  expires_at: {
    type: Date,
    required: [true, 'MFA challenge expiration is required'],
  },
  attempt_count: {
    type: Number,
    default: 0,
    min: 0,
  },
  max_attempts: {
    type: Number,
    required: true,
    min: 1,
  },
  verified_at: {
    type: Date,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
  },
}, { timestamps: true })

AdminMfaChallengeSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 })
AdminMfaChallengeSchema.index({ user_id: 1, status: 1, createdAt: -1 })

export interface AdminMfaChallengeDocument extends mongoose.Document, mongoose.InferSchemaType<typeof AdminMfaChallengeSchema> {}

export default mongoose.model<AdminMfaChallengeDocument>('AdminMfaChallenge', AdminMfaChallengeSchema)
