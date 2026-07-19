import { Request, Response, NextFunction } from 'express'
import { StatusCodes } from 'http-status-codes'
import { AuditLog } from '@alias/models'
import { AuditAction } from '@alias/models/auditlog.model'
import logger, { sanitizeLogText } from '@alias/utils/logger'
import ApiResponse from '@alias/utils/ApiResponse'

/**
 * Resource-specific allowlists for audit `new_data`.
 * Only operational identifiers / config flags — never free-text PII/PHI,
 * credentials, demographics, medical details, or contact data.
 */
const AUDIT_BODY_ALLOWLIST: Readonly<Record<string, ReadonlySet<string>>> = {
  Doctor: new Set(['login_id', 'department', 'hospital_id', 'hospital', 'is_active']),
  Patient: new Set([
    'login_id',
    'assigned_doctor_id',
    'new_doctor_id',
    'hospital_id',
    'hospital',
    'account_status',
    'is_active',
  ]),
  Hospital: new Set(['code', 'status']),
  Billing: new Set(['billing_period', 'plan', 'amount']),
  Role: new Set(['permissions']),
  SystemConfig: new Set([
    'inr_thresholds',
    'session_timeout_minutes',
    'rate_limit',
    'feature_flags',
  ]),
  // Admin users, broadcast, batch ops, password reset, fallback
  System: new Set([
    'role',
    'hospital_id',
    'hospital',
    'is_active',
    'status',
    'operation',
    'user_ids',
    'target_user_id',
    'target',
    'priority',
  ]),
}

/** Response fields safe to reference when building error_message. */
const AUDIT_ERROR_ALLOWLIST = new Set(['message'])

function resolveResourceType(url: string): string {
  if (url.includes('/doctors')) return 'Doctor'
  if (url.includes('/patients') || url.includes('/reassign')) return 'Patient'
  if (url.includes('/hospitals')) return 'Hospital'
  if (url.includes('/billing')) return 'Billing'
  if (url.includes('/roles')) return 'Role'
  if (url.includes('/config')) return 'SystemConfig'
  return 'System'
}

/**
 * Copy nested config objects only when every leaf is a JSON primitive.
 * Drops arbitrary nested structures that could hold unapproved data.
 */
function minimizeNestedValue(value: unknown, depth = 0): unknown {
  if (depth > 3) return undefined
  if (value === null) return null
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean') return value
  if (Array.isArray(value)) {
    const items: unknown[] = []
    for (const item of value) {
      const minimized = minimizeNestedValue(item, depth + 1)
      if (minimized === undefined && item !== undefined) return undefined
      items.push(minimized)
    }
    return items
  }
  if (t === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      // Nested credentials / secrets must never appear under an allowed parent key
      if (/password|secret|token|authorization|otp|totp/i.test(key)) continue
      const minimized = minimizeNestedValue(child, depth + 1)
      if (minimized !== undefined) out[key] = minimized
    }
    return out
  }
  return undefined
}

/**
 * Explicit field minimization via resource allowlist.
 * Primitive string bodies and non-objects are excluded entirely.
 */
function minimizeAuditBody(body: unknown, resourceType: string): Record<string, unknown> | undefined {
  if (body == null) return undefined
  // Exclude primitive strings, numbers, booleans, and top-level arrays
  if (typeof body !== 'object' || Array.isArray(body)) return undefined

  const allowlist = AUDIT_BODY_ALLOWLIST[resourceType] ?? AUDIT_BODY_ALLOWLIST.System
  const minimized: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (!allowlist.has(key) || value === undefined) continue
    // Defense in depth: never persist credential-like keys even if allowlisted by mistake
    if (/password|secret|token|authorization|otp|totp/i.test(key)) continue

    const safe = minimizeNestedValue(value)
    if (safe !== undefined) minimized[key] = safe
  }

  return Object.keys(minimized).length > 0 ? minimized : undefined
}

/**
 * Build a safe error_message from the response body using the same
 * allowlist minimization approach — never persist raw response strings.
 */
function minimizeErrorMessage(body: unknown): string | undefined {
  if (body == null) return undefined

  let payload: unknown = body
  if (typeof body === 'string') {
    const trimmed = body.trim()
    if (!trimmed) return undefined
    try {
      payload = JSON.parse(trimmed)
    } catch {
      // Raw/unstructured string bodies are excluded (may echo PII/PHI)
      return undefined
    }
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return undefined
  }

  const minimized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (!AUDIT_ERROR_ALLOWLIST.has(key)) continue
    if (typeof value === 'string' && value.trim()) {
      minimized[key] = sanitizeLogText(value).slice(0, 300)
    }
  }

  const message = minimized.message
  return typeof message === 'string' && message.length > 0 ? message : undefined
}

/**
 * Determines audit action from the request method and path
 */
function inferAction(method: string, path: string): AuditAction | null {
  const m = method.toUpperCase()
  const p = path.toLowerCase()

  if (p.includes('/doctors') && m === 'POST') return AuditAction.USER_CREATE
  if (p.includes('/doctors') && m === 'PUT') return AuditAction.USER_UPDATE
  if (p.includes('/doctors') && m === 'DELETE') return AuditAction.USER_DEACTIVATE
  if (p.includes('/patients') && m === 'POST') return AuditAction.USER_CREATE
  if (p.includes('/patients') && m === 'PUT') return AuditAction.USER_UPDATE
  if (p.includes('/patients') && m === 'DELETE') return AuditAction.USER_DEACTIVATE
  if (p.includes('/hospitals') && m === 'POST') return AuditAction.USER_CREATE
  if (p.includes('/hospitals') && (m === 'PUT' || m === 'PATCH')) return AuditAction.USER_UPDATE
  if (p.includes('/hospitals') && m === 'DELETE') return AuditAction.USER_DEACTIVATE
  if (p.includes('/roles') && m === 'PUT') return AuditAction.CONFIG_UPDATE
  if (p.includes('/billing/invoices') && m === 'POST') return AuditAction.BATCH_OPERATION
  if (p.match(/\/users\/[^/]+/) && m === 'PUT') return AuditAction.USER_UPDATE
  if (p.endsWith('/users') && m === 'POST') return AuditAction.USER_CREATE
  if (p.includes('/reassign')) return AuditAction.PATIENT_REASSIGN
  if (p.includes('/config') && m === 'PUT') return AuditAction.CONFIG_UPDATE
  if (p.includes('/notifications/broadcast')) return AuditAction.NOTIFICATION_BROADCAST
  if (p.includes('/users/batch')) return AuditAction.BATCH_OPERATION
  if (p.includes('/reset-password')) return AuditAction.PASSWORD_RESET

  return null
}

/**
 * Audit logger middleware - automatically logs admin actions.
 * Place early on the router so it wraps res.send for route handlers.
 *
 * No durable audit outbox/queue exists in this service, so persistence is
 * fail-closed: the HTTP response is held until AuditLog.create succeeds.
 * If the audited operation would otherwise succeed but the audit write fails,
 * the client receives 500 and does not get a successful completion signal.
 */
export function auditLogger(req: Request, res: Response, next: NextFunction): void {
  const originalSend = res.send
  let auditWrite: Promise<unknown> | null = null

  res.send = function (body: any) {
    // Only audit mutating admin operations
    if (!req.user || !/\/api(?:\/v\d+)?\/admin\//.test(req.originalUrl)) {
      return originalSend.call(this, body)
    }

    const action = inferAction(req.method, req.originalUrl)
    if (!action) {
      return originalSend.call(this, body)
    }

    // If send is invoked again after an in-flight audit write, wait for it
    // rather than starting a second create or sending without durability.
    if (auditWrite) {
      return auditWrite.then(() => {
        if (res.headersSent) return res
        return originalSend.call(this, body)
      })
    }

    const success = res.statusCode < 400
    const resourceType = resolveResourceType(req.originalUrl)
    const auditPayload = {
      user_id: req.user.user_id,
      user_type: req.user.user_type,
      action,
      description: `${req.method} ${req.originalUrl.split('?')[0]}`,
      resource_type: resourceType,
      resource_id: req.params?.id || req.params?.op_num || undefined,
      new_data: minimizeAuditBody(req.body, resourceType),
      ip_address: req.ip || req.socket?.remoteAddress,
      user_agent: req.headers['user-agent'],
      success,
      error_message: !success ? minimizeErrorMessage(body) : undefined,
    }

    auditWrite = AuditLog.create(auditPayload)
      .then(() => originalSend.call(this, body))
      .catch((err: Error) => {
        logger.error('Audit log creation failed', {
          error: sanitizeLogText(err.message),
          action,
          path: req.originalUrl.split('?')[0],
        })

        // Fail-closed for successful operations: do not report success without
        // a durable audit record. Persistence failure is returned to the client.
        if (success) {
          if (res.headersSent) {
            return res
          }
          res.status(StatusCodes.INTERNAL_SERVER_ERROR)
          return originalSend.call(
            this,
            JSON.stringify(
              new ApiResponse(
                StatusCodes.INTERNAL_SERVER_ERROR,
                'Request could not be completed because the audit record could not be persisted',
              ),
            ),
          )
        }

        // Operation already failed: still deliver the original error response
        // so clients retain validation/business errors; audit failure is logged.
        if (res.headersSent) {
          return res
        }
        return originalSend.call(this, body)
      })

    return auditWrite
  }

  next()
}

export default auditLogger
