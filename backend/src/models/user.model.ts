import { generateSalt, hashPassword } from "@alias/utils";
import { UserType } from "@alias/validators";
import mongoose from "mongoose";

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
  failed_login_attempts: { type: Number, default: 0, min: 0 },
  locked_until: { type: Date },
  last_login_at: { type: Date },
  last_failed_login_at: { type: Date },
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
  }
})

UserSchema.methods.toJSON = function () {
  var object = this.toObject();
  delete object.password;
  delete object.salt;
  return object;
}

export interface UserDocument extends mongoose.InferSchemaType<typeof UserSchema> { }

export default mongoose.model<UserDocument>("User", UserSchema)
