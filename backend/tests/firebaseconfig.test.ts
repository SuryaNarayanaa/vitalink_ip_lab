describe('Firebase configuration boundary', () => {
  const originalEnv = process.env

  afterEach(() => {
    process.env = originalEnv
    jest.resetModules()
  })

  test('app imports safely when Firebase is disabled and credentials are unset', () => {
    process.env = { ...originalEnv, NODE_ENV: 'test', FCM_ENABLED: 'false' }
    delete process.env.FIREBASE_SERVICE_ACCOUNT
    jest.resetModules()

    expect(() => require('@alias/app')).not.toThrow()
  })

  test('enabled Firebase reports missing credentials intentionally', () => {
    process.env = { ...originalEnv, NODE_ENV: 'test', FCM_ENABLED: 'true' }
    delete process.env.FIREBASE_SERVICE_ACCOUNT
    jest.resetModules()

    const { initializeFirebaseMessaging } = require('@alias/config/firebase.config')
    expect(() => initializeFirebaseMessaging())
      .toThrow('FCM_ENABLED is true but FIREBASE_SERVICE_ACCOUNT is missing')
  })

  test('enabled Firebase rejects malformed credential JSON', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      FCM_ENABLED: 'true',
      FIREBASE_SERVICE_ACCOUNT: '{bad-json',
    }
    jest.resetModules()

    const { initializeFirebaseMessaging } = require('@alias/config/firebase.config')
    expect(() => initializeFirebaseMessaging())
      .toThrow('FIREBASE_SERVICE_ACCOUNT must be valid JSON')
  })
})
