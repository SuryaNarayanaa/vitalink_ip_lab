import { NextFunction, Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import { isFeatureEnabled } from '@alias/services/config.service'

export const isControlPlaneRequest = (path: string) =>
  path.includes('/auth/') || path.includes('/admin/config') || path.includes('/health')

export const isPatientRegistrationRequest = (method: string, path: string) =>
  method === 'POST' && (/\/admin\/patients$/.test(path) || /\/doctors\/patients$/.test(path))

export const enforceSystemFeatureFlags = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (await isFeatureEnabled('maintenance_mode') && !isControlPlaneRequest(req.path)) {
      res.status(StatusCodes.SERVICE_UNAVAILABLE).json({
        success: false,
        message: 'The service is temporarily unavailable for maintenance.',
      })
      return
    }

    const isPatientRegistration = isPatientRegistrationRequest(req.method, req.path)
    if (isPatientRegistration && !await isFeatureEnabled('patient_registration_enabled')) {
      res.status(StatusCodes.SERVICE_UNAVAILABLE).json({
        success: false,
        message: 'Patient registration is currently disabled.',
      })
      return
    }

    next()
  } catch (error) {
    next(error)
  }
}
