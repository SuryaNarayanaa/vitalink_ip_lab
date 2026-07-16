import mongoose from 'mongoose'

export enum FileAssetPurpose {
  INR_REPORT = 'INR_REPORT',
  PATIENT_PROFILE_PICTURE = 'PATIENT_PROFILE_PICTURE',
  DOCTOR_PROFILE_PICTURE = 'DOCTOR_PROFILE_PICTURE',
}

export enum FileAssetStorageProvider {
  S3_COMPATIBLE = 'S3_COMPATIBLE',
}

export enum FileAssetStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  FAILED = 'FAILED',
  DELETED = 'DELETED',
}

const FileAssetSchema = new mongoose.Schema({
  hospital_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hospital',
    required: true,
  },
  owner_user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  patient_profile_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PatientProfile',
  },
  purpose: {
    type: String,
    enum: Object.values(FileAssetPurpose),
    required: true,
  },
  storage_provider: {
    type: String,
    enum: Object.values(FileAssetStorageProvider),
    default: FileAssetStorageProvider.S3_COMPATIBLE,
    required: true,
  },
  bucket: { type: String, required: true },
  object_key: { type: String, required: true },
  original_filename: { type: String, required: true },
  detected_mime: { type: String, required: true },
  byte_size: { type: Number, required: true, min: 0 },
  sha256_checksum: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  status: {
    type: String,
    enum: Object.values(FileAssetStatus),
    default: FileAssetStatus.ACTIVE,
    required: true,
  },
  created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  failure_reason: { type: String },
  deleted_at: { type: Date },
  retention_eligible_at: { type: Date },
}, { timestamps: true })

FileAssetSchema.index({ hospital_id: 1, purpose: 1, createdAt: -1 })
FileAssetSchema.index({ owner_user_id: 1, createdAt: -1 })
FileAssetSchema.index({ patient_profile_id: 1, createdAt: -1 })
FileAssetSchema.index({ bucket: 1, object_key: 1 }, { unique: true })
FileAssetSchema.index({ status: 1 })

export interface FileAssetDocument extends mongoose.Document, mongoose.InferSchemaType<typeof FileAssetSchema> { }

export default mongoose.model<FileAssetDocument>('FileAsset', FileAssetSchema)
