import type { Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import {
  createAdminAccount as createAdminAccountLifecycle,
  listAdminAccounts as listAdminAccountsLifecycle,
  resetAdminAccountMfa as resetAdminAccountMfaLifecycle,
  updateAdminAccount as updateAdminAccountLifecycle,
} from '@alias/services/admin-account.service'
import type { AdminAccessContext } from '@alias/types/admin-access'
import { hasAdminCapability } from '@alias/types/admin-access'
import { ApiError, ApiResponse, asyncHandler } from '@alias/utils'

function requireAppAdminAccountAccess(req: Request, mutation: boolean): AdminAccessContext {
  const access = req.adminAccess
  const capability = mutation ? 'platform.admin_accounts.manage' : 'platform.admin_accounts.read'
  if (
    !access
    || access.role !== 'app_admin'
    || access.scope !== 'global'
    || (mutation && access.readOnly)
    || !hasAdminCapability(access, capability)
  ) {
    const error = new ApiError(StatusCodes.FORBIDDEN, 'Application Admin account-management access is required.')
    Object.assign(error, { requiredCapability: capability })
    throw error
  }
  return access
}

/** GET /api/admin/admin-accounts */
export const listAdminAccounts = asyncHandler(async (req: Request, res: Response) => {
  const access = requireAppAdminAccountAccess(req, false)
  const result = await listAdminAccountsLifecycle(access)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Administrator accounts retrieved', result))
})

/** POST /api/admin/admin-accounts */
export const createAdminAccount = asyncHandler(async (req: Request, res: Response) => {
  const access = requireAppAdminAccountAccess(req, true)
  const result = await createAdminAccountLifecycle(req.body, access)
  res.status(StatusCodes.CREATED).json(new ApiResponse(StatusCodes.CREATED, 'Administrator account created', result))
})

/** PUT /api/admin/admin-accounts/:id */
export const updateAdminAccount = asyncHandler(async (req: Request, res: Response) => {
  const access = requireAppAdminAccountAccess(req, true)
  const result = await updateAdminAccountLifecycle(req.params.id, req.body, access)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Administrator account updated', result))
})

/** POST /api/admin/admin-accounts/:id/mfa/reset */
export const resetAdminAccountMfa = asyncHandler(async (req: Request, res: Response) => {
  const access = requireAppAdminAccountAccess(req, true)
  const result = await resetAdminAccountMfaLifecycle(req.params.id, access)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Administrator authenticator reset', result))
})

export const inviteAdminAccount = createAdminAccount
export const resetAdminAccountAuthenticator = resetAdminAccountMfa
