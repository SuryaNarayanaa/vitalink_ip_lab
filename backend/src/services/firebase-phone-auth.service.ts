import type { Auth, DecodedIdToken } from 'firebase-admin/auth'
import { config } from '@alias/config'
import { getFirebaseAuth } from '@alias/config/firebase.config'
import { normalizePhoneNumber } from './otp.service'

export function toFirebaseE164(phoneNumber: string): string {
  const trimmed = phoneNumber.trim()
  if (!trimmed) throw new Error('Registered phone number is empty')

  if (trimmed.startsWith('+')) {
    return `+${normalizePhoneNumber(trimmed)}`
  }

  const countryCode = `+${normalizePhoneNumber(config.firebasePhoneDefaultCountryCode)}`
  return `${countryCode}${normalizePhoneNumber(trimmed)}`
}

export async function verifyFirebasePhoneIdToken(
  idToken: string,
  expectedPhoneNumber: string,
  auth: Auth = getFirebaseAuth()
): Promise<DecodedIdToken> {
  const decodedToken = await auth.verifyIdToken(idToken, true)
  const verifiedPhone = typeof decodedToken.phone_number === 'string'
    ? decodedToken.phone_number
    : ''

  if (!verifiedPhone) {
    throw new Error('Firebase ID token does not contain a verified phone number')
  }

  if (normalizePhoneNumber(verifiedPhone) !== normalizePhoneNumber(toFirebaseE164(expectedPhoneNumber))) {
    throw new Error('Firebase phone number does not match the registered phone number')
  }

  return decodedToken
}
