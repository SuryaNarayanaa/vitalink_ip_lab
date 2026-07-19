import { JWTPayload } from '@alias/validators'

/**
 * Lean user snapshot loaded during authenticate. Controllers can reuse this
 * instead of a second User.findById for the same principal.
 */
export type AuthUserSnapshot = {
  _id: import('mongoose').Types.ObjectId | string
  user_type: string
  profile_id?: import('mongoose').Types.ObjectId | string
  is_active: boolean
  security_version?: number
  must_change_password?: boolean
  password_changed_at?: Date | string | null
  createdAt?: Date | string
  updatedAt?: Date | string
}

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
