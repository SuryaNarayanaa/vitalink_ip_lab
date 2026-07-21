import { User } from '@alias/models'
import { createAdminTotpBootstrapEnrollment } from '@alias/services/admin-totp.service'

describe('admin TOTP bootstrap enrollment', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test.each(['DISABLED', 'PENDING'])('stores only encrypted pending material from %s state', async (status) => {
    const admin = {
      _id: '507f1f77bcf86cd799439011',
      login_id: 'bootstrap-admin',
      user_type: 'ADMIN',
      is_active: true,
      security_version: 3,
      admin_mfa: { totp: { status, factor_generation: 2 } },
    }
    jest.spyOn(User, 'findOne').mockResolvedValue(admin as any)
    const update = jest.spyOn(User, 'updateOne').mockResolvedValue({ modifiedCount: 1 } as any)

    const enrollment = await createAdminTotpBootstrapEnrollment(admin)

    expect(enrollment.secret).toMatch(/^[A-Z2-7]+$/)
    expect(enrollment.otpauth_url).toContain(`secret=${enrollment.secret}`)
    const persistedUpdate = update.mock.calls[0][1] as any
    expect(persistedUpdate.$set['admin_mfa.totp.status']).toBe('PENDING')
    expect(persistedUpdate.$set['admin_mfa.totp.pending_secret_ciphertext']).toBeDefined()
    expect(JSON.stringify(persistedUpdate)).not.toContain(enrollment.secret)
    expect(persistedUpdate.$unset).toMatchObject({
      'admin_mfa.totp.secret_ciphertext': '',
      'admin_mfa.totp.last_verified_time_step': '',
    })
  })

  test('refuses to rotate an enabled factor', async () => {
    const admin = {
      _id: '507f1f77bcf86cd799439012',
      login_id: 'enabled-admin',
      user_type: 'ADMIN',
      is_active: true,
      security_version: 4,
      admin_mfa: { totp: { status: 'ENABLED', factor_generation: 5 } },
    }
    jest.spyOn(User, 'findOne').mockResolvedValue(admin as any)
    const update = jest.spyOn(User, 'updateOne')

    await expect(createAdminTotpBootstrapEnrollment(admin)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Admin TOTP is already enabled',
    })
    expect(update).not.toHaveBeenCalled()
  })
})
