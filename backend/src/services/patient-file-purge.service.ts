import { StatusCodes } from 'http-status-codes'
import type { Types } from 'mongoose'
import { DoctorProfile, FileAsset, PatientProfile, User } from '@alias/models'
import { FileAssetPurpose, FileAssetStatus, type FileAssetDocument } from '@alias/models/fileasset.model'
import { config } from '@alias/config'
import { ApiError } from '@alias/utils'
import { purgeFilePermanently } from '@alias/utils/fileUpload'
import logger from '@alias/utils/logger'
import { randomUUID } from 'crypto'

type PatientFilePurgeInput = {
  patientProfileId: Types.ObjectId | string
  ownerUserId: Types.ObjectId | string
}

export type PatientFilePurgeSummary = {
  trackedObjectsDeleted: number
  legacyObjectsDeleted: number
  metadataRecordsDeleted: number
  failures: number
}

export class PatientFilePurgeError extends Error {
  constructor(public readonly summary: PatientFilePurgeSummary) {
    super('Patient file purge did not complete; patient data must not be purged yet')
    this.name = 'PatientFilePurgeError'
  }
}

const FILE_OPERATION_LEASE_MS = 5 * 60_000
const PURGE_EXECUTION_LEASE_MS = 5 * 60_000

/** Atomically prevents a purge from starting until this upload has created its tracked asset. */
export async function acquirePatientFileOperationLease(
  patientProfileId: Types.ObjectId | string,
  options: { requireActive?: boolean } = {},
) {
  const leaseId = randomUUID()
  const now = new Date()
  const requireActive = options.requireActive !== false
  const result = await PatientProfile.updateOne(
    {
      _id: patientProfileId,
      ...(requireActive ? { account_status: 'Active' } : {}),
      'file_purge.state': { $nin: ['PURGING', 'COMPLETE'] },
    },
    { $push: { file_operation_leases: { lease_id: leaseId, expires_at: new Date(now.getTime() + FILE_OPERATION_LEASE_MS) } } },
  )
  if (result.matchedCount === 0) throw new ApiError(StatusCodes.CONFLICT, 'Patient files are no longer accepting uploads')

  let released = false
  let lost = false
  const renew = async () => {
    if (released || lost) return
    const renewed = await PatientProfile.updateOne(
      {
        _id: patientProfileId,
        ...(requireActive ? { account_status: 'Active' } : {}),
        'file_purge.state': { $nin: ['PURGING', 'COMPLETE'] },
        'file_operation_leases.lease_id': leaseId,
      },
      { $set: { 'file_operation_leases.$[lease].expires_at': new Date(Date.now() + FILE_OPERATION_LEASE_MS) } },
      { arrayFilters: [{ 'lease.lease_id': leaseId }] },
    )
    if (renewed.matchedCount === 0) lost = true
  }
  const heartbeat = setInterval(() => {
    void renew().catch(error => {
      lost = true
      logger.error('Patient file operation lease renewal failed', { error, patientProfileId })
    })
  }, Math.floor(FILE_OPERATION_LEASE_MS / 3))
  heartbeat.unref()

  const assertOwned = async () => {
    await renew()
    if (lost) throw new ApiError(StatusCodes.CONFLICT, 'Patient file upload lease was superseded')
  }
  const release = async () => {
    if (released) return
    released = true
    clearInterval(heartbeat)
    await PatientProfile.updateOne(
      { _id: patientProfileId },
      { $pull: { file_operation_leases: { lease_id: leaseId } } },
    ).catch(error => {
      // The lease expires on its own. Do not turn an otherwise successful
      // upload into an orphan merely because immediate lease cleanup failed.
      logger.error('Patient file operation lease release failed', { error, patientProfileId })
    })
  }
  return { assertOwned, release }
}

function broadOwnershipQuery(input: PatientFilePurgeInput) {
  return {
    $or: [
      { patient_profile_id: input.patientProfileId },
      { owner_user_id: input.ownerUserId },
    ],
  }
}

function strictOwnershipQuery(input: PatientFilePurgeInput, hospitalId: unknown) {
  return {
    patient_profile_id: input.patientProfileId,
    owner_user_id: input.ownerUserId,
    hospital_id: hospitalId,
    purpose: { $in: [FileAssetPurpose.INR_REPORT, FileAssetPurpose.PATIENT_PROFILE_PICTURE] },
  }
}

function embeddedObjectKeys(profile: any): string[] {
  const keys = new Set<string>()
  if (profile.profile_picture_url) keys.add(profile.profile_picture_url)
  for (const report of profile.inr_history ?? []) {
    if (report.file_url) keys.add(report.file_url)
  }
  return [...keys]
}

async function loadPurgeContext(input: PatientFilePurgeInput) {
  const [profile, user] = await Promise.all([
    PatientProfile.findById(input.patientProfileId).lean(),
    User.findOne({ _id: input.ownerUserId, profile_id: input.patientProfileId }).lean(),
  ])
  if (!profile || !user) throw new ApiError(StatusCodes.NOT_FOUND, 'Patient purge target not found')
  if (user.is_active || profile.account_status === 'Active') {
    throw new ApiError(StatusCodes.CONFLICT, 'Patient must be deactivated before files can be purged')
  }
  if (!profile.hospital_id) throw new ApiError(StatusCodes.CONFLICT, 'Patient hospital ownership is required for file purge')
  const assetQuery = strictOwnershipQuery(input, profile.hospital_id)
  const [assets, ownershipMismatch] = await Promise.all([
    FileAsset.find(assetQuery),
    FileAsset.findOne({ ...broadOwnershipQuery(input), $nor: [assetQuery] }).select('_id').lean(),
  ])
  if (ownershipMismatch) {
    throw new ApiError(StatusCodes.CONFLICT, 'Patient file ownership mismatch requires reconciliation before purge')
  }
  const typedAssets = assets as FileAssetDocument[]
  const trackedDefaultBucketKeys = new Set(
    typedAssets
      .filter(asset => asset.bucket === config.bucketName)
      .map(asset => asset.object_key),
  )
  const legacyKeys = embeddedObjectKeys(profile).filter(key => !trackedDefaultBucketKeys.has(key))
  if (legacyKeys.length > 0) {
    const [externalKeyOwner, otherPatientReference, doctorReference] = await Promise.all([
      FileAsset.findOne({
        bucket: config.bucketName,
        object_key: { $in: legacyKeys },
      }).select('_id').lean(),
      PatientProfile.findOne({
        _id: { $ne: input.patientProfileId },
        $or: [
          { profile_picture_url: { $in: legacyKeys } },
          { 'inr_history.file_url': { $in: legacyKeys } },
        ],
      }).select('_id').lean(),
      DoctorProfile.findOne({
        profile_picture_url: { $in: legacyKeys },
      }).select('_id').lean(),
    ])
    if (externalKeyOwner || otherPatientReference || doctorReference) {
      throw new ApiError(
        StatusCodes.CONFLICT,
        'Legacy patient file key has another metadata reference and requires reconciliation before purge',
      )
    }
  }
  return { assets: typedAssets, legacyKeys, assetQuery }
}

async function beginPurge(input: PatientFilePurgeInput) {
  const now = new Date()
  const executionId = randomUUID()
  await PatientProfile.updateOne(
    { _id: input.patientProfileId },
    { $pull: { file_operation_leases: { expires_at: { $lte: now } } } },
  )
  const profile = await PatientProfile.findOneAndUpdate(
    {
      _id: input.patientProfileId,
      account_status: { $in: ['Discharged', 'Deceased'] },
      $or: [
        { 'file_purge.state': { $ne: 'PURGING' } },
        { 'file_purge.lease_expires_at': { $lte: now } },
      ],
      file_operation_leases: { $not: { $elemMatch: { expires_at: { $gt: now } } } },
    },
    {
      $set: {
        'file_purge.state': 'PURGING',
        'file_purge.execution_id': executionId,
        'file_purge.lease_expires_at': new Date(now.getTime() + PURGE_EXECUTION_LEASE_MS),
        'file_purge.started_at': now,
      },
      $unset: {
        'file_purge.completed_at': '',
        'file_purge.last_error': '',
      },
    },
    { new: true },
  ).select('_id')
  if (!profile) {
    throw new ApiError(StatusCodes.CONFLICT, 'Patient must be inactive and have no upload in progress before file purge')
  }
  return executionId
}

async function renewPurgeExecution(input: PatientFilePurgeInput, executionId: string) {
  const result = await PatientProfile.updateOne(
    { _id: input.patientProfileId, 'file_purge.state': 'PURGING', 'file_purge.execution_id': executionId },
    { $set: { 'file_purge.lease_expires_at': new Date(Date.now() + PURGE_EXECUTION_LEASE_MS) } },
  )
  if (result.matchedCount === 0) throw new ApiError(StatusCodes.CONFLICT, 'Patient file purge execution was superseded')
}

async function markPurgeFailed(input: PatientFilePurgeInput, executionId: string, error: unknown) {
  await PatientProfile.updateOne(
    { _id: input.patientProfileId, 'file_purge.state': 'PURGING', 'file_purge.execution_id': executionId },
    {
      $set: {
        'file_purge.state': 'FAILED',
        'file_purge.last_error': (error instanceof Error ? error.message : 'Patient file purge failed').slice(0, 500),
      },
    },
  ).catch(trackingError => {
    logger.error('Unable to persist patient file purge failure state', { trackingError, patientProfileId: input.patientProfileId })
  })
}

/**
 * Deletes every tracked and legacy object owned by an inactive patient. This is
 * a mandatory precondition for the higher-level patient-data purge: callers
 * must abort patient-record deletion when PatientFilePurgeError is raised.
 * S3 DeleteObject is idempotent, so the workflow can safely be retried.
 */
export async function purgePatientFileAssets(input: PatientFilePurgeInput): Promise<PatientFilePurgeSummary> {
  const executionId = await beginPurge(input)
  const summary: PatientFilePurgeSummary = {
    trackedObjectsDeleted: 0,
    legacyObjectsDeleted: 0,
    metadataRecordsDeleted: 0,
    failures: 0,
  }

  try {
    const { assets, legacyKeys, assetQuery } = await loadPurgeContext(input)
    for (const asset of assets) {
      if (asset.status === FileAssetStatus.DELETED) continue
      await renewPurgeExecution(input, executionId)
      try {
        await purgeFilePermanently(asset.object_key, asset.bucket)
        await FileAsset.updateOne(
          { _id: asset._id },
          { $set: { status: FileAssetStatus.DELETED, deleted_at: new Date() }, $unset: { failure_reason: '' } },
        )
        summary.trackedObjectsDeleted += 1
      } catch (error) {
        summary.failures += 1
        await FileAsset.updateOne(
          { _id: asset._id, status: { $ne: FileAssetStatus.DELETED } },
          {
            $set: {
              status: FileAssetStatus.FAILED,
              failure_reason: error instanceof Error ? error.message.slice(0, 500) : 'Storage deletion failed',
            },
          },
        ).catch((trackingError) => {
          logger.error('Unable to persist failed patient file purge state', {
            trackingError,
            fileAssetId: asset._id,
          })
        })
      }
    }

    for (const key of legacyKeys) {
      await renewPurgeExecution(input, executionId)
      try {
        await purgeFilePermanently(key)
        summary.legacyObjectsDeleted += 1
      } catch (error) {
        summary.failures += 1
        logger.error('Legacy patient object purge failed', {
          error,
          patientProfileId: input.patientProfileId,
        })
      }
    }

    if (summary.failures > 0) throw new PatientFilePurgeError(summary)

    // A final ownership query is the reconciliation gate. Upload leases prevent
    // a new patient asset from being created after purge begins.
    await renewPurgeExecution(input, executionId)
    const residual = await FileAsset.countDocuments({
      ...assetQuery,
      status: { $ne: FileAssetStatus.DELETED },
    })
    if (residual > 0) throw new PatientFilePurgeError({ ...summary, failures: residual })

    const deletion = await FileAsset.deleteMany(assetQuery)
    summary.metadataRecordsDeleted = deletion.deletedCount
    const completion = await PatientProfile.updateOne(
      {
        _id: input.patientProfileId,
        'file_purge.state': 'PURGING',
        'file_purge.execution_id': executionId,
      },
      {
        $set: { 'file_purge.state': 'COMPLETE', 'file_purge.completed_at': new Date() },
        $unset: { 'file_purge.last_error': '', 'file_purge.lease_expires_at': '' },
      },
    )
    if (completion.matchedCount === 0) {
      throw new Error('Patient file purge completion state could not be persisted')
    }
    return summary
  } catch (error) {
    await markPurgeFailed(input, executionId, error)
    throw error
  }
}

export async function getPatientFilePurgePlan(input: PatientFilePurgeInput) {
  const { assets, legacyKeys } = await loadPurgeContext(input)
  return {
    trackedObjects: assets.filter(asset => asset.status !== FileAssetStatus.DELETED).length,
    trackedMetadataRecords: assets.length,
    legacyObjects: legacyKeys.length,
  }
}
