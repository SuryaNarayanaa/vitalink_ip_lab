import { loadGuardedEnvironment } from '../fixtures/guards'

export type GuardedMutationEnvironment = ReturnType<typeof loadGuardedEnvironment> & {
  secret: string
}

export function loadGuardedMutationEnvironment(): GuardedMutationEnvironment {
  const environment = loadGuardedEnvironment({ requireDatabase: true })
  if (process.env.ALLOW_DESTRUCTIVE_LOAD !== 'true') {
    throw new Error('ALLOW_DESTRUCTIVE_LOAD=true is required for dynamic mutation coordination')
  }
  const secret = process.env.LOAD_TEST_MUTATION_SECRET ?? ''
  if (secret.length < 32) {
    throw new Error('LOAD_TEST_MUTATION_SECRET must be at least 32 characters and supplied only through the environment')
  }
  return { ...environment, secret }
}
