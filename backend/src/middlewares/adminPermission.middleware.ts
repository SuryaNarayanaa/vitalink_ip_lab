import type { NextFunction, Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import type { AdminCapability } from '@alias/constants/admin-capabilities'
import { hasAdminCapability, hasAnyAdminCapability } from '@alias/types/admin-access'
import type {} from '@alias/types/admin-access'

function deny(
  res: Response,
  input: {
    message: string
    requiredCapability?: AdminCapability
    requiredCapabilities?: readonly AdminCapability[]
    policyVersion?: number
  },
): void {
  res.status(StatusCodes.FORBIDDEN).json({
    success: false,
    message: input.message,
    ...(input.requiredCapability ? { required_capability: input.requiredCapability } : {}),
    ...(input.requiredCapabilities ? { required_capabilities: input.requiredCapabilities } : {}),
    ...(input.policyVersion !== undefined ? { policy_version: input.policyVersion } : {}),
  })
}

/** Require one canonical V2 capability from the request-scoped policy snapshot. */
export const requireAdminCapability = (capability: AdminCapability) => (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const context = req.adminAccess
  if (!context || !hasAdminCapability(context, capability)) {
    deny(res, {
      message: 'Administrator role does not have the required capability.',
      requiredCapability: capability,
      policyVersion: context?.policyVersion,
    })
    return
  }
  next()
}

/** Require at least one canonical V2 capability from the same request snapshot. */
export const requireAnyAdminCapability = (capabilities: readonly AdminCapability[]) => (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const context = req.adminAccess
  if (!capabilities.length || !context || !hasAnyAdminCapability(context, capabilities)) {
    deny(res, {
      message: 'Administrator role does not have any required capability.',
      requiredCapabilities: capabilities,
      policyVersion: context?.policyVersion,
    })
    return
  }
  next()
}

export const requireGlobalAdminScope = () => (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!req.adminAccess || req.adminAccess.scope !== 'global') {
    deny(res, { message: 'Global administrator scope is required.', policyVersion: req.adminAccess?.policyVersion })
    return
  }
  next()
}

export const requireTenantAdminScope = () => (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (
    !req.adminAccess
    || req.adminAccess.scope !== 'tenant'
    || !req.adminAccess.hospitalId
    || !req.adminAccess.hospitalCode
  ) {
    deny(res, { message: 'Active hospital administrator scope is required.', policyVersion: req.adminAccess?.policyVersion })
    return
  }
  next()
}

/**
 * Hard mutation boundary. System Auditors are denied independently of policy
 * contents, so a corrupt or tampered policy cannot make an Auditor writable.
 */
export const requireAdminMutation = () => (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!req.adminAccess) {
    deny(res, { message: 'Administrator access context is required.' })
    return
  }
  if (req.adminAccess.role === 'auditor' || req.adminAccess.readOnly) {
    deny(res, {
      message: 'System Auditors have read-only access.',
      policyVersion: req.adminAccess.policyVersion,
    })
    return
  }
  next()
}

