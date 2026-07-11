import { getFirebaseMessaging } from '@alias/config/firebase.config'
import DeviceToken from '@alias/models/DeviceToken.model'

export interface PushPayload {
  title: string
  body: string
  data?: Record<string, string> // all values must be strings for FCM
}

export type PushSendResult = {
  success: boolean
  skipped: boolean
  skipReason?: 'fcm_disabled' | 'no_tokens'
  successCount: number
  failureCount: number
  providerMessageIds: string[]
  permanentFailures: number
  hasTransientFailure: boolean
  errorCode?: string
  errorMessage?: string
}

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
  payload: PushPayload
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
      permanentFailures: 0,
      hasTransientFailure: false,
    }
  }

  const tokens = await DeviceToken.find(
    { user_id: userId, is_active: true },
    { fcm_token: 1 }
  ).lean()

  if (!tokens.length) {
    return {
      success: true,
      skipped: true,
      skipReason: 'no_tokens',
      successCount: 0,
      failureCount: 0,
      providerMessageIds: [],
      permanentFailures: 0,
      hasTransientFailure: false,
    }
  }

  const fcmTokens = tokens.map((t) => t.fcm_token)

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
  let permanentFailures = 0
  let hasTransientFailure = false
  let firstErrorCode: string | undefined
  let firstErrorMessage: string | undefined

  for (let i = 0; i < response.responses.length; i++) {
    const res = response.responses[i]
    if (res.success) {
      if (res.messageId) providerMessageIds.push(res.messageId)
      continue
    }

    const code = res.error?.code
    const message = res.error?.message
    if (!firstErrorCode && code) firstErrorCode = code
    if (!firstErrorMessage && message) firstErrorMessage = message

    if (code && PERMANENT_TOKEN_ERROR_CODES.has(code)) {
      permanentFailures += 1
      // Only deactivate when the token is still owned by this user.
      await DeviceToken.updateOne(
        { fcm_token: fcmTokens[i], user_id: userId, is_active: true },
        { $set: { is_active: false } }
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
  // Transient partial failures should retry; pure permanent failures complete.
  const success = !hasTransientFailure

  return {
    success,
    skipped: false,
    successCount,
    failureCount,
    providerMessageIds,
    permanentFailures,
    hasTransientFailure,
    errorCode: firstErrorCode,
    errorMessage: firstErrorMessage,
  }
}
