import mongoose from 'mongoose'
import { GenericContainer, StartedTestContainer } from 'testcontainers'
import { AdminMfaChallenge, AdminProfile, User } from '@alias/models'
import { AdminMfaChallengeStatus } from '@alias/models/adminmfachallenge.model'
import {
  createAdminMfaLoginChallenge,
  createAdminTotpEnrollment,
  generateTotpCode,
  replaceAdminTotpForRecovery,
  verifyAdminMfaLoginChallenge,
} from '@alias/services/admin-totp.service'

describe('admin TOTP supervised recovery concurrency', () => {
  let mongoContainer: StartedTestContainer

  beforeAll(async () => {
    mongoContainer = await new GenericContainer('mongo:7.0').withExposedPorts(27017).start()
    await mongoose.connect(
      `mongodb://${mongoContainer.getHost()}:${mongoContainer.getMappedPort(27017)}/test`,
    )
  }, 60_000)

  afterAll(async () => {
    await mongoose.connection.dropDatabase()
    await mongoose.disconnect()
    await mongoContainer.stop()
  })

  const createAdmin = async (loginId: string) => {
    const profile = await AdminProfile.create({ name: loginId })
    return User.create({
      login_id: loginId,
      password: 'Recovery@123',
      user_type: 'ADMIN',
      profile_id: profile._id,
      is_active: true,
      admin_mfa: { totp: { status: 'DISABLED', factor_generation: 0 } },
    })
  }

  test('returns setup material only to the single winning concurrent reset', async () => {
    const admin = await createAdmin('concurrent-recovery-admin')
    const originalUpdate = User.updateOne.bind(User)
    let arrivals = 0
    let release!: () => void
    const bothArrived = new Promise<void>(resolve => { release = resolve })
    const spy = jest.spyOn(User, 'updateOne').mockImplementation(((...args: any[]) => {
      if (args[0]?.['admin_mfa.totp.factor_generation'] !== undefined && args[1]?.$inc?.security_version) {
        arrivals += 1
        if (arrivals === 2) release()
        return (async () => {
          await bothArrived
          return originalUpdate(...args) as any
        })() as any
      }
      return originalUpdate(...args) as any
    }) as any)

    try {
      const results = await Promise.allSettled([
        replaceAdminTotpForRecovery(admin),
        replaceAdminTotpForRecovery(admin),
      ])
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
      expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.statusCode).toBe(409)
      const stored = await User.findById(admin._id).lean()
      expect(stored?.security_version).toBe(1)
      expect(stored?.admin_mfa?.totp?.factor_generation).toBe(1)
    } finally {
      spy.mockRestore()
    }
  })

  test('returns conflict and retains pending challenges when deactivation wins before replacement', async () => {
    const admin = await createAdmin('deactivated-recovery-admin')
    const challenge = await AdminMfaChallenge.create({
      user_id: admin._id,
      user_type: 'ADMIN',
      status: AdminMfaChallengeStatus.PENDING,
      expires_at: new Date(Date.now() + 60_000),
      max_attempts: 5,
      factor_generation: 0,
      security_version: Number(admin.security_version || 0),
    })
    const originalUpdate = User.updateOne.bind(User)
    let deactivated = false
    const spy = jest.spyOn(User, 'updateOne').mockImplementation(((...args: any[]) => {
      if (!deactivated && args[0]?.['admin_mfa.totp.factor_generation'] !== undefined) {
        deactivated = true
        return (async () => {
          await User.collection.updateOne({ _id: admin._id }, { $set: { is_active: false } })
          return originalUpdate(...args) as any
        })() as any
      }
      return originalUpdate(...args) as any
    }) as any)
    try {
      await expect(replaceAdminTotpForRecovery(admin)).rejects.toMatchObject({ statusCode: 409 })
      expect((await AdminMfaChallenge.findById(challenge._id))?.status).toBe(AdminMfaChallengeStatus.PENDING)
    } finally {
      spy.mockRestore()
    }
  })

  test('supervised recovery atomically supersedes a lost pending enrollment with usable setup', async () => {
    const admin = await createAdmin('pending-recovery-admin')
    const abandoned = await createAdminTotpEnrollment(admin)
    const pendingBefore: any = await User.findById(admin._id).lean()
    expect(pendingBefore?.admin_mfa?.totp?.status).toBe('PENDING')

    const replacement = await replaceAdminTotpForRecovery(admin)
    expect(replacement.secret).not.toBe(abandoned.secret)
    const stored: any = await User.findById(admin._id).lean()
    expect(stored?.admin_mfa?.totp?.status).toBe('ENABLED')
    expect(stored?.admin_mfa?.totp?.factor_generation).toBe(1)
    expect(stored?.security_version).toBe(1)
    expect(stored?.admin_mfa?.totp?.pending_secret_ciphertext).toBeUndefined()

    const challenge = await createAdminMfaLoginChallenge(stored)
    const verified = await verifyAdminMfaLoginChallenge(
      String(challenge._id),
      generateTotpCode(replacement.secret),
    )
    expect(String(verified._id)).toBe(String(admin._id))
  })

  test('returns the committed recovery secret when obsolete challenge cleanup fails', async () => {
    const admin = await createAdmin('cleanup-failure-recovery-admin')
    const challenge = await AdminMfaChallenge.create({
      user_id: admin._id, user_type: 'ADMIN', status: AdminMfaChallengeStatus.PENDING,
      expires_at: new Date(Date.now() + 60_000), max_attempts: 5,
      factor_generation: 0, security_version: 0,
    })
    const cleanup = jest.spyOn(AdminMfaChallenge, 'updateMany').mockRejectedValueOnce(new Error('cleanup unavailable'))
    try {
      const replacement = await replaceAdminTotpForRecovery(admin)
      expect(replacement.secret).toMatch(/^[A-Z2-7]+$/)
      expect(replacement.challenge_cleanup_completed).toBe(false)
      const stored: any = await User.findById(admin._id).lean()
      expect(stored.security_version).toBe(1)
      expect(stored.admin_mfa.totp.factor_generation).toBe(1)
      expect((await AdminMfaChallenge.findById(challenge._id))?.status).toBe(AdminMfaChallengeStatus.PENDING)
      await expect(verifyAdminMfaLoginChallenge(
        String(challenge._id), generateTotpCode(replacement.secret),
      )).rejects.toBeDefined()
    } finally {
      cleanup.mockRestore()
    }
  })
})
