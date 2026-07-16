import mongoose from "mongoose";
import { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import ApiError from "../utils/ApiError";
import ApiResponse from "../utils/ApiResponse";
import { StatusCodes } from "http-status-codes";
import logger from "@alias/utils/logger";
import { sanitizeLogText } from "@alias/utils/logger";

const errorHandler: ErrorRequestHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  if (err?.type === 'entity.too.large') {
    return res.status(StatusCodes.REQUEST_TOO_LONG).json(new ApiResponse(StatusCodes.REQUEST_TOO_LONG, 'Request body is too large'))
  }

  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(StatusCodes.BAD_REQUEST).json(new ApiResponse(StatusCodes.BAD_REQUEST, 'Malformed JSON request body'))
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

  if (err?.name === 'MulterError') {
    return res.status(StatusCodes.BAD_REQUEST).json(new ApiResponse(StatusCodes.BAD_REQUEST, 'Invalid file upload request'))
  }

  if (err?.code === 11000) {
    return res.status(StatusCodes.CONFLICT).json(new ApiResponse(StatusCodes.CONFLICT, 'A resource with the same unique identifier already exists'))
  }

  const response = new ApiResponse(error.statusCode, error.message, error.data)
  return res.status(error.statusCode).json(response);
}

export default errorHandler
