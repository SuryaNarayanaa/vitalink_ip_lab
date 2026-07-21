describe('FileAsset legacy cutoff config validation', () => {
  const originalEnv = process.env

  afterEach(() => {
    process.env = originalEnv
    jest.resetModules()
  })

  test('requires an explicit cutoff in production', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      MONGO_URI: 'mongodb://example.invalid/vitalink',
      JWT_SECRET: 'production-test-secret',
      ACCESS_KEY_ID: 'test-access-key',
      SECRET_ACCESS_KEY: 'test-secret-key',
      S3_BUCKET_NAME: 'test-bucket',
      FILE_ASSET_LEGACY_CUTOFF_AT: '',
    }
    jest.resetModules()

    expect(() => require('@alias/config'))
      .toThrow('Missing required environment variable in production: FILE_ASSET_LEGACY_CUTOFF_AT')
  })

  test('rejects a non-ISO or invalid cutoff timestamp', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      FILE_ASSET_LEGACY_CUTOFF_AT: 'not-a-date',
    }
    jest.resetModules()

    expect(() => require('@alias/config'))
      .toThrow('Invalid ISO timestamp for environment variable FILE_ASSET_LEGACY_CUTOFF_AT')
  })

  test.each([
    '2026-02-30T00:00:00Z',
    '2026-01-01T24:00:00Z',
    '2026-01-01T00:00:00+14:30',
  ])('rejects impossible ISO calendar or time value %s', (cutoff) => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      FILE_ASSET_LEGACY_CUTOFF_AT: cutoff,
    }
    jest.resetModules()

    expect(() => require('@alias/config'))
      .toThrow('Invalid ISO timestamp for environment variable FILE_ASSET_LEGACY_CUTOFF_AT')
  })

  test('accepts a valid leap-day cutoff', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      FILE_ASSET_LEGACY_CUTOFF_AT: '2028-02-29T23:59:59.999+05:30',
    }
    jest.resetModules()

    const { config } = require('@alias/config')
    expect(config.fileAssetLegacyCutoffAt.toISOString()).toBe('2028-02-29T18:29:59.999Z')
  })

  test('allows the deterministic development/test default', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      FILE_ASSET_LEGACY_CUTOFF_AT: '',
    }
    jest.resetModules()

    const { config } = require('@alias/config')
    expect(config.fileAssetLegacyCutoffAt.toISOString()).toBe('2100-01-01T00:00:00.000Z')
  })

  test('reports a missing malware scanner URL in production even when not explicitly enabled', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      MONGO_URI: 'mongodb://example.invalid/vitalink',
      JWT_SECRET: 'production-test-secret',
      ACCESS_KEY_ID: 'test-access-key',
      SECRET_ACCESS_KEY: 'test-secret-key',
      S3_BUCKET_NAME: 'test-bucket',
      FILE_ASSET_LEGACY_CUTOFF_AT: '2026-07-16T00:00:00.000Z',
      ADMIN_TOTP_ENCRYPTION_KEY: 'test-only-admin-totp-encryption-key-32b',
      TWILIO_ACCOUNT_SID: 'AC-test',
      TWILIO_AUTH_TOKEN: 'test-token',
      TWILIO_VERIFY_SERVICE_SID: 'VA-test',
      MALWARE_SCAN_URL: '',
    }
    delete process.env.MALWARE_SCAN_ENABLED
    jest.resetModules()

    const { getMissingEnvironmentVariables, config } = require('@alias/config')
    expect(config.malwareScanEnabled).toBe(true)
    expect(getMissingEnvironmentVariables()).toContain('MALWARE_SCAN_URL')
  })

  test('rejects explicitly disabled malware scanning in production readiness', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      MONGO_URI: 'mongodb://example.invalid/vitalink',
      JWT_SECRET: 'production-test-secret',
      ACCESS_KEY_ID: 'test-access-key',
      SECRET_ACCESS_KEY: 'test-secret-key',
      S3_BUCKET_NAME: 'test-bucket',
      FILE_ASSET_LEGACY_CUTOFF_AT: '2026-07-16T00:00:00.000Z',
      ADMIN_TOTP_ENCRYPTION_KEY: 'test-only-admin-totp-encryption-key-32b',
      TWILIO_ACCOUNT_SID: 'AC-test',
      TWILIO_AUTH_TOKEN: 'test-token',
      TWILIO_VERIFY_SERVICE_SID: 'VA-test',
      MALWARE_SCAN_ENABLED: 'false',
      MALWARE_SCAN_URL: 'https://scanner.example/scan',
    }
    jest.resetModules()

    const { getMissingEnvironmentVariables } = require('@alias/config')
    expect(getMissingEnvironmentVariables()).toEqual(
      expect.arrayContaining([expect.stringContaining('MALWARE_SCAN_ENABLED')]),
    )
  })

  test.each(['scanner.internal/scan', 'http://scanner.internal/scan'])('rejects non-absolute or non-HTTPS scanner URL %s', (url) => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      MALWARE_SCAN_ENABLED: 'true',
      MALWARE_SCAN_URL: url,
    }
    jest.resetModules()
    expect(() => require('@alias/config')).toThrow(/absolute URL|use HTTPS/)
  })
})
