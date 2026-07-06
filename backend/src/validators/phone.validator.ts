import { z } from 'zod'

export const primaryPhoneNumberSchema = z
  .string('Phone number should be a string')
  .trim()
  .regex(/^\d{10}$/, 'Phone number must be exactly 10 digits')

export const optionalPrimaryPhoneNumberSchema = primaryPhoneNumberSchema.optional()
