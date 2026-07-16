import 'dotenv/config'
import mongoose from 'mongoose'
import { config } from '@alias/config'
import { PatientProfile, User } from '@alias/models'
import { UserType } from '@alias/validators'
import { getPatientFilePurgePlan, purgePatientFileAssets } from '@alias/services/patient-file-purge.service'

function parseArgs(argv: string[]) {
  const patientArg = argv.find(arg => arg.startsWith('--patient='))?.slice('--patient='.length)
  if (!patientArg) throw new Error('Usage: --patient=<user id, login id, or profile id> [--execute]')
  return { patientArg, execute: argv.includes('--execute') }
}

async function resolvePatient(identifier: string) {
  let user = await User.findOne({ login_id: identifier, user_type: UserType.PATIENT })
  if (!user && mongoose.isValidObjectId(identifier)) {
    user = await User.findOne({ _id: identifier, user_type: UserType.PATIENT })
    if (!user) {
      const profile = await PatientProfile.findById(identifier).select('_id')
      if (profile) user = await User.findOne({ profile_id: profile._id, user_type: UserType.PATIENT })
    }
  }
  if (!user) throw new Error('Patient not found')
  return { ownerUserId: user._id, patientProfileId: user.profile_id }
}

export async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  await mongoose.connect(config.databaseUrl)
  const target = await resolvePatient(args.patientArg)
  const plan = await getPatientFilePurgePlan(target)
  console.log(JSON.stringify({ mode: args.execute ? 'execute' : 'dry-run', ...plan }, null, 2))
  if (!args.execute) return
  const summary = await purgePatientFileAssets(target)
  console.log(JSON.stringify({ mode: 'complete', ...summary }, null, 2))
}

if (require.main === module) {
  run()
    .catch(error => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
    .finally(() => mongoose.disconnect())
}
