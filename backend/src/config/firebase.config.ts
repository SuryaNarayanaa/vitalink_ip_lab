import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getMessaging, type Messaging } from 'firebase-admin/messaging'

let messagingInstance: Messaging | null | undefined

export function isFirebaseMessagingEnabled() {
  return ['1', 'true', 'yes', 'on'].includes((process.env.FCM_ENABLED || '').trim().toLowerCase())
}

export function initializeFirebaseMessaging(): Messaging | null {
  if (!isFirebaseMessagingEnabled()) {
    messagingInstance = null
    return null
  }
  if (messagingInstance) return messagingInstance

  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT?.trim()
  if (!rawServiceAccount) {
    throw new Error('FCM_ENABLED is true but FIREBASE_SERVICE_ACCOUNT is missing')
  }

  let serviceAccount: object
  try {
    serviceAccount = JSON.parse(rawServiceAccount)
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT must be valid JSON when FCM_ENABLED is true')
  }

  if (!getApps().length) {
    initializeApp({ credential: cert(serviceAccount) })
  }
  messagingInstance = getMessaging()
  return messagingInstance
}

export function getFirebaseMessaging(): Messaging | null {
  return initializeFirebaseMessaging()
}

export function getFirebaseMessagingHealth(): {
  enabled: boolean
  state: 'disabled' | 'initialized' | 'failed'
  error?: string
} {
  if (!isFirebaseMessagingEnabled()) {
    return { enabled: false, state: 'disabled' }
  }

  try {
    initializeFirebaseMessaging()
    return { enabled: true, state: 'initialized' }
  } catch (error) {
    return {
      enabled: true,
      state: 'failed',
      error: error instanceof Error ? error.message : 'Firebase initialization failed',
    }
  }
}
