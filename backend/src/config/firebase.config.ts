import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getMessaging } from 'firebase-admin/messaging'

if (!getApps().length) {
  const serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT!
  )

  initializeApp({
    credential: cert(serviceAccount),
  })
}

export const messaging = getMessaging()