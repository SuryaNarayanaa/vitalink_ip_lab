import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { config } from '@alias/config'
import { UserType } from '@alias/validators'
import { ensureRedisConnected, getRedisClient, isRedisConfigured } from '@alias/config/redis'
import logger from '@alias/utils/logger'

const STREAM_TICKET_TTL_SECONDS = 30
const STREAM_TICKET_PURPOSE = 'notification_stream'
const LOCAL_TICKET_TTL_MS = STREAM_TICKET_TTL_SECONDS * 1000

export type StreamTicketPayload = {
  user_id: string
  user_type: UserType
  purpose: typeof STREAM_TICKET_PURPOSE
  jti: string
  session_id: string
  token_id: string
  security_version: number
}

/** Process-local single-use registry when Redis is unavailable. */
const localUnusedTickets = new Map<string, number>()

function pruneLocalTickets(now = Date.now()) {
  for (const [jti, expiresAt] of localUnusedTickets) {
    if (expiresAt <= now) localUnusedTickets.delete(jti)
  }
}

async function markTicketIssuable(jti: string): Promise<void> {
  if (isRedisConfigured()) {
    const client = getRedisClient()
    if (client && (await ensureRedisConnected(client))) {
      await client.set(`stream-ticket:${jti}`, '1', 'EX', STREAM_TICKET_TTL_SECONDS, 'NX')
      return
    }
  }
  pruneLocalTickets()
  localUnusedTickets.set(jti, Date.now() + LOCAL_TICKET_TTL_MS)
}

/**
 * Consumes a single-use ticket jti. Returns true only on the first successful consume.
 */
export async function consumeStreamTicketJti(jti: string): Promise<boolean> {
  if (!jti) return false

  if (isRedisConfigured()) {
    const client = getRedisClient()
    if (client && (await ensureRedisConnected(client))) {
      try {
        const key = `stream-ticket:${jti}`
        // GETDEL is ideal; fall back to GET + DEL for older Redis.
        const result = await (client as any).getdel?.(key)
        if (typeof result === 'string') return result === '1'
        const existing = await client.get(key)
        if (existing !== '1') return false
        const deleted = await client.del(key)
        return deleted === 1
      } catch (error) {
        logger.warn('stream_ticket.redis_consume_failed', {
          error: error instanceof Error ? error.message : String(error),
        })
        // Fall through to local map for degraded mode
      }
    }
  }

  pruneLocalTickets()
  if (!localUnusedTickets.has(jti)) return false
  localUnusedTickets.delete(jti)
  return true
}

export async function createNotificationStreamTicket(input: {
  userId: string
  userType: UserType
  sessionId: string
  tokenId: string
  securityVersion: number
}): Promise<string> {
  const jti = crypto.randomUUID()
  await markTicketIssuable(jti)

  return jwt.sign(
    {
      user_id: input.userId,
      user_type: input.userType,
      purpose: STREAM_TICKET_PURPOSE,
      jti,
      session_id: input.sessionId,
      token_id: input.tokenId,
      security_version: input.securityVersion,
    } satisfies StreamTicketPayload,
    config.jwtSecret,
    { expiresIn: STREAM_TICKET_TTL_SECONDS },
  )
}

export function verifyNotificationStreamTicket(
  ticket: string,
  expectedType: UserType,
): StreamTicketPayload | null {
  try {
    const payload = jwt.verify(ticket, config.jwtSecret) as StreamTicketPayload
    if (
      payload.purpose !== STREAM_TICKET_PURPOSE ||
      payload.user_type !== expectedType ||
      !payload.user_id ||
      !payload.jti ||
      !payload.session_id ||
      !payload.token_id
    ) {
      return null
    }
    return payload
  } catch {
    return null
  }
}
