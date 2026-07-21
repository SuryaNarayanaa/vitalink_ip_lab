import 'dotenv/config'
import mongoose from 'mongoose'
import connectDB from '@alias/config/db'
import { PatientProfile } from '@alias/models'
import { getSystemConfig } from '@alias/services/config.service'
import { getObjectIdString } from '@alias/utils/objectid'

type CliOptions = {
  dryRun: boolean
  limit?: number
}

type MigrationStats = {
  scannedProfiles: number
  scannedReports: number
  updatedProfiles: number
  updatedReports: number
  wouldUpdateProfiles: number
  wouldUpdateReports: number
  skippedProfiles: number
  failedProfiles: number
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
  console.log('Usage: ts-node src/scripts/migrateInrCriticalFlags.ts [--dry-run] [--execute] [--limit=<n>]')
  console.log('')
  console.log('Defaults to dry-run. Pass --execute to apply writes.')
  console.log('Options:')
  console.log('  --dry-run    Preview changes without writing to database (default)')
  console.log('  --execute    Apply updates to the database')
  console.log('  --limit      Scan only first N patient profiles')
  process.exit(code)
}

function getSafeInrThresholds(thresholds: { critical_low?: number; critical_high?: number } | undefined) {
  const defaultThresholds = { criticalLow: 1.5, criticalHigh: 4.5 }
  const rawLow = thresholds?.critical_low
  const rawHigh = thresholds?.critical_high
  const criticalLow = typeof rawLow === 'number' && Number.isFinite(rawLow) ? rawLow : defaultThresholds.criticalLow
  const criticalHigh = typeof rawHigh === 'number' && Number.isFinite(rawHigh) ? rawHigh : defaultThresholds.criticalHigh

  if (criticalLow >= criticalHigh) {
    return defaultThresholds
  }

  return { criticalLow, criticalHigh }
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2))
  await connectDB()

  const config = await getSystemConfig()
  const { criticalLow, criticalHigh } = getSafeInrThresholds(config?.inr_thresholds)

  const stats: MigrationStats = {
    scannedProfiles: 0,
    scannedReports: 0,
    updatedProfiles: 0,
    updatedReports: 0,
    wouldUpdateProfiles: 0,
    wouldUpdateReports: 0,
    skippedProfiles: 0,
    failedProfiles: 0,
  }

  const cursor = PatientProfile.find({ 'inr_history.0': { $exists: true } })
    .select('_id inr_history')
    .cursor()

  for await (const profile of cursor) {
    if (options.limit && stats.scannedProfiles >= options.limit) {
      break
    }

    stats.scannedProfiles += 1

    const history = Array.isArray(profile.inr_history) ? profile.inr_history : []
    if (history.length === 0) {
      stats.skippedProfiles += 1
      continue
    }

    let changedInThisProfile = 0

    for (const report of history) {
      stats.scannedReports += 1
      const inrValue = report?.inr_value
      if (typeof inrValue !== 'number' || !Number.isFinite(inrValue)) {
        continue
      }

      const expectedIsCritical = inrValue < criticalLow || inrValue > criticalHigh
      if (report.is_critical !== expectedIsCritical) {
        report.is_critical = expectedIsCritical
        changedInThisProfile += 1
      }
    }

    if (changedInThisProfile === 0) {
      continue
    }

    if (options.dryRun) {
      stats.wouldUpdateProfiles += 1
      stats.wouldUpdateReports += changedInThisProfile
      continue
    }

    try {
      await profile.save()
      stats.updatedProfiles += 1
      stats.updatedReports += changedInThisProfile
    } catch (error) {
      stats.failedProfiles += 1
      console.error(
        `Failed to migrate patient profile ${getObjectIdString(profile._id) ?? '<unknown>'}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  console.log('--- INR Critical Flag Migration Summary ---')
  console.log(`Mode: ${options.dryRun ? 'DRY RUN (no writes)' : 'LIVE (writes applied)'}`)
  console.log(`Thresholds used: critical_low=${criticalLow}, critical_high=${criticalHigh}`)
  console.log(`Patient profiles scanned: ${stats.scannedProfiles}`)
  console.log(`INR reports scanned: ${stats.scannedReports}`)
  if (options.dryRun) {
    console.log(`Would update profiles: ${stats.wouldUpdateProfiles}`)
    console.log(`Would update reports: ${stats.wouldUpdateReports}`)
  } else {
    console.log(`Updated profiles: ${stats.updatedProfiles}`)
    console.log(`Updated reports: ${stats.updatedReports}`)
    console.log(`Failed profiles: ${stats.failedProfiles}`)
  }
  console.log(`Skipped profiles (no history): ${stats.skippedProfiles}`)

  if (stats.failedProfiles > 0) {
    process.exitCode = 1
  }

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
