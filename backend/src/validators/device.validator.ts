import { z } from 'zod'

export const registerDeviceSchema = z.object({
  body: z.object({
    fcm_token: z.string().trim().min(20, 'fcm_token is invalid').max(4096, 'fcm_token is too long'),
    platform: z.enum(['android', 'ios', 'web']),
    app_version: z.string().trim().min(1).max(100).optional(),
  }).strict(),
})

export const deregisterDeviceSchema = z.object({
  params: z.object({
    tokenId: z.string().regex(/^[a-f\d]{24}$/i, 'tokenId must be a valid ObjectId'),
  }).strict(),
})
