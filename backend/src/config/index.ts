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
  otpExpiryMinutes: number
  otpMaxAttempts: number
  otpResendCooldownSeconds: number
  otpMaxResends: number
  adminTotpEncryptionKey: string
  adminTotpChallengeExpiryMinutes: number
  adminTotpMaxAttempts: number
  refreshTokenExpiryDays: number
  twilioAccountSid: string
  twilioAuthToken: string
  twilioVerifyServiceSid: string
  twilioVerifyChannel: string
  twilioVerifyTemplateSid: string
  twilioVerifyTemplateTtlMinutes: number
}

const nodeEnv = process.env.NODE_ENV || 'development'
const isProduction = nodeEnv === 'production'
const isStaging = nodeEnv === 'staging'
const isTest = nodeEnv === 'test'

function getEnv(
  key: string,
  options: {
    requiredInProduction?: boolean
    requiredInStaging?: boolean
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

  if (isStaging && options.requiredInStaging) {
    throw new Error(`Missing required environment variable in staging: ${key}`)
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
  otpExpiryMinutes: getIntEnv('OTP_EXPIRY_MINUTES', 10),
  otpMaxAttempts: getIntEnv('OTP_MAX_ATTEMPTS', 5),
  otpResendCooldownSeconds: getIntEnv('OTP_RESEND_COOLDOWN_SECONDS', 60),
  otpMaxResends: getIntEnv('OTP_MAX_RESENDS', 3),
  adminTotpEncryptionKey: getEnv('ADMIN_TOTP_ENCRYPTION_KEY', {
    requiredInProduction: true,
    requiredInStaging: true,
    defaultValue: isTest ? 'test-only-admin-totp-encryption-key-32b' : '',
  }),
  adminTotpChallengeExpiryMinutes: getIntEnv('ADMIN_TOTP_CHALLENGE_EXPIRY_MINUTES', 5),
  adminTotpMaxAttempts: getIntEnv('ADMIN_TOTP_MAX_ATTEMPTS', 5),
  refreshTokenExpiryDays: getIntEnv('REFRESH_TOKEN_EXPIRY_DAYS', 30),
  twilioAccountSid: getEnv('TWILIO_ACCOUNT_SID', { requiredInProduction: true, requiredInStaging: true }),
  twilioAuthToken: getEnv('TWILIO_AUTH_TOKEN', { requiredInProduction: true, requiredInStaging: true }),
  twilioVerifyServiceSid: getEnv('TWILIO_VERIFY_SERVICE_SID', { requiredInProduction: true, requiredInStaging: true }),
  twilioVerifyChannel: getEnv('TWILIO_VERIFY_CHANNEL', { defaultValue: 'sms' }),
  twilioVerifyTemplateSid: getEnv('TWILIO_VERIFY_TEMPLATE_SID'),
  twilioVerifyTemplateTtlMinutes: getIntEnv('TWILIO_VERIFY_TEMPLATE_TTL_MINUTES', getIntEnv('OTP_EXPIRY_MINUTES', 10)),
}

