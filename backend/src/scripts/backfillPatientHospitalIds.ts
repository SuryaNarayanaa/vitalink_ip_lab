import 'dotenv/config'
import mongoose from 'mongoose'
import connectDB from '@alias/config/db'
import { DoctorProfile, PatientProfile, User } from '@alias/models'
import { UserType } from '@alias/validators'
import { getObjectIdString } from '@alias/utils/objectid'

type CliOptions = { execute: boolean; limit?: number }

type Stats = {
  scanned: number
  alreadyScoped: number
  eligible: number
  updated: number
  wouldUpdate: number
  skippedUnassigned: number
  skippedUnknownDoctor: number
  skippedDoctorWithoutHospital: number
  skippedAmbiguous: number
  updateNoop: number
  updateFailed: number
}

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = { execute: false }
  for (const arg of argv) {
    if (arg === '--execute') { options.execute = true; continue }
    if (arg === '--dry-run') { options.execute = false; continue }
    if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length))
      if (!Number.isInteger(value) || value <= 0) throw new Error('--limit must be a positive integer')
      options.limit = value
      continue
    }
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: ts-node src/scripts/backfillPatientHospitalIds.ts [--dry-run] [--execute] [--limit=<n>]')
      console.log('Defaults to --dry-run. --execute writes only missing patient hospital_id values.')
      process.exit(0)
    }
    throw new Error(`Unknown argument "${arg}"`)
  }
  return options
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2))
  await connectDB()

  const stats: Stats = {
    scanned: 0, alreadyScoped: 0, eligible: 0, updated: 0, wouldUpdate: 0,
    skippedUnassigned: 0, skippedUnknownDoctor: 0, skippedDoctorWithoutHospital: 0,
    skippedAmbiguous: 0, updateNoop: 0, updateFailed: 0,
  }

  // Older records can refer to either users._id or doctorprofiles._id. Build both maps,
  // but only accept a mapping when it identifies exactly one doctor and one hospital.
  const doctors = await User.find({ user_type: UserType.DOCTOR }).select('_id profile_id').lean()
  const doctorProfileIds = doctors.map(doctor => doctor.profile_id).filter(Boolean)
  const profiles = await DoctorProfile.find({ _id: { $in: doctorProfileIds } }).select('_id hospital_id').lean()
  const profileById = new Map(profiles.map(profile => [getObjectIdString(profile._id), profile]))
  const hospitalByDoctorUserId = new Map<string, string | undefined>()
  const hospitalByDoctorProfileId = new Map<string, string | undefined>()

  for (const doctor of doctors) {
    const userId = getObjectIdString(doctor._id)
    const profileId = getObjectIdString(doctor.profile_id)
    const profile = profileId ? profileById.get(profileId) : undefined
    const hospitalId = profile ? getObjectIdString(profile.hospital_id) : undefined
    if (userId) hospitalByDoctorUserId.set(userId, hospitalId)
    if (profileId) hospitalByDoctorProfileId.set(profileId, hospitalId)
  }

  const cursor = PatientProfile.find({ hospital_id: null })
    .select('_id assigned_doctor_id hospital_id')
    .lean()
    .cursor()

  for await (const patient of cursor) {
    if (options.limit && stats.scanned >= options.limit) break
    stats.scanned += 1
    if (patient.hospital_id) { stats.alreadyScoped += 1; continue }

    const assignedDoctorId = getObjectIdString(patient.assigned_doctor_id)
    if (!assignedDoctorId) { stats.skippedUnassigned += 1; continue }

    const matchesUser = hospitalByDoctorUserId.has(assignedDoctorId)
    const matchesProfile = hospitalByDoctorProfileId.has(assignedDoctorId)
    if (matchesUser && matchesProfile) {
      stats.skippedAmbiguous += 1
      continue
    }
    if (!matchesUser && !matchesProfile) { stats.skippedUnknownDoctor += 1; continue }
    const hospitalId = matchesUser
      ? hospitalByDoctorUserId.get(assignedDoctorId)
      : hospitalByDoctorProfileId.get(assignedDoctorId)
    if (!hospitalId) { stats.skippedDoctorWithoutHospital += 1; continue }

    stats.eligible += 1
    if (!options.execute) { stats.wouldUpdate += 1; continue }
    try {
      const result = await PatientProfile.updateOne(
        { _id: patient._id, hospital_id: { $in: [null] } },
        { $set: { hospital_id: new mongoose.Types.ObjectId(hospitalId) } }
      )
      if (result.modifiedCount) stats.updated += 1
      else stats.updateNoop += 1
    } catch (error) {
      stats.updateFailed += 1
      console.error(`Failed to update ${getObjectIdString(patient._id) ?? '<unknown>'}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  console.log('--- Patient Hospital ID Backfill Summary ---')
  console.log(`Mode: ${options.execute ? 'LIVE (writes applied)' : 'DRY RUN (no writes)'}`)
  console.log(`Patient profiles scanned: ${stats.scanned}`)
  console.log(`Eligible: ${stats.eligible}`)
  console.log(options.execute ? `Updated: ${stats.updated}` : `Would update: ${stats.wouldUpdate}`)
  console.log(`Skipped: unassigned=${stats.skippedUnassigned}, unknown-doctor=${stats.skippedUnknownDoctor}, doctor-without-hospital=${stats.skippedDoctorWithoutHospital}, ambiguous=${stats.skippedAmbiguous}`)
  if (options.execute) console.log(`Update no-op: ${stats.updateNoop}; failed: ${stats.updateFailed}`)
  await mongoose.disconnect()
}

main().catch(async error => {
  console.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`)
  try { await mongoose.disconnect() } catch { /* ignore disconnect failures */ }
  process.exit(1)
})
