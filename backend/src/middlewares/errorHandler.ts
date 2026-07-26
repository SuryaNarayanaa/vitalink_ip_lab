import mongoose from "mongoose";
import { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import ApiError from "../utils/ApiError";
import ApiResponse from "../utils/ApiResponse";
import { StatusCodes } from "http-status-codes";
import logger from "@alias/utils/logger";
import { sanitizeLogText } from "@alias/utils/logger";
import { isAdminCapability } from '@alias/constants/admin-capabilities';

const errorHandler: ErrorRequestHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  if (err?.type === 'entity.too.large') {
    return res.status(StatusCodes.REQUEST_TOO_LONG).json(new ApiResponse(StatusCodes.REQUEST_TOO_LONG, 'Request body is too large'))
  }

  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(StatusCodes.BAD_REQUEST).json(new ApiResponse(StatusCodes.BAD_REQUEST, 'Malformed JSON request body'))
  }

  // Known client/upload/constraint failures: handle before the generic
  // "Unhandled error" path so they are not misclassified as 500s in logs.
  if (err?.name === 'MulterError') {
    return res.status(StatusCodes.BAD_REQUEST).json(new ApiResponse(StatusCodes.BAD_REQUEST, 'Invalid file upload request'))
  }

  if (err?.code === 11000) {
    return res.status(StatusCodes.CONFLICT).json(new ApiResponse(StatusCodes.CONFLICT, 'A resource with the same unique identifier already exists'))
  }

  if (err instanceof ZodError) {
    const errors = err.issues.map((issue) => ({ message: issue.message }))
    logger.error(`Validation Error: ${JSON.stringify(errors, null, 2)}`)
    return res.status(StatusCodes.BAD_REQUEST).json(new ApiResponse(StatusCodes.BAD_REQUEST, 'Validation failed', { errors }))
  }

  if (err instanceof mongoose.Error.CastError) {
    const castDetails = { field: err.path }
    return res.status(StatusCodes.BAD_REQUEST).json(new ApiResponse(StatusCodes.BAD_REQUEST, 'Invalid value for field', castDetails))
  }

  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(StatusCodes.BAD_REQUEST).json(
      new ApiResponse(StatusCodes.BAD_REQUEST, 'The submitted data violates a persistence constraint')
    )
  }

  let error = err;
  if (!(err instanceof ApiError)) {
    logger.error('Unhandled error', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      requestId: (req as any).requestId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
    })
    const statusCode = error instanceof mongoose.Error ? StatusCodes.BAD_REQUEST : StatusCodes.INTERNAL_SERVER_ERROR
    const message = statusCode === StatusCodes.INTERNAL_SERVER_ERROR
      ? 'The server could not complete the request.'
      : sanitizeLogText(error.message || 'Invalid database operation')
    error = new ApiError(statusCode, message)
  }

  const response = new ApiResponse(error.statusCode, error.message, error.data)
  const safeDetails: Record<string, unknown> = {}

  if (error.statusCode === StatusCodes.FORBIDDEN) {
    if (isAdminCapability(error.requiredCapability)) {
      safeDetails.required_capability = error.requiredCapability
    }
    if (Array.isArray(error.requiredCapabilities)) {
      const requiredCapabilities = error.requiredCapabilities.filter(isAdminCapability)
      if (requiredCapabilities.length) safeDetails.required_capabilities = requiredCapabilities
    }
    if (req.adminAccess?.policyVersion !== undefined) {
      safeDetails.policy_version = req.adminAccess.policyVersion
    }
  }

  if (error.statusCode === StatusCodes.CONFLICT && error.currentPolicy) {
    const current = error.currentPolicy
    safeDetails.conflict = {
      type: 'role_policy_version_conflict',
      current_policy: {
        schema_version: current.schemaVersion,
        role_key: current.roleKey,
        capabilities: current.capabilities,
        protected: current.protected,
        policy_version: current.policyVersion,
        updated_by: current.updatedBy,
        updated_at: current.updatedAt instanceof Date ? current.updatedAt.toISOString() : current.updatedAt,
        change_reason: current.changeReason,
      },
    }
  }

  return res.status(error.statusCode).json({ ...response, ...safeDetails });
}

export default errorHandler
