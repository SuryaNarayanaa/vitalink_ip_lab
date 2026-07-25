import { readFileSync } from 'fs'
import { parse } from 'yaml'
import { HTTP_METHODS, HttpMethod, OpenApiOperation } from './types'
import { normalizePath } from './source-route-parser'

type OpenApiDocument = {
  paths?: Record<string, Record<string, unknown>>
}

const methods = new Set<string>(HTTP_METHODS.map((method) => method.toLowerCase()))

export function extractOpenApiOperations(openApiFile: string): OpenApiOperation[] {
  const document = parse(readFileSync(openApiFile, 'utf8')) as OpenApiDocument
  if (!document || typeof document !== 'object' || !document.paths || typeof document.paths !== 'object') {
    throw new Error(`OpenAPI document has no paths object: ${openApiFile}`)
  }

  const operations: OpenApiOperation[] = []
  for (const [path, pathItem] of Object.entries(document.paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!methods.has(method.toLowerCase())) continue
      const operationObject = operation && typeof operation === 'object' ? operation as Record<string, unknown> : {}
      operations.push({
        method: method.toUpperCase() as HttpMethod,
        path: normalizePath(path),
        operationId: typeof operationObject.operationId === 'string' ? operationObject.operationId : null,
      })
    }
  }

  return operations.sort((left, right) =>
    left.path.localeCompare(right.path) || left.method.localeCompare(right.method))
}
