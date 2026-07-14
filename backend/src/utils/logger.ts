import { config } from '@alias/config'
import { createLogger, format, transports } from 'winston'

export function sanitizeLogText(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value ?? '')
  return text
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/]+:)[^@\s/]+@/gi, '$1[redacted]@')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g, '[redacted-jwt]')
    .replace(/(?:password|refresh_token|access_token|private_key|client_email|authorization)\s*[:=]\s*[^,\s}]+/gi, '$1=[redacted]')
    .replace(/[A-Za-z0-9_\-]{120,}/g, '[redacted]')
    .slice(0, 1000)
}

const SENSITIVE_LOG_KEY = /(?:password|passphrase|otp|totp|secret|token|authorization|private[_-]?key|client[_-]?email|credential|patient[_-]?name)/i

function sanitizeLogValue(value: unknown, key = ''): unknown {
  if (SENSITIVE_LOG_KEY.test(key)) return '[redacted]'
  if (typeof value === 'string') return sanitizeLogText(value)
  if (Array.isArray(value)) return value.map(item => sanitizeLogValue(item))
  if (value && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value)) {
      sanitized[childKey] = sanitizeLogValue(childValue, childKey)
    }
    return sanitized
  }
  return value
}

const redactSensitiveLogData = format((info) => {
  for (const [key, value] of Object.entries(info)) {
    info[key] = sanitizeLogValue(value, key) as any
  }
  return info
})

const logFormat = format.printf(({ level, message, timestamp, requestId, stack, ...meta }) => {
  const logMessage = stack || message
  const requestIdSegment = requestId ? ` [request-id:${requestId}]` : ''
  const metaSegment = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : ''
  return `${timestamp} [${level}]${requestIdSegment}: ${logMessage}${metaSegment}`;
});

const activeTransports: any[] = [
  new transports.Console({
    format: format.combine(format.colorize(), logFormat),
  }),
]

const lokiUrl = process.env.LOKI_URL?.trim()
if (lokiUrl) {
  try {
    const LokiTransport = require('winston-loki')
    const lokiUsername = process.env.LOKI_USERNAME?.trim()
    const lokiPassword = process.env.LOKI_PASSWORD?.trim()

    activeTransports.push(
      new LokiTransport({
        host: lokiUrl,
        labels: {
          app: 'vitalink-backend',
          env: config.nodeEnv,
        },
        json: true,
        replaceTimestamp: true,
        basicAuth: lokiUsername && lokiPassword ? `${lokiUsername}:${lokiPassword}` : undefined,
        onConnectionError: (error: Error) => {
          console.error(`Loki transport connection error: ${sanitizeLogText(error)}`)
        },
      })
    )
  } catch (error) {
    console.error(`Failed to initialize Loki transport: ${sanitizeLogText(error)}`)
  }
}

const logger = createLogger({
  level: config.logLevel,
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.splat(),
    redactSensitiveLogData(),
    format.json()
  ),
  transports: activeTransports,
})

export default logger
