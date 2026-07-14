import mongoose from 'mongoose'
import { UserType } from '@alias/validators'

export enum AuthSessionRevocationReason {
  LOGOUT = 'LOGOUT',
  USER_REVOKED = 'USER_REVOKED',
  REFRESH_ROTATED = 'REFRESH_ROTATED',
  REFRESH_TOKEN_REUSE = 'REFRESH_TOKEN_REUSE',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  PASSWORD_RESET = 'PASSWORD_RESET',
  MFA_RESET = 'MFA_RESET',
  ACCOUNT_DISABLED = 'ACCOUNT_DISABLED',
}

const AuthSessionSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'User',
    index: true,
  },
  user_type: {
    type: String,
    enum: Object.values(UserType),
    required: true,
  },
  security_version: {
    type: Number,
    required: true,
    default: 0,
  },
  access_token_id: {
    type: String,
    required: true,
    unique: true,
  },
  refresh_token_hash: {
    type: String,
    required: true,
    unique: true,
  },
  /** Recently rotated token hashes used to detect refresh-token family reuse. */
  refresh_token_history_hashes: {
    type: [String],
    default: [],
    select: false,
  },
  expires_at: {
    type: Date,
    required: true,
  },
  /** Sliding access-session expiry; expires_at is the absolute refresh-family expiry. */
  access_expires_at: {
    type: Date,
  },
  revoked_at: {
    type: Date,
  },
  revoked_reason: {
    type: String,
    enum: Object.values(AuthSessionRevocationReason),
  },
  last_used_at: {
    type: Date,
    default: Date.now,
  },
  ip_address: {
    type: String,
  },
  user_agent: {
    type: String,
  },
}, { timestamps: true })

AuthSessionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 })
AuthSessionSchema.index({ user_id: 1, revoked_at: 1, expires_at: 1 })
AuthSessionSchema.index({ access_expires_at: 1 })
AuthSessionSchema.index({ refresh_token_history_hashes: 1 })

export interface AuthSessionDocument extends mongoose.InferSchemaType<typeof AuthSessionSchema> { }

export default mongoose.model<AuthSessionDocument>('AuthSession', AuthSessionSchema)
