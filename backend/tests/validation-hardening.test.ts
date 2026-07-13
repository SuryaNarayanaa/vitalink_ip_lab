import { StatusCodes } from 'http-status-codes'
import { createPatient as doctorCreatePatientSchema } from '@alias/validators/doctor.validator'
import { createPatientSchema as adminCreatePatientSchema } from '@alias/validators/admin.validator'
import { assertStrongPassword } from '@alias/services/password.service'
import ApiError from '@alias/utils/ApiError'
import errorHandler from '@alias/middlewares/errorHandler'
import { validate } from '@alias/middlewares/ValidateResource'
import { getDoctorsSchema } from '@alias/validators/admin.validator'
import { calendarDateKeyInTimeZone, dateOnlyStringKey } from '@alias/utils/dateOnly'

describe('validation and error hardening', () => {
  test.each(['short', 'alllowercase1!', 'ALLUPPERCASE1!', 'NoNumber!', 'NoSpecial1']) (
    'central password policy rejects %s',
    (password) => {
      expect(() => assertStrongPassword(password)).toThrow(ApiError)
    }
  )

  test('central password policy accepts a strong password', () => {
    expect(() => assertStrongPassword('StrongPass1!')).not.toThrow()
  })

  test('doctor patient onboarding rejects an invalid date instead of dropping it', async () => {
    const result = await doctorCreatePatientSchema.safeParseAsync({
      body: {
        name: 'Patient',
        op_num: 'PAT-1',
        gender: 'Other',
        contact_no: '+919000000001',
        kin_contact_number: '+919000000002',
        therapy_start_date: '31-02-2026',
      },
    })

    expect(result.success).toBe(false)
  })

  test('admin patient onboarding parses a valid date-only value', async () => {
    const result = await adminCreatePatientSchema.parseAsync({
      body: {
        login_id: 'PAT-1',
        password: 'StrongPass1!',
        assigned_doctor_id: 'DOC-1',
        demographics: {
          name: 'Patient',
          phone: '+919000000001',
        },
        medical_config: { therapy_start_date: '2025-06-20' },
      },
    })

    expect(result.body.medical_config?.therapy_start_date).toBeInstanceOf(Date)
  })

  test('clinical today is not treated as future before UTC reaches local midnight', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-13T19:00:00.000Z'))
    try {
      expect(calendarDateKeyInTimeZone(new Date(), 'Asia/Kolkata')).toBe('2026-07-14')
      expect(dateOnlyStringKey('2026-07-14')).toBe('2026-07-14')

      const result = await adminCreatePatientSchema.safeParseAsync({
        body: {
          login_id: 'PAT-TZ',
          password: 'StrongPass1!',
          assigned_doctor_id: 'DOC-1',
          demographics: { name: 'Patient', phone: '+919000000001' },
          medical_config: { therapy_start_date: '2026-07-14' },
        },
      })

      expect(result.success).toBe(true)

      const futureResult = await adminCreatePatientSchema.safeParseAsync({
        body: {
          login_id: 'PAT-TZ-FUTURE',
          password: 'StrongPass1!',
          assigned_doctor_id: 'DOC-1',
          demographics: { name: 'Patient', phone: '+919000000001' },
          medical_config: { therapy_start_date: '2026-07-15' },
        },
      })
      expect(futureResult.success).toBe(false)
    } finally {
      jest.useRealTimers()
    }
  })

  test('Express 5 query validation preserves parsed values on the request side channel', async () => {
    const req = { body: {}, params: {}, query: { page: '2', limit: '25' } } as any
    const next = jest.fn()

    await validate(getDoctorsSchema)(req, {} as any, next)

    expect(next).toHaveBeenCalledWith()
    expect(req.query).toEqual({ page: '2', limit: '25' })
    expect(req.validatedQuery).toEqual({ page: 2, limit: 25 })
  })

  test('unexpected errors do not disclose internal messages', () => {
    const status = jest.fn().mockReturnThis()
    const json = jest.fn().mockReturnThis()
    const req = { method: 'GET', originalUrl: '/api/private', requestId: 'request-1' } as any
    const res = { status, json } as any

    errorHandler(new Error('database password leaked in driver error'), req, res, jest.fn())

    expect(status).toHaveBeenCalledWith(StatusCodes.INTERNAL_SERVER_ERROR)
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'The server could not complete the request.',
    }))
  })
})
