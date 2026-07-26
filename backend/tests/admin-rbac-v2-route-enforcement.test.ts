import axios, { type AxiosInstance } from 'axios'
import express from 'express'
import fs from 'fs'
import path from 'path'
import type { Server } from 'http'
import ts from 'typescript'

jest.mock('@alias/middlewares/adminAccess.middleware', () => ({
  resolveAdminAccess: (req: any, res: any, next: any) => {
    const { DEFAULT_ADMIN_ROLE_POLICIES } = jest.requireActual('@alias/constants/admin-capabilities')
    const role = String(req.headers['x-test-admin-role'] || '')
    const contexts: Record<string, any> = {
      app_admin: {
        userId: 'app-user', role: 'app_admin', scope: 'global', policyVersion: 2, readOnly: false,
        permissions: { ...DEFAULT_ADMIN_ROLE_POLICIES.app_admin },
      },
      hospital_admin: {
        userId: 'hospital-user', role: 'hospital_admin', scope: 'tenant',
        hospitalId: 'hospital-1', hospitalCode: 'H001', policyVersion: 3, readOnly: false,
        permissions: { ...DEFAULT_ADMIN_ROLE_POLICIES.hospital_admin },
      },
      auditor: {
        userId: 'auditor-user', role: 'auditor', scope: 'global', policyVersion: 4, readOnly: false,
        // Deliberately merge an impossible mutation grant: the hard Auditor
        // boundary must deny writes independently of persisted policy contents.
        permissions: {
          ...DEFAULT_ADMIN_ROLE_POLICIES.auditor,
          'platform.hospitals.manage': true,
          'platform.role_policy.manage': true,
        },
      },
    }
    const context = contexts[role]
    if (!context) {
      res.status(403).json({ success: false, message: 'Unknown test administrator role' })
      return
    }
    const disabledCapability = String(req.headers['x-test-disabled-capability'] || '')
    if (disabledCapability) context.permissions[disabledCapability] = false
    const requestedVersion = Number(req.headers['x-test-policy-version'])
    if (Number.isSafeInteger(requestedVersion) && requestedVersion > 0) context.policyVersion = requestedVersion
    req.adminAccess = context
    next()
  },
}))

import errorHandler from '@alias/middlewares/errorHandler'
import { validate } from '@alias/middlewares/ValidateResource'
import { createPatientSchema, updatePatientSchema } from '@alias/validators/admin.validator'
import {
  clearRegisteredAdminRoutePoliciesForTests,
  getRegisteredAdminRoutePolicies,
  registerAdminRoute,
  type AdminRoutePolicy,
} from '@alias/authorization/admin-route-policy'
import {
  DEFAULT_ADMIN_ROLE_POLICIES,
  type AdminCapability,
  type AdminRoleKey,
} from '@alias/constants/admin-capabilities'

const BACKEND_ROOT = path.resolve(__dirname, '..')
const PROTECTED_ROUTE_FILES = [
  path.join(BACKEND_ROOT, 'src/routes/admin.routes.ts'),
  path.join(BACKEND_ROOT, 'src/routes/statistics.routes.ts'),
]
const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete'])

function inventoryProtectedRouteSource(file: string) {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const routerBindings = new Set<string>()
  const directRegistrations: string[] = []
  let typedRegistrations = 0

  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
      && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression)
      && node.initializer.expression.text === 'Router'
    ) {
      routerBindings.add(node.name.text)
    }
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === 'registerAdminRoute') {
        typedRegistrations += 1
      }
      if (
        ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && routerBindings.has(node.expression.expression.text)
        && ROUTE_METHODS.has(node.expression.name.text)
      ) {
        const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1
        directRegistrations.push(`${path.basename(file)}:${line} router.${node.expression.name.text}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return { directRegistrations, typedRegistrations }
}

describe('RBAC V2 typed route enforcement', () => {
  let server: Server
  let api: AxiosInstance
  let patientWriteAttempts = 0

  beforeAll(async () => {
    clearRegisteredAdminRoutePoliciesForTests()
    const app = express()
    app.use(express.json())
    const router = express.Router()

    registerAdminRoute(router, {
      method: 'get', path: '/platform-read', capability: 'platform.hospitals.read',
      scope: 'global', mutation: false, surface: 'admin',
    }, (req, res) => res.status(200).json({ role: req.adminAccess?.role }))
    registerAdminRoute(router, {
      method: 'get', path: '/tenant-read', capability: 'tenant.doctors.read',
      scope: 'tenant', mutation: false, surface: 'admin',
    }, (req, res) => res.status(200).json({ role: req.adminAccess?.role }))
    registerAdminRoute(router, {
      method: 'post', path: '/platform-write', capability: 'platform.hospitals.manage',
      scope: 'global', mutation: true, surface: 'admin',
    }, (req, res) => res.status(200).json({ role: req.adminAccess?.role }))
    registerAdminRoute(router, {
      method: 'post', path: '/patients', capability: 'tenant.patients.manage',
      scope: 'tenant', mutation: true, surface: 'admin',
    }, validate(createPatientSchema), (_req, res) => {
      patientWriteAttempts += 1
      res.status(201).json({ success: true })
    })
    registerAdminRoute(router, {
      method: 'put', path: '/patients/:id', capability: 'tenant.patients.manage',
      scope: 'tenant', mutation: true, surface: 'admin',
    }, validate(updatePatientSchema), (_req, res) => {
      patientWriteAttempts += 1
      res.status(200).json({ success: true })
    })

    app.use('/probe', router)
    app.use(errorHandler)
    server = app.listen(0)
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve)
      server.once('error', reject)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP port')
    api = axios.create({ baseURL: `http://127.0.0.1:${address.port}`, validateStatus: () => true })
  })

  afterAll(async () => {
    clearRegisteredAdminRoutePoliciesForTests()
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  })

  test('enforces representative Application Admin, Hospital Admin, and Auditor allow-deny decisions', async () => {
    const request = (method: 'get' | 'post', route: string, role: string) => api.request({
      method,
      url: `/probe${route}`,
      headers: { 'x-test-admin-role': role },
    })

    await expect(request('get', '/platform-read', 'app_admin')).resolves.toMatchObject({ status: 200 })
    await expect(request('get', '/tenant-read', 'app_admin')).resolves.toMatchObject({ status: 403 })

    await expect(request('get', '/tenant-read', 'hospital_admin')).resolves.toMatchObject({ status: 200 })
    await expect(request('get', '/platform-read', 'hospital_admin')).resolves.toMatchObject({ status: 403 })

    await expect(request('get', '/platform-read', 'auditor')).resolves.toMatchObject({ status: 200 })
    await expect(request('get', '/tenant-read', 'auditor')).resolves.toMatchObject({ status: 403 })
  })

  test('hard-denies Auditor mutation even when a malformed snapshot grants the capability', async () => {
    const denied = await api.post('/probe/platform-write', {}, {
      headers: { 'x-test-admin-role': 'auditor' },
    })
    expect(denied.status).toBe(403)
    expect(denied.data).toMatchObject({ success: false })
    expect(String(denied.data.message)).toMatch(/read-only/i)

    const allowed = await api.post('/probe/platform-write', {}, {
      headers: { 'x-test-admin-role': 'app_admin' },
    })
    expect(allowed.status).toBe(200)
  })

  test('returns strict 400 responses for administrative Patient credentials and clinical fields before writes', async () => {
    patientWriteAttempts = 0
    const headers = { 'x-test-admin-role': 'hospital_admin' }
    const basePatient = {
      login_id: 'PAT-STRICT-ROUTE',
      assigned_doctor_id: 'DOC-1',
      demographics: { name: 'Strict Route Patient', phone: '+919000000001' },
    }

    const passwordCreate = await api.post('/probe/patients', {
      ...basePatient,
      password: 'CallerSupplied1!',
    }, { headers })
    const clinicalCreate = await api.post('/probe/patients', {
      ...basePatient,
      medical_config: { therapy_start_date: '2026-07-26' },
    }, { headers })
    const mixedUpdate = await api.put('/probe/patients/PAT-STRICT-ROUTE', {
      demographics: { name: 'Must Not Persist' },
      password: 'CallerSupplied2!',
      medical_config: { diagnosis: 'Must Not Persist' },
    }, { headers })

    expect(passwordCreate.status).toBe(400)
    expect(clinicalCreate.status).toBe(400)
    expect(mixedUpdate.status).toBe(400)
    expect(patientWriteAttempts).toBe(0)
  })

  test('covers every protected route through the typed registry with no direct registration', () => {
    const inventories = PROTECTED_ROUTE_FILES.map(inventoryProtectedRouteSource)
    expect(inventories.flatMap(inventory => inventory.directRegistrations)).toEqual([])

    clearRegisteredAdminRoutePoliciesForTests()
    for (const file of PROTECTED_ROUTE_FILES) require(file)

    const policies = getRegisteredAdminRoutePolicies()
    const typedCount = inventories.reduce((total, inventory) => total + inventory.typedRegistrations, 0)
    expect(typedCount).toBeGreaterThan(0)
    expect(policies).toHaveLength(typedCount)

    const keys = policies.map(policy => `${policy.surface}:${policy.method.toUpperCase()} ${policy.path}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const policy of policies) {
      const hasSingle = Object.prototype.hasOwnProperty.call(policy, 'capability')
      const hasAny = Array.isArray(policy.anyOfCapabilities) && policy.anyOfCapabilities.length > 0
      expect(hasSingle || hasAny).toBe(true)
      expect(['global', 'tenant', 'either', 'self']).toContain(policy.scope)
      expect(typeof policy.mutation).toBe('boolean')
      if (policy.capability === null) expect(policy.scope).toBe('self')
    }
  })

  test('enforces a newly persisted policy snapshot on the next request', async () => {
    const first = await api.get('/probe/platform-read', {
      headers: { 'x-test-admin-role': 'app_admin', 'x-test-policy-version': '11' },
    })
    expect(first.status).toBe(200)

    const next = await api.get('/probe/platform-read', {
      headers: {
        'x-test-admin-role': 'app_admin',
        'x-test-policy-version': '12',
        'x-test-disabled-capability': 'platform.hospitals.read',
      },
    })
    expect(next.status).toBe(403)
    expect(next.data).toMatchObject({
      required_capability: 'platform.hospitals.read',
      policy_version: 12,
    })
  })

  test('applies fixed-role allow/deny rules to every typed route class', async () => {
    const policies = [...getRegisteredAdminRoutePolicies()]
    expect(policies.length).toBeGreaterThan(40)

    const matrixApp = express()
    const matrixRouter = express.Router()
    clearRegisteredAdminRoutePoliciesForTests()
    for (const policy of policies) {
      registerAdminRoute(matrixRouter, policy as AdminRoutePolicy, (req, res) => {
        res.status(204).send()
      })
    }
    matrixApp.use('/matrix', matrixRouter)
    const matrixServer = matrixApp.listen(0)
    await new Promise<void>((resolve, reject) => {
      matrixServer.once('listening', resolve)
      matrixServer.once('error', reject)
    })
    const address = matrixServer.address()
    if (!address || typeof address === 'string') throw new Error('Matrix server did not expose a TCP port')
    const matrixApi = axios.create({
      baseURL: `http://127.0.0.1:${address.port}`,
      validateStatus: () => true,
    })

    const roleScope: Record<AdminRoleKey, 'global' | 'tenant'> = {
      app_admin: 'global',
      hospital_admin: 'tenant',
      auditor: 'global',
    }
    const declaredCapabilities = (policy: Readonly<AdminRoutePolicy>): AdminCapability[] => (
      typeof policy.capability === 'string'
        ? [policy.capability]
        : [...(policy.anyOfCapabilities ?? [])]
    )
    const expectedAllowed = (policy: Readonly<AdminRoutePolicy>, role: AdminRoleKey) => {
      if (policy.scope === 'self') return true
      if (policy.mutation && role === 'auditor') return false
      if (policy.scope !== 'either' && policy.scope !== roleScope[role]) return false
      return declaredCapabilities(policy).some(capability => DEFAULT_ADMIN_ROLE_POLICIES[role][capability] === true)
    }
    const concretePath = (route: string) => route.replace(/:([A-Za-z0-9_]+)/g, 'probe-id')

    try {
      for (const policy of policies) {
        for (const role of ['app_admin', 'hospital_admin', 'auditor'] as const) {
          const response = await matrixApi.request({
            method: policy.method,
            url: `/matrix${concretePath(policy.path)}`,
            headers: { 'x-test-admin-role': role },
          })
          const expected = expectedAllowed(policy, role) ? 204 : 403
          expect({
            key: `${policy.surface}:${policy.method.toUpperCase()} ${policy.path}`,
            role,
            status: response.status,
          }).toEqual({
            key: `${policy.surface}:${policy.method.toUpperCase()} ${policy.path}`,
            role,
            status: expected,
          })
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) => matrixServer.close(error => error ? reject(error) : resolve()))
    }
  })
})
