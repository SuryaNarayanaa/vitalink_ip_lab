import { Request, Response, NextFunction } from 'express'
import { ZodSchema } from 'zod'

export const validate = (schema: ZodSchema) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params
      })
      if (parsed && typeof parsed === 'object') {
        if ('body' in parsed) {
          req.body = parsed.body
        }
        if ('query' in parsed) {
          ;(req as any).validatedQuery = parsed.query
        }
        if ('params' in parsed) {
          req.params = parsed.params as Request['params']
        }
      }
      next()
    } catch (error) {
      next(error)
    }
  }
}
