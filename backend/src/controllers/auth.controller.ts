import { Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import { asyncHandler, ApiError, ApiResponse, generateToken } from '@alias/utils'
import { User } from '@alias/models'
import { comparePasswords } from '@alias/utils'
import { UserType } from '@alias/validators'
import { ChangePasswordInput, LoginInput } from '@alias/validators/user.validator'


export const loginController = asyncHandler(async (req: Request<{}, {}, LoginInput["body"]>, res: Response) => {
  const { login_id, password } = req.body;
  const normalizedLoginId = login_id.trim()

  const matchedUsers = await User.find({ login_id: normalizedLoginId }).limit(2)
  if (matchedUsers.length === 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User Doesn't exist")
  }
  if (matchedUsers.length > 1) {
    throw new ApiError(StatusCodes.CONFLICT, 'Multiple accounts found for this login ID. Please contact support.')
  }

  const user = matchedUsers[0]
  if (!user.is_active) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Account is inactive. Please contact support.')
  }

  const isPasswordValid = await comparePasswords({
    password,
    salt: user.salt,
    hashedPassword: user.password,
  })

  if (!isPasswordValid) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid credentials')
  }

  const token = generateToken({ user_id: user._id.toString(), user_type: user.user_type as UserType })

  const populatedUser = await User.findById(user._id)
    .populate({ path: 'profile_id', populate: { path: 'hospital_id' } })
    .select('-password -salt')

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, "User logged in successfully", { token, user: populatedUser }))
})

export const logoutController = asyncHandler((req: Request, res: Response) => {
  res.status(StatusCodes.OK).json({
    success: true,
    message: 'Logout successful. Please clear the token from client-side.',
  })
})

export const getMeController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User not authenticated')
  }

  const user = await User.findById(req.user.user_id).populate('profile_id').select('-password -salt').lean()
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found')
  }

  res.status(StatusCodes.OK).json(new ApiResponse(StatusCodes.OK, 'User profile retrieved successfully', { user }))
})

export const changePasswordController = asyncHandler(
  async (req: Request<{}, {}, ChangePasswordInput["body"]>, res: Response) => {
    if (!req.user) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, 'User not authenticated')
    }

    const user = await User.findById(req.user.user_id)
    if (!user) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'User not found')
    }

    if (!user.is_active) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'Account is inactive. Please contact support.')
    }

    const { current_password, new_password } = req.body

    const isCurrentPasswordValid = await comparePasswords({
      password: current_password,
      salt: user.salt,
      hashedPassword: user.password,
    })

    if (!isCurrentPasswordValid) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, 'Current password is incorrect')
    }

    user.password = new_password
    user.must_change_password = false
    await user.save()

    res.status(StatusCodes.OK).json(
      new ApiResponse(StatusCodes.OK, 'Password changed successfully', {
        must_change_password: user.must_change_password,
      })
    )
  }
)
