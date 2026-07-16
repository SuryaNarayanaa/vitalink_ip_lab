import { NextFunction, Request, Response } from 'express'
import { config } from '@alias/config'

export const apiVersionHeaders = (version = config.apiVersion) => {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-API-Version', version)
    res.setHeader('X-API-Supported-Versions', config.apiVersion)
    next()
  }
}

export const legacyApiHeaders = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-API-Version', config.apiVersion)
  res.setHeader('X-API-Supported-Versions', config.apiVersion)
  res.setHeader('Deprecation', 'true')
  res.setHeader('Sunset', config.legacyApiSunsetDate)
  res.setHeader('Link', `</api/${config.apiVersion}>; rel="successor-version"`)
  next()
}
