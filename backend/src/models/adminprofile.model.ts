import mongoose from 'mongoose'

export enum AdminPermission {
  FULL_ACCESS = 'FULL_ACCESS',
  READ_ONLY = 'READ_ONLY',
  LIMITED_ACCESS = 'LIMITED_ACCESS',
}

export enum AdminRole {
  APP_ADMIN = 'app_admin',
  HOSPITAL_ADMIN = 'hospital_admin',
  AUDITOR = 'auditor',
}

const AdminProfileSchema = new mongoose.Schema({
  name: { type: String, default: 'Admin User' },
  permission: {
    type: String,
    enum: Object.values(AdminPermission),
    default: AdminPermission.FULL_ACCESS,
  },
  admin_role: {
    type: String,
    enum: Object.values(AdminRole),
    default: AdminRole.APP_ADMIN,
    index: true,
  },
  hospital_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hospital',
  },
}, { timestamps: true })

export interface AdminProfileDocument extends mongoose.InferSchemaType<typeof AdminProfileSchema> {}

export default mongoose.model<AdminProfileDocument>('AdminProfile', AdminProfileSchema)
