import type { Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import { getEnabledAdminCapabilities } from '@alias/constants/admin-capabilities'
import type { AdminAccessContext } from '@alias/types/admin-access'
import { ApiError, ApiResponse, asyncHandler } from '@alias/utils'

function accessContext(req: Request): AdminAccessContext {
  if (!req.adminAccess) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Administrator access context is required.')
  }
  return req.adminAccess
}

/** GET /api/admin/access/me */
export const getCurrentAdminAccess = asyncHandler(async (req: Request, res: Response) => {
  const access = accessContext(req)
  const response = {
    schema_version: 2,
    user_id: access.userId,
    role: access.role,
    scope: access.scope,
    hospital: access.scope === 'tenant'
      ? {
        id: access.hospitalId,
        code: access.hospitalCode,
      }
      : null,
    effective_capabilities: getEnabledAdminCapabilities(access.role, access.permissions),
    policy_version: access.policyVersion,
    read_only: access.readOnly,
  }
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Administrator access retrieved', response))
})

export const getAdminAccessMe = getCurrentAdminAccess
