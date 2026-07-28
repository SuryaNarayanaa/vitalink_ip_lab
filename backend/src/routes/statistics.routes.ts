import { Router } from 'express'
import { authenticate, authorize, validate } from '@alias/middlewares'
import { UserType } from '@alias/validators'
import { registerAdminRoute } from '@alias/authorization/admin-route-policy'
import {
  getAdminStats, getTrends, getCompliance, getWorkload, getPeriodStats,
} from '@alias/controllers/statistics.controller'
import { z } from 'zod'

const router = Router()
const validDateString = z.string('Date should be a string').refine(
  (value) => !Number.isNaN(Date.parse(value)),
  'Date should be a valid date string'
)

const trendsQuerySchema = z.object({
  query: z.object({
    period: z.enum(['7d', '30d', '90d', '1y']).optional(),
  }).strict()
})

const periodStatsQuerySchema = z.object({
  query: z.object({
    start_date: validDateString.optional(),
    end_date: validDateString.optional(),
  }).strict().refine(
    ({ start_date, end_date }) => {
      if (!start_date || !end_date) return true
      return new Date(end_date).getTime() >= new Date(start_date).getTime()
    },
    { message: 'end_date must be greater than or equal to start_date' }
  )
})

// All statistics routes require authentication + ADMIN role before their typed
// capability and scope policy resolves the request-scoped access snapshot.
router.use(authenticate)
router.use(authorize([UserType.ADMIN]))

registerAdminRoute(router, {
  method: 'get', path: '/admin', anyOfCapabilities: ['platform.analytics.read', 'tenant.dashboard.read'], scope: 'either', mutation: false, surface: 'statistics',
}, getAdminStats)
registerAdminRoute(router, {
  method: 'get', path: '/trends', anyOfCapabilities: ['platform.analytics.read', 'tenant.analytics.read'], scope: 'either', mutation: false, surface: 'statistics',
}, validate(trendsQuerySchema), getTrends)
registerAdminRoute(router, {
  method: 'get', path: '/compliance', capability: 'tenant.analytics.read', scope: 'tenant', mutation: false, surface: 'statistics',
}, getCompliance)
registerAdminRoute(router, {
  method: 'get', path: '/workload', anyOfCapabilities: ['platform.analytics.read', 'tenant.analytics.read'], scope: 'either', mutation: false, surface: 'statistics',
}, getWorkload)
registerAdminRoute(router, {
  method: 'get', path: '/period', anyOfCapabilities: ['platform.analytics.read', 'tenant.analytics.read'], scope: 'either', mutation: false, surface: 'statistics',
}, validate(periodStatsQuerySchema), getPeriodStats)

export default router
