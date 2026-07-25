export type VuFixtureContext = Readonly<{
  poolIndex: number
  accessToken: string
  userId: string
  profileId: string
  mutableIds: Readonly<Record<string, string>>
}>

export function selectExclusiveVuContext(
  pool: readonly VuFixtureContext[] | undefined,
  vuId: number,
  configuredMaxVus: number,
): VuFixtureContext {
  if (!Number.isSafeInteger(vuId) || vuId < 1) throw new Error('k6 VU ID must be a positive integer')
  if (!Number.isSafeInteger(configuredMaxVus) || configuredMaxVus < 1) {
    throw new Error('Configured maximum VUs must be a positive integer')
  }
  if (!Array.isArray(pool) || pool.length < configuredMaxVus) {
    throw new Error(
      `Valid mutation load requires at least ${configuredMaxVus} exclusive fixture contexts; `
      + `received ${pool?.length ?? 0}`,
    )
  }
  const context = pool[vuId - 1]
  if (!context || context.poolIndex !== vuId - 1) {
    throw new Error(`No exclusive fixture context exists for VU ${vuId}`)
  }
  if (!context.accessToken || !context.userId || !context.profileId) {
    throw new Error(`VU ${vuId} fixture context is incomplete`)
  }
  return context
}
