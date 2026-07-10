import cron from 'node-cron'
import { PatientProfile, User } from '@alias/models'
import { sendPushToUser } from '@alias/services/fcm.service'
import logger from '@alias/utils/logger'

// Runs every minute — checks for patients who haven't taken today's dose
cron.schedule('0 9 * * *', async () => {
  try {
    logger.info('[DosageScheduler] Running daily dosage reminder...')

    const today = new Date()
    const dayOfWeek = today.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()

    // Find all active patients who have a dose scheduled today
    const patients = await PatientProfile.find({
      [`weekly_dosage.${dayOfWeek}`]: { $gt: 0 },
    }).lean()

    for (const patient of patients) {
      try {
        // Find the user account linked to this patient profile
        const user = await User.findOne({
          profile_id: patient._id,
          user_type:  'PATIENT',
          is_active:  true,
        }).lean()

        if (!user) continue

        const dose = (patient.weekly_dosage as any)[dayOfWeek]
        const drugName = patient.medical_config?.therapy_drug ?? 'your medication'

        await sendPushToUser(String(user._id), {
          title: 'Time for your medication',
          body:  `Take your ${drugName} dose — ${dose}mg today.`,
          data:  {
            route:     'patient-details',
            patientId: String(patient._id),
          },
        })

        logger.info(`[DosageScheduler] Reminder sent to patient ${user._id}`)
      } catch (err) {
        logger.error(`[DosageScheduler] Failed for patient ${patient._id}`, { err })
      }
    }
  } catch (err) {
    logger.error('[DosageScheduler] Cron job failed', { err })
  }
})

logger.info('[DosageScheduler] Dosage reminder cron registered — fires daily at 9:00 AM')