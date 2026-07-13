import mongoose from 'mongoose'
import { UserType } from '@alias/validators'

export enum OtpChallengePurpose {
  PHONE_FIRST_LOGIN = 'PHONE_FIRST_LOGIN',
}

export enum OtpDeliveryChannel {
  SMS = 'SMS',
}

export enum OtpChallengeStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  EXPIRED = 'EXPIRED',
  LOCKED = 'LOCKED',
  CANCELLED = 'CANCELLED',
}

const OtpChallengeSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    index: true,
  },
  user_type: {
    type: String,
    enum: [UserType.DOCTOR, UserType.PATIENT],
    required: [true, 'User type is required'],
  },
  purpose: {
    type: String,
    enum: Object.values(OtpChallengePurpose),
    required: [true, 'OTP purpose is required'],
    default: OtpChallengePurpose.PHONE_FIRST_LOGIN,
  },
  delivery_channel: {
    type: String,
    enum: Object.values(OtpDeliveryChannel),
    required: [true, 'OTP delivery channel is required'],
    default: OtpDeliveryChannel.SMS,
  },
  phone_hash: {
    type: String,
    required: [true, 'Phone hash is required'],
  },
  phone_last4: {
    type: String,
  },
  provider: {
    type: String,
    required: true,
    default: 'twilio_verify',
  },
  provider_verification_sid: {
    type: String,
  },
  provider_status: {
    type: String,
  },
  provider_reservation_id: {
    type: String,
  },
  provider_reservation_operation: {
    type: String,
    enum: ['resend', 'verify'],
  },
  provider_reservation_expires_at: {
    type: Date,
  },
  expires_at: {
    type: Date,
    required: [true, 'OTP expiration is required'],
  },
  attempt_count: {
    type: Number,
    default: 0,
    min: 0,
  },
  max_attempts: {
    type: Number,
    required: true,
    default: 5,
    min: 1,
  },
  resend_count: {
    type: Number,
    default: 0,
    min: 0,
  },
  max_resends: {
    type: Number,
    required: true,
    default: 3,
    min: 0,
  },
  resend_available_at: {
    type: Date,
  },
  last_sent_at: {
    type: Date,
  },
  verified_at: {
    type: Date,
  },
  status: {
    type: String,
    enum: Object.values(OtpChallengeStatus),
    default: OtpChallengeStatus.PENDING,
    index: true,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
  },
}, { timestamps: true })

OtpChallengeSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 })
OtpChallengeSchema.index({ user_id: 1, purpose: 1, status: 1, createdAt: -1 })

export interface OtpChallengeDocument extends mongoose.Document, mongoose.InferSchemaType<typeof OtpChallengeSchema> {}

export default mongoose.model<OtpChallengeDocument>('OtpChallenge', OtpChallengeSchema)
