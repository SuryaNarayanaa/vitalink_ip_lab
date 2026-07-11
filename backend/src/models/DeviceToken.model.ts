import mongoose, { Schema, Document } from 'mongoose'

export interface IDeviceToken extends Document {
  user_id:           mongoose.Types.ObjectId
  fcm_token:         string
  platform:          'android' | 'ios' | 'web'
  app_version?:      string
  is_active:         boolean
  last_refreshed_at: Date
}

const DeviceTokenSchema = new Schema<IDeviceToken>(
  {
    user_id: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },
    fcm_token: {
      type:     String,
      required: true,
    },
    platform: {
      type:     String,
      enum:     ['android', 'ios', 'web'],
      required: true,
    },
    app_version: {
      type: String,
    },
    is_active: {
      type:    Boolean,
      default: true,
    },
    last_refreshed_at: {
      type:    Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
)

// A physical FCM token has exactly one current owner. Re-registration transfers this document.
DeviceTokenSchema.index({ fcm_token: 1 }, { unique: true })
DeviceTokenSchema.index({ user_id: 1, is_active: 1 })

const DeviceToken = mongoose.model<IDeviceToken>('DeviceToken', DeviceTokenSchema)
export default DeviceToken
