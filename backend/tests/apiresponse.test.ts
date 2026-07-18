import { StatusCodes } from 'http-status-codes'
import ApiResponse from '@alias/utils/ApiResponse'

describe('ApiResponse', () => {
  test('uses default message "Success" and default data null when omitted', () => {
    const response = new ApiResponse(StatusCodes.OK)

    expect(response.message).toBe('Success')
    expect(response.data).toBeNull()
  })

  test('stores a custom message and data payload', () => {
    const payload = { id: 'abc123', name: 'Test Patient' }
    const response = new ApiResponse(StatusCodes.CREATED, 'Patient created', payload)

    expect(response.message).toBe('Patient created')
    expect(response.data).toBe(payload)
  })

  test('sets statusCode from the constructor argument', () => {
    const response = new ApiResponse(StatusCodes.ACCEPTED)

    expect(response.statusCode).toBe(StatusCodes.ACCEPTED)
  })

  test.each([
    [StatusCodes.OK, true],
    [StatusCodes.CREATED, true],
    [399, true],
    [StatusCodes.BAD_REQUEST, false],
    [StatusCodes.NOT_FOUND, false],
    [StatusCodes.INTERNAL_SERVER_ERROR, false],
  ])('sets success based on statusCode %i -> %s', (statusCode, expectedSuccess) => {
    const response = new ApiResponse(statusCode as StatusCodes)

    expect(response.success).toBe(expectedSuccess)
  })

  test('treats 400 as the exact boundary for failure', () => {
    const failing = new ApiResponse(400 as StatusCodes)
    const passing = new ApiResponse(399 as StatusCodes)

    expect(failing.success).toBe(false)
    expect(passing.success).toBe(true)
  })

  test('accepts array data payloads', () => {
    const items = [1, 2, 3]
    const response = new ApiResponse(StatusCodes.OK, 'List fetched', items)

    expect(response.data).toEqual([1, 2, 3])
  })

  test('accepts falsy but defined data payloads without falling back to null', () => {
    const response = new ApiResponse(StatusCodes.OK, 'Empty string data', '')

    expect(response.data).toBe('')
  })

  test('is exported as the default export of the module', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@alias/utils/ApiResponse')
    expect(mod.default).toBe(ApiResponse)
  })
})