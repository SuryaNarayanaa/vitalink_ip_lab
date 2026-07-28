import { z } from 'zod'
import {
  ADMIN_CAPABILITIES,
  ADMIN_ROLE_KEYS,
  type AdminRoleKey,
  normalizeAdminCapabilityMap,
} from '@alias/constants/admin-capabilities'

export const adminRoleKeySchema = z.enum(ADMIN_ROLE_KEYS)
const expectedVersionSchema = z.number().int().positive()
const changeReasonSchema = z.string().trim().min(3).max(500)
const revisionIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'revision_id must be a valid ObjectId')

export const adminCapabilityMapSchema = z.record(z.string(), z.boolean())
  .superRefine((value, ctx) => {
    for (const key of Object.keys(value)) {
      if (!ADMIN_CAPABILITIES.includes(key as any)) {
        ctx.addIssue({ code: 'custom', path: [key], message: `Unsupported administrative capability: ${key}` })
      }
    }
  })

function validateCompleteMapForRole(
  roleKey: AdminRoleKey,
  capabilities: Record<string, boolean>,
  ctx: z.RefinementCtx,
): void {
  try {
    normalizeAdminCapabilityMap(roleKey, capabilities)
  } catch (error) {
    ctx.addIssue({
      code: 'custom',
      path: ['body', 'capabilities'],
      message: error instanceof Error ? error.message : 'Invalid capability map',
    })
  }
}

export const adminRolePolicyParamsSchema = z.object({
  params: z.object({ roleKey: adminRoleKeySchema }).strict(),
})

export const previewAdminRolePolicySchema = z.object({
  params: z.object({ roleKey: adminRoleKeySchema }).strict(),
  body: z.object({
    capabilities: adminCapabilityMapSchema,
    expected_version: expectedVersionSchema.optional(),
  }).strict(),
}).superRefine((value, ctx) => validateCompleteMapForRole(value.params.roleKey, value.body.capabilities, ctx))

export const updateAdminRolePolicySchema = z.object({
  params: z.object({ roleKey: adminRoleKeySchema }).strict(),
  body: z.object({
    capabilities: adminCapabilityMapSchema,
    expected_version: expectedVersionSchema,
    change_reason: changeReasonSchema,
  }).strict(),
}).superRefine((value, ctx) => validateCompleteMapForRole(value.params.roleKey, value.body.capabilities, ctx))

export const adminRolePolicyHistorySchema = z.object({
  params: z.object({ roleKey: adminRoleKeySchema }).strict(),
  query: z.object({
    limit: z.coerce.number().int().positive().max(100).optional(),
    before_version: z.coerce.number().int().min(2).optional(),
  }).strict(),
})

export const previewAdminRolePolicyRestoreSchema = z.object({
  params: z.object({ roleKey: adminRoleKeySchema }).strict(),
  body: z.object({
    revision_id: revisionIdSchema,
    expected_version: expectedVersionSchema,
  }).strict(),
})

export const restoreAdminRolePolicySchema = z.object({
  params: z.object({ roleKey: adminRoleKeySchema }).strict(),
  body: z.object({
    revision_id: revisionIdSchema,
    expected_version: expectedVersionSchema,
    change_reason: changeReasonSchema,
  }).strict(),
})

export type UpdateAdminRolePolicyInput = z.infer<typeof updateAdminRolePolicySchema>
export type PreviewAdminRolePolicyInput = z.infer<typeof previewAdminRolePolicySchema>
export type RestoreAdminRolePolicyInput = z.infer<typeof restoreAdminRolePolicySchema>
