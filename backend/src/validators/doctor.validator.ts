import { z } from 'zod'
import { therapy_drug } from '.'
import { primaryPhoneNumberSchema, optionalPrimaryPhoneNumberSchema } from './phone.validator'
import { calendarDateKeyInTimeZone, dateOnlyStringKey, parseStrictDateOnly } from '@alias/utils/dateOnly'
import { config } from '@alias/config'

const dosageScheduleBaseSchema = z.object({
  monday: z.number().finite().nonnegative().default(0), tuesday: z.number().finite().nonnegative().default(0), wednesday: z.number().finite().nonnegative().default(0), thursday: z.number().finite().nonnegative().default(0), friday: z.number().finite().nonnegative().default(0), saturday: z.number().finite().nonnegative().default(0), sunday: z.number().finite().nonnegative().default(0)
}).refine(value => Object.values(value).some(dose => dose > 0), 'At least one scheduled dose must be positive')

const dosageScheduleSchema = dosageScheduleBaseSchema.optional()

const opNumParamsSchema = z.object({
  op_num: z.string("Op num should be a String").trim().min(1, "op_num should not be empty").max(100)
}).strict()

export const patientOpNumParamsSchema = z.object({ params: opNumParamsSchema })

export const patientReportParamsSchema = z.object({
  params: opNumParamsSchema.extend({
    report_id: z.string().regex(/^[a-f\d]{24}$/i, 'report_id must be a valid ObjectId'),
  }),
})

const optionalDateOnly = z.union([z.string(), z.date()])
  .transform((value, ctx) => {
    const parsed = value instanceof Date ? value : parseStrictDateOnly(value)
    if (!parsed || Number.isNaN(parsed.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'Date must be a valid calendar date in DD-MM-YYYY or YYYY-MM-DD format' })
      return z.NEVER
    }
    return parsed
  })
  .optional()

const medicalHistorySchema = z.object({
  diagnosis: z.string().trim().max(500).optional(),
  duration_value: z.number().finite().positive().optional(),
  duration_unit: z.enum(['Days', 'Weeks', 'Months', 'Years']).optional(),
});

export const createPatient = z.object({
  body: z.object({
    name: z.string("Name should be a String").trim().min(1, "Name Should Not be Empty").max(200),
    op_num: z.string("Op num should be a String").trim().min(1, "op_num should not be empty").max(100),
    age: z.number("age should be a number").int().positive().max(120, "Age cannot exceed 120").optional(),
    gender: z.enum(["Male", "Female", "Other"], "The gender should be a valid option"),
    contact_no: primaryPhoneNumberSchema,
    target_inr_min: z.number().finite().positive().optional(),
    target_inr_max: z.number().finite().positive().optional(),
    therapy: z.enum(therapy_drug, "Therapy Drug Should only Take The given Drug Values").optional(),
    therapy_start_date: optionalDateOnly,
    prescription: dosageScheduleSchema,
    medical_history: z.array(medicalHistorySchema).max(50).optional(),
    kin_name: z.string("kin_name should be string").trim().max(200).optional(),
    kin_relation: z.string("Relation should be string").trim().max(100).optional(),
    kin_contact_number: z.string("contact_number should be a string"),
  }).strict().refine(value => value.target_inr_min === undefined || value.target_inr_max === undefined || value.target_inr_min < value.target_inr_max, 'Target INR minimum must be less than maximum')
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
    op_num: z.string("Op_num should be a valid String").trim().min(1).max(100),
    report_id: z.string("Report_id should be a valid String").regex(/^[a-f\d]{24}$/i, 'report_id must be a valid ObjectId')
  }).strict(),
  body: z.object({
    is_critical: z.boolean("Critical Must be a Boolean Value").optional(),
    notes: z.string("Instructions To The patient Must To be a String").trim().max(4000).optional()
  }).strict()
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
      .refine(value => Boolean(parseStrictDateOnly(value)), 'Date must be a valid calendar date')
      .refine(
        value => (dateOnlyStringKey(value) ?? '') >= calendarDateKeyInTimeZone(new Date(), config.dosageReminderTimezone),
        'Next review date cannot be in the past',
      )
  }).strict()
})

export type UpdateNextReviewInput = z.infer<typeof UpdateNextReviewSchema>

export const UpdateInstructionsSchema = z.object({
  params: opNumParamsSchema,
  body: z.object({
    instructions: z.array(z.string("Each instruction must be a string").trim().min(1).max(500), {
      error: "Instructions must be an array of strings",
    }).max(50)
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
