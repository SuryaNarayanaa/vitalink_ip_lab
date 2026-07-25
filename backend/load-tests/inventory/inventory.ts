import { createHash } from 'crypto'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { dirname, join, relative, resolve } from 'path'
import ts from 'typescript'
import { extractOpenApiOperations } from './openapi-parser'
import {
  extractDirectApplicationRoutes,
  extractApplicationRouterMounts,
  joinRoutePaths,
  normalizePath,
} from './source-route-parser'
import {
  ConditionalEndpoint,
  DerivedProtocolCheck,
  ExplicitEndpoint,
  ExplicitScope,
  HttpMethod,
  InventoryManifest,
  SourceRoute,
} from './types'

const SCOPE_ORDER: Record<ExplicitScope, number> = { canonical: 0, legacy: 1, global: 2, edge: 3 }

export interface InventoryPaths {
  repositoryRoot: string
  backendRoot: string
  appFile: string
  rootRouterFile: string
  configFile: string
  docsRouterFile: string
  openApiFile: string
  nginxFile: string
  generatedFile: string
}

function findRepositoryRoot(start: string): string {
  let cursor = resolve(start)
  while (true) {
    if (existsSync(join(cursor, 'backend', 'src', 'app.ts'))) return cursor
    if (existsSync(join(cursor, 'src', 'app.ts')) && cursor.endsWith(`${join('', 'backend')}`)) {
      return dirname(cursor)
    }
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  throw new Error(`Could not locate repository root from ${start}`)
}

export function resolveInventoryPaths(start = process.cwd()): InventoryPaths {
  const repositoryRoot = findRepositoryRoot(start)
  const backendRoot = join(repositoryRoot, 'backend')
  return {
    repositoryRoot,
    backendRoot,
    appFile: join(backendRoot, 'src', 'app.ts'),
    rootRouterFile: join(backendRoot, 'src', 'routes', 'index.ts'),
    configFile: join(backendRoot, 'src', 'config', 'index.ts'),
    docsRouterFile: join(backendRoot, 'src', 'routes', 'docs.routes.ts'),
    openApiFile: join(backendRoot, 'docs', 'api', 'openapi.yaml'),
    nginxFile: join(repositoryRoot, 'deploy', 'nginx', 'conf.d', 'default.conf'),
    generatedFile: join(backendRoot, 'load-tests', 'generated', 'endpoints.json'),
  }
}

function getLiteralDefault(configFile: string, property: string): string | boolean {
  const sourceText = readFileSync(configFile, 'utf8')
  const sourceFile = ts.createSourceFile(configFile, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let found: string | boolean | undefined

  const visit = (node: ts.Node): void => {
    if (found !== undefined || !ts.isPropertyAssignment(node)) {
      ts.forEachChild(node, visit)
      return
    }
    const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : null
    if (name !== property) {
      ts.forEachChild(node, visit)
      return
    }

    if (ts.isStringLiteralLike(node.initializer)) {
      found = node.initializer.text
      return
    }
    if (node.initializer.kind === ts.SyntaxKind.TrueKeyword) {
      found = true
      return
    }
    if (node.initializer.kind === ts.SyntaxKind.FalseKeyword) {
      found = false
      return
    }
    if (ts.isCallExpression(node.initializer)) {
      for (const argument of node.initializer.arguments) {
        if (!ts.isObjectLiteralExpression(argument)) continue
        for (const option of argument.properties) {
          if (!ts.isPropertyAssignment(option)) continue
          const optionName = ts.isIdentifier(option.name) || ts.isStringLiteral(option.name) ? option.name.text : null
          if (optionName !== 'defaultValue') continue
          if (ts.isStringLiteralLike(option.initializer)) found = option.initializer.text
          if (option.initializer.kind === ts.SyntaxKind.TrueKeyword) found = true
          if (option.initializer.kind === ts.SyntaxKind.FalseKeyword) found = false
        }
      }
    }
  }
  visit(sourceFile)

  if (found === undefined) throw new Error(`Unable to determine default config.${property} from ${configFile}`)
  return found
}

function getDefaults(configFile: string): InventoryManifest['defaults'] {
  const apiVersion = getLiteralDefault(configFile, 'apiVersion')
  const apiDocsPath = getLiteralDefault(configFile, 'apiDocsPath')
  // apiDocsEnabled is computed from NODE_ENV, so the manifest records the safe local default.
  if (typeof apiVersion !== 'string' || typeof apiDocsPath !== 'string') {
    throw new Error('API version and documentation path defaults must be strings')
  }
  return {
    apiVersion,
    apiDocsEnabledByDefault: { nonProduction: true, production: false },
    apiDocsPath: normalizePath(apiDocsPath),
  }
}

function endpointId(method: string, path: string): string {
  return `${method.toUpperCase()} ${normalizePath(path)}`
}

function sortEndpoints<T extends { method: string; path: string }>(endpoints: T[]): T[] {
  return endpoints.sort((left, right) =>
    left.path.localeCompare(right.path) || left.method.localeCompare(right.method))
}

function uniqueSourceRoutes(routes: SourceRoute[]): SourceRoute[] {
  const byKey = new Map<string, SourceRoute>()
  for (const route of routes) {
    const normalized = { ...route, path: normalizePath(route.path) }
    const key = endpointId(normalized.method, normalized.path)
    const existing = byKey.get(key)
    if (existing) {
      throw new Error(`Duplicate runtime route ${key} in ${existing.sourceFile} and ${route.sourceFile}`)
    }
    byKey.set(key, normalized)
  }
  return sortEndpoints([...byKey.values()])
}

function explicitEndpoint(route: SourceRoute, scope: ExplicitScope, canonicalId: string | null): ExplicitEndpoint {
  return {
    id: endpointId(route.method, route.path),
    method: route.method,
    path: normalizePath(route.path),
    scope,
    canonicalId,
    openApiPath: null,
    openApiOperationId: null,
    sourceFile: route.sourceFile,
    sourceLine: route.sourceLine,
  }
}

function assertNginxHealth(nginxFile: string, repositoryRoot: string): SourceRoute {
  const source = readFileSync(nginxFile, 'utf8')
  const match = source.match(/^\s*location\s+(?:=\s+)?(\/nginx-health)\s*\{[\s\S]*?^\s*return\s+200\b/m)
  if (!match) throw new Error(`Active Nginx /nginx-health location returning 200 not found in ${nginxFile}`)
  const line = source.slice(0, match.index).split(/\r?\n/).length
  return {
    method: 'GET',
    path: match[1],
    sourceFile: relative(repositoryRoot, nginxFile).replace(/\\/g, '/'),
    sourceLine: line,
  }
}

function digestSources(paths: InventoryPaths): string {
  const files = [paths.appFile, paths.rootRouterFile, paths.configFile, paths.docsRouterFile, paths.openApiFile, paths.nginxFile]
  const routesDir = join(paths.backendRoot, 'src', 'routes')
  const routeFiles = readdirSync(routesDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(routesDir, name))
  const uniqueFiles = [...new Set([...files, ...routeFiles])].sort()
  const hash = createHash('sha256')
  for (const file of uniqueFiles) {
    hash.update(relative(paths.repositoryRoot, file).replace(/\\/g, '/'))
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

function buildConditionalEndpoints(defaults: InventoryManifest['defaults'], docsSource: string): ConditionalEndpoint[] {
  const condition = 'API_DOCS_ENABLED=true; effective path is API_DOCS_PATH'
  const specPath = joinRoutePaths(defaults.apiDocsPath, '/openapi.yaml')
  return sortEndpoints([
    { id: endpointId('GET', defaults.apiDocsPath), method: 'GET', path: defaults.apiDocsPath, condition, kind: 'documentation', sourceFile: docsSource },
    { id: endpointId('HEAD', defaults.apiDocsPath), method: 'HEAD', path: defaults.apiDocsPath, condition, kind: 'documentation', sourceFile: docsSource },
    { id: endpointId('GET', specPath), method: 'GET', path: specPath, condition, kind: 'documentation-spec', sourceFile: docsSource },
    { id: endpointId('HEAD', specPath), method: 'HEAD', path: specPath, condition, kind: 'documentation-spec', sourceFile: docsSource },
    {
      id: endpointId('GET', joinRoutePaths(defaults.apiDocsPath, '/{swaggerAsset}')),
      method: 'GET',
      path: joinRoutePaths(defaults.apiDocsPath, '/{swaggerAsset}'),
      condition,
      kind: 'documentation-asset',
      sourceFile: docsSource,
    },
  ])
}

function buildDerivedChecks(explicit: ExplicitEndpoint[]): DerivedProtocolCheck[] {
  const application = explicit.filter((endpoint) => endpoint.scope !== 'edge')
  const checks: DerivedProtocolCheck[] = []

  for (const endpoint of application.filter((item) => item.method === 'GET')) {
    checks.push({
      id: `HEAD ${endpoint.path} [derived]`,
      method: 'HEAD',
      path: endpoint.path,
      kind: 'express-head',
      derivedFromEndpointIds: [endpoint.id],
    })
  }

  const endpointsByPath = new Map<string, ExplicitEndpoint[]>()
  for (const endpoint of application) {
    const current = endpointsByPath.get(endpoint.path) ?? []
    current.push(endpoint)
    endpointsByPath.set(endpoint.path, current)
  }
  for (const [path, endpoints] of endpointsByPath) {
    checks.push({
      id: `OPTIONS ${path} [derived]`,
      method: 'OPTIONS',
      path,
      kind: 'cors-preflight',
      derivedFromEndpointIds: endpoints.map((endpoint) => endpoint.id).sort(),
    })
  }

  for (const endpoint of application.filter((item) => item.path.endsWith('/notifications/stream'))) {
    checks.push({
      id: `SSE ${endpoint.path} [protocol]`,
      method: 'GET',
      path: endpoint.path,
      kind: 'sse-stream',
      derivedFromEndpointIds: [endpoint.id],
    })
  }

  checks.push({
    id: 'GET /api/{unmatchedPath} [semantic-fallback]',
    method: 'GET',
    path: '/api/{unmatchedPath}',
    kind: 'api-not-found-fallback',
    derivedFromEndpointIds: [],
  })

  return checks.sort((left, right) => left.path.localeCompare(right.path) || left.id.localeCompare(right.id))
}

function operationKey(method: HttpMethod, path: string): string {
  return endpointId(method, path)
}

export function buildInventory(paths = resolveInventoryPaths()): InventoryManifest {
  const defaults = getDefaults(paths.configFile)
  const values = new Map([['config.apiVersion', defaults.apiVersion]])
  const directRoutes = uniqueSourceRoutes(extractDirectApplicationRoutes(paths.appFile, paths.repositoryRoot, values))
  const applicationMounts = extractApplicationRouterMounts(paths.appFile, paths.repositoryRoot, values)
  const canonicalBase = `/api/${defaults.apiVersion}`

  const canonicalIndex = directRoutes.find((route) => route.method === 'GET' && route.path === canonicalBase)
  const legacyIndex = directRoutes.find((route) => route.method === 'GET' && route.path === '/api')
  if (!canonicalIndex || !legacyIndex) throw new Error('Canonical and legacy API index routes must both exist')

  const canonicalMount = applicationMounts.find((mount) => mount.prefix === canonicalBase && mount.routes.length > 0)
  const legacyMount = applicationMounts.find((mount) => mount.prefix === '/api' && mount.routes.length > 0)
  if (!canonicalMount || !legacyMount) {
    throw new Error(`Expected Express router mounts at ${canonicalBase} and /api`)
  }
  const canonicalRoutes = uniqueSourceRoutes([canonicalIndex, ...canonicalMount.routes])
  const legacyRoutes = uniqueSourceRoutes([legacyIndex, ...legacyMount.routes])
  const globalRoutes = directRoutes.filter((route) => (
    !route.path.startsWith('/api')
    && !route.path.startsWith('/load-test/')
  ))
  const edgeRoute = assertNginxHealth(paths.nginxFile, paths.repositoryRoot)

  const openApi = extractOpenApiOperations(paths.openApiFile)
  const openApiByKey = new Map(openApi.map((operation) => [operationKey(operation.method, operation.path), operation]))

  const canonical = canonicalRoutes.map((route) => {
    const relativePath = route.path === canonicalBase ? '/' : normalizePath(route.path.slice(canonicalBase.length))
    const operation = openApiByKey.get(operationKey(route.method, relativePath))
    return {
      ...explicitEndpoint(route, 'canonical', null),
      canonicalId: endpointId(route.method, route.path),
      openApiPath: relativePath,
      openApiOperationId: operation?.operationId ?? null,
    }
  })
  const legacy = legacyRoutes.map((route) => {
    const relativePath = route.path === '/api' ? '/' : normalizePath(route.path.slice('/api'.length))
    return explicitEndpoint(route, 'legacy', endpointId(route.method, joinRoutePaths(canonicalBase, relativePath)))
  })
  const global = globalRoutes.map((route) => explicitEndpoint(route, 'global', null))
  const edge = [explicitEndpoint(edgeRoute, 'edge', null)]
  const explicitEndpoints = [...canonical, ...legacy, ...global, ...edge].sort((left, right) =>
    SCOPE_ORDER[left.scope] - SCOPE_ORDER[right.scope] ||
    left.path.localeCompare(right.path) ||
    left.method.localeCompare(right.method)
  )
  const conditionalEndpoints = buildConditionalEndpoints(
    defaults,
    relative(paths.repositoryRoot, paths.docsRouterFile).replace(/\\/g, '/'),
  )
  const derivedProtocolChecks = buildDerivedChecks(explicitEndpoints)

  return {
    schemaVersion: 1,
    sourceDigest: digestSources(paths),
    sources: {
      application: relative(paths.repositoryRoot, paths.appFile).replace(/\\/g, '/'),
      routerRoot: relative(paths.repositoryRoot, paths.rootRouterFile).replace(/\\/g, '/'),
      openApi: relative(paths.repositoryRoot, paths.openApiFile).replace(/\\/g, '/'),
      nginx: relative(paths.repositoryRoot, paths.nginxFile).replace(/\\/g, '/'),
    },
    defaults,
    counts: {
      canonical: canonical.length,
      legacy: legacy.length,
      global: global.length,
      edge: edge.length,
      mandatoryExplicit: explicitEndpoints.length,
      openApiOperations: openApi.length,
      conditional: conditionalEndpoints.length,
      derivedProtocolChecks: derivedProtocolChecks.length,
    },
    explicitEndpoints,
    conditionalEndpoints,
    derivedProtocolChecks,
  }
}

export function serializeInventory(manifest: InventoryManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

export function reconcileInventory(manifest: InventoryManifest): string[] {
  const errors: string[] = []
  const canonical = manifest.explicitEndpoints.filter((endpoint) => endpoint.scope === 'canonical')
  const canonicalOpenApiKeys = new Set(canonical.map((endpoint) => operationKey(endpoint.method, endpoint.openApiPath!)))
  const openApi = extractOpenApiOperations(resolveInventoryPaths().openApiFile)
  const openApiKeys = new Set(openApi.map((operation) => operationKey(operation.method, operation.path)))

  for (const key of [...canonicalOpenApiKeys].sort()) {
    if (!openApiKeys.has(key)) errors.push(`Runtime canonical operation missing from OpenAPI: ${key}`)
  }
  for (const key of [...openApiKeys].sort()) {
    if (!canonicalOpenApiKeys.has(key)) errors.push(`OpenAPI operation missing from canonical runtime: ${key}`)
  }

  if (manifest.counts.canonical !== 95) errors.push(`Expected 95 canonical operations; found ${manifest.counts.canonical}`)
  if (manifest.counts.legacy !== 95) errors.push(`Expected 95 legacy operations; found ${manifest.counts.legacy}`)
  if (manifest.counts.global !== 3) errors.push(`Expected 3 global operations; found ${manifest.counts.global}`)
  if (manifest.counts.edge !== 1) errors.push(`Expected 1 edge operation; found ${manifest.counts.edge}`)
  if (manifest.counts.mandatoryExplicit !== 194) {
    errors.push(`Expected 194 mandatory explicit operations; found ${manifest.counts.mandatoryExplicit}`)
  }
  if (manifest.counts.openApiOperations !== manifest.counts.canonical) {
    errors.push(`OpenAPI/canonical count mismatch: ${manifest.counts.openApiOperations} vs ${manifest.counts.canonical}`)
  }

  const ids = manifest.explicitEndpoints.map((endpoint) => endpoint.id)
  if (new Set(ids).size !== ids.length) errors.push('Explicit endpoint IDs are not unique')

  return errors
}
