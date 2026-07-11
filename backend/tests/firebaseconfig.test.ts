describe('Firebase Auth config validation', () => {
  const originalEnv = process.env

  afterEach(() => {
    process.env = originalEnv
    jest.resetModules()
  })

  test('reports a missing service account when Firebase Auth is enabled in staging', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'staging',
      ADMIN_TOTP_ENCRYPTION_KEY: 'test-only-admin-totp-encryption-key-32b',
      FILE_ASSET_LEGACY_CUTOFF_AT: '2026-07-11T00:00:00.000Z',
      FIREBASE_AUTH_ENABLED: 'true',
      FIREBASE_SERVICE_ACCOUNT: '',
    }
    jest.resetModules()

    const { getMissingEnvironmentVariables } = require('@alias/config')
    expect(getMissingEnvironmentVariables()).toContain('FIREBASE_SERVICE_ACCOUNT')
  })

  test('does not require Firebase credentials when Auth and FCM are disabled', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      FIREBASE_AUTH_ENABLED: 'false',
      FCM_ENABLED: 'false',
      FIREBASE_SERVICE_ACCOUNT: '',
    }
    jest.resetModules()

    expect(() => require('@alias/config')).not.toThrow()
  })

  test('reports Firebase Auth disabled without initializing credentials', () => {
    process.env = {
      ...originalEnv,
      FIREBASE_AUTH_ENABLED: 'false',
      FIREBASE_SERVICE_ACCOUNT: '',
    }
    jest.resetModules()

    const { getFirebaseAuthHealth } = require('@alias/config/firebase.config')
    expect(getFirebaseAuthHealth()).toEqual({ enabled: false, state: 'disabled' })
  })

  test('reports malformed Firebase Auth credentials as a readiness failure', () => {
    process.env = {
      ...originalEnv,
      FIREBASE_AUTH_ENABLED: 'true',
      FIREBASE_SERVICE_ACCOUNT: 'not-json',
    }
    jest.resetModules()

    const { getFirebaseAuthHealth } = require('@alias/config/firebase.config')
    expect(getFirebaseAuthHealth()).toEqual(expect.objectContaining({
      enabled: true,
      state: 'failed',
      error: 'FIREBASE_SERVICE_ACCOUNT must be valid JSON',
    }))
  })
})
