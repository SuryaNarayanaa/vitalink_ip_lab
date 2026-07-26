import mongoose from 'mongoose'
import {
  ADMIN_POLICY_SCHEMA_VERSION,
  ADMIN_ROLE_KEYS,
  type AdminRoleKey,
  normalizeAdminCapabilityMap,
} from '@alias/constants/admin-capabilities'

const AdminRolePolicySchema = new mongoose.Schema({
  role_key: {
    type: String,
    enum: ADMIN_ROLE_KEYS,
    required: true,
    unique: true,
    index: true,
    immutable: true,
  },
  capabilities: {
    // Mongoose Map forbids dots in keys; namespaced capabilities therefore use
    // a strictly validated plain object stored as Mixed.
    type: mongoose.Schema.Types.Mixed,
    required: true,
    validate: {
      validator: function (value: unknown) {
        const context = this as any
        const role = context.role_key ?? context.getQuery?.().role_key
        if (!ADMIN_ROLE_KEYS.includes(role)) return false
        try {
          normalizeAdminCapabilityMap(role, value)
          return true
        } catch {
          return false
        }
      },
      message: 'capabilities must be the complete supported allowlist map for role_key',
    },
  },
  protected: {
    type: Boolean,
    required: true,
    default: false,
    validate: {
      validator: function (value: boolean) {
        const context = this as any
        const role = context.role_key ?? context.getQuery?.().role_key
        return role !== 'app_admin' || value === true
      },
      message: 'Application Admin policy must remain protected',
    },
  },
  schema_version: {
    type: Number,
    required: true,
    enum: [ADMIN_POLICY_SCHEMA_VERSION],
    default: ADMIN_POLICY_SCHEMA_VERSION,
    immutable: true,
  },
  policy_version: {
    type: Number,
    required: true,
    min: 1,
    validate: {
      validator: Number.isSafeInteger,
      message: 'policy_version must be a positive safe integer',
    },
  },
  updated_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  change_reason: {
    type: String,
    required: true,
    trim: true,
    minlength: 3,
    maxlength: 500,
  },
}, {
  timestamps: true,
  strict: 'throw',
  minimize: false,
})

AdminRolePolicySchema.pre('validate', function () {
  const role = this.role_key as AdminRoleKey
  if (!ADMIN_ROLE_KEYS.includes(role)) return
  try {
    this.capabilities = normalizeAdminCapabilityMap(role, this.capabilities) as any
  } catch (error) {
    this.invalidate('capabilities', error instanceof Error ? error.message : 'Invalid capability map')
  }
  if (role === 'app_admin' && this.protected !== true) {
    this.invalidate('protected', 'Application Admin policy must remain protected')
  }
})

export interface AdminRolePolicyDocument extends mongoose.InferSchemaType<typeof AdminRolePolicySchema> {}

const AdminRolePolicy = mongoose.models.AdminRolePolicy
  || mongoose.model<AdminRolePolicyDocument>('AdminRolePolicy', AdminRolePolicySchema)

export default AdminRolePolicy
