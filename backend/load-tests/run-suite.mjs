#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const K6_IMAGE = 'grafana/k6:2.1.0'
const TRUE = 'true'

function required(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function safeRunId(value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{5,79}$/.test(value)) {
    throw new Error('LOAD_TEST_RUN_ID must be 6-80 safe characters')
  }
  return value
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command),
      stdio: options.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    if (options.quiet) {
      child.stdout.on('data', chunk => { stdout += chunk })
      child.stderr.on('data', chunk => { stderr += chunk })
    }
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${command} exited ${code}${stderr ? `: ${stderr.trim()}` : ''}`))
    })
  })
}

function dockerScenario({ backendRoot, contextInContainer, runId, baseUrl, allowedHosts, fingerprint, reportRelative, entrypoint, operationMode }) {
  const summaryRoot = path.join(backendRoot, reportRelative, `${runId}-smoke`)
  fs.mkdirSync(summaryRoot, { recursive: true })
  const rawRelative = `${reportRelative}/raw-k6.json`.replaceAll('\\', '/')
  const args = [
    'run', '--rm',
    '--add-host', 'host.docker.internal:host-gateway',
    '-v', `${backendRoot}:/work`,
    '-w', '/work',
    K6_IMAGE,
    'run', '--no-color',
    '--out', `json=${rawRelative}`,
    '-e', 'ALLOW_LOAD_TESTS=true',
    '-e', 'ALLOW_DESTRUCTIVE_LOAD=true',
    '-e', `LOAD_TEST_RUN_ID=${runId}`,
    '-e', 'LOAD_TEST_PROFILE=smoke',
    '-e', `LOAD_TEST_BASE_URL=${baseUrl}`,
    '-e', `LOAD_TEST_ALLOWED_HOSTS=${allowedHosts}`,
    '-e', `LOAD_TEST_ENV_FINGERPRINT=${fingerprint}`,
    '-e', `LOAD_TEST_CONTEXT_FILE=${contextInContainer}`,
    '-e', `LOAD_TEST_REPORT_DIR=${reportRelative.replaceAll('\\', '/')}`,
    '-e', 'LOAD_TEST_REQUIRE_COMPLETE_COVERAGE=true',
    ...(operationMode ? ['-e', `LOAD_TEST_OPERATION_MODE=${operationMode}`] : []),
    entrypoint,
  ]
  return run('docker', args, { cwd: backendRoot })
}

async function main() {
  if (String(process.env.ALLOW_LOAD_TESTS || '').toLowerCase() !== TRUE) {
    throw new Error('Refusing to run: ALLOW_LOAD_TESTS=true is required')
  }
  if (String(process.env.LOAD_TEST_VALID_MUTATIONS || '').toLowerCase() === TRUE) {
    throw new Error('Valid mutations are disabled until the durable dynamic cleanup ledger is implemented')
  }

  const backendRoot = process.cwd()
  if (!fs.existsSync(path.join(backendRoot, 'load-tests', 'generated', 'endpoints.json'))) {
    throw new Error('Run the suite from the backend directory')
  }
  const runId = safeRunId(required('LOAD_TEST_RUN_ID'))
  const baseUrl = required('LOAD_TEST_BASE_URL')
  const allowedHosts = required('LOAD_TEST_ALLOWED_HOSTS')
  const fingerprint = required('LOAD_TEST_ENV_FINGERPRINT')
  const contextFile = path.resolve(required('LOAD_TEST_CONTEXT_FILE'))
  const relativeContext = path.relative(backendRoot, contextFile)
  if (relativeContext.startsWith('..') || path.isAbsolute(relativeContext)) {
    throw new Error('LOAD_TEST_CONTEXT_FILE must be inside backend so Docker can mount it read-only')
  }
  const contextInContainer = `/work/${relativeContext.replaceAll('\\', '/')}`
  const reportRoot = path.join(backendRoot, 'load-tests', 'reports', runId)
  if (fs.existsSync(reportRoot)) throw new Error(`Refusing to overwrite existing report directory: ${reportRoot}`)
  fs.mkdirSync(reportRoot, { recursive: true })

  const scenarioDefinitions = [
    ['public', 'load-tests/scenarios/public-auth-devices/scenario.js', 'auto'],
    ['clinical', 'load-tests/scenarios/clinical/runner.js', 'contract'],
    ['admin', 'load-tests/scenarios/admin-platform/runner.js', 'contract'],
    ['legacy', 'load-tests/scenarios/legacy/runner.js', undefined],
  ]

  const executionErrors = []
  let cleanupError
  try {
    for (const [name, entrypoint, operationMode] of scenarioDefinitions) {
      process.stdout.write(`Running ${name} contract surface...\n`)
      try {
        await dockerScenario({
          backendRoot,
          contextInContainer,
          runId,
          baseUrl,
          allowedHosts,
          fingerprint,
          reportRelative: `load-tests/reports/${runId}/${name}`,
          entrypoint,
          operationMode,
        })
      } catch (error) {
        executionErrors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    const sseBaseUrl = String(process.env.LOAD_TEST_SSE_BASE_URL || baseUrl).trim()
    const sseOutput = path.join(reportRoot, 'sse.json')
    try {
      await run(process.execPath, ['load-tests/sse/runner.mjs'], {
        cwd: backendRoot,
        env: {
          ...process.env,
          LOAD_TEST_BASE_URL: sseBaseUrl,
          SSE_OUTPUT_FILE: sseOutput,
        },
      })
    } catch (error) {
      executionErrors.push(`sse: ${error instanceof Error ? error.message : String(error)}`)
    }
  } finally {
    const tsxCli = path.join(backendRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
    try {
      await run(process.execPath, [tsxCli, 'load-tests/fixtures/finalize.ts'], {
        cwd: backendRoot,
        env: {
          ...process.env,
          LOAD_TEST_ALLOWED_HTTP_HOSTS: process.env.LOAD_TEST_ALLOWED_HTTP_HOSTS || allowedHosts,
        },
      })
    } catch (error) {
      cleanupError = error
    }
  }

  const environmentFile = path.join(reportRoot, 'environment.json')
  fs.writeFileSync(environmentFile, `${JSON.stringify({
    name: process.env.LOAD_TEST_ENVIRONMENT_NAME || 'authorized-non-production',
    fingerprint,
    gitSha: process.env.LOAD_TEST_GIT_SHA || 'unknown',
    applicationVersion: process.env.LOAD_TEST_APPLICATION_VERSION || 'unknown',
    region: process.env.LOAD_TEST_REGION || 'local',
  }, null, 2)}\n`)

  const rawFiles = scenarioDefinitions
    .map(([name]) => path.join(reportRoot, name, 'raw-k6.json'))
    .filter(file => fs.existsSync(file))
  const sseFile = path.join(reportRoot, 'sse.json')
  const journal = path.join(required('LOAD_TEST_STATE_DIR'), `${runId}.cleanup-journal.json`)
  const finalOutput = path.join(reportRoot, 'final')
  if (rawFiles.length) {
    const tsxCli = path.join(backendRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
    const mergeArgs = [
      tsxCli, 'load-tests/reporting/merge-results.ts',
      '--inventory', 'load-tests/generated/endpoints.json',
      ...rawFiles.flatMap(file => ['--k6-json', file]),
      ...(fs.existsSync(sseFile) ? ['--sse-json', sseFile] : []),
      '--environment', environmentFile,
      '--cleanup-journal', journal,
      '--output', finalOutput,
    ]
    try {
      await run(process.execPath, mergeArgs, { cwd: backendRoot })
    } catch (error) {
      executionErrors.push(`report: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (cleanupError) throw new Error(`Fixture finalization failed: ${cleanupError.message}`)
  if (executionErrors.length) {
    throw new Error(`One or more suite stages failed after report generation:\n- ${executionErrors.join('\n- ')}`)
  }
  process.stdout.write(`Suite complete: ${path.join(finalOutput, 'report.html')}\n`)
}

main().catch(error => {
  process.stderr.write(`Load-test suite failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
