import type { Types } from 'mongoose'

/**
 * Lean user snapshot loaded during authenticate. Controllers can reuse this
 * instead of a second User.findById for the same principal.
 */
export type AuthUserSnapshot = {
  _id: Types.ObjectId | string
  user_type: string
  profile_id?: Types.ObjectId | string
  is_active: boolean
  security_version?: number
  must_change_password?: boolean
  password_changed_at?: Date | string | null
  createdAt?: Date | string
  updatedAt?: Date | string
}
