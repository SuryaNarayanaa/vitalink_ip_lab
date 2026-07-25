import path from 'node:path'

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/
const SAFE_DATABASE_PATTERN = /(?:load[_-]?test|stress|perf(?:ormance)?)/i
const FORBIDDEN_HOST_PATTERN = /(?:^|[.-])(?:prod|production)(?:[.-]|$)/i
const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'mongo'])

export type GuardedEnvironment = {
  runId: string
  mongoUri: string
  databaseName: string
  databaseHosts: string[]
  stateDirectory: string
  fixturePassword?: string
  jwtSecret?: string
  baseUrl?: string
}

function requireExactTrue(name: string): void {
  if (process.env[name] !== 'true') {
    throw new Error(`${name}=true is required; refusing to run load-test fixture tooling`)
  }
}

function parseCsv(value: string | undefined): Set<string> {
  return new Set((value ?? '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean))
}

function assertAllowedDatabaseHosts(hosts: string[]): void {
  const explicitAllowed = parseCsv(process.env.LOAD_TEST_ALLOWED_DB_HOSTS)
  const explicitDenied = parseCsv(process.env.LOAD_TEST_DENY_DB_HOSTS)

  for (const host of hosts) {
    const normalized = host.toLowerCase()
    if (FORBIDDEN_HOST_PATTERN.test(normalized) || explicitDenied.has(normalized)) {
      throw new Error(`Database host ${host} is forbidden for load-test fixtures`)
    }
    if (!LOCAL_DATABASE_HOSTS.has(normalized) && !explicitAllowed.has(normalized)) {
      throw new Error(
        `Database host ${host} is not allowlisted. Set LOAD_TEST_ALLOWED_DB_HOSTS explicitly for a dedicated non-production target.`,
      )
    }
  }
}

function parseMongoTarget(uri: string): { databaseName: string; hosts: string[] } {
  if (!/^mongodb(?:\+srv)?:\/\//i.test(uri)) {
    throw new Error('LOAD_TEST_MONGO_URI must be a MongoDB URI')
  }

  const withoutScheme = uri.replace(/^mongodb(?:\+srv)?:\/\//i, '')
  const authorityAndPath = withoutScheme.split('?')[0]
  const slashIndex = authorityAndPath.indexOf('/')
  const authority = slashIndex >= 0 ? authorityAndPath.slice(0, slashIndex) : authorityAndPath
  const databaseName = slashIndex >= 0
    ? decodeURIComponent(authorityAndPath.slice(slashIndex + 1).split('/')[0] ?? '')
    : ''
  const hostList = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority
  const hosts = hostList.split(',').map(hostPort => {
    if (hostPort.startsWith('[')) return hostPort.slice(1, hostPort.indexOf(']'))
    return hostPort.split(':')[0]
  }).filter(Boolean)

  if (!databaseName || !SAFE_DATABASE_PATTERN.test(databaseName)) {
    throw new Error(
      `Database name ${databaseName || '<missing>'} is unsafe; it must contain load_test, stress, perf, or performance`,
    )
  }
  if (hosts.length === 0) throw new Error('LOAD_TEST_MONGO_URI has no database host')
  return { databaseName, hosts }
}

function assertBaseUrl(baseUrl: string | undefined): void {
  if (!baseUrl) return
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error('LOAD_TEST_BASE_URL must be an absolute URL when provided')
  }

  const host = parsed.hostname.toLowerCase()
  const allowed = parseCsv(process.env.LOAD_TEST_ALLOWED_HTTP_HOSTS)
  if (FORBIDDEN_HOST_PATTERN.test(host)) {
    throw new Error(`HTTP host ${host} is forbidden for load tests`)
  }
  if (!LOCAL_DATABASE_HOSTS.has(host) && !allowed.has(host)) {
    throw new Error(`HTTP host ${host} is not listed in LOAD_TEST_ALLOWED_HTTP_HOSTS`)
  }
}

export function loadGuardedEnvironment(options: { requireDatabase?: boolean; requirePassword?: boolean } = {}): GuardedEnvironment {
  requireExactTrue('ALLOW_LOAD_TESTS')

  const nodeEnvironment = (process.env.NODE_ENV ?? 'development').trim().toLowerCase()
  if (nodeEnvironment === 'production') {
    throw new Error('NODE_ENV=production is never accepted by fixture tooling')
  }

  const runId = (process.env.LOAD_TEST_RUN_ID ?? '').trim()
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error('LOAD_TEST_RUN_ID must be 8-64 characters using letters, digits, underscore, or hyphen')
  }

  const stateDirectory = path.resolve((process.env.LOAD_TEST_STATE_DIR ?? '').trim())
  if (!process.env.LOAD_TEST_STATE_DIR?.trim() || !path.isAbsolute(stateDirectory)) {
    throw new Error('LOAD_TEST_STATE_DIR must be an explicit absolute path on durable storage')
  }

  const mongoUri = (process.env.LOAD_TEST_MONGO_URI ?? '').trim()
  if (options.requireDatabase !== false && !mongoUri) {
    throw new Error('LOAD_TEST_MONGO_URI is required')
  }
  const target = mongoUri ? parseMongoTarget(mongoUri) : { databaseName: '', hosts: [] }
  if (mongoUri) assertAllowedDatabaseHosts(target.hosts)

  const fixturePassword = process.env.LOAD_TEST_FIXTURE_PASSWORD
  if (options.requirePassword && (!fixturePassword || fixturePassword.length < 16)) {
    throw new Error('LOAD_TEST_FIXTURE_PASSWORD must be at least 16 characters and supplied only through the environment')
  }
  if (fixturePassword && /^(?:password|changeme|loadtest|test123)/i.test(fixturePassword)) {
    throw new Error('LOAD_TEST_FIXTURE_PASSWORD is too predictable')
  }
  const jwtSecret = process.env.LOAD_TEST_JWT_SECRET
  if (options.requirePassword && (!jwtSecret || jwtSecret.length < 32)) {
    throw new Error('LOAD_TEST_JWT_SECRET must be at least 32 characters and must match JWT_SECRET on the isolated API')
  }

  const baseUrl = process.env.LOAD_TEST_BASE_URL?.trim()
  assertBaseUrl(baseUrl)

  return {
    runId,
    mongoUri,
    databaseName: target.databaseName,
    databaseHosts: target.hosts,
    stateDirectory,
    fixturePassword,
    jwtSecret,
    baseUrl,
  }
}

export const guardInternals = { parseMongoTarget }
