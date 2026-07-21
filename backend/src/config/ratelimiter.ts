import { NextFunction, Request, Response } from 'express'
import { ipKeyGenerator } from 'express-rate-limit'
import { config } from '@alias/config'
import { getCachedSystemConfig } from '@alias/services/config.service'
import { ensureRedisConnected, getRedisClient, isRedisConfigured } from '@alias/config/redis'
import logger from '@alias/utils/logger'

const isTest = config.nodeEnv === 'test'

type RateLimitWindow = { count: number; resetAt: number; windowMs: number }
/** Process-local fallback only when Redis is unavailable (dev / degraded). */
const requestWindows = new Map<string, RateLimitWindow>()
const authWindows = new Map<string, RateLimitWindow>()
const MAX_TRACKED_IPS = 10_000
const CLEANUP_INTERVAL_MS = 60_000
let lastCleanupAt = 0
let lastAuthCleanupAt = 0

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

const removeExpiredAuthWindows = (now: number) => {
  if (now - lastAuthCleanupAt < CLEANUP_INTERVAL_MS && authWindows.size < MAX_TRACKED_IPS) return
  lastAuthCleanupAt = now
  removeExpiredRateLimitWindows(authWindows, now)
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

/**
 * Returns the per-IP key for the in-memory fallback store.
 * When capacity is reached after cleanup, the oldest window is evicted so
 * unrelated clients never share a global overflow bucket.
 */
export const getRateLimitWindowKey = (windows: Map<string, RateLimitWindow>, ip: string) => {
  const key = getRateLimitKey(ip)
  if (windows.has(key) || windows.size < MAX_TRACKED_IPS) return key

  // Evict the soonest-to-expire entry instead of coalescing new IPs.
  let oldestKey: string | undefined
  let oldestReset = Number.POSITIVE_INFINITY
  for (const [candidate, window] of windows) {
    if (window.resetAt < oldestReset) {
      oldestReset = window.resetAt
      oldestKey = candidate
    }
  }
  if (oldestKey) windows.delete(oldestKey)
  return key
}

async function consumeRedisWindow(
  namespace: string,
  key: string,
  windowMs: number,
  maxRequests: number,
): Promise<{ count: number; resetAt: number; limited: boolean } | null> {
  const client = getRedisClient()
  if (!client || !(await ensureRedisConnected(client))) return null

  const redisKey = `ratelimit:${namespace}:${key}`
  try {
    const results = await client
      .multi()
      .incr(redisKey)
      .pttl(redisKey)
      .exec()

    if (!results) return null

    const count = Number(results[0]?.[1] ?? 0)
    let ttl = Number(results[1]?.[1] ?? -1)

    if (count === 1 || ttl < 0) {
      await client.pexpire(redisKey, windowMs)
      ttl = windowMs
    }

    const resetAt = Date.now() + Math.max(ttl, 0)
    return { count, resetAt, limited: count > maxRequests }
  } catch (error) {
    logger.warn('ratelimit.redis_failed', {
      namespace,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function applyLocalLimit(
  windows: Map<string, RateLimitWindow>,
  ip: string,
  now: number,
  windowMs: number,
  maxRequests: number,
  res: Response,
  message: string,
): boolean {
  const windowKey = getRateLimitWindowKey(windows, ip)
  const current = windows.get(windowKey)
  const window = nextRateLimitWindow(current, now, windowMs)
  windows.set(windowKey, window)
  res.setHeader('RateLimit-Limit', maxRequests)
  res.setHeader('RateLimit-Remaining', Math.max(0, maxRequests - window.count))
  res.setHeader('RateLimit-Reset', Math.ceil(window.resetAt / 1000))

  if (window.count > maxRequests) {
    res.setHeader('Retry-After', Math.max(1, Math.ceil((window.resetAt - now) / 1000)))
    res.status(429).json({ success: false, message })
    return true
  }
  return false
}

/**
 * Applies the administrator-configured API limit.
 * Prefers a shared Redis-backed counter so allowances are not multiplied across
 * replicas. Falls back to a process-local map with per-IP keys only (no shared
 * overflow bucket) when Redis is unavailable.
 */
export const apiLimiter = async (req: Request, res: Response, next: NextFunction) => {
  if (isTest) return next()

  try {
    const systemConfig = await getCachedSystemConfig()
    const maxRequests = systemConfig.rate_limit.max_requests
    const windowMs = systemConfig.rate_limit.window_minutes * 60 * 1000
    const now = Date.now()
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    const key = getRateLimitKey(ip)
    const message = 'Too many requests from this IP, please try again later'

    if (isRedisConfigured()) {
      const redisResult = await consumeRedisWindow('api', key, windowMs, maxRequests)
      if (redisResult) {
        res.setHeader('RateLimit-Limit', maxRequests)
        res.setHeader('RateLimit-Remaining', Math.max(0, maxRequests - redisResult.count))
        res.setHeader('RateLimit-Reset', Math.ceil(redisResult.resetAt / 1000))
        if (redisResult.limited) {
          res.setHeader('Retry-After', Math.max(1, Math.ceil((redisResult.resetAt - now) / 1000)))
          res.status(429).json({ success: false, message })
          return
        }
        next()
        return
      }
    }

    removeExpiredWindows(now)
    if (applyLocalLimit(requestWindows, ip, now, windowMs, maxRequests, res, message)) return
    next()
  } catch (error) {
    next(error)
  }
}

/** Login / auth endpoints: shared Redis counter when available; no overflow bucket. */
export const authLimiter = async (req: Request, res: Response, next: NextFunction) => {
  if (isTest) return next()

  try {
    const maxRequests = config.authRateLimitMaxRequests
    const windowMs = config.authRateLimitWindowMs
    const now = Date.now()
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    const key = getRateLimitKey(ip)
    const message = 'Too many login attempts. Please wait and try again.'

    if (isRedisConfigured()) {
      const redisResult = await consumeRedisWindow('auth', key, windowMs, maxRequests)
      if (redisResult) {
        res.setHeader('RateLimit-Limit', maxRequests)
        res.setHeader('RateLimit-Remaining', Math.max(0, maxRequests - redisResult.count))
        res.setHeader('RateLimit-Reset', Math.ceil(redisResult.resetAt / 1000))
        if (redisResult.limited) {
          res.setHeader('Retry-After', Math.max(1, Math.ceil((redisResult.resetAt - now) / 1000)))
          res.status(429).json({ success: false, message })
          return
        }
        next()
        return
      }
    }

    removeExpiredAuthWindows(now)
    if (applyLocalLimit(authWindows, ip, now, windowMs, maxRequests, res, message)) return
    next()
  } catch (error) {
    next(error)
  }
}

export default apiLimiter
