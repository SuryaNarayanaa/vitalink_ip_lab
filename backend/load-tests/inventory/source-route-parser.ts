import { existsSync, readFileSync } from 'fs'
import { dirname, relative, resolve } from 'path'
import ts from 'typescript'
import { HTTP_METHODS, HttpMethod, SourceRoute } from './types'

interface ParsedFile {
  routes: SourceRoute[]
  mounts: Array<{ prefix: string; importedFile: string; sourceLine: number }>
}

const METHOD_SET = new Set<string>(HTTP_METHODS.map((method) => method.toLowerCase()))

function sourceLine(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function normalizeSourceFile(repositoryRoot: string, filePath: string): string {
  return relative(repositoryRoot, filePath).replace(/\\/g, '/')
}

function propertyName(expression: ts.Expression): string | null {
  return ts.isPropertyAccessExpression(expression) ? expression.name.text : null
}

function receiverIdentifier(expression: ts.Expression): string | null {
  if (!ts.isPropertyAccessExpression(expression)) return null
  return ts.isIdentifier(expression.expression) ? expression.expression.text : null
}

function evaluatePath(expression: ts.Expression | undefined, values: ReadonlyMap<string, string>): string | null {
  if (!expression) return null
  if (ts.isStringLiteralLike(expression)) return expression.text

  if (ts.isTemplateExpression(expression)) {
    let value = expression.head.text
    for (const span of expression.templateSpans) {
      const key = span.expression.getText()
      const replacement = values.get(key)
      if (replacement === undefined) return null
      value += replacement + span.literal.text
    }
    return value
  }

  return null
}

function resolveRelativeImport(containingFile: string, moduleName: string): string {
  const base = resolve(dirname(containingFile), moduleName)
  if (/\.[cm]?[jt]sx?$/.test(base)) return base
  const candidates = [`${base}.ts`, resolve(base, 'index.ts')]
  const resolved = candidates.find((candidate) => existsSync(candidate))
  if (!resolved) throw new Error(`Unable to resolve relative import ${moduleName} from ${containingFile}`)
  return resolved
}

function parseChainedRoute(
  call: ts.CallExpression,
  routerNames: ReadonlySet<string>,
  values: ReadonlyMap<string, string>,
): { path: string; methods: HttpMethod[] } | null {
  const methods: HttpMethod[] = []
  let cursor: ts.Expression = call

  while (ts.isCallExpression(cursor) && ts.isPropertyAccessExpression(cursor.expression)) {
    const name = cursor.expression.name.text.toLowerCase()
    const target = cursor.expression.expression

    if (name === 'route') {
      if (!ts.isIdentifier(target) || !routerNames.has(target.text)) return null
      const path = evaluatePath(cursor.arguments[0], values)
      return path ? { path, methods: methods.reverse() } : null
    }

    if (!METHOD_SET.has(name)) return null
    methods.push(name.toUpperCase() as HttpMethod)
    cursor = target
  }

  return null
}

function parseRouterFile(
  filePath: string,
  repositoryRoot: string,
  values: ReadonlyMap<string, string>,
): ParsedFile {
  const sourceText = readFileSync(filePath, 'utf8')
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const imports = new Map<string, string>()
  const routerNames = new Set<string>()
  const routes: SourceRoute[] = []
  const mounts: ParsedFile['mounts'] = []
  const normalizedFile = normalizeSourceFile(repositoryRoot, filePath)

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const moduleName = statement.moduleSpecifier.text
      if (!moduleName.startsWith('.')) continue
      const importClause = statement.importClause
      if (importClause?.name) {
        imports.set(importClause.name.text, resolveRelativeImport(filePath, moduleName))
      }
      if (importClause?.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
        for (const element of importClause.namedBindings.elements) {
          imports.set(element.name.text, resolveRelativeImport(filePath, moduleName))
        }
      }
      continue
    }

    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) {
        continue
      }
      const callee = declaration.initializer.expression
      if (ts.isIdentifier(callee) && (callee.text === 'Router' || callee.text === 'express')) {
        routerNames.add(declaration.name.text)
      }
    }
  }

  const seenRoutes = new Set<string>()
  const seenMounts = new Set<string>()
  const addRoute = (method: HttpMethod, path: string, node: ts.Node) => {
    const key = `${method} ${path}`
    if (seenRoutes.has(key)) return
    seenRoutes.add(key)
    routes.push({ method, path, sourceFile: normalizedFile, sourceLine: sourceLine(sourceFile, node) })
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const chain = parseChainedRoute(node, routerNames, values)
      if (chain) {
        for (const method of chain.methods) addRoute(method, chain.path, node)
      } else {
        const methodName = propertyName(node.expression)?.toLowerCase()
        const receiver = receiverIdentifier(node.expression)
        if (methodName && receiver && routerNames.has(receiver) && METHOD_SET.has(methodName)) {
          const path = evaluatePath(node.arguments[0], values)
          if (path) addRoute(methodName.toUpperCase() as HttpMethod, path, node)
        }

        if (methodName === 'use' && receiver && routerNames.has(receiver)) {
          const prefix = evaluatePath(node.arguments[0], values)
          if (prefix !== null) {
            for (const argument of node.arguments.slice(1)) {
              if (!ts.isIdentifier(argument)) continue
              const importedFile = imports.get(argument.text)
              if (!importedFile) continue
              const key = `${prefix}\0${importedFile}`
              if (seenMounts.has(key)) continue
              seenMounts.add(key)
              mounts.push({ prefix, importedFile, sourceLine: sourceLine(sourceFile, node) })
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { routes, mounts }
}

export function normalizePath(path: string): string {
  const withLeadingSlash = path.startsWith('/') ? path : `/${path}`
  const normalized = withLeadingSlash
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/:([A-Za-z0-9_]+)/g, '{$1}')
  return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized
}

export function joinRoutePaths(prefix: string, suffix: string): string {
  if (prefix === '/') return normalizePath(suffix)
  if (suffix === '/') return normalizePath(prefix)
  return normalizePath(`${prefix}/${suffix}`)
}

export function extractRouterRoutes(
  rootRouterFile: string,
  repositoryRoot: string,
  values: ReadonlyMap<string, string>,
): SourceRoute[] {
  const activeStack = new Set<string>()

  const expand = (filePath: string, prefix: string): SourceRoute[] => {
    const absoluteFile = resolve(filePath)
    if (activeStack.has(absoluteFile)) {
      throw new Error(`Circular Express router mount detected at ${absoluteFile}`)
    }
    activeStack.add(absoluteFile)
    const parsed = parseRouterFile(absoluteFile, repositoryRoot, values)
    const result = parsed.routes.map((route) => ({ ...route, path: joinRoutePaths(prefix, route.path) }))
    for (const mount of parsed.mounts) {
      result.push(...expand(mount.importedFile, joinRoutePaths(prefix, mount.prefix)))
    }
    activeStack.delete(absoluteFile)
    return result
  }

  return expand(rootRouterFile, '/')
}

export function extractDirectApplicationRoutes(
  appFile: string,
  repositoryRoot: string,
  values: ReadonlyMap<string, string>,
): SourceRoute[] {
  const parsed = parseRouterFile(appFile, repositoryRoot, values)
  return parsed.routes.map((route) => ({ ...route, path: normalizePath(route.path) }))
}

export function extractApplicationRouterMounts(
  appFile: string,
  repositoryRoot: string,
  values: ReadonlyMap<string, string>,
): Array<{ prefix: string; routes: SourceRoute[] }> {
  const parsed = parseRouterFile(appFile, repositoryRoot, values)
  return parsed.mounts.map((mount) => ({
    prefix: normalizePath(mount.prefix),
    routes: extractRouterRoutes(mount.importedFile, repositoryRoot, values)
      .map((route) => ({ ...route, path: joinRoutePaths(mount.prefix, route.path) })),
  }))
}
