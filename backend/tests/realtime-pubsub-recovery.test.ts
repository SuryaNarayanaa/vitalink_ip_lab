import { describe, expect, test, beforeEach, afterEach, jest } from '@jest/globals'

type Handler = (...args: any[]) => void

describe('realtime pub/sub recovery after subscriber termination', () => {
  const handlers = new Map<string, Set<Handler>>()
  let connectCount = 0

  const mockSub = {
    status: 'ready' as string,
    on: jest.fn((event: string, handler: Handler) => {
      const set = handlers.get(event) ?? new Set<Handler>()
      set.add(handler)
      handlers.set(event, set)
      return mockSub
    }),
    off: jest.fn((event: string, handler: Handler) => {
      handlers.get(event)?.delete(handler)
      return mockSub
    }),
    psubscribe: jest.fn(async () => {
      connectCount += 1
    }),
    emit(event: string, ...args: any[]) {
      for (const handler of [...(handlers.get(event) ?? [])]) handler(...args)
    },
  }

  beforeEach(() => {
    jest.resetModules()
    handlers.clear()
    connectCount = 0
    mockSub.status = 'ready'
    mockSub.on.mockClear()
    mockSub.off.mockClear()
    mockSub.psubscribe.mockClear()

    jest.doMock('@alias/config/redis', () => ({
      isRedisConfigured: () => true,
      getRedisSubscriber: () => mockSub,
      getRedisClient: () => null,
      ensureRedisConnected: async () => true,
      resetRedisSubscriberForTests: jest.fn(),
    }))
  })

  afterEach(() => {
    jest.dontMock('@alias/config/redis')
    jest.resetModules()
  })

  test('clears subscription state on end and resubscribes on the next ensure', async () => {
    const realtime = await import('@alias/services/realtime-notification.service')

    await realtime.ensureRealtimePubSub()
    expect(connectCount).toBe(1)
    expect(realtime.__isPubSubInitializedForTests()).toBe(true)

    // Simulate Redis subscriber termination after reconnect exhaustion.
    mockSub.emit('end')
    expect(realtime.__isPubSubInitializedForTests()).toBe(false)

    await realtime.ensureRealtimePubSub()
    expect(connectCount).toBe(2)
    expect(realtime.__isPubSubInitializedForTests()).toBe(true)

    realtime.__resetPubSubStateForTests()
  })
})
