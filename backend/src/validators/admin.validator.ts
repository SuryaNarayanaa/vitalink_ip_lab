import { z } from 'zod'
import { primaryPhoneNumberSchema, optionalPrimaryPhoneNumberSchema } from './phone.validator'

// ─── Param Schemas ───

export const userIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'User ID is required'),
  }),
})

// ─── Doctor Schemas ───

export const createDoctorSchema = z.object({
  body: z.object({
    login_id: z.string().min(3, 'Login ID must be at least 3 characters'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Password must contain at least one digit')
      .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
    name: z.string().min(1, 'Name is required'),
    department: z.string().optional(),
    contact_number: primaryPhoneNumberSchema,
    hospital_id: z.string().optional(),
    hospital: z.string().optional(),
  }).strict(),
})

export const updateDoctorSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Doctor ID is required'),
  }),
  body: z.object({
    name: z.string().min(1).optional(),
    department: z.string().optional(),
    contact_number: optionalPrimaryPhoneNumberSchema,
    is_active: z.boolean().optional(),
    password: z.string().min(8).optional(),
    hospital_id: z.string().optional(),
    hospital: z.string().optional(),
  }).strict(),
})

export const getDoctorsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    department: z.string().optional(),
    is_active: z.enum(['true', 'false']).optional(),
    search: z.string().optional(),
    hospital_id: z.string().optional(),
  }),
})

// ─── Patient Schemas ───

export const createPatientSchema = z.object({
  body: z.object({
    login_id: z.string().min(3, 'Login ID must be at least 3 characters'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Password must contain at least one digit')
      .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
    assigned_doctor_id: z.string().min(1, 'Assigned doctor ID is required'),
    demographics: z.object({
      name: z.string().min(1, 'Patient name is required'),
      age: z.number().int().positive().optional(),
      gender: z.enum(['Male', 'Female', 'Other']).optional(),
      phone: primaryPhoneNumberSchema,
      next_of_kin: z
        .object({
          name: z.string().optional(),
          relation: z.string().optional(),
          relationship: z.string().optional(),
          phone: optionalPrimaryPhoneNumberSchema,
        })
        .optional(),
    }),
    medical_config: z
      .object({
        diagnosis: z.string().optional(),
        therapy_drug: z.string().optional(),
        therapy_start_date: z.string().optional(),
        target_inr: z
          .object({
            min: z.number().positive(),
            max: z.number().positive(),
          })
          .optional(),
      })
      .optional(),
    hospital_id: z.string().optional(),
    hospital: z.string().optional(),
  }),
})

export const updatePatientSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Patient ID is required'),
  }),
  body: z.object({
    demographics: z
      .object({
        name: z.string().optional(),
        age: z.number().int().positive().optional(),
        gender: z.string().optional(),
        phone: optionalPrimaryPhoneNumberSchema,
        next_of_kin: z
          .object({
            name: z.string().optional(),
            relation: z.string().optional(),
            relationship: z.string().optional(),
            phone: optionalPrimaryPhoneNumberSchema,
          })
          .optional(),
      })
      .optional(),
    medical_config: z
      .object({
        diagnosis: z.string().optional(),
        therapy_drug: z.string().optional(),
        therapy_start_date: z.string().optional(),
        target_inr: z
          .object({
            min: z.number().positive(),
            max: z.number().positive(),
          })
          .optional(),
      })
      .optional(),
    assigned_doctor_id: z.string().optional(),
    account_status: z.enum(['Active', 'Discharged', 'Deceased']).optional(),
    is_active: z.boolean().optional(),
    password: z.string().min(8).optional(),
    hospital_id: z.string().optional(),
    hospital: z.string().optional(),
  }),
})

export const getUsersSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    assigned_doctor_id: z.string().optional(),
    account_status: z.string().optional(),
    search: z.string().optional(),
    hospital_id: z.string().optional(),
  }),
})

// ─── Reassign Schema ───

export const reassignPatientSchema = z.object({
  params: z.object({
    op_num: z.string().min(1, 'Patient OP number is required'),
  }),
  body: z.object({
    new_doctor_id: z.string().min(1, 'New doctor ID is required'),
  }),
})

export const updateSystemConfigSchema = z.object({
  body: z.object({
    inr_thresholds: z.object({
      critical_low: z.number().positive().optional(),
      critical_high: z.number().positive().optional(),
    }).optional(),
    session_timeout_minutes: z.number().int().positive().optional(),
    rate_limit: z.object({
      max_requests: z.number().int().positive().optional(),
      window_minutes: z.number().int().positive().optional(),
    }).optional(),
    feature_flags: z.record(z.string(), z.boolean()).optional(),
  }).strict(),
})

export const broadcastNotificationSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'Title is required').max(200),
    message: z.string().min(1, 'Message is required').max(2000),
    target: z.enum(['ALL', 'DOCTORS', 'PATIENTS', 'SPECIFIC']),
    user_ids: z.array(z.string().min(1)).optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  }).strict().superRefine((value, ctx) => {
    if (value.target === 'SPECIFIC' && (!value.user_ids || value.user_ids.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'user_ids is required when target is SPECIFIC',
        path: ['user_ids'],
      })
    }
  }),
})

export const batchOperationSchema = z.object({
  body: z.object({
    operation: z.enum(['activate', 'deactivate', 'reset_password']),
    user_ids: z.array(z.string().min(1)).min(1, 'At least one user ID is required'),
  }).strict(),
})

export const resetPasswordSchema = z.object({
  body: z.object({
    target_user_id: z.string().min(1, 'Target user ID is required'),
    new_password: z.string().min(8).optional(),
  }).strict(),
})
