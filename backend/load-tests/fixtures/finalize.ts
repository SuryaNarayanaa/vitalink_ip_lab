// Intentionally a separate process entrypoint. CI cancellation handlers and
// operators can invoke it after the load generator is gone.
import { cleanupFixtures } from './cleanup'

cleanupFixtures().catch(error => {
  process.stderr.write(`Out-of-process fixture finalizer failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})

