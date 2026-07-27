import type { RequestHandler, Router } from 'express'
import type { AdminCapability } from '@alias/constants/admin-capabilities'
import { isMutationAdminCapability } from '@alias/constants/admin-capabilities'
import { resolveAdminAccess } from '@alias/middlewares/adminAccess.middleware'
import {
  requireAdminCapability,
  requireAdminMutation,
  requireAnyAdminCapability,
  requireGlobalAdminScope,
  requireTenantAdminScope,
} from '@alias/middlewares/adminPermission.middleware'

export type AdminRouteMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'
export type AdminRouteScope = 'global' | 'tenant' | 'either' | 'self'

export type AdminRoutePolicy = {
  method: AdminRouteMethod
  path: string
  /** null is allowed only for authenticated administrator self-service routes. */
  capability?: AdminCapability | null
  anyOfCapabilities?: readonly AdminCapability[]
  scope: AdminRouteScope
  mutation: boolean
  surface: 'admin' | 'statistics'
}

const routePolicies: AdminRoutePolicy[] = []

function validateRoutePolicy(policy: AdminRoutePolicy): void {
  if (!policy.path.startsWith('/')) throw new Error('Admin route policy path must begin with /')
  const hasSingle = typeof policy.capability === 'string'
  const hasAny = Boolean(policy.anyOfCapabilities?.length)
  const isSelfService = policy.scope === 'self' && policy.capability === null && !hasAny
  if (!isSelfService && hasSingle === hasAny) {
    throw new Error('Admin route policy must declare exactly one capability or anyOfCapabilities list')
  }
  if (policy.scope === 'self' && !isSelfService) {
    throw new Error('Administrator self-service routes must explicitly declare capability: null')
  }
  if (isSelfService && policy.mutation) {
    throw new Error('Capability-free administrator self-service metadata cannot declare an RBAC mutation')
  }
  if (policy.anyOfCapabilities && new Set(policy.anyOfCapabilities).size !== policy.anyOfCapabilities.length) {
    throw new Error('Admin route policy anyOfCapabilities must not contain duplicates')
  }
  const declared = hasSingle
    ? [policy.capability as AdminCapability]
    : [...(policy.anyOfCapabilities || [])]
  if (!policy.mutation) {
    if (declared.some(isMutationAdminCapability)) {
      throw new Error('Read route policy cannot require a mutation capability')
    }
  } else if (declared.length && !declared.some(isMutationAdminCapability)) {
    // Mutation routes must require at least one mutation-classified capability so
    // a pure-read capability cannot authorize write handlers.
    throw new Error('Mutation route policy must require at least one mutation capability')
  }
}

export function defineAdminRoutePolicy(policy: AdminRoutePolicy): Readonly<AdminRoutePolicy> {
  validateRoutePolicy(policy)
  return Object.freeze({
    ...policy,
    anyOfCapabilities: policy.anyOfCapabilities
      ? Object.freeze([...policy.anyOfCapabilities])
      : undefined,
  })
}

export function getRegisteredAdminRoutePolicies(): readonly Readonly<AdminRoutePolicy>[] {
  return routePolicies.map(policy => Object.freeze({ ...policy }))
}

export function clearRegisteredAdminRoutePoliciesForTests(): void {
  routePolicies.length = 0
}

/**
 * Register a protected route and its authorization metadata together. Route
 * modules should use this helper instead of direct router method calls once
 * converted to V2 enforcement.
 */
export function registerAdminRoute(
  router: Router,
  rawPolicy: AdminRoutePolicy,
  ...handlers: RequestHandler[]
): Router {
  const policy = defineAdminRoutePolicy(rawPolicy)
  const duplicate = routePolicies.some(existing => (
    existing.surface === policy.surface
    && existing.method === policy.method
    && existing.path === policy.path
  ))
  if (duplicate) throw new Error(`Duplicate admin route policy: ${policy.method.toUpperCase()} ${policy.path}`)
  if (!handlers.length) throw new Error('Protected admin route must include at least one handler')

  const guards: RequestHandler[] = [resolveAdminAccess]
  if (typeof policy.capability === 'string') guards.push(requireAdminCapability(policy.capability))
  else if (policy.anyOfCapabilities?.length) guards.push(requireAnyAdminCapability(policy.anyOfCapabilities))
  if (policy.scope === 'global') guards.push(requireGlobalAdminScope())
  if (policy.scope === 'tenant') guards.push(requireTenantAdminScope())
  if (policy.mutation) guards.push(requireAdminMutation())

  routePolicies.push({ ...policy })
  ;(router[policy.method] as (...args: any[]) => Router)(policy.path, ...guards, ...handlers)
  return router
}

export const registerProtectedAdminRoute = registerAdminRoute
