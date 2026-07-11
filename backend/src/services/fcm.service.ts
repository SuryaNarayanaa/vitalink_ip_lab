import { messaging } from '@alias/config/firebase.config'
import DeviceToken from '@alias/models/DeviceToken.model'

export interface PushPayload {
  title: string
  body:  string
  data?: Record<string, string>  // all values must be strings for FCM
}

export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<void> {
  // Get all active tokens for this user
  const tokens = await DeviceToken.find(
    { user_id: userId, is_active: true },
    { fcm_token: 1 }
  ).lean()

  if (!tokens.length) return  // user has no registered devices

  const fcmTokens = tokens.map(t => t.fcm_token)

  // Send to all devices at once
  const response = await messaging.sendEachForMulticast({
    tokens: fcmTokens,
    notification: {
      title: payload.title,
      body:  payload.body,
    },
    data:    payload.data ?? {},
    android: { priority: 'high' },
    apns:    { payload: { aps: { sound: 'default' } } },
  })

  // Deactivate any dead tokens
  for (let i = 0; i < response.responses.length; i++) {
    const res = response.responses[i]
    if (
      !res.success &&
      (res.error?.code === 'messaging/registration-token-not-registered' ||
       res.error?.code === 'messaging/invalid-registration-token')
    ) {
      await DeviceToken.updateOne(
        { fcm_token: fcmTokens[i] },
        { $set: { is_active: false } }
      )
    }
  }
}