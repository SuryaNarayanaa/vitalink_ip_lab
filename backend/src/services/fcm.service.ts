import { getFirebaseMessaging } from '@alias/config/firebase.config'
import DeviceToken from '@alias/models/DeviceToken.model'
import { isFeatureEnabled } from '@alias/services/config.service'
import logger from '@alias/utils/logger'
import User from '@alias/models/user.model'
import { hasActiveClinicalHospitalAccess, hasActiveHospitalAccess } from '@alias/services/hospital-access.service'

export interface PushPayload {
  title: string
  body: string
  data?: Record<string, string> // all values must be strings for FCM
}

export type PushSendResult = {
  success: boolean
  skipped: boolean
  skipReason?: 'fcm_disabled' | 'no_tokens' | 'notifications_paused' | 'permanent_token_failures' | 'expired_notification' | 'recipient_unavailable' | 'notification_cancelled'
  successCount: number
  failureCount: number
  providerMessageIds: string[]
  successfulDeviceTokenIds: string[]
  permanentFailures: number
  hasTransientFailure: boolean
  errorCode?: string
  errorMessage?: string
}

export type PushRecipientPolicy = 'clinical' | 'general'
export type FinalDeliveryGateResult = true | Exclude<PushSendResult['skipReason'], undefined>

const PERMANENT_TOKEN_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
])

const TRANSIENT_ERROR_CODES = new Set([
  'messaging/server-unavailable',
  'messaging/internal-error',
  'messaging/unknown-error',
  'messaging/message-rate-exceeded',
  'messaging/quota-exceeded',
  'messaging/third-party-auth-error',
])

function isTransientProviderError(code?: string, message?: string): boolean {
  if (code && TRANSIENT_ERROR_CODES.has(code)) return true
  if (code && PERMANENT_TOKEN_ERROR_CODES.has(code)) return false
  // Network / unexpected provider failures without a known permanent code are retryable.
  if (!code && message) return true
  if (code?.startsWith('messaging/')) {
    // Unknown messaging codes: retry unless clearly permanent-token.
    return !PERMANENT_TOKEN_ERROR_CODES.has(code)
  }
  return true
}

/**
 * Send a push to all active devices for a user.
 * Invalid tokens are deactivated only when still owned by the same user.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  excludedDeviceTokenIds: string[] = [],
  deliveryValidUntil?: Date,
  recipientPolicy: PushRecipientPolicy = 'clinical',
  finalDeliveryGate?: () => Promise<FinalDeliveryGateResult>,
): Promise<PushSendResult> {
  const messaging = getFirebaseMessaging()
  if (!messaging) {
    return {
      success: true,
      skipped: true,
      skipReason: 'fcm_disabled',
      successCount: 0,
      failureCount: 0,
      providerMessageIds: [],
      successfulDeviceTokenIds: [],
      permanentFailures: 0,
      hasTransientFailure: false,
    }
  }

  const tokens = await DeviceToken.find(
    {
      user_id: userId,
      is_active: true,
      ...(excludedDeviceTokenIds.length ? { _id: { $nin: excludedDeviceTokenIds } } : {}),
    },
    { fcm_token: 1 }
  ).lean()

  // Keep the operational pause check after the awaited lookup even when it
  // returns no rows. Pausing must leave durable work resumable rather than
  // consuming an attempt and terminalizing it as a no-token delivery.
  if (!await isFeatureEnabled('notifications_enabled')) {
    return {
      success: true,
      skipped: true,
      skipReason: 'notifications_paused',
      successCount: 0,
      failureCount: 0,
      providerMessageIds: [],
      successfulDeviceTokenIds: [],
      permanentFailures: 0,
      hasTransientFailure: false,
    }
  }

  if (deliveryValidUntil && deliveryValidUntil <= new Date()) {
    return {
      success: true, skipped: true, skipReason: 'expired_notification',
      successCount: 0, failureCount: 0, providerMessageIds: [],
      successfulDeviceTokenIds: [], permanentFailures: 0, hasTransientFailure: false,
    }
  }

  if (!tokens.length) {
    return {
      success: true,
      skipped: true,
      skipReason: 'no_tokens',
      successCount: 0,
      failureCount: 0,
      providerMessageIds: [],
      successfulDeviceTokenIds: [],
      permanentFailures: 0,
      hasTransientFailure: false,
    }
  }

  // Revalidate the recipient after the awaited token lookup, immediately
  // before PHI-bearing content crosses the provider boundary. A hospital may
  // enter suspension while tokens are being loaded.
  const recipient = await User.findById(userId)
    .select('is_active user_type profile_id')
    .lean()
  const recipientEligible = recipient?.is_active && await (
    recipientPolicy === 'clinical'
      ? hasActiveClinicalHospitalAccess(recipient)
      : hasActiveHospitalAccess(recipient)
  )
  if (!recipientEligible) {
    return {
      success: true, skipped: true, skipReason: 'recipient_unavailable',
      successCount: 0, failureCount: 0, providerMessageIds: [],
      successfulDeviceTokenIds: [], permanentFailures: 0, hasTransientFailure: false,
    }
  }

  const fcmTokens = tokens.map((t) => t.fcm_token)

  // These checks must remain after every awaited recipient/tenant lookup. This
  // is the final provider disclosure boundary: an operator can pause delivery,
  // or a clinical deadline can pass, while eligibility is being resolved.
  if (!await isFeatureEnabled('notifications_enabled')) {
    return {
      success: true, skipped: true, skipReason: 'notifications_paused',
      successCount: 0, failureCount: 0, providerMessageIds: [],
      successfulDeviceTokenIds: [], permanentFailures: 0, hasTransientFailure: false,
    }
  }
  if (deliveryValidUntil && deliveryValidUntil <= new Date()) {
    return {
      success: true, skipped: true, skipReason: 'expired_notification',
      successCount: 0, failureCount: 0, providerMessageIds: [],
      successfulDeviceTokenIds: [], permanentFailures: 0, hasTransientFailure: false,
    }
  }
  // Repeat pause/deadline after all eligibility reads. The lease-bound durable
  // handoff below must be the final awaited operation before the provider call.
  if (!await isFeatureEnabled('notifications_enabled')) {
    return {
      success: true, skipped: true, skipReason: 'notifications_paused',
      successCount: 0, failureCount: 0, providerMessageIds: [],
      successfulDeviceTokenIds: [], permanentFailures: 0, hasTransientFailure: false,
    }
  }
  if (deliveryValidUntil && deliveryValidUntil <= new Date()) {
    return {
      success: true, skipped: true, skipReason: 'expired_notification',
      successCount: 0, failureCount: 0, providerMessageIds: [],
      successfulDeviceTokenIds: [], permanentFailures: 0, hasTransientFailure: false,
    }
  }
  const finalGateResult = finalDeliveryGate ? await finalDeliveryGate() : true
  if (finalGateResult !== true) {
    return {
      success: true, skipped: true, skipReason: finalGateResult,
      successCount: 0, failureCount: 0, providerMessageIds: [],
      successfulDeviceTokenIds: [], permanentFailures: 0, hasTransientFailure: false,
    }
  }

  const response = await messaging.sendEachForMulticast({
    tokens: fcmTokens,
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: payload.data ?? {},
    android: { priority: 'high' },
    apns: { payload: { aps: { sound: 'default' } } },
  })

  const providerMessageIds: string[] = []
  const successfulDeviceTokenIds: string[] = []
  let permanentFailures = 0
  let hasTransientFailure = false
  let firstErrorCode: string | undefined
  let firstErrorMessage: string | undefined
  const invalidTokenCleanup: Promise<unknown>[] = []

  for (let i = 0; i < response.responses.length; i++) {
    const res = response.responses[i]
    if (res.success) {
      if (res.messageId) providerMessageIds.push(res.messageId)
      if (tokens[i]?._id) successfulDeviceTokenIds.push(String(tokens[i]._id))
      continue
    }

    const code = res.error?.code
    const message = res.error?.message
    if (!firstErrorCode && code) firstErrorCode = code
    if (!firstErrorMessage && message) firstErrorMessage = message

    if (code && PERMANENT_TOKEN_ERROR_CODES.has(code)) {
      permanentFailures += 1
      // Only deactivate when the token is still owned by this user.
      invalidTokenCleanup.push(
        DeviceToken.updateOne(
          { fcm_token: fcmTokens[i], user_id: userId, is_active: true },
          { $set: { is_active: false } }
        )
      )
      continue
    }

    if (isTransientProviderError(code, message)) {
      hasTransientFailure = true
    } else {
      permanentFailures += 1
    }
  }

  const successCount = response.successCount
  const failureCount = response.failureCount
  const cleanupResults = await Promise.allSettled(invalidTokenCleanup)
  const cleanupFailures = cleanupResults.filter(result => result.status === 'rejected').length
  if (cleanupFailures > 0) {
    // Provider acceptance evidence must survive local hygiene failures. Do not
    // include token values or provider error bodies in this security log.
    logger.error('fcm.invalid_token_cleanup_failed', { userId, cleanupFailures })
  }

  // Transient partial failures should retry. Pure permanent failures complete,
  // but zero accepted devices is a terminal non-delivery rather than success.
  const noDeviceAccepted = successCount === 0 && !hasTransientFailure && permanentFailures > 0
  const success = !hasTransientFailure && !noDeviceAccepted

  return {
    success,
    skipped: noDeviceAccepted,
    ...(noDeviceAccepted ? { skipReason: 'permanent_token_failures' as const } : {}),
    successCount,
    failureCount,
    providerMessageIds,
    successfulDeviceTokenIds,
    permanentFailures,
    hasTransientFailure,
    errorCode: firstErrorCode,
    errorMessage: firstErrorMessage,
  }
}
