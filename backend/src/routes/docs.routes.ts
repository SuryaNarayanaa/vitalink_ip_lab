import { Router, Request, Response, NextFunction } from 'express'
import { StatusCodes } from 'http-status-codes'
import swaggerUi from 'swagger-ui-express'
import { parse } from 'yaml'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { timingSafeEqual } from 'crypto'
import { config } from '@alias/config'

const docsRouter = Router()

const specCandidates = [
  resolve(process.cwd(), 'docs/api/openapi.yaml'),
  resolve(__dirname, '../../docs/api/openapi.yaml'),
  resolve(__dirname, '../docs/api/openapi.yaml'),
]

const specPath = specCandidates.find((candidate) => existsSync(candidate))

if (!specPath) {
  throw new Error('OpenAPI specification not found at docs/api/openapi.yaml')
}

const openApiYaml = readFileSync(specPath, 'utf8')
const openApiSpec = parse(openApiYaml)

function safeEqual(value: string, expected: string): boolean {
  const valueBuffer = Buffer.from(value)
  const expectedBuffer = Buffer.from(expected)

  if (valueBuffer.length !== expectedBuffer.length) {
    return false
  }

  return timingSafeEqual(valueBuffer, expectedBuffer)
}

function requireDocsBasicAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.apiDocsUsername || !config.apiDocsPassword) {
    // Allow unauthenticated docs only outside production (local/dev/test).
    if (config.nodeEnv !== 'production') {
      next()
      return
    }
    res.status(StatusCodes.SERVICE_UNAVAILABLE).send(
      'API documentation is not configured. Set API_DOCS_USERNAME and API_DOCS_PASSWORD.',
    )
    return
  }

  const authorization = req.header('authorization') || ''
  const [scheme, encodedCredentials] = authorization.split(' ')

  if (scheme !== 'Basic' || !encodedCredentials) {
    res.setHeader('WWW-Authenticate', 'Basic realm="VitaLink API Docs", charset="UTF-8"')
    res.status(StatusCodes.UNAUTHORIZED).send('Authentication required')
    return
  }

  const credentials = Buffer.from(encodedCredentials, 'base64').toString('utf8')
  const separatorIndex = credentials.indexOf(':')
  const username = separatorIndex >= 0 ? credentials.slice(0, separatorIndex) : ''
  const password = separatorIndex >= 0 ? credentials.slice(separatorIndex + 1) : ''

  if (
    !username ||
    !password ||
    !safeEqual(username, config.apiDocsUsername) ||
    !safeEqual(password, config.apiDocsPassword)
  ) {
    res.setHeader('WWW-Authenticate', 'Basic realm="VitaLink API Docs", charset="UTF-8"')
    res.status(StatusCodes.UNAUTHORIZED).send('Authentication required')
    return
  }

  next()
}

docsRouter.use((req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD')
    res.status(StatusCodes.METHOD_NOT_ALLOWED).send('Method not allowed')
    return
  }

  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data:",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'none'",
    ].join('; ')
  )

  next()
})

docsRouter.use(requireDocsBasicAuth)

docsRouter.get('/openapi.yaml', (_req, res) => {
  res.type('application/yaml').send(openApiYaml)
})

docsRouter.use(
  '/',
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec, {
    customSiteTitle: 'VitaLink API Documentation',
    swaggerOptions: {
      supportedSubmitMethods: [],
      validatorUrl: null,
      displayRequestDuration: true,
      docExpansion: 'none',
      defaultModelsExpandDepth: 1,
      url: 'openapi.yaml',
    },
  })
)

export default docsRouter
