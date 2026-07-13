import { NextFunction, Request, Response } from 'express'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import { config } from '@alias/config'
import { getSystemConfig } from '@alias/services/config.service'

const isTest = config.nodeEnv === 'test'

type RateLimitWindow = { count: number; resetAt: number; windowMs: number }
const requestWindows = new Map<string, RateLimitWindow>()
const MAX_TRACKED_IPS = 10_000
const CLEANUP_INTERVAL_MS = 60_000
let lastCleanupAt = 0

export const getRateLimitKey = (ip: string) => ipKeyGenerator(ip, 56)

export const removeExpiredRateLimitWindows = (windows: Map<string, RateLimitWindow>, now: number) => {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key)
  }
}

const removeExpiredWindows = (now: number) => {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS && requestWindows.size < MAX_TRACKED_IPS) return
  lastCleanupAt = now
  removeExpiredRateLimitWindows(requestWindows, now)
}

export const nextRateLimitWindow = (
  current: RateLimitWindow | undefined,
  now: number,
  windowMs: number,
): RateLimitWindow => {
  if (!current || current.resetAt <= now || current.windowMs !== windowMs) {
    return { count: 1, resetAt: now + windowMs, windowMs }
  }
  return { ...current, count: current.count + 1 }
}

export const getRateLimitWindowKey = (windows: Map<string, RateLimitWindow>, ip: string) => {
  const key = getRateLimitKey(ip)
  if (windows.has(key) || windows.size < MAX_TRACKED_IPS) return key

  // Keep state bounded under a flood of unique addresses. New addresses share
  // an overflow bucket instead of allocating unbounded per-IP state.
  return '__rate-limit-overflow__'
}

/**
 * Applies the administrator-configured API limit. The store is deliberately
 * process-local, matching express-rate-limit's default store used previously.
 */
export const apiLimiter = async (req: Request, res: Response, next: NextFunction) => {
  if (isTest) return next()

  try {
    const systemConfig = await getSystemConfig()
    const maxRequests = systemConfig.rate_limit.max_requests
    const windowMs = systemConfig.rate_limit.window_minutes * 60 * 1000
    const now = Date.now()
    removeExpiredWindows(now)
    const key = getRateLimitWindowKey(requestWindows, req.ip || req.socket.remoteAddress || 'unknown')
    const current = requestWindows.get(key)
    // Reset a bucket if its duration changed so the saved setting applies on
    // the very next request rather than after the prior window expires.
    const window = nextRateLimitWindow(current, now, windowMs)
    requestWindows.set(key, window)
    res.setHeader('RateLimit-Limit', maxRequests)
    res.setHeader('RateLimit-Remaining', Math.max(0, maxRequests - window.count))
    res.setHeader('RateLimit-Reset', Math.ceil(window.resetAt / 1000))

    if (window.count > maxRequests) {
      res.setHeader('Retry-After', Math.max(1, Math.ceil((window.resetAt - now) / 1000)))
      res.status(429).json({ success: false, message: 'Too many requests from this IP, please try again later' })
      return
    }

    next()
  } catch (error) {
    next(error)
  }
}

export const authLimiter = rateLimit({
  windowMs: config.authRateLimitWindowMs,
  limit: config.authRateLimitMaxRequests,
  message: 'Too many login attempts. Please wait and try again.',
  statusCode: 429,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  ipv6Subnet: 56,
  skip: () => isTest,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many login attempts. Please wait and try again.',
    })
  },
})

export default apiLimiter
