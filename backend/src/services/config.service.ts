import { AuthSession, SystemConfig } from '@alias/models'
import { ApiError } from '@alias/utils'
import { StatusCodes } from 'http-status-codes'

export const DEFAULT_FEATURE_FLAGS = {
  maintenance_mode: false,
  patient_registration_enabled: true,
  notifications_enabled: true,
} as const

export const MAX_SESSION_TIMEOUT_MINUTES = 1440

export async function getSystemConfig() {
  let config = await SystemConfig.findOne({ is_active: true })

  if (!config) {
    try {
      config = await SystemConfig.create({
        inr_thresholds: { critical_low: 1.5, critical_high: 4.5 },
        session_timeout_minutes: 30,
        rate_limit: { max_requests: 100, window_minutes: 15 },
        feature_flags: DEFAULT_FEATURE_FLAGS,
        is_active: true,
      })
    } catch (error: any) {
      if (error?.code !== 11000) throw error
      config = await SystemConfig.findOne({ is_active: true })
      if (!config) throw error
    }
  }

  return config
}

export async function updateSystemConfig(updates: {
  inr_thresholds?: { critical_low?: number; critical_high?: number }
  session_timeout_minutes?: number
  rate_limit?: { max_requests?: number; window_minutes?: number }
  feature_flags?: Record<string, boolean>
}) {
  let config = await SystemConfig.findOne({ is_active: true })

  if (!config) {
    validateInrThresholds(updates.inr_thresholds?.critical_low ?? 1.5, updates.inr_thresholds?.critical_high ?? 4.5)
    try {
      config = await SystemConfig.create({
        ...updates,
        is_active: true,
      })
    } catch (error: any) {
      if (error?.code !== 11000) throw error
      config = await SystemConfig.findOne({ is_active: true })
      if (!config) throw error
    }
  }

  // Deep merge updates
  if (updates.inr_thresholds) {
    const criticalLow = updates.inr_thresholds.critical_low ?? config.inr_thresholds.critical_low
    const criticalHigh = updates.inr_thresholds.critical_high ?? config.inr_thresholds.critical_high
    validateInrThresholds(criticalLow, criticalHigh)
    if (updates.inr_thresholds.critical_low !== undefined) {
      config.inr_thresholds.critical_low = updates.inr_thresholds.critical_low
    }
    if (updates.inr_thresholds.critical_high !== undefined) {
      config.inr_thresholds.critical_high = updates.inr_thresholds.critical_high
    }
  }

  if (updates.session_timeout_minutes !== undefined) {
    config.session_timeout_minutes = updates.session_timeout_minutes
  }

  if (updates.rate_limit) {
    if (updates.rate_limit.max_requests !== undefined) {
      config.rate_limit.max_requests = updates.rate_limit.max_requests
    }
    if (updates.rate_limit.window_minutes !== undefined) {
      config.rate_limit.window_minutes = updates.rate_limit.window_minutes
    }
  }

  if (updates.feature_flags) {
    for (const [key, value] of Object.entries(updates.feature_flags)) {
      config.feature_flags.set(key, value)
    }
  }

  await config.save()
  if (updates.session_timeout_minutes !== undefined) {
    // Auth middleware checks the sliding access expiry on every request. The
    // absolute refresh-family expiry remains unchanged.
    const now = new Date()
    await AuthSession.updateMany(
      {
        revoked_at: { $exists: false },
        expires_at: { $gt: now },
        $or: [
          { access_expires_at: { $gt: now } },
          { access_expires_at: { $exists: false } },
        ],
      },
      { $set: { access_expires_at: new Date(now.getTime() + updates.session_timeout_minutes * 60 * 1000) } }
    )
  }
  return config
}

/** Ensures a value cannot be classified as both critically low and high. */
export function validateInrThresholds(criticalLow: number, criticalHigh: number) {
  if (criticalLow >= criticalHigh) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'INR critical low threshold must be less than the critical high threshold.'
    )
  }
}

export async function getSessionTimeoutMinutes(): Promise<number> {
  const systemConfig = await getSystemConfig()
  return systemConfig.session_timeout_minutes
}

export async function isFeatureEnabled(feature: keyof typeof DEFAULT_FEATURE_FLAGS): Promise<boolean> {
  const systemConfig = await getSystemConfig()
  return systemConfig.feature_flags.get(feature) ?? DEFAULT_FEATURE_FLAGS[feature]
}
