export { authenticate, authorize } from './authProvider.middleware'
export { validate } from './ValidateResource'
import { Request, Response, NextFunction } from 'express'
import { UserType } from '@alias/validators'
import { ApiError, asyncHandler } from '@alias/utils'
import { StatusCodes } from 'http-status-codes'
import { User } from '@alias/models'

export const AllowDoctor = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { user_id, user_type } = req.user;
  if (user_type != UserType.DOCTOR) {
    throw new ApiError(StatusCodes.FORBIDDEN,"Doctor access only")
  }

  const user = await User.findById(user_id)
  if(!user){
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found")
  }
  next()
})

export const AllowPatient = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { user_id, user_type } = req.user;
  if (user_type != UserType.PATIENT) {
    throw new ApiError(StatusCodes.FORBIDDEN,"Patient access only")
  }

  const user = await User.findById(user_id)
  if(!user){
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found")
  }
  next()
})

export const AllowAdmin = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { user_id, user_type } = req.user;
  if (user_type != UserType.ADMIN) {
    throw new ApiError(StatusCodes.FORBIDDEN, "ADMIN access only")
  }

  const user = await User.findById(user_id)
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found")
  }
  next()
})
