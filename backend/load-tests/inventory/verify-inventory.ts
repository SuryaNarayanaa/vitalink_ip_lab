import { existsSync, readFileSync } from 'fs'
import { buildInventory, reconcileInventory, resolveInventoryPaths, serializeInventory } from './inventory'

function assertContains(haystack: Set<string>, needle: string, description: string, errors: string[]): void {
  if (!haystack.has(needle)) errors.push(`Parser self-test failed (${description}): missing ${needle}`)
}

function main(): void {
  const paths = resolveInventoryPaths()
  const manifest = buildInventory(paths)
  const errors = reconcileInventory(manifest)
  const explicit = new Set(manifest.explicitEndpoints.map((endpoint) => endpoint.id))

  // These current-source sentinels prove direct routes, recursive mounts, chained methods,
  // global routes, canonical/legacy expansion, and the Nginx edge route are all observed.
  assertContains(explicit, 'GET /api/v1/doctors/patients/{op_num}/reports/{report_id}', 'chained GET', errors)
  assertContains(explicit, 'PUT /api/v1/doctors/patients/{op_num}/reports/{report_id}', 'chained PUT', errors)
  assertContains(explicit, 'GET /api/doctors/patients/{op_num}/reports/{report_id}', 'legacy recursive mount', errors)
  assertContains(explicit, 'POST /api/v1/webhooks/payment', 'root router direct route', errors)
  assertContains(explicit, 'GET /health/ready', 'global application route', errors)
  assertContains(explicit, 'GET /nginx-health', 'Nginx edge route', errors)

  if (manifest.conditionalEndpoints.length !== 5) {
    errors.push(`Expected 5 separately represented documentation surfaces; found ${manifest.conditionalEndpoints.length}`)
  }
  if (!manifest.derivedProtocolChecks.some((check) => check.kind === 'express-head')) {
    errors.push('No derived Express HEAD checks were generated')
  }
  if (!manifest.derivedProtocolChecks.some((check) => check.kind === 'cors-preflight')) {
    errors.push('No derived CORS OPTIONS checks were generated')
  }
  if (manifest.derivedProtocolChecks.filter((check) => check.kind === 'sse-stream').length !== 4) {
    errors.push('Expected four canonical/legacy SSE protocol checks')
  }

  if (!existsSync(paths.generatedFile)) {
    errors.push(`Generated manifest is missing: ${paths.generatedFile}`)
  } else {
    const committed = readFileSync(paths.generatedFile, 'utf8')
    const expected = serializeInventory(manifest)
    if (committed !== expected) {
      errors.push('Generated endpoint manifest is stale; run generate-inventory.ts')
    }
  }

  if (errors.length > 0) {
    process.stderr.write(`Endpoint inventory verification failed:\n- ${errors.join('\n- ')}\n`)
    process.exitCode = 1
    return
  }

  process.stdout.write(
    `Endpoint inventory verified: ${manifest.counts.canonical} canonical operations exactly match ` +
    `${manifest.counts.openApiOperations} OpenAPI operations; mandatory explicit total=${manifest.counts.mandatoryExplicit}.\n`,
  )
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
}
