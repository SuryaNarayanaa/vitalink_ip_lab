import { JWTPayload } from '@alias/validators'
import type { AuthUserSnapshot } from '@alias/types/auth-user'

export type { AuthUserSnapshot }

/**
 * Extend Express Request type to include user authentication data
 */
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload
      /** Lean user row validated by authenticate (same request only). */
      authUser?: AuthUserSnapshot
      requestId?: string
      validatedQuery?: unknown
    }
  }
}
declare module "express-serve-static-core" {
  interface Request {
    requestId?: string;
    validatedQuery?: unknown;
    authUser?: AuthUserSnapshot;
  }
}
