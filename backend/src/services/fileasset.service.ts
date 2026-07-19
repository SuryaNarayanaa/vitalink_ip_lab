import { StatusCodes } from 'http-status-codes'
import { FileAsset } from '@alias/models'
import {
  FileAssetPurpose,
  FileAssetStatus,
  FileAssetStorageProvider,
  type FileAssetDocument,
} from '@alias/models/fileasset.model'
import { ApiError } from '@alias/utils'
import {
  getDownloadUrl,
  prepareFileUpload,
  purgeFilePermanently,
  putPreparedFile,
  type UploadedFileMetadata,
} from '@alias/utils/fileUpload'
import logger from '@alias/utils/logger'
import mongoose, { type Types } from 'mongoose'

export type AssetOwnership = {
  hospitalId: Types.ObjectId | string
  ownerUserId: Types.ObjectId | string
  patientProfileId?: Types.ObjectId | string
  purpose: FileAssetPurpose
  createdBy: Types.ObjectId | string
}

export async function createFileAsset(
  metadata: UploadedFileMetadata,
  ownership: AssetOwnership,
  status = FileAssetStatus.ACTIVE,
): Promise<FileAssetDocument> {
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
    status,
    created_by: ownership.createdBy,
  } as any) as unknown as FileAssetDocument
}

/**
 * Persists a PENDING intent before the PUT so timeouts, connection resets, and
 * process crashes always leave enough ownership metadata for purge/recovery.
 */
export async function uploadTrackedFile(
  folder: string,
  file: Express.Multer.File,
  ownership: AssetOwnership,
  lifecycleGuard?: { assertOwned: () => Promise<void> },
) {
  const prepared = await prepareFileUpload(folder, file, lifecycleGuard)
  const { uploadUrl: _uploadUrl, ...metadata } = prepared
  const asset = await createFileAsset(metadata, ownership, FileAssetStatus.PENDING)
  try {
    await putPreparedFile(prepared, file, lifecycleGuard)
    asset.status = FileAssetStatus.ACTIVE
    await asset.save()
    return { metadata, asset }
  } catch (uploadError) {
    try {
      await purgeFilePermanently(metadata.key, metadata.bucket)
      asset.status = FileAssetStatus.DELETED
      asset.deleted_at = new Date()
      asset.failure_reason = uploadError instanceof Error ? uploadError.message.slice(0, 500) : 'Upload failed'
    } catch (cleanupError) {
      asset.status = FileAssetStatus.FAILED
      asset.failure_reason = cleanupError instanceof Error ? cleanupError.message.slice(0, 500) : 'Upload cleanup failed'
    }
    await asset.save().catch(trackingError => {
      logger.error('Unable to persist failed tracked upload state', { trackingError, fileAssetId: asset._id })
    })
    throw uploadError
  }
}

export async function createTrackedFileAsset(metadata: UploadedFileMetadata, ownership: AssetOwnership): Promise<FileAssetDocument> {
  try {
    return await createFileAsset(metadata, ownership)
  } catch (error) {
    try {
      await purgeFilePermanently(metadata.key, metadata.bucket)
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
    await purgeFilePermanently(asset.object_key, asset.bucket)
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

/**
 * Resolve many download URLs with a single FileAsset query + parallel signing.
 * Items without fileAssetId use the same legacy key rules as resolveAssetDownloadUrl.
 * Missing assets throw NOT_FOUND (same fail-closed behavior as the single path).
 */
export async function resolveAssetDownloadUrls(
  items: ResolveAssetInput[],
  options?: { concurrency?: number },
): Promise<(string | null)[]> {
  if (items.length === 0) return []

  for (const input of items) {
    if (!input.hospitalId || !input.requesterHospitalId || String(input.hospitalId) !== String(input.requesterHospitalId)) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'Cross-tenant file access is not allowed')
    }
  }

  // Only valid ObjectIds enter $in — malformed ids would CastError the whole batch.
  // Invalid entries are omitted here and surface as NOT_FOUND in the per-item path.
  const assetIds = items
    .map((item) => item.fileAssetId)
    .filter((id): id is string | Types.ObjectId => {
      if (id == null || String(id).length === 0) return false
      return mongoose.Types.ObjectId.isValid(String(id))
    })

  const assetsById = new Map<string, { object_key: string; bucket?: string; hospital_id: unknown; owner_user_id: unknown; purpose: string; patient_profile_id?: unknown }>()
  if (assetIds.length > 0) {
    // Fetch by id set only. Per-item checks below enforce hospital/owner/purpose/
    // patient_profile so heterogeneous batches remain correct.
    const assets = await FileAsset.find({
      _id: { $in: assetIds as Types.ObjectId[] },
      status: FileAssetStatus.ACTIVE,
      deleted_at: { $exists: false },
    }).lean()
    for (const asset of assets) {
      assetsById.set(String(asset._id), asset as any)
    }
  }

  const requestedConcurrency = options?.concurrency ?? 8
  const concurrency = Number.isFinite(requestedConcurrency)
    ? Math.max(1, Math.min(Math.floor(requestedConcurrency), 32))
    : 8
  const results: (string | null)[] = new Array(items.length).fill(null)
  let nextIndex = 0

  const worker = async () => {
    while (true) {
      const index = nextIndex++
      if (index >= items.length) return
      const input = items[index]
      if (!input.fileAssetId) {
        if (!input.legacyObjectKey) {
          results[index] = null
          continue
        }
        if (!input.legacyEligible) {
          throw new ApiError(StatusCodes.NOT_FOUND, 'File asset metadata is required')
        }
        results[index] = await getDownloadUrl(input.legacyObjectKey)
        continue
      }

      const asset = assetsById.get(String(input.fileAssetId))
      if (
        !asset ||
        String(asset.hospital_id) !== String(input.hospitalId) ||
        String(asset.owner_user_id) !== String(input.ownerUserId) ||
        asset.purpose !== input.purpose ||
        (input.patientProfileId && String(asset.patient_profile_id || '') !== String(input.patientProfileId))
      ) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'File asset not found')
      }
      results[index] = await getDownloadUrl(asset.object_key, asset.bucket)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return results
}
