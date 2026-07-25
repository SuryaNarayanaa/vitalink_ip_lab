'use strict'

const http = require('node:http')
const { URLSearchParams } = require('node:url')

const port = Number.parseInt(process.env.PORT || '8080', 10)
const maxBodyBytes = 64 * 1024

function send(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let bytes = 0
    const chunks = []
    request.on('data', chunk => {
      bytes += chunk.length
      if (bytes > maxBodyBytes) {
        reject(new Error('request body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

const server = http.createServer(async (request, response) => {
  const path = new URL(request.url || '/', 'http://stub.invalid').pathname
  if (request.method === 'GET' && path === '/health') {
    send(response, 200, { status: 'ok', service: 'synthetic-load-test-provider' })
    return
  }

  try {
    const rawBody = await readBody(request)
    if (request.method === 'POST' && /\/Verifications$/.test(path)) {
      send(response, 201, { sid: 'VE_SYNTHETIC_LOAD_TEST', status: 'pending' })
      return
    }
    if (request.method === 'POST' && /\/VerificationCheck$/.test(path)) {
      const form = new URLSearchParams(rawBody)
      const approved = form.get('Code') === '000000'
      send(response, 200, { sid: 'VE_SYNTHETIC_LOAD_TEST', status: approved ? 'approved' : 'pending', valid: approved })
      return
    }
    if (request.method === 'POST' && path === '/checkout/sessions') {
      send(response, 201, {
        id: 'checkout_synthetic_load_test',
        checkout_url: 'http://provider-stub:8080/synthetic-checkout',
        status: 'created',
      })
      return
    }
    if (request.method === 'POST' && /\/messages:send$/.test(path)) {
      send(response, 200, { name: 'projects/synthetic/messages/load-test-message' })
      return
    }
    send(response, 404, { error: 'unsupported synthetic provider route' })
  } catch (error) {
    send(response, 413, { error: error instanceof Error ? error.message : 'request rejected' })
  }
})

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`Synthetic provider stub listening on ${port}\n`)
})

function shutdown() {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 5_000).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

