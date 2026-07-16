import { Request, Response, NextFunction } from 'express'
import { AuditLog } from '@alias/models'
import { AuditAction } from '@alias/models/auditlog.model'
import logger from '@alias/utils/logger'

/**
 * Sanitizes request body by redacting sensitive fields
 */
function sanitizeBody(body: any): any {
  if (!body || typeof body !== 'object') return body
  const sensitiveFields = new Set([
    'password',
    'new_password',
    'current_password',
    'token',
    'access_token',
    'refresh_token',
    'authorization',
    'code',
    'otp',
    'totp',
    'secret',
    'secret_ciphertext',
    'secret_iv',
    'secret_auth_tag',
    'pending_secret_ciphertext',
    'pending_secret_iv',
    'pending_secret_auth_tag',
  ])

  if (Array.isArray(body)) {
    return body.map((item) => sanitizeBody(item))
  }

  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (sensitiveFields.has(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]'
      continue
    }
    sanitized[key] = sanitizeBody(value)
  }

  return sanitized
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
 * Audit logger middleware - automatically logs admin actions
 * Place this AFTER the route handler to capture the response status
 */
export function auditLogger(req: Request, res: Response, next: NextFunction): void {
  const originalSend = res.send

  res.send = function (body: any) {
    // Only audit mutating admin operations
    if (req.user && /\/api(?:\/v\d+)?\/admin\//.test(req.originalUrl)) {
      const action = inferAction(req.method, req.originalUrl)

      if (action) {
        const success = res.statusCode < 400

        AuditLog.create({
          user_id: req.user.user_id,
          user_type: req.user.user_type,
          action,
          description: `${req.method} ${req.originalUrl.split('?')[0]}`,
          resource_type: req.originalUrl.includes('/doctors') ? 'Doctor'
            : req.originalUrl.includes('/patients') ? 'Patient'
            : req.originalUrl.includes('/hospitals') ? 'Hospital'
            : req.originalUrl.includes('/billing') ? 'Billing'
            : req.originalUrl.includes('/roles') ? 'Role'
            : req.originalUrl.includes('/config') ? 'SystemConfig'
            : 'System',
          resource_id: req.params?.id || req.params?.op_num || undefined,
          new_data: sanitizeBody(req.body),
          ip_address: req.ip || req.socket?.remoteAddress,
          user_agent: req.headers['user-agent'],
          success,
          error_message: !success ? (typeof body === 'string' ? body : undefined) : undefined,
        }).catch((err: Error) => {
          logger.error('Audit log creation failed', { error: err.message })
        })
      }
    }

    return originalSend.call(this, body)
  }

  next()
}

export default auditLogger
