import 'dotenv/config'
import type { StringValue } from 'ms'

interface Config {
  port: number
  databaseUrl: string
  jwtSecret: string
  jwtExpiresIn: StringValue | number
  nodeEnv: string
  logLevel: string
  accessKeyId: string
  secretAccessKey: string
  bucketName?: string
  apiVersion: string
  legacyApiSunsetDate: string
  corsAllowedOrigins: string[]
  jsonBodyLimit: string
  requestTimeoutMs: number
  rateLimitWindowMs: number
  rateLimitMaxRequests: number
  authRateLimitWindowMs: number
  authRateLimitMaxRequests: number
  maxFailedLoginAttempts: number
  accountLockoutMinutes: number
  trustProxy: boolean | number
  apiDocsEnabled: boolean
  apiDocsPath: string
  apiDocsUsername: string
  apiDocsPassword: string
}

const nodeEnv = process.env.NODE_ENV || 'development'
const isProduction = nodeEnv === 'production'
const isTest = nodeEnv === 'test'

function getEnv(
  key: string,
  options: {
    requiredInProduction?: boolean
    defaultValue?: string
  } = {}
): string {
  const value = process.env[key]?.trim()

  if (value) {
    return value
  }

  if (isProduction && options.requiredInProduction) {
    throw new Error(`Missing required environment variable in production: ${key}`)
  }

  if (options.defaultValue !== undefined) {
    return options.defaultValue
  }

  return ''
}

function getIntEnv(key: string, defaultValue: number): number {
  const value = process.env[key]?.trim()
  if (!value) return defaultValue
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue
}

function getBoolEnv(key: string, defaultValue: boolean): boolean {
  const value = process.env[key]?.trim().toLowerCase()
  if (!value) return defaultValue
  return ['1', 'true', 'yes', 'on'].includes(value)
}

function getCorsOrigins(): string[] {
  const raw = process.env.CORS_ALLOWED_ORIGINS?.trim()
  if (!raw) return []
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

function getTrustProxy(): boolean | number {
  const raw = process.env.TRUST_PROXY?.trim().toLowerCase()
  if (!raw) return isProduction ? 1 : false
  if (raw === 'true') return true
  if (raw === 'false') return false
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : false
}

const defaultDatabaseUrl = isTest
  ? 'mongodb://localhost:27017/VitaLink_test'
  : 'mongodb://localhost:27017/VitaLink'

const defaultJwtSecret = isTest
  ? 'test-only-jwt-secret'
  : 'dev-only-jwt-secret-change-me'

const apiDocsEnabled = getBoolEnv('API_DOCS_ENABLED', !isProduction)

export const config: Config = {
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  databaseUrl: getEnv('MONGO_URI', { requiredInProduction: true, defaultValue: defaultDatabaseUrl }),
  jwtSecret: getEnv('JWT_SECRET', { requiredInProduction: true, defaultValue: defaultJwtSecret }),
  jwtExpiresIn: (getEnv('JWT_EXPIRES_IN', { defaultValue: '1h' }) as StringValue),
  nodeEnv,
  logLevel: getEnv('LOG_LEVEL', { defaultValue: 'info' }),
  accessKeyId: getEnv('ACCESS_KEY_ID', { requiredInProduction: true }),
  secretAccessKey: getEnv('SECRET_ACCESS_KEY', { requiredInProduction: true }),
  bucketName: getEnv('S3_BUCKET_NAME', { requiredInProduction: true }),
  apiVersion: getEnv('API_VERSION', { defaultValue: 'v1' }),
  legacyApiSunsetDate: getEnv('LEGACY_API_SUNSET_DATE', { defaultValue: '2026-10-01' }),
  corsAllowedOrigins: getCorsOrigins(),
  jsonBodyLimit: getEnv('JSON_BODY_LIMIT', { defaultValue: '1mb' }),
  requestTimeoutMs: getIntEnv('REQUEST_TIMEOUT_MS', 30_000),
  rateLimitWindowMs: getIntEnv('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  rateLimitMaxRequests: getIntEnv('RATE_LIMIT_MAX_REQUESTS', 200),
  authRateLimitWindowMs: getIntEnv('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  authRateLimitMaxRequests: getIntEnv('AUTH_RATE_LIMIT_MAX_REQUESTS', 20),
  maxFailedLoginAttempts: getIntEnv('MAX_FAILED_LOGIN_ATTEMPTS', 5),
  accountLockoutMinutes: getIntEnv('ACCOUNT_LOCKOUT_MINUTES', 15),
  trustProxy: getTrustProxy(),
  apiDocsEnabled,
  apiDocsPath: getEnv('API_DOCS_PATH', { defaultValue: '/docs' }),
  apiDocsUsername: getEnv('API_DOCS_USERNAME', { requiredInProduction: apiDocsEnabled }),
  apiDocsPassword: getEnv('API_DOCS_PASSWORD', { requiredInProduction: apiDocsEnabled }),
}

