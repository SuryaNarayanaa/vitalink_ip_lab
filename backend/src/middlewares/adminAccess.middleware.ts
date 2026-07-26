import type { NextFunction, Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import { resolveAdminAccessContext } from '@alias/services/admin-access.service'
import { ApiError } from '@alias/utils'
import type {} from '@alias/types/admin-access'

/**
 * Resolve the persisted V2 administrator access snapshot once, after authenticate
 * and authorize([ADMIN]). Every later guard and handler reuses req.adminAccess.
 */
export async function resolveAdminAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (req.adminAccess) {
      if (!req.user?.user_id || req.adminAccess.userId !== String(req.user.user_id)) {
        throw new ApiError(StatusCodes.FORBIDDEN, 'Administrator access context does not match the authenticated user')
      }
      next()
      return
    }

    req.adminAccess = await resolveAdminAccessContext(req.user?.user_id, {
      authUser: req.authUser,
    })
    next()
  } catch (error) {
    const statusCode = error instanceof ApiError
      ? error.statusCode
      : StatusCodes.INTERNAL_SERVER_ERROR
    const message = error instanceof ApiError
      ? error.message
      : 'Unable to verify administrator access.'
    res.status(statusCode).json({ success: false, message })
  }
}

export const adminAccessMiddleware = resolveAdminAccess
