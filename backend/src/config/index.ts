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
  fileAssetLegacyCutoffAt: Date
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
  passwordExpiryDays: number
  passwordHistoryCount: number
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
  redisUrl: string
  notificationDeliveryEnabled: boolean
  notificationDeliveryMaxAttempts: number
  notificationDeliveryBaseBackoffMs: number
  notificationDeliveryRetentionDays: number
  notificationDeliveryRecoveryIntervalMs: number
  notificationDeliveryProcessingLeaseMs: number
  notificationDeliveryWorkerConcurrency: number
  dosageReminderCron: string
  dosageReminderTimezone: string
  inrReminderIntervalDays: number
  nextReviewReminderLeadDays: number
  missedDoseEscalationWindowDays: number
  missedDoseEscalationThreshold: number
  malwareScanEnabled: boolean
  malwareScanUrl: string
  malwareScanAuthToken: string
  malwareScanTimeoutMs: number
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

function getNonNegativeIntEnv(key: string, defaultValue: number): number {
  const value = process.env[key]?.trim()
  if (!value) return defaultValue
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue
}

function getBoolEnv(key: string, defaultValue: boolean): boolean {
  const value = process.env[key]?.trim().toLowerCase()
  if (!value) return defaultValue
  return ['1', 'true', 'yes', 'on'].includes(value)
}

function getIsoDateEnv(
  key: string,
  options: { requiredInProduction?: boolean; requiredInStaging?: boolean; defaultValue?: string } = {}
): Date {
  const raw = getEnv(key, options)
  const isoTimestamp = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/
  const match = isoTimestamp.exec(raw)
  if (!match) {
    throw new Error(`Invalid ISO timestamp for environment variable ${key}: ${raw || '<empty>'}`)
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const offsetHour = match[8] === 'Z' ? 0 : Number(match[10])
  const offsetMinute = match[8] === 'Z' ? 0 : Number(match[11])
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const componentsAreValid = (
    month >= 1 && month <= 12 &&
    day >= 1 && day <= daysInMonth[month - 1] &&
    hour >= 0 && hour <= 23 &&
    minute >= 0 && minute <= 59 &&
    second >= 0 && second <= 59 &&
    offsetHour >= 0 && offsetHour <= 14 &&
    offsetMinute >= 0 && offsetMinute <= 59 &&
    (offsetHour < 14 || offsetMinute === 0)
  )
  const parsed = new Date(raw)
  if (!componentsAreValid || Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO timestamp for environment variable ${key}: ${raw || '<empty>'}`)
  }
  return parsed
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
const malwareScanEnabled = getBoolEnv('MALWARE_SCAN_ENABLED', false)

function getMalwareScanUrl() {
  const value = getEnv('MALWARE_SCAN_URL')
  if (!value) return ''
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('MALWARE_SCAN_URL must be an absolute URL')
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('MALWARE_SCAN_URL must use HTTPS')
  }
  return parsed.toString()
}

/** Returns required runtime keys without exposing any configured values. */
export function getMissingEnvironmentVariables(): string[] {
  if (!isProduction && !isStaging) {
    return []
  }

  const required = [
    'MONGO_URI',
    'JWT_SECRET',
    'ACCESS_KEY_ID',
    'SECRET_ACCESS_KEY',
    'S3_BUCKET_NAME',
    'FILE_ASSET_LEGACY_CUTOFF_AT',
    'ADMIN_TOTP_ENCRYPTION_KEY',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_VERIFY_SERVICE_SID',
  ]

  if (apiDocsEnabled) {
    required.push('API_DOCS_USERNAME', 'API_DOCS_PASSWORD')
  }

  if (getBoolEnv('FCM_ENABLED', false)) {
    required.push('FIREBASE_SERVICE_ACCOUNT')
  }

  if (malwareScanEnabled) {
    required.push('MALWARE_SCAN_URL')
  }

  return required.filter((key) => !(process.env[key] || '').trim())
}

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
  fileAssetLegacyCutoffAt: getIsoDateEnv('FILE_ASSET_LEGACY_CUTOFF_AT', {
    requiredInProduction: true,
    requiredInStaging: true,
    defaultValue: isProduction || isStaging ? undefined : '2100-01-01T00:00:00.000Z',
  }),
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
  passwordExpiryDays: getNonNegativeIntEnv('PASSWORD_EXPIRY_DAYS', 90),
  passwordHistoryCount: getNonNegativeIntEnv('PASSWORD_HISTORY_COUNT', 5),
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
  // Never let Jest inherit a developer/production Redis endpoint from `.env`.
  // Queue integration tests opt in explicitly by mutating this runtime config.
  redisUrl: isTest ? '' : getEnv('REDIS_URL', { defaultValue: '' }),
  notificationDeliveryEnabled: isTest
    ? false
    : getBoolEnv('NOTIFICATION_DELIVERY_ENABLED', true),
  notificationDeliveryMaxAttempts: getIntEnv('NOTIFICATION_DELIVERY_MAX_ATTEMPTS', 5),
  notificationDeliveryBaseBackoffMs: getIntEnv('NOTIFICATION_DELIVERY_BASE_BACKOFF_MS', 2_000),
  notificationDeliveryRetentionDays: getIntEnv('NOTIFICATION_DELIVERY_RETENTION_DAYS', 30),
  notificationDeliveryRecoveryIntervalMs: getIntEnv('NOTIFICATION_DELIVERY_RECOVERY_INTERVAL_MS', 30_000),
  notificationDeliveryProcessingLeaseMs: getIntEnv('NOTIFICATION_DELIVERY_PROCESSING_LEASE_MS', 5 * 60_000),
  notificationDeliveryWorkerConcurrency: getIntEnv('NOTIFICATION_DELIVERY_WORKER_CONCURRENCY', 5),
  // Keep the reminder window explicit and independent of the host/container timezone.
  dosageReminderCron: getEnv('DOSAGE_REMINDER_CRON', { defaultValue: '0 9 * * *' }),
  dosageReminderTimezone: getEnv('DOSAGE_REMINDER_TIMEZONE', { defaultValue: 'Asia/Kolkata' }),
  inrReminderIntervalDays: getIntEnv('INR_REMINDER_INTERVAL_DAYS', 30),
  nextReviewReminderLeadDays: getIntEnv('NEXT_REVIEW_REMINDER_LEAD_DAYS', 7),
  missedDoseEscalationWindowDays: getIntEnv('MISSED_DOSE_ESCALATION_WINDOW_DAYS', 7),
  missedDoseEscalationThreshold: getIntEnv('MISSED_DOSE_ESCALATION_THRESHOLD', 2),
  malwareScanEnabled,
  malwareScanUrl: getMalwareScanUrl(),
  malwareScanAuthToken: getEnv('MALWARE_SCAN_AUTH_TOKEN'),
  malwareScanTimeoutMs: getIntEnv('MALWARE_SCAN_TIMEOUT_MS', 10_000),
}

