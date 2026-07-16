import { z } from 'zod'

const normalizeIndianPrimaryPhoneNumber = (phoneNumber: string): string => {
  const compactPhoneNumber = phoneNumber.trim().replace(/[\s()-]/g, '')

  if (/^\d{10}$/.test(compactPhoneNumber)) {
    return `+91${compactPhoneNumber}`
  }

  if (/^91\d{10}$/.test(compactPhoneNumber)) {
    return `+${compactPhoneNumber}`
  }

  if (/^\+91\d{10}$/.test(compactPhoneNumber)) {
    return compactPhoneNumber
  }

  if (/^0\d{10}$/.test(compactPhoneNumber)) {
    return `+91${compactPhoneNumber.slice(1)}`
  }

  return compactPhoneNumber
}

export const primaryPhoneNumberSchema = z
  .string('Phone number should be a string')
  .transform(normalizeIndianPrimaryPhoneNumber)
  .refine((phoneNumber) => /^\+91\d{10}$/.test(phoneNumber), {
    message: 'Phone number must be a valid Indian number with 10 digits',
  })

export const optionalPrimaryPhoneNumberSchema = primaryPhoneNumberSchema.optional()
