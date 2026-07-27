import { Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import { asyncHandler, ApiResponse } from '@alias/utils'
import * as statisticsService from '@alias/services/statistics.service'
import { requireAdminAccessContext } from '@alias/types/admin-access'

function accessContext(req: Request) {
  return requireAdminAccessContext(req)
}

export const getAdminStats = asyncHandler(async (req: Request, res: Response) => {
  const stats = await statisticsService.getAdminDashboardStats(accessContext(req))
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Admin stats retrieved', stats))
})

export const getTrends = asyncHandler(async (req: Request, res: Response) => {
  const { period } = (req.validatedQuery ?? req.query) as any
  const trends = await statisticsService.getRegistrationTrends(accessContext(req), period)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Trends retrieved', trends))
})

export const getCompliance = asyncHandler(async (req: Request, res: Response) => {
  const compliance = await statisticsService.getInrComplianceStats(accessContext(req))
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Compliance stats retrieved', compliance))
})

export const getWorkload = asyncHandler(async (req: Request, res: Response) => {
  const workload = await statisticsService.getDoctorWorkloadStats(accessContext(req))
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Workload stats retrieved', workload))
})

export const getPeriodStats = asyncHandler(async (req: Request, res: Response) => {
  const { start_date, end_date } = (req.validatedQuery ?? req.query) as any
  const stats = await statisticsService.getPeriodStatistics(accessContext(req), start_date, end_date)
  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'Period stats retrieved', stats))
})
