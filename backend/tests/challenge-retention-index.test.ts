import mongoose from 'mongoose'
import { GenericContainer } from 'testcontainers'
import OtpChallenge from '@alias/models/otpchallenge.model'
import AdminMfaChallenge from '@alias/models/adminmfachallenge.model'
import { ensureAuthGenerationDefaults, ensureChallengeAuditRetention } from '@alias/config/db'
import { AuthSession, User } from '@alias/models'

describe('authentication challenge audit retention', () => {
  test.each([
    ['phone OTP', OtpChallenge],
    ['admin MFA', AdminMfaChallenge],
  ])('%s challenges expire by purge_at rather than validity expiry', (_label, model) => {
    const indexes = model.schema.indexes()
    expect(indexes).toContainEqual([{ purge_at: 1 }, { expireAfterSeconds: 0 }])
    expect(indexes.some(([keys, options]) =>
      keys.expires_at === 1 && options.expireAfterSeconds !== undefined,
    )).toBe(false)
  })

  test('retries pending-MFA index migration when a legacy writer inserts after cleanup', async () => {
    const mongoContainer = await new GenericContainer('mongo:7.0')
      .withExposedPorts(27017)
      .start()
    await mongoose.connect(
      `mongodb://${mongoContainer.getHost()}:${mongoContainer.getMappedPort(27017)}/test`,
      { autoIndex: false },
    )
    const userId = new mongoose.Types.ObjectId()
    const now = new Date()
    await AdminMfaChallenge.collection.insertOne({
      user_id: userId,
      user_type: 'ADMIN',
      status: 'PENDING',
      expires_at: new Date(now.getTime() + 60_000),
      purge_at: new Date(now.getTime() + 86_400_000),
      attempt_count: 0,
      max_attempts: 5,
      factor_generation: 1,
      createdAt: now,
      updatedAt: now,
    })

    const createIndex = AdminMfaChallenge.collection.createIndex.bind(AdminMfaChallenge.collection)
    let injected = false
    const createIndexSpy = jest.spyOn(AdminMfaChallenge.collection, 'createIndex')
      .mockImplementation(async (keys: any, options: any) => {
        if (options?.name === 'one_pending_admin_mfa_challenge_per_user' && !injected) {
          injected = true
          await AdminMfaChallenge.collection.insertOne({
            user_id: userId,
            user_type: 'ADMIN',
            status: 'PENDING',
            expires_at: new Date(now.getTime() + 60_000),
            purge_at: new Date(now.getTime() + 86_400_000),
            attempt_count: 0,
            max_attempts: 5,
            factor_generation: 1,
            createdAt: new Date(now.getTime() + 1),
            updatedAt: new Date(now.getTime() + 1),
          })
        }
        return createIndex(keys, options)
      })

    try {
      await expect(ensureChallengeAuditRetention()).resolves.toBeUndefined()
      expect(injected).toBe(true)
      expect(await AdminMfaChallenge.countDocuments({ user_id: userId, status: 'PENDING' })).toBe(1)
      const indexes = await AdminMfaChallenge.collection.indexes()
      expect(indexes.some(index => index.name === 'one_pending_admin_mfa_challenge_per_user')).toBe(true)
    } finally {
      createIndexSpy.mockRestore()
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
      await mongoContainer.stop()
    }
  }, 60_000)
})

describe('legacy authentication generation migration', () => {
  test('backfills raw legacy users, TOTP factors, and sessions to generation zero', async () => {
    const mongoContainer = await new GenericContainer('mongo:7.0')
      .withExposedPorts(27017)
      .start()
    await mongoose.connect(
      `mongodb://${mongoContainer.getHost()}:${mongoContainer.getMappedPort(27017)}/test`,
      { autoIndex: false },
    )
    const userId = new mongoose.Types.ObjectId()
    const sessionId = new mongoose.Types.ObjectId()
    await User.collection.insertOne({
      _id: userId,
      login_id: 'raw-legacy-admin',
      password: 'legacy-hash',
      salt: 'legacy-salt',
      user_type: 'ADMIN',
      user_type_model: 'AdminProfile',
      profile_id: new mongoose.Types.ObjectId(),
      is_active: true,
      admin_mfa: {
        totp: {
          status: 'ENABLED',
          secret_ciphertext: 'ciphertext',
          secret_iv: 'iv',
          secret_auth_tag: 'tag',
        },
      },
    } as any)
    await AuthSession.collection.insertOne({
      _id: sessionId,
      user_id: userId,
      user_type: 'ADMIN',
      access_token_id: 'legacy-access',
      refresh_token_hash: 'legacy-refresh',
      expires_at: new Date(Date.now() + 60_000),
    } as any)

    try {
      await ensureAuthGenerationDefaults()
      await ensureAuthGenerationDefaults()
      const [user, session] = await Promise.all([
        User.collection.findOne({ _id: userId }),
        AuthSession.collection.findOne({ _id: sessionId }),
      ])
      expect(user?.security_version).toBe(0)
      expect(user?.admin_mfa?.totp?.factor_generation).toBe(0)
      expect(session?.security_version).toBe(0)
    } finally {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
      await mongoContainer.stop()
    }
  }, 60_000)
})
