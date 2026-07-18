import { Request, Response, NextFunction } from 'express'
import asyncHandler from '@alias/utils/asynchandler'

const buildReqResNext = () => {
  const req = {} as Request
  const res = {} as Response
  const next = jest.fn() as unknown as NextFunction
  return { req, res, next }
}

describe('asyncHandler', () => {
  test('returns a function (RequestHandler)', () => {
    const wrapped = asyncHandler(async () => {})

    expect(typeof wrapped).toBe('function')
  })

  test('invokes the wrapped handler with req, res, and next', async () => {
    const handler = jest.fn(async () => {})
    const wrapped = asyncHandler(handler)
    const { req, res, next } = buildReqResNext()

    wrapped(req, res, next)
    await Promise.resolve()

    expect(handler).toHaveBeenCalledWith(req, res, next)
  })

  test('does not call next when the handler resolves successfully', async () => {
    const handler = jest.fn(async () => {})
    const wrapped = asyncHandler(handler)
    const { req, res, next } = buildReqResNext()

    wrapped(req, res, next)
    await Promise.resolve()
    await Promise.resolve()

    expect(next).not.toHaveBeenCalled()
  })

  test('forwards a rejected promise error to next', async () => {
    const error = new Error('async failure')
    const handler = jest.fn(async () => {
      throw error
    })
    const wrapped = asyncHandler(handler)
    const { req, res, next } = buildReqResNext()

    wrapped(req, res, next)
    await Promise.resolve()
    await Promise.resolve()

    expect(next).toHaveBeenCalledWith(error)
  })

  test('forwards a synchronously thrown error to next', async () => {
    const error = new Error('sync failure')
    const handler = jest.fn(() => {
      throw error
    })
    const wrapped = asyncHandler(handler)
    const { req, res, next } = buildReqResNext()

    wrapped(req, res, next)
    await Promise.resolve()
    await Promise.resolve()

    expect(next).toHaveBeenCalledWith(error)
  })

  test('supports handlers that return void synchronously without calling next', async () => {
    const handler = jest.fn((_req: Request, res: Response) => {
      (res as any).sent = true
    })
    const wrapped = asyncHandler(handler)
    const { req, res, next } = buildReqResNext()

    wrapped(req, res, next)
    await Promise.resolve()
    await Promise.resolve()

    expect((res as any).sent).toBe(true)
    expect(next).not.toHaveBeenCalled()
  })

  test('propagates the return value of Promise.resolve().catch chain only on error', async () => {
    const handler = jest.fn(async (_req: Request, res: Response) => {
      (res as any).body = 'ok'
    })
    const wrapped = asyncHandler(handler)
    const { req, res, next } = buildReqResNext()

    wrapped(req, res, next)
    await Promise.resolve()
    await Promise.resolve()

    expect((res as any).body).toBe('ok')
    expect(next).not.toHaveBeenCalled()
  })

  test('calls next explicitly invoked by the handler exactly once, without an extra error call', async () => {
    const handler = jest.fn(async (_req: Request, _res: Response, next: NextFunction) => {
      next()
    })
    const wrapped = asyncHandler(handler)
    const { req, res, next } = buildReqResNext()

    wrapped(req, res, next)
    await Promise.resolve()
    await Promise.resolve()

    expect(next).toHaveBeenCalledTimes(1)
    expect(next).toHaveBeenCalledWith()
  })

  test('is exported as the default export of the module', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@alias/utils/asynchandler')
    expect(mod.default).toBe(asyncHandler)
  })
})