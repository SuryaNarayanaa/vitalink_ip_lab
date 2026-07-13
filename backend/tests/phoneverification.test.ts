import { createDoctorSchema, createPatientSchema } from '@alias/validators/admin.validator'
import { createPatient as doctorCreatePatientSchema } from '@alias/validators/doctor.validator'
import { updateProfileSchema as patientUpdateProfileSchema } from '@alias/validators/patient.validator'
import { DoctorProfile, PatientProfile, User } from '@alias/models'
import { updatePatient } from '@alias/services/admin.service'
import * as rolePolicyService from '@alias/services/role-policy.service'

describe('phone verification groundwork', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('requires valid doctor contact_number on admin doctor creation', async () => {
    await expect(createDoctorSchema.parseAsync({
      body: {
        login_id: 'doctor_phone',
        password: 'Doctor@123',
        name: 'Dr. Phone',
      },
    })).rejects.toBeDefined()

    await expect(createDoctorSchema.parseAsync({
      body: {
        login_id: 'doctor_phone',
        password: 'Doctor@123',
        name: 'Dr. Phone',
        contact_number: '9000000001',
      },
    })).resolves.toBeDefined()
  })

  test('requires valid patient demographics phone on admin patient creation', async () => {
    await expect(createPatientSchema.parseAsync({
      body: {
        login_id: 'PAT_PHONE',
        password: 'Patient@123',
        assigned_doctor_id: 'doctor_phone',
        demographics: {
          name: 'Patient Phone',
          phone: '12345abcde',
        },
      },
    })).rejects.toBeDefined()

    await expect(createPatientSchema.parseAsync({
      body: {
        login_id: 'PAT_PHONE',
        password: 'Patient@123',
        assigned_doctor_id: 'doctor_phone',
        demographics: {
          name: 'Patient Phone',
          phone: '9888888888',
        },
      },
    })).resolves.toBeDefined()
  })

  test('validates doctor-added patient and patient self-update phone numbers', async () => {
    await expect(doctorCreatePatientSchema.parseAsync({
      body: {
        name: 'Doctor Added Patient',
        op_num: 'PAT_DOC_PHONE',
        gender: 'Male',
        contact_no: '7777777777',
        kin_contact_number: '6666666666',
      },
    })).resolves.toBeDefined()

    await expect(patientUpdateProfileSchema.parseAsync({
      body: {
        demographics: {
          phone: '77777abcde',
        },
      },
    })).rejects.toBeDefined()
  })

  test('defaults doctor and patient phone verification to pending', () => {
    const doctorProfile = new DoctorProfile({
      name: 'Dr. Pending',
      contact_number: '9000000001',
    })
    const patientProfile = new PatientProfile({
      demographics: {
        name: 'Pending Patient',
        phone: '9888888888',
      },
    })

    expect(doctorProfile.phone_verification.status).toBe('PENDING')
    expect(patientProfile.demographics.phone_verification.status).toBe('PENDING')
  })

  test('admin patient demographics updates preserve phone verification when phone is omitted', async () => {
    // updatePatient resolves admin permissions; isolate that dependency and let
    // the suite-level afterEach restore this spy even when the test fails.
    jest.spyOn(rolePolicyService, 'getRolePermissions').mockResolvedValue({} as any)
    const profileId = 'patient-profile-id'
    const patientUser: any = {
      _id: 'patient-user-id',
      user_type: 'PATIENT',
      profile_id: {
        _id: profileId,
        demographics: {
          name: 'Existing Patient',
          phone: '9888888888',
          phone_verification: {
            status: 'VERIFIED',
            verified_at: new Date('2026-01-01T00:00:00.000Z'),
          },
        },
      },
      save: jest.fn().mockResolvedValue(undefined),
    }
    const updatedUser = { ...patientUser }

    const findByIdMock = jest.spyOn(User, 'findById' as any) as jest.Mock
    findByIdMock
      .mockReturnValueOnce({ populate: jest.fn().mockResolvedValue(patientUser) })
      .mockReturnValueOnce({ populate: jest.fn().mockResolvedValue(updatedUser) })
    jest.spyOn(User, 'findOne').mockReturnValue({ populate: jest.fn() } as any)
    const updateSpy = jest
      .spyOn(PatientProfile, 'findByIdAndUpdate')
      .mockResolvedValue({} as any)

    await updatePatient('patient-user-id', {
      demographics: {
        name: 'Updated Name',
      },
    })

    expect(updateSpy).toHaveBeenCalledWith(
      patientUser.profile_id,
      {
        'demographics.name': 'Updated Name',
      }
    )
    const [, update] = updateSpy.mock.calls[0]
    expect(update).not.toHaveProperty('demographics')
    expect(update).not.toHaveProperty('demographics.phone')
    expect(update).not.toHaveProperty('demographics.phone_verification')
  })
})
