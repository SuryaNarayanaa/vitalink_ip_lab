import mongoose from 'mongoose'
import {
  ADMIN_ROLE_KEYS,
  type AdminRoleKey,
  normalizeAdminCapabilityMap,
} from '@alias/constants/admin-capabilities'

const AdminRolePolicyRevisionSchema = new mongoose.Schema({
  role_key: {
    type: String,
    enum: ADMIN_ROLE_KEYS,
    required: true,
    immutable: true,
    index: true,
  },
  previous_capabilities: {
    // Mongoose Map forbids dots in keys; capability snapshots are strictly
    // validated plain objects stored as Mixed.
    type: mongoose.Schema.Types.Mixed,
    required: true,
    immutable: true,
  },
  new_capabilities: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    immutable: true,
  },
  previous_policy_version: {
    type: Number,
    required: true,
    min: 1,
    immutable: true,
    validate: {
      validator: Number.isSafeInteger,
      message: 'previous_policy_version must be a positive safe integer',
    },
  },
  new_policy_version: {
    type: Number,
    required: true,
    min: 2,
    immutable: true,
    validate: {
      validator: Number.isSafeInteger,
      message: 'new_policy_version must be a positive safe integer',
    },
  },
  actor_user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    immutable: true,
  },
  actor_role: {
    type: String,
    enum: ADMIN_ROLE_KEYS,
    required: true,
    immutable: true,
  },
  change_reason: {
    type: String,
    required: true,
    trim: true,
    minlength: 3,
    maxlength: 500,
    immutable: true,
  },
  affected_active_account_count: {
    type: Number,
    required: true,
    min: 0,
    immutable: true,
    validate: {
      validator: Number.isSafeInteger,
      message: 'affected_active_account_count must be a non-negative safe integer',
    },
  },
  request_correlation_id: {
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 200,
    immutable: true,
    index: true,
  },
  restored_from_revision_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AdminRolePolicyRevision',
    immutable: true,
  },
}, {
  timestamps: { createdAt: true, updatedAt: false },
  strict: 'throw',
  minimize: false,
})

AdminRolePolicyRevisionSchema.index({ role_key: 1, new_policy_version: -1 }, { unique: true })
AdminRolePolicyRevisionSchema.index({ role_key: 1, createdAt: -1 })

AdminRolePolicyRevisionSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'],
  function () {
    throw new Error('Admin role policy revisions are append-only')
  },
)

AdminRolePolicyRevisionSchema.pre('validate', function () {
  const role = this.role_key as AdminRoleKey
  if (!ADMIN_ROLE_KEYS.includes(role)) return
  try {
    this.previous_capabilities = normalizeAdminCapabilityMap(role, this.previous_capabilities) as any
  } catch (error) {
    this.invalidate('previous_capabilities', error instanceof Error ? error.message : 'Invalid previous capability map')
  }
  try {
    this.new_capabilities = normalizeAdminCapabilityMap(role, this.new_capabilities) as any
  } catch (error) {
    this.invalidate('new_capabilities', error instanceof Error ? error.message : 'Invalid new capability map')
  }
  if (
    Number.isSafeInteger(this.previous_policy_version)
    && Number.isSafeInteger(this.new_policy_version)
    && this.new_policy_version !== this.previous_policy_version + 1
  ) {
    this.invalidate('new_policy_version', 'new_policy_version must increment the previous version by one')
  }
})

export interface AdminRolePolicyRevisionDocument extends mongoose.InferSchemaType<typeof AdminRolePolicyRevisionSchema> {}

const AdminRolePolicyRevision = mongoose.models.AdminRolePolicyRevision
  || mongoose.model<AdminRolePolicyRevisionDocument>('AdminRolePolicyRevision', AdminRolePolicyRevisionSchema)

export default AdminRolePolicyRevision
