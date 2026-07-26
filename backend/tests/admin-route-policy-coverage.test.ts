import fs from 'fs'
import path from 'path'
import ts from 'typescript'
import YAML from 'yaml'

const BACKEND_ROOT = path.resolve(__dirname, '..')
const PROTECTED_ROUTE_FILES = [
  { surface: 'admin', file: path.join(BACKEND_ROOT, 'src/routes/admin.routes.ts') },
  { surface: 'statistics', file: path.join(BACKEND_ROOT, 'src/routes/statistics.routes.ts') },
] as const
const REGISTRY_MODULE = path.join(BACKEND_ROOT, 'src/authorization/admin-route-policy')
const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete'])

type RouteRegistration = {
  surface: string
  method: string
  path: string
  line: number
}

type SourceInventory = {
  direct: RouteRegistration[]
  typedHelperCalls: number
  typedHelperImports: string[]
}

function sourceFile(file: string, source = fs.readFileSync(file, 'utf8')) {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function routePath(argument: ts.Expression | undefined) {
  if (!argument) return '<missing-path>'
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) return argument.text
  return `<dynamic:${argument.getText()}>`
}

function inventorySource(surface: string, file: string, source?: string): SourceInventory {
  const ast = sourceFile(file, source)
  const typedHelperBindings = new Set<string>()
  const routerFactoryBindings = new Set<string>(['Router'])
  const routerBindings = new Set<string>()
  const direct: RouteRegistration[] = []
  let typedHelperCalls = 0

  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const clause = statement.importClause
    if (statement.moduleSpecifier.text === 'express' && clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if ((element.propertyName ?? element.name).text === 'Router') routerFactoryBindings.add(element.name.text)
      }
    }
    if (!statement.moduleSpecifier.text.includes('admin-route-policy')) continue
    if (clause?.name) typedHelperBindings.add(clause.name.text)
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) typedHelperBindings.add(element.name.text)
    }
  }

  function discoverRouters(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      routerFactoryBindings.has(node.initializer.expression.text)
    ) {
      routerBindings.add(node.name.text)
    }
    ts.forEachChild(node, discoverRouters)
  }
  discoverRouters(ast)

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && typedHelperBindings.has(node.expression.text)) {
        typedHelperCalls += 1
      }
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        routerBindings.has(node.expression.expression.text) &&
        ROUTE_METHODS.has(node.expression.name.text)
      ) {
        const location = ast.getLineAndCharacterOfPosition(node.getStart(ast))
        direct.push({
          surface,
          method: node.expression.name.text.toUpperCase(),
          path: routePath(node.arguments[0]),
          line: location.line + 1,
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)

  return {
    direct,
    typedHelperCalls,
    typedHelperImports: [...typedHelperBindings].sort(),
  }
}

function registryModuleExists() {
  return ['.ts', '.js', ''].some(extension => fs.existsSync(`${REGISTRY_MODULE}${extension}`))
}

function loadRegistryEntries(registerRouteModules = false): unknown[] {
  const loaded = require(REGISTRY_MODULE)
  if (registerRouteModules) {
    if (typeof loaded.clearRegisteredAdminRoutePoliciesForTests === 'function') {
      loaded.clearRegisteredAdminRoutePoliciesForTests()
    }
    for (const { file } of PROTECTED_ROUTE_FILES) require(file)
  }
  const candidate = loaded.ADMIN_ROUTE_POLICIES
    ?? loaded.adminRoutePolicies
    ?? loaded.ADMIN_ROUTE_POLICY_REGISTRY
    ?? (typeof loaded.getAdminRoutePolicies === 'function' ? loaded.getAdminRoutePolicies() : undefined)
    ?? (typeof loaded.getRegisteredAdminRoutePolicies === 'function'
      ? loaded.getRegisteredAdminRoutePolicies()
      : undefined)
  expect(candidate).toBeDefined()
  expect(Array.isArray(candidate)).toBe(true)
  return candidate
}

function normalizeRegistryEntry(entry: any) {
  const policy = entry?.policy ?? entry?.authorization ?? {}
  const capabilityDeclared = (
    Object.prototype.hasOwnProperty.call(entry ?? {}, 'capability') ||
    Object.prototype.hasOwnProperty.call(entry ?? {}, 'capabilities') ||
    Object.prototype.hasOwnProperty.call(entry ?? {}, 'anyOfCapabilities') ||
    Object.prototype.hasOwnProperty.call(policy, 'capability') ||
    Object.prototype.hasOwnProperty.call(policy, 'capabilities') ||
    Object.prototype.hasOwnProperty.call(policy, 'anyOfCapabilities')
  )
  const capabilities = entry?.capabilities ?? entry?.anyOfCapabilities
    ?? policy?.capabilities ?? policy?.anyOfCapabilities
  const capability = Object.prototype.hasOwnProperty.call(entry ?? {}, 'capability')
    ? entry.capability
    : policy?.capability
  const scope = entry?.scope ?? policy?.scope
  const mutation = entry?.mutation ?? policy?.mutation
    ?? (entry?.classification ? entry.classification === 'mutation' : undefined)
  return {
    method: String(entry?.method ?? '').toUpperCase(),
    path: entry?.path ?? entry?.route,
    capabilityDeclared,
    capability,
    capabilities,
    scope,
    mutation,
  }
}

const FOUNDATION_DIRECT_ROUTE_BASELINE = [
  'admin GET /roles',
  'admin PUT /roles/:roleKey',
  'admin GET /hospitals',
  'admin POST /hospitals',
  'admin GET /hospitals/:id',
  'admin PUT /hospitals/:id',
  'admin PATCH /hospitals/:id/status',
  'admin DELETE /hospitals/:id',
  'admin GET /billing/invoices',
  'admin POST /billing/invoices',
  'admin POST /billing/checkout/:invoiceId',
  'admin GET /users',
  'admin POST /users',
  'admin POST /users/:id/mfa/reset',
  'admin PUT /users/:id',
  'admin POST /doctors',
  'admin GET /doctors',
  'admin PUT /doctors/:id',
  'admin DELETE /doctors/:id',
  'admin POST /patients',
  'admin GET /patients',
  'admin PUT /patients/:id',
  'admin DELETE /patients/:id',
  'admin PUT /reassign/:op_num',
  'admin GET /audit-logs',
  'admin GET /config',
  'admin PUT /config',
  'admin POST /notifications/broadcast',
  'admin POST /users/batch',
  'admin POST /users/reset-password',
  'admin GET /system/health',
  'admin GET /system/reminder-delivery-health',
  'admin GET /legacy/patients',
  'admin GET /legacy/patient/:op_num',
  'admin GET /legacy/doctor/:id',
  'statistics GET /admin',
  'statistics GET /trends',
  'statistics GET /compliance',
  'statistics GET /workload',
  'statistics GET /period',
]

function inventoryProtectedRoutes() {
  return PROTECTED_ROUTE_FILES.map(({ surface, file }) => inventorySource(surface, file))
}

describe('admin/statistics route policy inventory', () => {
  test('keeps the additive-wave route inventory explicit until typed registration is integrated', () => {
    const inventories = inventoryProtectedRoutes()
    const helperIntegrated = inventories.some(inventory => inventory.typedHelperImports.length > 0)

    if (!helperIntegrated) {
      // Transitional gate, not a waiver: this exact list is the direct-call debt
      // inherited by Wave 1. Any newly added direct route fails immediately.
      const actual = inventories.flatMap(inventory => inventory.direct)
        .map(route => `${route.surface} ${route.method} ${route.path}`)
      expect(actual).toEqual(FOUNDATION_DIRECT_ROUTE_BASELINE)
      return
    }

    // Final integration assumptions:
    // 1. Both protected modules import their typed helper from
    //    authorization/admin-route-policy.
    // 2. No router.get/post/put/patch/delete call remains.
    // 3. Every helper registration produces one registry entry.
    expect(inventories.every(inventory => inventory.typedHelperImports.length > 0)).toBe(true)
    expect(inventories.flatMap(inventory => inventory.direct)).toEqual([])
    const helperCallCount = inventories.reduce((sum, inventory) => sum + inventory.typedHelperCalls, 0)
    const registryEntries = loadRegistryEntries(true)
    expect(helperCallCount).toBeGreaterThan(0)
    expect(registryEntries.length).toBe(helperCallCount)
  })

  test('the AST guard distinguishes typed helper calls from forbidden direct calls', () => {
    const sample = `
      import { registerAdminRoute as protectedRoute } from '@alias/authorization/admin-route-policy'
      const router = Router()
      protectedRoute(router, { method: 'GET', path: '/safe', capability: 'platform.audit.read' }, handler)
      router.get('/unsafe', handler)
      router.use(authentication)
    `
    const inventory = inventorySource('sample', 'sample.routes.ts', sample)
    expect(inventory.typedHelperImports).toEqual(['protectedRoute'])
    expect(inventory.typedHelperCalls).toBe(1)
    expect(inventory.direct.map(route => `${route.method} ${route.path}`)).toEqual(['GET /unsafe'])
  })

  test('consumes the import-safe typed registry when the foundation module is present', () => {
    if (!registryModuleExists()) {
      // Exact additive-wave dependency. The authorization-foundation owner will
      // add this module; route conversion is not part of this validation wave.
      expect(path.relative(BACKEND_ROOT, `${REGISTRY_MODULE}.ts`).replace(/\\/g, '/'))
        .toBe('src/authorization/admin-route-policy.ts')
      return
    }

    const normalized = loadRegistryEntries().map(normalizeRegistryEntry)
    const keys = normalized.map(entry => `${entry.method} ${entry.path}`)
    expect(new Set(keys).size).toBe(keys.length)

    for (const entry of normalized) {
      expect(entry.method).toMatch(/^(GET|POST|PUT|PATCH|DELETE)$/)
      expect(typeof entry.path).toBe('string')
      expect(entry.path).toMatch(/^\//)
      expect(entry.capabilityDeclared).toBe(true)
      expect(['global', 'tenant', 'either', 'self']).toContain(entry.scope)
      expect(typeof entry.mutation).toBe('boolean')

      const declared = entry.capabilities ?? entry.capability
      if (declared !== null) {
        const capabilities = Array.isArray(declared) ? declared : [declared]
        expect(capabilities.length).toBeGreaterThan(0)
        for (const capability of capabilities) {
          expect(capability).toMatch(/^(platform|tenant)\./)
        }
      } else {
        // capability: null is reserved for an explicitly declared authenticated
        // admin self-service route such as /access/me, never an omitted policy.
        expect(entry.scope).toBe('self')
      }
    }
  })

  test('documents every typed admin/statistics route method in OpenAPI', () => {
    const document = YAML.parse(fs.readFileSync(path.join(BACKEND_ROOT, 'docs/api/openapi.yaml'), 'utf8')) as any
    const entries = loadRegistryEntries().map((entry: any) => {
      const normalized = normalizeRegistryEntry(entry)
      const surface = entry?.surface ?? entry?.policy?.surface
      const prefix = surface === 'statistics' ? '/statistics' : '/admin'
      const documentedPath = `${prefix}${normalized.path}`.replace(/:([A-Za-z0-9_]+)/g, '{$1}')
      return { ...normalized, documentedPath }
    })

    const missing = entries
      .filter(entry => !document.paths?.[entry.documentedPath]?.[entry.method.toLowerCase()])
      .map(entry => `${entry.method} ${entry.documentedPath}`)
    expect(missing).toEqual([])

    const requiredV2Operations = [
      ['PATCH', '/admin/doctors/{id}/status', 'tenant.accounts.status.manage'],
      ['POST', '/admin/doctors/{id}/credentials/reset', 'tenant.credentials.reset'],
      ['PATCH', '/admin/patients/{id}/status', 'tenant.accounts.status.manage'],
      ['POST', '/admin/patients/{id}/credentials/reset', 'tenant.credentials.reset'],
      ['PUT', '/admin/patients/{id}/assignment', 'tenant.patients.assign'],
    ] as const
    for (const [method, route, capability] of requiredV2Operations) {
      const operation = document.paths?.[route]?.[method.toLowerCase()]
      expect(operation).toBeDefined()
      expect(operation['x-required-capability']).toBe(capability)
      expect(operation['x-admin-scope']).toBe('tenant')
      expect(operation['x-admin-roles']).toEqual(['hospital_admin'])
    }

    const assignmentSchema = document.paths['/admin/patients/{id}/assignment'].put
      .requestBody.content['application/json'].schema.$ref
    expect(assignmentSchema).toBe('#/components/schemas/AdminPatientAssignmentRequest')
    expect(document.components.schemas.AdminPatientAssignmentRequest.required).toEqual(['doctor_id'])
  })
})
