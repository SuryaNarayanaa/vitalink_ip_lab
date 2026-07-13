import { Request, Response, NextFunction } from 'express'
import { ApiError } from '@alias/utils'
import { StatusCodes } from 'http-status-codes'
import { getAdminContext, requirePermission } from '@alias/services/admin.service'

/**
 * Enforce a single RBAC permission from the persisted role policy.
 * Permissions are re-read from MongoDB on every request so policy edits take effect immediately.
 * Mutation read-only rules for auditors remain in service/controller layers via requireCanMutate.
 */
export const requireAdminPermission = (permission: string) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const context = await getAdminContext(req.user?.user_id)
    requirePermission(context, permission)
    next()
  } catch (error) {
    const statusCode = error instanceof ApiError ? error.statusCode : StatusCodes.INTERNAL_SERVER_ERROR
    const message = error instanceof ApiError ? error.message : 'Unable to verify permissions.'
    res.status(statusCode).json({ success: false, message })
  }
}
