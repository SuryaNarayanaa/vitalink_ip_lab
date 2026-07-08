import { generateSalt, hashPassword } from "@alias/utils";
import { UserType } from "@alias/validators";
import mongoose from "mongoose";

const PasswordHistoryEntrySchema = new mongoose.Schema({
  password: {
    type: String,
    required: true,
  },
  salt: {
    type: String,
    required: true,
  },
  changed_at: {
    type: Date,
    required: true,
  },
}, { _id: false })

const UserSchema = new mongoose.Schema({
  login_id: {
    type: String,
    required: [true, 'Login ID is required'],
    trim: true,
    unique: true
  },
  password: {
    type: String,
    required: [true, 'Password is required']
  },
  salt: {
    type: String,
    required: [true, 'Salt is required']
  },
  user_type: {
    type: String,
    enum: Object.values(UserType),
    required: [true, 'User type is required']
  },
  profile_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: [true, 'Profile ID is required'],
    unique: true,
    refPath: 'user_type_model'
  },
  user_type_model: {
    type: String,
    required: [true, "user_type_model is required"],
  },
  is_active: { type: Boolean, default: true },
  must_change_password: { type: Boolean, default: false },
  password_changed_at: { type: Date, default: Date.now },
  password_history: {
    type: [PasswordHistoryEntrySchema],
    default: [],
    select: false,
  },
  failed_login_attempts: { type: Number, default: 0, min: 0 },
  locked_until: { type: Date },
  last_login_at: { type: Date },
  last_failed_login_at: { type: Date },
  admin_mfa: {
    totp: {
      status: {
        type: String,
        enum: ['DISABLED', 'PENDING', 'ENABLED'],
        default: 'DISABLED',
      },
      secret_ciphertext: { type: String },
      secret_iv: { type: String },
      secret_auth_tag: { type: String },
      pending_secret_ciphertext: { type: String },
      pending_secret_iv: { type: String },
      pending_secret_auth_tag: { type: String },
      enrolled_at: { type: Date },
      activated_at: { type: Date },
      last_verified_at: { type: Date },
      last_verified_time_step: { type: Number },
    },
  },
}, { timestamps: true });

UserSchema.index({ locked_until: 1 });

UserSchema.pre('validate', async function () {
  const map: Record<string, string> = {
    ADMIN: 'AdminProfile',
    DOCTOR: 'DoctorProfile',
    PATIENT: 'PatientProfile',
  }

  this.user_type_model = map[this.user_type]

  if (typeof this.login_id === 'string') {
    this.login_id = this.login_id.trim()
  }

  if (this.isModified('password')) {
    this.salt = generateSalt()
    this.password = await hashPassword(this.password, this.salt)
    this.password_changed_at = new Date()
  }
})

UserSchema.methods.toJSON = function () {
  var object = this.toObject();
  delete object.password;
  delete object.salt;
  delete object.password_history;
  return object;
}

export interface UserDocument extends mongoose.InferSchemaType<typeof UserSchema> { }

export default mongoose.model<UserDocument>("User", UserSchema)
