import { cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import type { Auth } from 'firebase-admin/auth'
import { getMessaging, type Messaging } from 'firebase-admin/messaging'

let appInstance: App | null | undefined
let authInstance: Auth | null | undefined
let messagingInstance: Messaging | null | undefined

const isEnabled = (key: string) =>
  ['1', 'true', 'yes', 'on'].includes((process.env[key] || '').trim().toLowerCase())

export function isFirebaseMessagingEnabled() {
  return isEnabled('FCM_ENABLED')
}

export function isFirebaseAuthEnabled() {
  return isEnabled('FIREBASE_AUTH_ENABLED')
}

function initializeFirebaseApp(): App {
  if (appInstance) return appInstance

  const existingApp = getApps()[0]
  if (existingApp) {
    appInstance = existingApp
    return existingApp
  }

  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT?.trim()
  if (!rawServiceAccount) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is required when Firebase Auth or FCM is enabled')
  }

  let serviceAccount: object
  try {
    serviceAccount = JSON.parse(rawServiceAccount)
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT must be valid JSON')
  }

  appInstance = initializeApp({ credential: cert(serviceAccount) })
  return appInstance
}

export function getFirebaseAuth(): Auth {
  if (!isFirebaseAuthEnabled()) {
    throw new Error('Firebase Authentication is disabled; set FIREBASE_AUTH_ENABLED=true')
  }
  if (authInstance) return authInstance
  // Keep Auth lazy: firebase-admin/auth currently pulls an ESM-only JOSE
  // dependency that older Jest/CommonJS runners cannot parse at module load.
  const { getAuth } = require('firebase-admin/auth') as typeof import('firebase-admin/auth')
  authInstance = getAuth(initializeFirebaseApp())
  return authInstance
}

export function initializeFirebaseMessaging(): Messaging | null {
  if (!isFirebaseMessagingEnabled()) {
    messagingInstance = null
    return null
  }
  if (messagingInstance) return messagingInstance

  messagingInstance = getMessaging(initializeFirebaseApp())
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
