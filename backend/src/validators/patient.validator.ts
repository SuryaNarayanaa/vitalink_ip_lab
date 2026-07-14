import { z } from 'zod'
import { HealthLog } from '.'
import { optionalPrimaryPhoneNumberSchema } from './phone.validator'
import { parseStrictDateOnly } from '@alias/utils/dateOnly'

const ddmmyyyy = z.string('Date should be a string')
    .regex(/^\d{2}-\d{2}-\d{4}$/, 'Date must be in DD-MM-YYYY format')
    .transform((val, ctx) => {
        const date = parseStrictDateOnly(val)
        if (!date) {
            ctx.addIssue({ code: 'custom', message: 'Date must be a valid calendar date' })
            return z.NEVER
        }
        return date
    })

const isoDateTime = z.string('Date should be a string')
    .datetime({ offset: true, message: 'Date must be a valid ISO-8601 timestamp' })
    .transform((value) => new Date(value))

export const reportSchema = z.object({
    body: z.object({
        inr_value: z.string().regex(/^\d+(?:\.\d+)?$/, 'INR value must be a positive decimal').transform(Number).refine(value => Number.isFinite(value) && value > 0 && value <= 20, 'INR value must be between 0 and 20'),
        test_date: ddmmyyyy,
    })
})
export type ReportInput = z.infer<typeof reportSchema>

export const takeDosageSchema = z.object({
    body: z.object({
        date: ddmmyyyy,
    })
})
export type TakeDosageInput = z.infer<typeof takeDosageSchema>

export const dosageCalendarQuerySchema = z.object({
    query: z.object({
        months: z.string().regex(/^[1-9]\d{0,2}$/, 'months must be a positive integer').optional(),
        start_date: z.string().refine(value => Boolean(parseStrictDateOnly(value)), 'start_date must be a valid calendar date in DD-MM-YYYY or YYYY-MM-DD format').optional(),
    }).strict()
})


export const updateHealthLogSchema = z.object({
    body: z.object({
        type: z.enum(HealthLog, "The Health Log Type should be a valid One"),
        description: z.string("Description Should be a string").trim().min(1, 'Description must not be empty').max(2000, 'Description is too long')
    }).strict()
})

export type UpdateHealthLog = z.infer<typeof updateHealthLogSchema>


export const updateProfileSchema = z.object({
    body: z.object({
        demographics: z.object({
            name: z.string().min(1, "Name is required").optional(),
            age: z.number().int().positive().optional(),
            gender: z.enum(["Male", "Female", "Other"]).optional(),
            phone: optionalPrimaryPhoneNumberSchema,
            next_of_kin: z.object({
                name: z.string().optional(),
                relation: z.string().optional(),
                phone: z.string().optional()
            }).optional()
        }).optional(),
        medical_history: z.array(z.object({
            diagnosis: z.string().trim().max(500).optional(),
            duration_value: z.number().finite().positive().optional(),
            duration_unit: z.enum(['Days', 'Weeks', 'Months', 'Years']).optional()
        }).strict()).max(50).optional(),
    }).strict()
})

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>

export const doctorUpdatesQuerySchema = z.object({
    query: z.object({
        unread_only: z.enum(['true', 'false']).optional(),
        limit: z.string().regex(/^\d+$/, 'Limit should be a valid number').optional(),
    }).strict()
})

export type DoctorUpdatesQueryInput = z.infer<typeof doctorUpdatesQuerySchema>

export const markDoctorUpdateReadSchema = z.object({
    params: z.object({
        event_id: z.string('event_id should be a valid string').regex(/^[a-f\d]{24}$/i, 'event_id must be a valid ObjectId')
    }).strict()
})

export type MarkDoctorUpdateReadInput = z.infer<typeof markDoctorUpdateReadSchema>

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
