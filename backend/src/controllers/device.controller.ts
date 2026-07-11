import { Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import { ApiError, ApiResponse, asyncHandler } from '@alias/utils'
import DeviceToken from '@alias/models/DeviceToken.model'
import { registerDeviceToken } from '@alias/services/device-token.service'

export const registerDevice = asyncHandler(async (req: Request, res: Response) => {
  const { fcm_token, platform, app_version } = req.body
  const userId = req.user!.user_id

  if (!fcm_token || !platform) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'fcm_token and platform are required')
  }

  if (!['android', 'ios', 'web'].includes(platform)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'platform must be android, ios, or web')
  }

  const token = await registerDeviceToken({
    userId,
    fcmToken: fcm_token,
    platform,
    appVersion: app_version,
  })

  res.status(StatusCodes.CREATED)
    .json(new ApiResponse(StatusCodes.CREATED, 'Device registered successfully', {
      token_id: token._id,
    }))
})

export const deregisterDevice = asyncHandler(async (req: Request, res: Response) => {
  const { tokenId } = req.params
  const userId      = req.user!.user_id

  const token = await DeviceToken.findOneAndUpdate(
    { _id: tokenId, user_id: userId, is_active: true },
    { $set: { is_active: false } },
    { new: true }
  )

  if (!token) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Token not found or already inactive')
  }

  res.status(StatusCodes.OK)
    .json(new ApiResponse(StatusCodes.OK, 'Device deregistered successfully', null))
})
