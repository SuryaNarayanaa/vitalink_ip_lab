export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

export type HttpMethod = (typeof HTTP_METHODS)[number]
export type ExplicitScope = 'canonical' | 'legacy' | 'global' | 'edge'

export interface SourceRoute {
  method: HttpMethod
  path: string
  sourceFile: string
  sourceLine: number
}

export interface OpenApiOperation {
  method: HttpMethod
  path: string
  operationId: string | null
}

export interface ExplicitEndpoint extends SourceRoute {
  id: string
  scope: ExplicitScope
  canonicalId: string | null
  openApiPath: string | null
  openApiOperationId: string | null
}

export interface ConditionalEndpoint {
  id: string
  method: 'GET' | 'HEAD'
  path: string
  condition: string
  kind: 'documentation' | 'documentation-spec' | 'documentation-asset'
  sourceFile: string
}

export interface DerivedProtocolCheck {
  id: string
  method: 'HEAD' | 'OPTIONS' | 'GET'
  path: string
  kind: 'express-head' | 'cors-preflight' | 'sse-stream' | 'api-not-found-fallback'
  derivedFromEndpointIds: string[]
}

export interface InventoryManifest {
  schemaVersion: 1
  sourceDigest: string
  sources: {
    application: string
    routerRoot: string
    openApi: string
    nginx: string
  }
  defaults: {
    apiVersion: string
    apiDocsEnabledByDefault: {
      nonProduction: boolean
      production: boolean
    }
    apiDocsPath: string
  }
  counts: {
    canonical: number
    legacy: number
    global: number
    edge: number
    mandatoryExplicit: number
    openApiOperations: number
    conditional: number
    derivedProtocolChecks: number
  }
  explicitEndpoints: ExplicitEndpoint[]
  conditionalEndpoints: ConditionalEndpoint[]
  derivedProtocolChecks: DerivedProtocolCheck[]
}
