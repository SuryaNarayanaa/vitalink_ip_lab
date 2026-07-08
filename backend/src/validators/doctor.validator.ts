import { z } from 'zod'
import { therapy_drug } from '.'
import { primaryPhoneNumberSchema, optionalPrimaryPhoneNumberSchema } from './phone.validator'

const dosageScheduleBaseSchema = z.object({
  monday: z.number().default(0),
  tuesday: z.number().default(0),
  wednesday: z.number().default(0),
  thursday: z.number().default(0),
  friday: z.number().default(0),
  saturday: z.number().default(0),
  sunday: z.number().default(0)
})

const dosageScheduleSchema = dosageScheduleBaseSchema.optional()

const opNumParamsSchema = z.object({
  op_num: z.string("Op num should be a String").nonempty("op_num should not be empty")
})

const ddmmyyyy = z.preprocess((arg) => {
  if (arg === null || arg === undefined || arg === '') return undefined;
  if (arg instanceof Date) return arg;
  if (typeof arg === 'string') {
    const isoDate = new Date(arg);
    if (!isNaN(isoDate.getTime())) return isoDate;

    const ddmmyyyyMatch = arg.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (ddmmyyyyMatch) {
      const [, day, month, year] = ddmmyyyyMatch;
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }

    const yyyymmddMatch = arg.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (yyyymmddMatch) {
      const [, year, month, day] = yyyymmddMatch;
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }
  }
  return undefined;
}, z.date().optional())

const medicalHistorySchema = z.object({
  diagnosis: z.string().optional(),
  duration_value: z.number().optional(),
  duration_unit: z.enum(['Days', 'Weeks', 'Months', 'Years']).optional(),
});

export const createPatient = z.object({
  body: z.object({
    name: z.string("Name should be a String").nonempty("Name Should Not be Empty"),
    op_num: z.string("Op num should be a String").nonempty("op_num should not be nonempty"),
    age: z.number("age should be a number").max(100, "Age cannot exceed 100").optional(),
    gender: z.enum(["Male", "Female", "Other"], "The gender should be a valid option"),
    contact_no: primaryPhoneNumberSchema,
    target_inr_min: z.number("target_inr_min should be a number").optional(),
    target_inr_max: z.number("target_inr_max should be a number").optional(),
    therapy: z.enum(therapy_drug, "Therapy Drug Should only Take The given Drug Values").optional(),
    therapy_start_date: ddmmyyyy.optional(),
    prescription: dosageScheduleSchema,
    medical_history: z.array(medicalHistorySchema).optional(),
    kin_name: z.string("kin_name should be string").optional(),
    kin_relation: z.string("Relation should be string").optional(),
    kin_contact_number: z.string("contact_number should be a string"),
  })
})

export type CreatePatientInput = z.infer<typeof createPatient>


export const updateProfile = z.object({
  body: z.object({
    name: z.string("Name should be a String").nonempty("Name Should Not be Empty").optional(),
    department: z.string("Department should be a String").optional(),
    contact_number: optionalPrimaryPhoneNumberSchema,
  }).strict()
})

export type UpdateProfileInput = z.infer<typeof updateProfile>

export const UpdateReportSchema = z.object({
  params: z.object({
    op_num: z.string("Op_num should be a valid String"),
    report_id: z.string("Report_id should be a valid String")
  }),
  body: z.object({
    is_critical: z.boolean("Critical Must be a Boolean Value").optional(),
    notes: z.string("Instructions To The patient Must To be a String").optional()
  })
})

export type UpdateReportInput = z.infer<typeof UpdateReportSchema>

export const ReassignPatientSchema = z.object({
  params: opNumParamsSchema,
  body: z.object({
    new_doctor_id: z.string("new_doctor_id should be a String").nonempty("new_doctor_id should not be empty")
  }).strict()
})

export type ReassignPatientInput = z.infer<typeof ReassignPatientSchema>

export const EditPatientDosageSchema = z.object({
  params: opNumParamsSchema,
  body: z.object({
    prescription: dosageScheduleBaseSchema
  }).strict()
})

export type EditPatientDosageInput = z.infer<typeof EditPatientDosageSchema>

export const UpdateNextReviewSchema = z.object({
  params: opNumParamsSchema,
  body: z.object({
    date: z.string("Date should be a string")
      .regex(/^\d{2}-\d{2}-\d{4}$/, "Date must be in DD-MM-YYYY format")
  }).strict()
})

export type UpdateNextReviewInput = z.infer<typeof UpdateNextReviewSchema>

export const UpdateInstructionsSchema = z.object({
  params: opNumParamsSchema,
  body: z.object({
    instructions: z.array(z.string("Each instruction must be a string"), {
      error: "Instructions must be an array of strings",
    })
  }).strict()
})

export type UpdateInstructionsInput = z.infer<typeof UpdateInstructionsSchema>

export const notificationsQuerySchema = z.object({
  query: z.object({
    page: z.string().regex(/^\d+$/, 'page should be a valid number').optional(),
    limit: z.string().regex(/^\d+$/, 'limit should be a valid number').optional(),
    is_read: z.enum(['true', 'false']).optional(),
  }).strict()
})

export type NotificationsQueryInput = z.infer<typeof notificationsQuerySchema>

export const markNotificationReadSchema = z.object({
  params: z.object({
    notification_id: z.string('notification_id should be a valid string').regex(/^[a-f\d]{24}$/i, 'notification_id must be a valid ObjectId')
  }).strict()
})

export type MarkNotificationReadInput = z.infer<typeof markNotificationReadSchema>
