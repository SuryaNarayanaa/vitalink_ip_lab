import { z } from 'zod'
import { MAX_SESSION_TIMEOUT_MINUTES } from '@alias/services/config.service'
import { primaryPhoneNumberSchema, optionalPrimaryPhoneNumberSchema } from './phone.validator'
const adminRoleSchema = z.enum(['hospital_admin', 'auditor'])
const roleKeySchema = z.enum(['app_admin', 'hospital_admin', 'doctor', 'patient', 'auditor'])
const rolePermissionsSchema = z.object({
  manage_hospitals: z.boolean().optional(),
  manage_users: z.boolean().optional(),
  manage_roles: z.boolean().optional(),
  view_audit: z.boolean().optional(),
  manage_doctors: z.boolean().optional(),
  manage_patients: z.boolean().optional(),
  export_data: z.boolean().optional(),
  manage_billing: z.boolean().optional(),
  manage_system: z.boolean().optional(),
}).strict().refine(value => Object.keys(value).length > 0, {
  message: 'At least one permission is required',
})

// ─── Param Schemas ───

export const userIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'User ID is required'),
  }),
})

export const doctorStatusSchema = z.object({
  params: z.object({ id: z.string().min(1, 'Doctor ID is required') }),
  body: z.object({ is_active: z.boolean() }).strict(),
})

export const patientStatusSchema = z.object({
  params: z.object({ id: z.string().min(1, 'Patient ID is required') }),
  body: z.object({
    is_active: z.boolean().optional(),
    account_status: z.enum(['Active', 'Discharged', 'Deceased']).optional(),
  }).strict().refine(value => value.is_active !== undefined || value.account_status !== undefined, {
    message: 'At least one Patient status field is required',
  }),
})

export const operationalCredentialsResetSchema = z.object({
  params: z.object({ id: z.string().min(1, 'User ID is required') }),
  body: z.object({ new_password: z.string().min(8).optional() }).strict(),
})

export const patientAssignmentSchema = z.object({
  params: z.object({ id: z.string().min(1, 'Patient ID is required') }),
  body: z.object({ doctor_id: z.string().min(1, 'Doctor ID is required') }).strict(),
})

// ─── Doctor Schemas ───

export const createDoctorSchema = z.object({
  body: z.object({
    login_id: z.string().min(3, 'Login ID must be at least 3 characters'),
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

// Keep an explicit typed shape so older TypeScript callers still compile, but
// always reject it: clinical configuration belongs to Doctor/clinical routes.
const forbiddenAdminMedicalConfigSchema = z.object({
  diagnosis: z.string().optional(),
  therapy_drug: z.string().optional(),
  therapy_start_date: z.coerce.date().optional(),
  target_inr: z.object({ min: z.number(), max: z.number() }).optional(),
  dosage: z.unknown().optional(),
  instructions: z.unknown().optional(),
  inr_data: z.unknown().optional(),
  treatment_data: z.unknown().optional(),
}).passthrough().superRefine((_value, ctx) => {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'Clinical Patient fields are not allowed on administrative routes',
  })
})

export const createPatientSchema = z.object({
  body: z.object({
    login_id: z.string().min(3, 'Login ID must be at least 3 characters'),
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
        .strict()
        .optional(),
    }).strict(),
    medical_config: forbiddenAdminMedicalConfigSchema.optional(),
    hospital_id: z.string().optional(),
    hospital: z.string().optional(),
  }).strict(),
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
        gender: z.enum(['Male', 'Female', 'Other']).optional(),
        phone: optionalPrimaryPhoneNumberSchema,
        next_of_kin: z
          .object({
            name: z.string().optional(),
            relation: z.string().optional(),
            relationship: z.string().optional(),
            phone: optionalPrimaryPhoneNumberSchema,
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    medical_config: forbiddenAdminMedicalConfigSchema.optional(),
    hospital_id: z.string().optional(),
    hospital: z.string().optional(),
  }).strict(),
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
    session_timeout_minutes: z.number().int().positive().max(MAX_SESSION_TIMEOUT_MINUTES).optional(),
    rate_limit: z.object({
      max_requests: z.number().int().positive().optional(),
      window_minutes: z.number().int().positive().optional(),
    }).optional(),
    feature_flags: z.record(z.string(), z.boolean()).optional(),
  }).strict().superRefine((value, ctx) => {
    const thresholds = value.inr_thresholds
    if (thresholds?.critical_low !== undefined &&
      thresholds.critical_high !== undefined &&
      thresholds.critical_low >= thresholds.critical_high) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['inr_thresholds', 'critical_low'],
        message: 'Critical low threshold must be less than critical high threshold',
      })
    }
  }),
})

const boundedQueryText = z.string().trim().min(1).max(100)

export const auditLogsQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    user_id: z.string().regex(/^[a-f\d]{24}$/i, 'user_id must be a valid ObjectId').optional(),
    action: z.enum([
      'LOGIN', 'LOGIN_CHALLENGE', 'LOGOUT', 'LOGIN_FAILED', 'USER_CREATE', 'USER_UPDATE',
      'USER_DEACTIVATE', 'USER_ACTIVATE', 'USER_DELETE', 'PASSWORD_RESET',
      'PASSWORD_CHANGE', 'MFA_SETUP', 'MFA_ACTIVATE', 'MFA_RESET', 'PATIENT_REASSIGN', 'PATIENT_DISCHARGE', 'INR_SUBMIT',
      'INR_UPDATE', 'DOSAGE_UPDATE', 'HEALTH_LOG_CREATE', 'CONFIG_UPDATE',
      'NOTIFICATION_BROADCAST', 'BATCH_OPERATION', 'PROFILE_UPDATE', 'REPORT_UPDATE',
    ]).optional(),
    start_date: z.string().refine(value => !Number.isNaN(Date.parse(value)), 'start_date must be a valid date').optional(),
    end_date: z.string().refine(value => !Number.isNaN(Date.parse(value)), 'end_date must be a valid date').optional(),
    success: z.enum(['true', 'false']).optional(),
  }).strict().refine(
    value => !value.start_date || !value.end_date || new Date(value.end_date) >= new Date(value.start_date),
    'end_date must be greater than or equal to start_date',
  ),
})

export const hospitalListQuerySchema = z.object({
  query: z.object({
    status: z.enum(['active', 'suspended', 'inactive']).optional(),
    search: boundedQueryText.optional(),
  }).strict(),
})

const hospitalStatusSchema = z.enum(['active', 'suspended', 'inactive'])
const hospitalBodySchema = z.object({
  code: z.string().min(1).max(32).optional(),
  name: z.string().min(1).max(200),
  location: z.string().min(1).max(200),
  admin_email: z.string().email(),
  status: hospitalStatusSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict()

export const createHospitalSchema = z.object({ body: hospitalBodySchema })
export const updateHospitalSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: hospitalBodySchema.partial().refine(value => Object.keys(value).length > 0, 'At least one field is required'),
})
export const updateHospitalStatusSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({ status: hospitalStatusSchema }).strict(),
})

const createAdminAccountBodySchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  role: adminRoleSchema,
  hospital_id: z.string().min(1).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.role === 'hospital_admin' && !value.hospital_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['hospital_id'],
      message: 'Hospital Admin must be assigned to one active hospital',
    })
  }
  if (value.role === 'auditor' && value.hospital_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['hospital_id'],
      message: 'System Auditor must not be assigned to a hospital',
    })
  }
})

export const createAdminAccountSchema = z.object({ body: createAdminAccountBodySchema })
export const inviteAdminUserSchema = createAdminAccountSchema

export const generateInvoicesSchema = z.object({
  body: z.object({
    billing_period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'billing_period must be YYYY-MM'),
    plan: z.string().min(1).max(200).optional(),
    amount: z.number().finite().nonnegative().optional(),
  }).strict(),
})

export const invoiceIdParamSchema = z.object({ params: z.object({ invoiceId: z.string().min(1) }) })

export const updateAdminAccountSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'User ID is required'),
  }),
  body: z.object({
    role: adminRoleSchema.optional(),
    name: z.string().min(1).optional(),
    hospital_id: z.string().min(1).optional(),
    hospital: z.string().min(1).optional(),
    is_active: z.boolean().optional(),
    status: z.enum(['active', 'inactive']).optional(),
  }).strict().refine(value => Object.keys(value).length > 0, 'At least one field is required')
    .superRefine((value, ctx) => {
      const hospital = value.hospital_id || value.hospital
      if (value.role === 'hospital_admin' && !hospital) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['hospital_id'],
          message: 'Hospital Admin role changes require one active hospital',
        })
      }
      if (value.role === 'auditor' && hospital) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['hospital_id'],
          message: 'System Auditor must not be assigned to a hospital',
        })
      }
      if (value.is_active !== undefined && value.status !== undefined &&
          value.is_active !== (value.status === 'active')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['status'],
          message: 'Conflicting administrator account status values',
        })
      }
    }),
})
export const updateAdminUserSchema = updateAdminAccountSchema
export const resetAdminAccountMfaSchema = userIdParamSchema

export const updateRoleSchema = z.object({
  params: z.object({
    roleKey: roleKeySchema,
  }),
  body: z.object({
    permissions: rolePermissionsSchema,
  }).strict(),
})

export const broadcastNotificationSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'Title is required').max(200),
    message: z.string().min(1, 'Message is required').max(2000),
    target: z.enum(['ALL', 'DOCTORS', 'PATIENTS', 'SPECIFIC']),
    user_ids: z.array(z.string().regex(/^[a-f\d]{24}$/i, 'user ID must be a valid ObjectId')).max(1000).optional(),
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
    user_ids: z.array(z.string().regex(/^[a-f\d]{24}$/i, 'user ID must be a valid ObjectId'))
      .min(1, 'At least one user ID is required').max(100),
  }).strict(),
})

export const resetPasswordSchema = z.object({
  body: z.object({
    target_user_id: z.string().min(1, 'Target user ID is required'),
    new_password: z.string().min(8).optional(),
  }).strict(),
})
