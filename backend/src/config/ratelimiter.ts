import { rateLimit } from 'express-rate-limit'
import { config } from '@alias/config'

const isTest = config.nodeEnv === 'test'

export const apiLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  limit: config.rateLimitMaxRequests,
  message: 'Too many requests from this IP, please try again later',
  statusCode: 429,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  ipv6Subnet: 56,
  skip: () => isTest,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many requests from this IP, please try again later',
    })
  },
})

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
