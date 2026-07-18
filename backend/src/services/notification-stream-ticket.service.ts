import jwt from 'jsonwebtoken'
import { config } from '@alias/config'
import { UserType } from '@alias/validators'

const STREAM_TICKET_TTL_SECONDS = 30
const STREAM_TICKET_PURPOSE = 'notification_stream'

type StreamTicketPayload = {
  user_id: string
  user_type: UserType
  purpose: typeof STREAM_TICKET_PURPOSE
}

export function createNotificationStreamTicket(userId: string, userType: UserType): string {
  return jwt.sign(
    { user_id: userId, user_type: userType, purpose: STREAM_TICKET_PURPOSE },
    config.jwtSecret,
    { expiresIn: STREAM_TICKET_TTL_SECONDS },
  )
}

export function verifyNotificationStreamTicket(ticket: string, expectedType: UserType): StreamTicketPayload | null {
  try {
    const payload = jwt.verify(ticket, config.jwtSecret) as StreamTicketPayload
    if (payload.purpose !== STREAM_TICKET_PURPOSE || payload.user_type !== expectedType || !payload.user_id) return null
    return payload
  } catch {
    return null
  }
}
