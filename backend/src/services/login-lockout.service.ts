import mongoose from 'mongoose'
import { config } from '@alias/config'
import { User } from '@alias/models'

/**
 * Increment failed login attempts and lock the account once the threshold is
 * reached. Used for password failures and second-factor (OTP/TOTP) failures so
 * re-authenticating with the password alone cannot reset the budget.
 */
export async function recordFailedLoginAttempt(userId: string | mongoose.Types.ObjectId) {
  const failedAt = new Date()
  const lockedUntil = new Date(failedAt.getTime() + config.accountLockoutMinutes * 60 * 1000)
  const updatedUser = await User.findOneAndUpdate(
    { _id: userId, is_active: true },
    [
      {
        $set: {
          failed_login_attempts: { $add: [{ $ifNull: ['$failed_login_attempts', 0] }, 1] },
          last_failed_login_at: failedAt,
        },
      },
      {
        $set: {
          locked_until: {
            $cond: [
              { $gte: ['$failed_login_attempts', config.maxFailedLoginAttempts] },
              lockedUntil,
              '$locked_until',
            ],
          },
        },
      },
    ],
    { new: true, updatePipeline: true },
  )
  const failedAttempts = updatedUser?.failed_login_attempts ?? 0
  return {
    failedAttempts,
    lockedUntil: updatedUser?.locked_until as Date | undefined,
    accountLocked: failedAttempts >= config.maxFailedLoginAttempts
      || Boolean(updatedUser?.locked_until && new Date(updatedUser.locked_until).getTime() > Date.now()),
  }
}

export async function clearLoginFailures(userId: string | mongoose.Types.ObjectId) {
  await User.updateOne(
    { _id: userId },
    { $set: { failed_login_attempts: 0 }, $unset: { locked_until: 1 } },
  )
}

export function accountLockoutWindowStart(now = new Date()) {
  return new Date(now.getTime() - config.accountLockoutMinutes * 60 * 1000)
}
