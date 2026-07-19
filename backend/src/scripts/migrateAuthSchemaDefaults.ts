import 'dotenv/config'
import mongoose from 'mongoose'
import connectDB, {
  ensureAuthGenerationDefaults,
  ensureChallengeAuditRetention,
} from '@alias/config/db'

/**
 * Operational migration for auth-related schema defaults and challenge
 * retention indexes.
 *
 * Formerly ran on every connectDB() boot; that does not scale under
 * multi-instance deploys. Run deliberately after deploy (or once per
 * environment upgrade):
 *
 *   npm run migrate:auth-schema-defaults
 *   npm run migrate:auth-schema-defaults:prod
 *
 * Both steps are idempotent and safe to re-run.
 */
async function main() {
  await connectDB()

  console.log('--- Auth Schema Defaults Migration ---')
  console.log('Step 1/2: ensureAuthGenerationDefaults (security_version / factor backfill)')
  await ensureAuthGenerationDefaults()
  console.log('Step 1/2: complete')

  console.log('Step 2/2: ensureChallengeAuditRetention (purge_at + indexes)')
  await ensureChallengeAuditRetention()
  console.log('Step 2/2: complete')

  console.log('Auth schema migration finished successfully.')
  await mongoose.disconnect()
}

main().catch(async (error) => {
  console.error(
    `Auth schema migration failed: ${error instanceof Error ? error.message : String(error)}`,
  )
  try {
    await mongoose.disconnect()
  } catch {
    // Ignore disconnect errors on failure path.
  }
  process.exit(1)
})
