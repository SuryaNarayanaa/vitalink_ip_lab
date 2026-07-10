describe('Twilio Verify config validation', () => {
  const originalEnv = process.env

  afterEach(() => {
    process.env = originalEnv
    jest.resetModules()
  })

  test('requires Twilio Verify credentials in staging', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'staging',
      // Keep other staging-required secrets set so this test isolates Twilio vars.
      ADMIN_TOTP_ENCRYPTION_KEY: 'test-only-admin-totp-encryption-key-32b',
      TWILIO_ACCOUNT_SID: '',
      TWILIO_AUTH_TOKEN: '',
      TWILIO_VERIFY_SERVICE_SID: '',
    }
    jest.resetModules()

    expect(() => require('@alias/config')).toThrow('Missing required environment variable in staging: TWILIO_ACCOUNT_SID')
  })

  test('does not require Twilio Verify credentials in test', () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      TWILIO_ACCOUNT_SID: '',
      TWILIO_AUTH_TOKEN: '',
      TWILIO_VERIFY_SERVICE_SID: '',
    }
    jest.resetModules()

    expect(() => require('@alias/config')).not.toThrow()
  })
})
