import { mkdirSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { buildInventory, reconcileInventory, resolveInventoryPaths, serializeInventory } from './inventory'

function main(): void {
  const paths = resolveInventoryPaths()
  const manifest = buildInventory(paths)
  const errors = reconcileInventory(manifest)
  if (errors.length > 0) {
    throw new Error(`Endpoint inventory reconciliation failed:\n- ${errors.join('\n- ')}`)
  }

  mkdirSync(dirname(paths.generatedFile), { recursive: true })
  writeFileSync(paths.generatedFile, serializeInventory(manifest), 'utf8')
  process.stdout.write(
    `Generated ${paths.generatedFile}\n` +
    `canonical=${manifest.counts.canonical} legacy=${manifest.counts.legacy} ` +
    `global=${manifest.counts.global} edge=${manifest.counts.edge} ` +
    `mandatory=${manifest.counts.mandatoryExplicit}\n`,
  )
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
}
