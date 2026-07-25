import http from 'node:http'
import { allocateDynamicMutation, leaseToken } from '../fixtures/dynamic/allocator'
import type { DynamicMutationEffect } from '../fixtures/dynamic/types'
import { loadGuardedMutationEnvironment } from './guard'
import { DurableMutationLedger } from './ledger'

const MAX_BODY_BYTES = 1024 * 1024

async function jsonBody(request: http.IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('Mutation sidecar request body is too large')
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

function reply(response: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  response.end(payload)
}

function authenticate(request: http.IncomingMessage, expected: string): boolean {
  const supplied = request.headers['x-load-mutation-secret']
  return typeof supplied === 'string' && supplied === expected
}

export function createMutationSidecar(): http.Server {
  const environment = loadGuardedMutationEnvironment()
  const ledger = new DurableMutationLedger(
    environment.stateDirectory,
    environment.runId,
    environment.databaseName,
  )
  ledger.initialize()

  return http.createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') {
        reply(response, 200, { status: 'ready', runId: environment.runId })
        return
      }
      if (!authenticate(request, environment.secret)) {
        reply(response, 401, { error: 'unauthorized' })
        return
      }
      if (request.method === 'POST' && request.url === '/v1/plan') {
        const body = await jsonBody(request)
        const allocation = allocateDynamicMutation(
          environment.runId,
          String(body.endpointId ?? ''),
          Number(body.vuId),
          Number(body.iteration),
          environment.secret,
        )
        const token = leaseToken(allocation, environment.secret)
        ledger.plan(allocation, token, body.effects as DynamicMutationEffect[])
        reply(response, 201, { allocation, leaseToken: token })
        return
      }
      if (request.method === 'POST' && request.url === '/v1/observe') {
        const body = await jsonBody(request)
        const entry = ledger.observe(
          String(body.requestId ?? ''),
          String(body.leaseToken ?? ''),
          { status: Number(body.status), succeeded: body.succeeded === true },
          body.effects as DynamicMutationEffect[] | undefined,
        )
        reply(response, 200, { requestId: entry.allocation.requestId, state: entry.state })
        return
      }
      if (request.method === 'GET' && request.url === '/v1/status') {
        const current = ledger.read()
        reply(response, 200, {
          runId: current.runId,
          state: current.state,
          counts: current.entries.reduce<Record<string, number>>((counts, entry) => {
            counts[entry.state] = (counts[entry.state] ?? 0) + 1
            return counts
          }, {}),
        })
        return
      }
      reply(response, 404, { error: 'not_found' })
    } catch (error) {
      reply(response, 400, { error: String(error instanceof Error ? error.message : error).slice(0, 1000) })
    }
  })
}

if (require.main === module) {
  const host = process.env.LOAD_TEST_MUTATION_HOST?.trim() || '127.0.0.1'
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
    throw new Error('Mutation sidecar may only bind to loopback')
  }
  const port = Number(process.env.LOAD_TEST_MUTATION_PORT ?? 17991)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('LOAD_TEST_MUTATION_PORT must be an integer from 1024 through 65535')
  }
  const server = createMutationSidecar()
  server.listen(port, host, () => {
    process.stdout.write(`${JSON.stringify({ status: 'ready', host, port })}\n`)
  })
}
