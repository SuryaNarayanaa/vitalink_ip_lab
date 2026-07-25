#!/usr/bin/env node
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const TRUE = 'true'
const DEFAULT_ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', 'host.docker.internal', 'vitalink-nginx'])
const PRODUCTION_HOSTS = new Set(['vitalink-uimf.onrender.com', 'api.vitalink.invalid'])
const STREAM_PATHS = Object.freeze({
  doctor: '/api/v1/doctors/notifications/stream',
  patient: '/api/v1/patient/notifications/stream',
})
const TICKET_PATHS = Object.freeze({
  doctor: '/api/v1/doctors/notifications/stream-ticket',
  patient: '/api/v1/patient/notifications/stream-ticket',
})
const activeControllers = new Set()

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    for (const controller of activeControllers) controller.abort()
  })
}

function parseJson(name, value, fallback) {
  if (!value) return fallback
  try { return JSON.parse(value) } catch (_) { throw new Error(`${name} must contain valid JSON`) }
}

function boundedInteger(name, value, fallback, minimum, maximum) {
  const parsed = value === undefined || value === '' ? fallback : Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be a whole number from ${minimum} to ${maximum}`)
  }
  return parsed
}

function safeTarget(rawBaseUrl, rawAllowedHosts) {
  let url
  try { url = new URL(rawBaseUrl) } catch (_) { throw new Error('LOAD_TEST_BASE_URL must be an absolute http(s) URL') }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  const allowed = new Set([...DEFAULT_ALLOWED_HOSTS, ...String(rawAllowedHosts || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean)])
  if (PRODUCTION_HOSTS.has(host) || /(?:^|[.-])prod(?:uction)?(?:[.-]|$)/i.test(host) || /^api\.vitalink(?:\.|$)/i.test(host)) {
    throw new Error(`Refusing to load test known or production-like host: ${host}`)
  }
  if (!allowed.has(host)) throw new Error(`Target host ${host} is not in LOAD_TEST_ALLOWED_HOSTS`)
  if (url.protocol !== 'https:' && !DEFAULT_ALLOWED_HOSTS.has(host) && process.env.ALLOW_INSECURE_REMOTE_LOAD?.toLowerCase() !== TRUE) {
    throw new Error('Remote SSE targets must use HTTPS')
  }
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url
}

function contextForRole(context, role) {
  const override = context[role] && typeof context[role] === 'object' ? context[role] : {}
  return {
    ...context,
    ...override,
    tokens: { ...(context.tokens || {}), ...(override.tokens || {}) },
  }
}

function basePath(url) {
  return url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '')
}

function makeDeferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function headerIncludes(response, name, value) {
  return String(response.headers.get(name) || '').toLowerCase().includes(value.toLowerCase())
}

function possibleEventTimestamp(data) {
  if (!data || typeof data !== 'object') return null
  for (const key of ['published_at', 'timestamp', 'createdAt', 'created_at', 'sent_at']) {
    const parsed = Date.parse(data[key])
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function consumeFrame(frame, state, receivedAt) {
  if (frame.startsWith(':')) {
    const comment = frame.slice(1).trim()
    state.comments += 1
    if (comment === 'ping') state.heartbeatTimes.push(receivedAt)
    return
  }
  let event = 'message'
  const dataLines = []
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }
  if (!dataLines.length) return
  let data = dataLines.join('\n')
  try { data = JSON.parse(data) } catch (_) { /* Record only metadata, never raw payloads. */ }
  const sourceTimestamp = possibleEventTimestamp(data)
  const record = {
    event,
    receivedAt,
    sourceTimestampLatencyMs: sourceTimestamp === null ? null : Math.max(0, receivedAt - sourceTimestamp),
  }
  state.events.push(record)
  if (state.firstEventAt === null) {
    state.firstEventAt = receivedAt
    state.firstEvent.resolve(record)
  }
  for (const waiter of [...state.eventWaiters]) {
    if (waiter.predicate(record)) {
      state.eventWaiters.delete(waiter)
      waiter.resolve(record)
    }
  }
}

async function pumpSse(response, state, controller) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        state.endedNaturally = !state.closedByRunner
        break
      }
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      let boundary
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        if (frame) consumeFrame(frame, state, Date.now())
      }
    }
  } catch (error) {
    if (!state.closedByRunner && error?.name !== 'AbortError') state.readError = error instanceof Error ? error.message : String(error)
  } finally {
    try { reader.releaseLock() } catch (_) { /* no-op */ }
    state.doneAt = Date.now()
  }
}

async function startStream({ baseUrl, role, auth }) {
  const url = new URL(`${baseUrl.origin}${basePath(baseUrl)}${STREAM_PATHS[role]}`)
  const headers = { Accept: 'text/event-stream', 'X-Load-Test-Run-Id': auth.runId }
  if (auth.mode === 'bearer') headers.Authorization = `Bearer ${auth.credential}`
  else url.searchParams.set('ticket', auth.credential)
  const controller = new AbortController()
  activeControllers.add(controller)
  const startedAt = Date.now()
  let response
  try {
    response = await fetch(url, { headers, signal: controller.signal, redirect: 'error' })
  } catch (error) {
    activeControllers.delete(controller)
    throw error
  }
  const headersAt = Date.now()
  const accelBuffering = response.headers.get('x-accel-buffering')
  const state = {
    role, mode: auth.mode, status: response.status, startedAt, headersAt,
    firstEventAt: null, firstEvent: makeDeferred(), heartbeatTimes: [], events: [], eventWaiters: new Set(), comments: 0,
    closedByRunner: false, endedNaturally: false, readError: null, doneAt: null,
    headersValid: response.status === 200 &&
      headerIncludes(response, 'content-type', 'text/event-stream') &&
      headerIncludes(response, 'cache-control', 'no-cache') &&
      (accelBuffering === null || accelBuffering.toLowerCase() === 'no'),
  }
  const pump = response.status === 200 ? pumpSse(response, state, controller) : Promise.resolve()
  const close = async () => {
    state.closedByRunner = true
    controller.abort()
    try { await pump } finally { activeControllers.delete(controller) }
  }
  return { response, state, close, pump }
}

async function waitWithTimeout(promise, timeoutMs, label) {
  let timeout
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs) }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

function waitForEvent(session, predicate, timeoutMs) {
  const existing = session.state.events.find(predicate)
  if (existing) return Promise.resolve(existing)
  const deferred = makeDeferred()
  const waiter = { predicate, resolve: deferred.resolve }
  session.state.eventWaiters.add(waiter)
  return waitWithTimeout(deferred.promise, timeoutMs, 'SSE notification event').finally(() => session.state.eventWaiters.delete(waiter))
}

async function issueTicket(baseUrl, role, token, runId) {
  const response = await fetch(`${baseUrl.origin}${basePath(baseUrl)}${TICKET_PATHS[role]}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-Load-Test-Run-Id': runId },
    redirect: 'error',
  })
  if (response.status !== 200) throw new Error(`${role} ticket request returned ${response.status}`)
  const body = await response.json()
  const ticket = body && body.data && body.data.ticket
  if (typeof ticket !== 'string' || ticket.length < 20) throw new Error(`${role} ticket response did not contain a ticket`)
  return ticket
}

async function credentialFor(baseUrl, role, mode, token, runId) {
  return mode === 'ticket' ? issueTicket(baseUrl, role, token, runId) : token
}

async function triggerEvent(baseUrl, role, trigger, tokens, runId) {
  if (!trigger) return { configured: false }
  const url = new URL(trigger.path || trigger.url, `${baseUrl.origin}${basePath(baseUrl)}/`)
  if (url.origin !== baseUrl.origin) throw new Error(`${role} trigger must use the guarded target origin`)
  const tokenRole = trigger.tokenRole || role
  const token = tokens[tokenRole]
  if (!token) throw new Error(`${role} trigger requires tokens.${tokenRole}`)
  const startedAt = Date.now()
  const response = await fetch(url, {
    method: trigger.method || 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Load-Test-Run-Id': runId },
    body: trigger.body === undefined ? undefined : JSON.stringify(trigger.body),
    redirect: 'error',
  })
  await response.body?.cancel()
  return { configured: true, startedAt, status: response.status, expectedStatuses: trigger.expectedStatuses || [200] }
}

function summarizeSession(session, triggerResult) {
  const { state } = session
  const heartbeatGaps = state.heartbeatTimes.slice(1).map((time, index) => time - state.heartbeatTimes[index])
  const notificationEvents = state.events.filter(event => event.event !== 'connected')
  return {
    status: state.status,
    headersValid: state.headersValid,
    timeToHeadersMs: state.headersAt - state.startedAt,
    timeToFirstEventMs: state.firstEventAt === null ? null : state.firstEventAt - state.startedAt,
    eventCount: state.events.length,
    eventTypes: [...new Set(state.events.map(event => event.event))],
    heartbeatCount: state.heartbeatTimes.length,
    maxHeartbeatGapMs: heartbeatGaps.length ? Math.max(...heartbeatGaps) : null,
    notificationEventLatencyMs: triggerResult && triggerResult.eventReceivedAt
      ? triggerResult.eventReceivedAt - triggerResult.startedAt
      : notificationEvents[0]?.sourceTimestampLatencyMs ?? null,
    unexpectedDisconnects: Number(state.endedNaturally || Boolean(state.readError)),
    readError: state.readError,
  }
}

async function observeMode({ baseUrl, role, mode, token, runId, holdMs, firstEventTimeoutMs, trigger, allTokens }) {
  let session
  let reconnect
  let replay
  try {
    const credential = await credentialFor(baseUrl, role, mode, token, runId)
    session = await startStream({ baseUrl, role, auth: { mode, credential, runId } })
    if (session.response.status !== 200) {
      await session.close()
      return { baseline: summarizeSession(session), reconnect: { status: session.response.status, passed: false }, ticketReplay: null }
    }
    await waitWithTimeout(session.state.firstEvent.promise, firstEventTimeoutMs, `${role} ${mode} first event`)

    let triggerResult = await triggerEvent(baseUrl, role, trigger, allTokens, runId)
    if (triggerResult.configured && triggerResult.expectedStatuses.includes(triggerResult.status)) {
      try {
        const event = await waitForEvent(session, record => record.event !== 'connected' && record.receivedAt >= triggerResult.startedAt, firstEventTimeoutMs)
        triggerResult.eventReceivedAt = event.receivedAt
      } catch (error) {
        triggerResult.error = error instanceof Error ? error.message : String(error)
      }
    }

    await new Promise(resolve => setTimeout(resolve, holdMs))
    await session.close()
    const baseline = summarizeSession(session, triggerResult)

    const reconnectCredential = await credentialFor(baseUrl, role, mode, token, runId)
    reconnect = await startStream({ baseUrl, role, auth: { mode, credential: reconnectCredential, runId } })
    let reconnectPassed = false
    if (reconnect.response.status === 200) {
      await waitWithTimeout(reconnect.state.firstEvent.promise, firstEventTimeoutMs, `${role} ${mode} reconnect`)
      reconnectPassed = reconnect.state.headersValid
    }
    await reconnect.close()

    let ticketReplay = null
    if (mode === 'ticket') {
      replay = await startStream({ baseUrl, role, auth: { mode, credential: reconnectCredential, runId } })
      ticketReplay = { status: replay.response.status, passed: replay.response.status === 401 }
      await replay.close()
    }
    return {
      baseline,
      trigger: triggerResult,
      reconnect: { status: reconnect.response.status, passed: reconnectPassed, timeToFirstEventMs: reconnect.state.firstEventAt === null ? null : reconnect.state.firstEventAt - reconnect.state.startedAt },
      ticketReplay,
    }
  } finally {
    await Promise.allSettled([session, reconnect, replay].filter(Boolean).map(item => item.close()))
  }
}

async function testPerUserCap({ baseUrl, role, token, runId, firstEventTimeoutMs }) {
  const sessions = []
  try {
    for (let index = 0; index < 3; index += 1) {
      const session = await startStream({ baseUrl, role, auth: { mode: 'bearer', credential: token, runId } })
      sessions.push(session)
      if (session.response.status === 200) await waitWithTimeout(session.state.firstEvent.promise, firstEventTimeoutMs, `${role} cap connection ${index + 1}`)
    }
    const overflow = await startStream({ baseUrl, role, auth: { mode: 'bearer', credential: token, runId } })
    const result = { acceptedStatuses: sessions.map(session => session.response.status), overflowStatus: overflow.response.status, passed: sessions.every(session => session.response.status === 200) && overflow.response.status === 429 }
    await overflow.close()
    return result
  } finally {
    await Promise.allSettled(sessions.map(session => session.close()))
  }
}

async function testPerIpCap({ baseUrl, identities, runId, firstEventTimeoutMs }) {
  if (!Array.isArray(identities) || identities.length < 11) {
    return { skipped: true, reason: 'Provide at least 11 distinct sseCapIdentities to test the ten-streams-per-IP cap' }
  }
  const sessions = []
  try {
    for (let index = 0; index < 10; index += 1) {
      const identity = identities[index]
      if (!STREAM_PATHS[identity?.role] || !identity?.token) throw new Error(`Invalid sseCapIdentities entry ${index}`)
      const session = await startStream({ baseUrl, role: identity.role, auth: { mode: 'bearer', credential: identity.token, runId } })
      sessions.push(session)
      if (session.response.status === 200) await waitWithTimeout(session.state.firstEvent.promise, firstEventTimeoutMs, `IP cap connection ${index + 1}`)
    }
    const overflowIdentity = identities[10]
    if (!STREAM_PATHS[overflowIdentity?.role] || !overflowIdentity?.token) throw new Error('Invalid sseCapIdentities overflow entry')
    const overflow = await startStream({ baseUrl, role: overflowIdentity.role, auth: { mode: 'bearer', credential: overflowIdentity.token, runId } })
    const result = {
      skipped: false,
      acceptedStatuses: sessions.map(session => session.response.status),
      overflowStatus: overflow.response.status,
      passed: sessions.every(session => session.response.status === 200) && overflow.response.status === 429,
    }
    await overflow.close()
    return result
  } finally {
    await Promise.allSettled(sessions.map(session => session.close()))
  }
}

function redact(value, key = '') {
  if (/token|ticket|authorization|cookie|secret|password|credential/i.test(key) && (typeof value === 'string' || typeof value === 'number')) return '[REDACTED]'
  if (typeof value === 'string') return value.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]')
  if (Array.isArray(value)) return value.map(item => redact(item))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]))
  return value
}

export async function runSseStress(env = process.env) {
  if (String(env.ALLOW_LOAD_TESTS || '').toLowerCase() !== TRUE) throw new Error('Refusing to run: ALLOW_LOAD_TESTS=true is required')
  if (String(env.ALLOW_DESTRUCTIVE_LOAD || '').toLowerCase() !== TRUE) throw new Error('Refusing to run: ALLOW_DESTRUCTIVE_LOAD=true is required')
  const runId = String(env.LOAD_TEST_RUN_ID || '').trim()
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{5,79}$/.test(runId)) throw new Error('LOAD_TEST_RUN_ID must be 6-80 safe characters')
  const baseUrl = safeTarget(env.LOAD_TEST_BASE_URL, env.LOAD_TEST_ALLOWED_HOSTS)
  const fingerprint = String(env.LOAD_TEST_ENV_FINGERPRINT || '').trim()
  if (!fingerprint) throw new Error('LOAD_TEST_ENV_FINGERPRINT is required')
  const identityResponse = await fetch(`${baseUrl.origin}${basePath(baseUrl)}/health/ready`, { redirect: 'error' })
  if (![200, 503].includes(identityResponse.status)
    || identityResponse.headers.get('x-load-test-environment-fingerprint') !== fingerprint
    || identityResponse.headers.get('x-load-test-run-id') !== runId) {
    await identityResponse.body?.cancel()
    throw new Error('Target load-test environment fingerprint or seeded run ID does not match')
  }
  await identityResponse.body?.cancel()
  const contextText = env.LOAD_TEST_CONTEXT_FILE
    ? await fs.readFile(env.LOAD_TEST_CONTEXT_FILE, 'utf8')
    : env.SSE_CONTEXT_JSON || env.LOAD_TEST_CONTEXT_JSON
  const context = parseJson('LOAD_TEST_CONTEXT_FILE, SSE_CONTEXT_JSON, or LOAD_TEST_CONTEXT_JSON', contextText, {})
  if (context.runId && context.runId !== runId) throw new Error('SSE context runId does not match LOAD_TEST_RUN_ID')
  if (context.baseUrl && new URL(context.baseUrl).origin !== baseUrl.origin) throw new Error('SSE context baseUrl does not match guarded target')
  if (context.sseTriggers || context.doctor?.sseTrigger || context.patient?.sseTrigger) {
    throw new Error('SSE mutation triggers are disabled until the durable dynamic cleanup ledger is implemented')
  }
  const roles = String(env.SSE_ROLES || 'doctor,patient').split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
  if (!roles.length || roles.some(role => !STREAM_PATHS[role])) throw new Error('SSE_ROLES must contain doctor and/or patient')
  const modes = String(env.SSE_AUTH_MODES || 'bearer,ticket').split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
  if (!modes.length || modes.some(mode => !['bearer', 'ticket'].includes(mode))) throw new Error('SSE_AUTH_MODES must contain bearer and/or ticket')
  const requireHeartbeat = String(env.SSE_REQUIRE_HEARTBEAT || 'true').toLowerCase() === TRUE
  const holdMs = boundedInteger('SSE_HOLD_MS', env.SSE_HOLD_MS, requireHeartbeat ? 27000 : 1000, requireHeartbeat ? 26000 : 100, 120000)
  const firstEventTimeoutMs = boundedInteger('SSE_FIRST_EVENT_TIMEOUT_MS', env.SSE_FIRST_EVENT_TIMEOUT_MS, 5000, 500, 30000)
  const tokens = {}
  for (const role of roles) {
    const roleCtx = contextForRole(context, role)
    const token = roleCtx.tokens && roleCtx.tokens[role]
    if (!token) throw new Error(`SSE runner requires context tokens.${role}`)
    tokens[role] = token
  }

  const startedAt = new Date().toISOString()
  const entries = await Promise.all(roles.flatMap(role => modes.map(async mode => ({
    role,
    mode,
    result: await observeMode({
      baseUrl, role, mode, token: tokens[role], runId, holdMs, firstEventTimeoutMs,
      trigger: contextForRole(context, role).sseTrigger || context.sseTriggers?.[role], allTokens: { ...(context.tokens || {}), ...tokens },
    }),
  }))))
  const results = Object.fromEntries(roles.map(role => [role, { modes: {} }]))
  for (const entry of entries) results[entry.role].modes[entry.mode] = entry.result
  if (String(env.SSE_TEST_CONNECTION_CAPS || 'true').toLowerCase() === TRUE) {
    // Give the server's socket close handlers a bounded moment to release the
    // baseline connections before asserting its cap bookkeeping.
    await new Promise(resolve => setTimeout(resolve, 250))
    for (const role of roles) results[role].connectionCap = await testPerUserCap({ baseUrl, role, token: tokens[role], runId, firstEventTimeoutMs })
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  const ipConnectionCap = String(env.SSE_TEST_CONNECTION_CAPS || 'true').toLowerCase() === TRUE
    ? await testPerIpCap({ baseUrl, identities: context.sseCapIdentities, runId, firstEventTimeoutMs })
    : { skipped: true, reason: 'Connection-cap tests disabled' }

  const failures = []
  for (const role of roles) {
    for (const mode of modes) {
      const result = results[role].modes[mode]
      if (result.baseline.status !== 200 || !result.baseline.headersValid || result.baseline.timeToFirstEventMs === null || result.baseline.unexpectedDisconnects) failures.push(`${role}/${mode} baseline`)
      if (requireHeartbeat && result.baseline.heartbeatCount < 1) failures.push(`${role}/${mode} heartbeat`)
      if (!result.reconnect.passed) failures.push(`${role}/${mode} reconnect`)
      if (mode === 'ticket' && !result.ticketReplay?.passed) failures.push(`${role}/${mode} replay`)
      if (result.trigger?.configured && (!result.trigger.expectedStatuses.includes(result.trigger.status) || result.baseline.notificationEventLatencyMs === null)) failures.push(`${role}/${mode} event latency`)
    }
    if (results[role].connectionCap && !results[role].connectionCap.passed) failures.push(`${role} connection cap`)
  }
  if (!ipConnectionCap.skipped && !ipConnectionCap.passed) failures.push('IP connection cap')
  if (String(env.SSE_REQUIRE_IP_CAP || 'false').toLowerCase() === TRUE && ipConnectionCap.skipped) failures.push('IP connection cap not exercised')

  return redact({
    schemaVersion: 1,
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    target: { origin: baseUrl.origin, basePath: baseUrl.pathname || '/' },
    config: { roles, modes, holdMs, firstEventTimeoutMs, requireHeartbeat, connectionCapsTested: String(env.SSE_TEST_CONNECTION_CAPS || 'true').toLowerCase() === TRUE },
    results,
    ipConnectionCap,
    verdict: { passed: failures.length === 0, failures },
  })
}

async function main() {
  const report = await runSseStress(process.env)
  const json = `${JSON.stringify(report, null, 2)}\n`
  if (process.env.SSE_OUTPUT_FILE) await fs.writeFile(process.env.SSE_OUTPUT_FILE, json, { encoding: 'utf8', flag: 'wx' })
  process.stdout.write(json)
  if (!report.verdict.passed) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`SSE stress runner failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
