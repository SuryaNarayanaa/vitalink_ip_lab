import { StatusCodes } from 'http-status-codes'
import ApiError from '@alias/utils/ApiError'

describe('ApiError', () => {
  test('uses the default message when none is provided', () => {
    const error = new ApiError(StatusCodes.INTERNAL_SERVER_ERROR)

    expect(error.message).toBe('Something went wrong')
  })

  test('uses a custom message when provided', () => {
    const error = new ApiError(StatusCodes.NOT_FOUND, 'Patient not found')

    expect(error.message).toBe('Patient not found')
  })

  test('sets the statusCode property from the constructor argument', () => {
    const error = new ApiError(StatusCodes.BAD_REQUEST, 'Invalid input')

    expect(error.statusCode).toBe(StatusCodes.BAD_REQUEST)
  })

  test('always sets data to null', () => {
    const error = new ApiError(StatusCodes.CONFLICT, 'Duplicate entry')

    expect(error.data).toBeNull()
  })

  test('always sets success to false', () => {
    const error = new ApiError(StatusCodes.UNAUTHORIZED, 'Not authorized')

    expect(error.success).toBe(false)
  })

  test('is an instance of both ApiError and Error', () => {
    const error = new ApiError(StatusCodes.FORBIDDEN, 'Forbidden')

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toBeInstanceOf(Error)
  })

  test('exposes a stack trace like a normal Error', () => {
    const error = new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Boom')

    expect(typeof error.stack).toBe('string')
  })

  test('can be thrown and caught, preserving its properties', () => {
    expect.assertions(3)
    try {
      throw new ApiError(StatusCodes.TOO_MANY_REQUESTS, 'Rate limited')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).statusCode).toBe(StatusCodes.TOO_MANY_REQUESTS)
      expect((err as ApiError).message).toBe('Rate limited')
    }
  })

  test('is exported as the default export of the module', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@alias/utils/ApiError')
    expect(mod.default).toBe(ApiError)
  })
})