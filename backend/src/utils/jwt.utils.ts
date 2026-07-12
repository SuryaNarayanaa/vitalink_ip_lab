import jwt from 'jsonwebtoken'
import { StringValue } from 'ms'
import { config } from '@alias/config'
import { JWTPayload } from '@alias/validators'

export function generateToken(payload: JWTPayload, expiresIn: StringValue | number = config.jwtExpiresIn): string {
  try {
    const token = jwt.sign(payload, config.jwtSecret, {
      expiresIn,
    })
    return token
  } catch (error) {
    throw new Error(`Failed to generate token: ${(error as Error).message}`)
  }
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as JWTPayload
    return decoded
  } catch (error) {
    // Token is invalid or expired, return null
    return null
  }
}

export function extractTokenFromHeader(authHeader?: string): string | null {
  if (!authHeader) {
    return null
  }

  const parts = authHeader.split(' ')
  
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null
  }

  return parts[1]
}
