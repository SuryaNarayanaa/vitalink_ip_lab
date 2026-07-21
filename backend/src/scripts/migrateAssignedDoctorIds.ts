import 'dotenv/config'
import mongoose from 'mongoose'
import connectDB from '@alias/config/db'
import { PatientProfile, User } from '@alias/models'
import { UserType } from '@alias/validators'
import { getObjectIdString } from '@alias/utils/objectid'

type CliOptions = {
  dryRun: boolean
  limit?: number
}

type MigrationStats = {
  scanned: number
  canonicalAlready: number
  legacyFound: number
  updated: number
  wouldUpdate: number
  skippedUnmapped: number
  skippedAmbiguous: number
  skippedInvalid: number
  updateNoop: number
  updateFailed: number
}

function parseCliArgs(argv: string[]): CliOptions {
  // Default to dry-run; require explicit --execute to mutate.
  const options: CliOptions = { dryRun: true }

  for (const arg of argv) {
    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (arg === '--execute') {
      options.dryRun = false
      continue
    }
    if (arg.startsWith('--limit=')) {
      const raw = arg.split('=')[1]
      const parsed = Number(raw)
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid --limit value "${raw}". Use a positive integer.`)
      }
      options.limit = parsed
      continue
    }
    if (arg === '--help' || arg === '-h') {
      printUsageAndExit(0)
    }
    throw new Error(`Unknown argument "${arg}"`)
  }

  return options
}

function printUsageAndExit(code: number): never {
  console.log('Usage: ts-node src/scripts/migrateAssignedDoctorIds.ts [--dry-run] [--execute] [--limit=<n>]')
  console.log('')
  console.log('Defaults to dry-run. Pass --execute to apply writes.')
  console.log('Options:')
  console.log('  --dry-run    Preview changes without writing to database (default)')
  console.log('  --execute    Apply updates to the database')
  console.log('  --limit      Scan only first N patient profiles (useful for smoke checks)')
  process.exit(code)
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2))

  await connectDB()

  const stats: MigrationStats = {
    scanned: 0,
    canonicalAlready: 0,
    legacyFound: 0,
    updated: 0,
    wouldUpdate: 0,
    skippedUnmapped: 0,
    skippedAmbiguous: 0,
    skippedInvalid: 0,
    updateNoop: 0,
    updateFailed: 0,
  }

  const doctorUsers = await User.find({ user_type: UserType.DOCTOR }).select('_id profile_id login_id').lean()
  const doctorUserIds = new Set<string>()
  const profileIdToDoctorUserId = new Map<string, string>()

  for (const doctorUser of doctorUsers) {
    const userId = getObjectIdString(doctorUser._id)
    const profileId = getObjectIdString(doctorUser.profile_id)
    if (!userId) {
      continue
    }
    doctorUserIds.add(userId)
    if (profileId) {
      profileIdToDoctorUserId.set(profileId, userId)
    }
  }

  const cursor = PatientProfile.find({
    assigned_doctor_id: { $exists: true, $ne: null },
  })
    .select('_id assigned_doctor_id')
    .lean()
    .cursor()

  for await (const profile of cursor) {
    if (options.limit && stats.scanned >= options.limit) {
      break
    }

    stats.scanned += 1

    const assignedDoctorId = getObjectIdString(profile.assigned_doctor_id)
    if (!assignedDoctorId) {
      stats.skippedInvalid += 1
      continue
    }

    const isDoctorUserId = doctorUserIds.has(assignedDoctorId)
    const mappedDoctorUserId = profileIdToDoctorUserId.get(assignedDoctorId)

    if (isDoctorUserId && mappedDoctorUserId) {
      // Highly unlikely ObjectId collision; skip safely instead of guessing.
      stats.skippedAmbiguous += 1
      continue
    }

    if (isDoctorUserId) {
      stats.canonicalAlready += 1
      continue
    }

    if (!mappedDoctorUserId) {
      stats.skippedUnmapped += 1
      continue
    }

    stats.legacyFound += 1

    if (options.dryRun) {
      stats.wouldUpdate += 1
      continue
    }

    try {
      const result = await PatientProfile.updateOne(
        { _id: profile._id, assigned_doctor_id: profile.assigned_doctor_id },
        { $set: { assigned_doctor_id: new mongoose.Types.ObjectId(mappedDoctorUserId) } }
      )

      if (result.modifiedCount > 0) {
        stats.updated += 1
      } else {
        stats.updateNoop += 1
      }
    } catch (error) {
      stats.updateFailed += 1
      console.error(
        `Failed to migrate profile ${getObjectIdString(profile._id) ?? '<unknown>'}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  console.log('--- Assigned Doctor ID Migration Summary ---')
  console.log(`Mode: ${options.dryRun ? 'DRY RUN (no writes)' : 'LIVE (writes applied)'}`)
  console.log(`Doctor users indexed: ${doctorUsers.length}`)
  console.log(`Patient profiles scanned: ${stats.scanned}`)
  console.log(`Already canonical (doctor user _id): ${stats.canonicalAlready}`)
  console.log(`Legacy profile_id assignments detected: ${stats.legacyFound}`)
  if (options.dryRun) {
    console.log(`Would update: ${stats.wouldUpdate}`)
  } else {
    console.log(`Updated: ${stats.updated}`)
    console.log(`Update no-op (concurrent change/not matched): ${stats.updateNoop}`)
    console.log(`Update failed: ${stats.updateFailed}`)
  }
  console.log(`Skipped (unmapped assigned_doctor_id): ${stats.skippedUnmapped}`)
  console.log(`Skipped (invalid assigned_doctor_id): ${stats.skippedInvalid}`)
  console.log(`Skipped (ambiguous collision): ${stats.skippedAmbiguous}`)

  await mongoose.disconnect()
}

main().catch(async (error) => {
  console.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`)
  try {
    await mongoose.disconnect()
  } catch {
    // Ignore disconnect errors on failure path.
  }
  process.exit(1)
})
