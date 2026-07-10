import { StatusCodes } from 'http-status-codes'
import { FileAsset } from '@alias/models'
import {
  FileAssetPurpose,
  FileAssetStatus,
  FileAssetStorageProvider,
  type FileAssetDocument,
} from '@alias/models/fileasset.model'
import { ApiError } from '@alias/utils'
import { deleteFile, getDownloadUrl, type UploadedFileMetadata } from '@alias/utils/fileUpload'
import logger from '@alias/utils/logger'
import type { Types } from 'mongoose'

type AssetOwnership = {
  hospitalId: Types.ObjectId | string
  ownerUserId: Types.ObjectId | string
  patientProfileId?: Types.ObjectId | string
  purpose: FileAssetPurpose
  createdBy: Types.ObjectId | string
}

export async function createFileAsset(metadata: UploadedFileMetadata, ownership: AssetOwnership): Promise<FileAssetDocument> {
  return FileAsset.create({
    hospital_id: ownership.hospitalId,
    owner_user_id: ownership.ownerUserId,
    patient_profile_id: ownership.patientProfileId,
    purpose: ownership.purpose,
    storage_provider: FileAssetStorageProvider.S3_COMPATIBLE,
    bucket: metadata.bucket,
    object_key: metadata.key,
    original_filename: metadata.originalFilename,
    detected_mime: metadata.detectedMime,
    byte_size: metadata.byteSize,
    sha256_checksum: metadata.sha256Checksum,
    status: FileAssetStatus.ACTIVE,
    created_by: ownership.createdBy,
  } as any) as unknown as FileAssetDocument
}

export async function createTrackedFileAsset(metadata: UploadedFileMetadata, ownership: AssetOwnership): Promise<FileAssetDocument> {
  try {
    return await createFileAsset(metadata, ownership)
  } catch (error) {
    try {
      await deleteFile(metadata.key, metadata.bucket)
    } catch (cleanupError) {
      logger.error('Object cleanup failed after FileAsset creation failure', { error, cleanupError, key: metadata.key })
      try {
        await FileAsset.create({
          hospital_id: ownership.hospitalId,
          owner_user_id: ownership.ownerUserId,
          patient_profile_id: ownership.patientProfileId,
          purpose: ownership.purpose,
          storage_provider: FileAssetStorageProvider.S3_COMPATIBLE,
          bucket: metadata.bucket,
          object_key: metadata.key,
          original_filename: metadata.originalFilename,
          detected_mime: metadata.detectedMime,
          byte_size: metadata.byteSize,
          sha256_checksum: metadata.sha256Checksum,
          status: FileAssetStatus.FAILED,
          failure_reason: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          created_by: ownership.createdBy,
        } as any)
      } catch (trackingError) {
        logger.error('Unable to track object after cleanup failure', { trackingError, key: metadata.key })
      }
    }
    throw error
  }
}

export async function compensateFileAsset(asset: FileAssetDocument, reason: unknown) {
  try {
    await deleteFile(asset.object_key, asset.bucket)
    asset.status = FileAssetStatus.DELETED
    asset.deleted_at = new Date()
    asset.failure_reason = reason instanceof Error ? reason.message : String(reason)
  } catch (cleanupError) {
    asset.status = FileAssetStatus.FAILED
    asset.failure_reason = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
    logger.error('Object cleanup failed after owning record persistence failure', {
      cleanupError,
      key: asset.object_key,
      fileAssetId: asset._id,
    })
  }
  await asset.save().catch((trackingError) => {
    logger.error('Unable to persist compensated FileAsset state', { trackingError, fileAssetId: asset._id })
  })
}

export async function retireReplacedFileAsset(input: {
  fileAssetId?: unknown
  hospitalId: unknown
  ownerUserId: unknown
  purpose: FileAssetPurpose
}) {
  if (!input.fileAssetId) return
  try {
    const asset = await FileAsset.findOne({
      _id: input.fileAssetId,
      hospital_id: input.hospitalId,
      owner_user_id: input.ownerUserId,
      purpose: input.purpose,
      status: FileAssetStatus.ACTIVE,
    })
    if (asset) await compensateFileAsset(asset, 'Replaced by a newer file asset')
  } catch (error) {
    logger.error('Unable to retire replaced FileAsset', { error, fileAssetId: input.fileAssetId })
  }
}

type ResolveAssetInput = {
  fileAssetId?: unknown
  legacyObjectKey?: string | null
  hospitalId: unknown
  requesterHospitalId: unknown
  ownerUserId: unknown
  patientProfileId?: unknown
  purpose: FileAssetPurpose
  legacyEligible?: boolean
}

export async function resolveAssetDownloadUrl(input: ResolveAssetInput) {
  if (!input.hospitalId || !input.requesterHospitalId || String(input.hospitalId) !== String(input.requesterHospitalId)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Cross-tenant file access is not allowed')
  }
  if (!input.fileAssetId) {
    if (!input.legacyObjectKey) return null
    if (!input.legacyEligible) throw new ApiError(StatusCodes.NOT_FOUND, 'File asset metadata is required')
    // Cutoff-gated migration fallback: the key came from an authorized owning record created before rollout.
    return getDownloadUrl(input.legacyObjectKey)
  }

  const query: Record<string, unknown> = {
    _id: input.fileAssetId,
    hospital_id: input.hospitalId,
    owner_user_id: input.ownerUserId,
    purpose: input.purpose,
    status: FileAssetStatus.ACTIVE,
    deleted_at: { $exists: false },
  }
  if (input.patientProfileId) query.patient_profile_id = input.patientProfileId

  const asset = await FileAsset.findOne(query).lean()
  if (!asset) throw new ApiError(StatusCodes.NOT_FOUND, 'File asset not found')
  return getDownloadUrl(asset.object_key, asset.bucket)
}
