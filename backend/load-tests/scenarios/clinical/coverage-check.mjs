import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CLINICAL_OPERATIONS, assertClinicalCoverage } from './descriptors.js'

const inventoryPath = fileURLToPath(new URL('../../generated/endpoints.json', import.meta.url))
const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'))
const expected = inventory.explicitEndpoints
  .filter(endpoint => endpoint.scope === 'canonical' && (/^\/api\/v1\/doctors(?:\/|$)/.test(endpoint.path) || /^\/api\/v1\/patient(?:\/|$)/.test(endpoint.path)))
  .map(endpoint => endpoint.id)

const coverage = assertClinicalCoverage(expected)
const sse = CLINICAL_OPERATIONS.filter(operation => operation.protocol === 'sse').map(operation => operation.id)
process.stdout.write(`${JSON.stringify({ ...coverage, sse }, null, 2)}\n`)
