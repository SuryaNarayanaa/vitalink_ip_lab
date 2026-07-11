import 'dotenv/config'
import path from 'path'
import mongoose from 'mongoose'
import connectDB from '@alias/config/db'
import { config } from '@alias/config'
import { DoctorProfile, FileAsset, PatientProfile, User } from '@alias/models'
import { FileAssetPurpose, FileAssetStatus, FileAssetStorageProvider } from '@alias/models/fileasset.model'
import { readStoredFileMetadata } from '@alias/utils/fileUpload'

type Options = { execute: boolean; limit?: number }
export type MigrationStats = {
  profiles: number
  candidates: number
  wouldCreate: number
  wouldAttach: number
  created: number
  attached: number
  skipped: number
  failed: number
}

export const createMigrationStats = (): MigrationStats => ({
  profiles: 0,
  candidates: 0,
  wouldCreate: 0,
  wouldAttach: 0,
  created: 0,
  attached: 0,
  skipped: 0,
  failed: 0,
})

function parseArgs(args: string[]): Options {
  const options: Options = { execute: false }
  for (const arg of args) {
    if (arg === '--execute') options.execute = true
    else if (arg.startsWith('--limit=')) {
      const limit = Number(arg.slice('--limit='.length))
      if (!Number.isInteger(limit) || limit <= 0) throw new Error('--limit must be a positive integer')
      options.limit = limit
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: npm run migrate:file-assets -- [--execute] [--limit=N]')
      console.log('Defaults to dry-run. Pass --execute to write FileAsset records and references.')
      process.exit(0)
    } else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

export async function findOrCreateAsset(input: {
  objectKey: string
  hospitalId: unknown
  ownerUserId: unknown
  patientProfileId?: unknown
  purpose: FileAssetPurpose
  execute: boolean
}, stats: MigrationStats): Promise<any> {
  stats.candidates += 1
  const bucket = config.bucketName
  if (!bucket || !input.hospitalId || !input.ownerUserId) {
    stats.skipped += 1
    return null
  }
  const existing = await FileAsset.findOne({ bucket, object_key: input.objectKey })
  if (existing) {
    const matchesOwnership = (
      String(existing.hospital_id) === String(input.hospitalId) &&
      String(existing.owner_user_id) === String(input.ownerUserId) &&
      existing.purpose === input.purpose &&
      existing.status === FileAssetStatus.ACTIVE &&
      (!input.patientProfileId || String(existing.patient_profile_id) === String(input.patientProfileId))
    )
    if (!matchesOwnership) {
      throw new Error(`Existing FileAsset ownership/status conflicts with ${input.objectKey}`)
    }
    return existing
  }
  const metadata = await readStoredFileMetadata(input.objectKey, bucket)
  if (!input.execute) {
    stats.wouldCreate += 1
    return { _id: null, validated: true }
  }
  const asset = await FileAsset.create({
    hospital_id: input.hospitalId,
    owner_user_id: input.ownerUserId,
    patient_profile_id: input.patientProfileId,
    purpose: input.purpose,
    storage_provider: FileAssetStorageProvider.S3_COMPATIBLE,
    bucket,
    object_key: input.objectKey,
    original_filename: path.basename(input.objectKey),
    detected_mime: metadata.detectedMime,
    byte_size: metadata.byteSize,
    sha256_checksum: metadata.sha256Checksum,
    status: FileAssetStatus.ACTIVE,
    created_by: input.ownerUserId,
  } as any)
  stats.created += 1
  return asset
}

export async function migratePatients(options: Options, stats: MigrationStats) {
  const cursor = PatientProfile.find({
    $or: [
      { profile_picture_url: { $exists: true, $nin: ['', null] } },
      { 'inr_history.file_url': { $exists: true, $nin: ['', null] } },
    ],
  }).cursor()

  for await (const profile of cursor) {
    if (options.limit && stats.profiles >= options.limit) break
    stats.profiles += 1
    const owner = await User.findOne({ profile_id: profile._id, user_type: 'PATIENT' }).select('_id')
    if (!owner || !profile.hospital_id) { stats.skipped += 1; continue }
    let changed = false

    if (profile.profile_picture_url && !profile.profile_picture_file_asset_id) {
      try {
        const asset = await findOrCreateAsset({
          objectKey: profile.profile_picture_url,
          hospitalId: profile.hospital_id,
          ownerUserId: owner._id,
          patientProfileId: profile._id,
          purpose: FileAssetPurpose.PATIENT_PROFILE_PICTURE,
          execute: options.execute,
        }, stats)
        if (asset && options.execute) { profile.profile_picture_file_asset_id = asset._id; changed = true; stats.attached += 1 }
        else if (asset) stats.wouldAttach += 1
      } catch (error) { stats.failed += 1; console.error(`Patient profile asset failed (${profile._id}):`, error) }
    }

    for (const report of profile.inr_history ?? []) {
      if (!report.file_url || report.file_asset_id) continue
      try {
        const asset = await findOrCreateAsset({
          objectKey: report.file_url,
          hospitalId: profile.hospital_id,
          ownerUserId: owner._id,
          patientProfileId: profile._id,
          purpose: FileAssetPurpose.INR_REPORT,
          execute: options.execute,
        }, stats)
        if (asset && options.execute) { report.file_asset_id = asset._id; changed = true; stats.attached += 1 }
        else if (asset) stats.wouldAttach += 1
      } catch (error) { stats.failed += 1; console.error(`INR report asset failed (${report._id}):`, error) }
    }
    if (changed) await profile.save()
  }
}

export async function migrateDoctors(options: Options, stats: MigrationStats) {
  const cursor = DoctorProfile.find({
    profile_picture_url: { $exists: true, $nin: ['', null] },
    profile_picture_file_asset_id: { $exists: false },
  }).cursor()
  for await (const profile of cursor) {
    if (options.limit && stats.profiles >= options.limit) break
    stats.profiles += 1
    const owner = await User.findOne({ profile_id: profile._id, user_type: 'DOCTOR' }).select('_id')
    if (!owner || !profile.hospital_id || !profile.profile_picture_url) { stats.skipped += 1; continue }
    try {
      const asset = await findOrCreateAsset({
        objectKey: profile.profile_picture_url,
        hospitalId: profile.hospital_id,
        ownerUserId: owner._id,
        purpose: FileAssetPurpose.DOCTOR_PROFILE_PICTURE,
        execute: options.execute,
      }, stats)
      if (asset && options.execute) {
        profile.profile_picture_file_asset_id = asset._id
        await profile.save()
        stats.attached += 1
      } else if (asset) stats.wouldAttach += 1
    } catch (error) { stats.failed += 1; console.error(`Doctor profile asset failed (${profile._id}):`, error) }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const stats = createMigrationStats()
  await connectDB()
  await migratePatients(options, stats)
  await migrateDoctors(options, stats)
  console.log('--- FileAsset Backfill Summary ---')
  console.log(`Mode: ${options.execute ? 'EXECUTE' : 'DRY RUN (default)'}`)
  console.log(stats)
  await mongoose.disconnect()
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error('FileAsset backfill failed:', error)
    await mongoose.disconnect().catch(() => undefined)
    process.exit(1)
  })
}
