import {
  optionalPrimaryPhoneNumberSchema,
  primaryPhoneNumberSchema,
} from '@alias/validators/phone.validator'

describe('Indian primary phone number validation', () => {
  test('defaults bare 10 digit phone numbers to +91 E.164 format', () => {
    expect(primaryPhoneNumberSchema.parse('7448757584')).toBe('+917448757584')
  })

  test('preserves valid +91 E.164 phone numbers', () => {
    expect(primaryPhoneNumberSchema.parse('+917448757584')).toBe('+917448757584')
  })

  test('accepts common Indian phone entry formats', () => {
    expect(primaryPhoneNumberSchema.parse('91 74487 57584')).toBe('+917448757584')
    expect(primaryPhoneNumberSchema.parse('07448757584')).toBe('+917448757584')
  })

  test('rejects phone numbers that cannot be normalized to Indian E.164', () => {
    expect(() => primaryPhoneNumberSchema.parse('+14755551212')).toThrow(
      'Phone number must be a valid Indian number with 10 digits'
    )
    expect(() => primaryPhoneNumberSchema.parse('744875758')).toThrow(
      'Phone number must be a valid Indian number with 10 digits'
    )
  })

  test('keeps optional phone numbers optional', () => {
    expect(optionalPrimaryPhoneNumberSchema.parse(undefined)).toBeUndefined()
  })
})
