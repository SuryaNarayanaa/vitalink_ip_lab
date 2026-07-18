import {Request, Response, NextFunction, RequestHandler} from 'express'

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void

const asyncHandler = (requestHandler: AsyncRequestHandler): RequestHandler => {
    return (req: Request, res: Response, next: NextFunction): void => {
        try {
            Promise.resolve(requestHandler(req, res, next)).catch(next)
        } catch (error) {
            next(error)
        }
    }
}

export default asyncHandler;
