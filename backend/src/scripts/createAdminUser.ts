import 'dotenv/config'
import mongoose from 'mongoose'
import { createInterface } from 'readline/promises'
import { config } from '@alias/config'
import { User, AdminProfile, AuditLog } from '@alias/models'
import { AdminRole } from '@alias/models/adminprofile.model'
import { AuditAction } from '@alias/models/auditlog.model'
import {
  activateAdminTotpEnrollment,
  createAdminTotpBootstrapEnrollment,
  isAdminTotpEnabled,
} from '@alias/services/admin-totp.service'

type BootstrapResult = {
  status: 'ALREADY_ENABLED' | 'ENABLED'
  created: boolean
  userId: string
}

type BootstrapOptions = {
  loginId: string
  password?: string
  deliverEnrollment: (otpauthUrl: string) => Promise<void> | void
  readVerificationCode: () => Promise<string>
}

export async function bootstrapAdminUser({
  loginId,
  password,
  deliverEnrollment,
  readVerificationCode,
}: BootstrapOptions): Promise<BootstrapResult> {
  let adminUser = await User.findOne({ login_id: loginId })
  let created = false

  if (adminUser) {
    if (adminUser.user_type !== 'ADMIN' || !adminUser.is_active) {
      throw new Error(`Existing user "${loginId}" is not an active administrator`)
    }
    const profile = await AdminProfile.findById(adminUser.profile_id)
    if (!profile || profile.admin_role !== AdminRole.APP_ADMIN) {
      throw new Error(`Existing administrator "${loginId}" is not an App Admin`)
    }
  } else {
    if (!password) {
      throw new Error('DEFAULT_ADMIN_PASSWORD is required when creating the bootstrap admin')
    }

    const adminProfile = await AdminProfile.create({
      permission: 'FULL_ACCESS',
      admin_role: AdminRole.APP_ADMIN,
    })
    try {
      adminUser = await User.create({
        login_id: loginId,
        password,
        user_type: 'ADMIN',
        profile_id: adminProfile._id,
        user_type_model: 'AdminProfile',
        must_change_password: true,
      })
      created = true
    } catch (error) {
      await AdminProfile.deleteOne({ _id: adminProfile._id })
      throw error
    }
  }

  if (isAdminTotpEnabled(adminUser)) {
    return { status: 'ALREADY_ENABLED', created, userId: String(adminUser._id) }
  }

  const enrollment = await createAdminTotpBootstrapEnrollment(adminUser)
  await AuditLog.create({
    user_id: adminUser._id,
    user_type: 'ADMIN',
    action: AuditAction.MFA_SETUP,
    description: 'Operations bootstrap started App Admin TOTP enrollment',
    resource_type: 'User',
    resource_id: String(adminUser._id),
    success: true,
    metadata: {
      source: 'operations_cli',
      factor_type: 'AUTHENTICATOR_APP',
      restarted_pending_enrollment: adminUser.admin_mfa?.totp?.status === 'PENDING',
    },
  })

  await deliverEnrollment(enrollment.otpauth_url)
  const code = (await readVerificationCode()).trim()

  let invalidatedSessionResult
  try {
    invalidatedSessionResult = await activateAdminTotpEnrollment(adminUser, code)
  } catch (error) {
    await AuditLog.create({
      user_id: adminUser._id,
      user_type: 'ADMIN',
      action: AuditAction.MFA_ACTIVATE,
      description: 'Operations bootstrap App Admin TOTP verification failed',
      resource_type: 'User',
      resource_id: String(adminUser._id),
      success: false,
      error_message: 'totp_verification_failed',
      metadata: { source: 'operations_cli', factor_type: 'AUTHENTICATOR_APP' },
    }).catch(() => undefined)
    throw error
  }

  const activatedAdmin = await User.findById(adminUser._id).select('security_version')
  await AuditLog.create({
    user_id: adminUser._id,
    user_type: 'ADMIN',
    action: AuditAction.MFA_ACTIVATE,
    description: 'Operations bootstrap activated App Admin TOTP',
    resource_type: 'User',
    resource_id: String(adminUser._id),
    success: true,
    metadata: {
      source: 'operations_cli',
      factor_type: 'AUTHENTICATOR_APP',
      security_version: Number(activatedAdmin?.security_version || 0),
      invalidated_sessions: invalidatedSessionResult.modifiedCount || 0,
      revocation_cleanup_completed: invalidatedSessionResult.cleanupCompleted,
    },
  })

  return { status: 'ENABLED', created, userId: String(adminUser._id) }
}

async function createAdminUser() {
  try {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error('Admin bootstrap requires an interactive terminal; do not run it in CI or redirected logs')
    }

    await mongoose.connect(config.databaseUrl)
    console.log('Connected to database')

    const requiresConfiguredCredentials = ['production', 'staging'].includes(config.nodeEnv)
    const configuredLoginId = process.env.DEFAULT_ADMIN_LOGIN?.trim()
    const configuredPassword = process.env.DEFAULT_ADMIN_PASSWORD?.trim()

    if (requiresConfiguredCredentials && !configuredLoginId) {
      throw new Error('DEFAULT_ADMIN_LOGIN is required in production and staging')
    }

    const loginId = configuredLoginId || 'admin'
    const terminal = createInterface({ input: process.stdin, output: process.stdout })
    try {
      const result = await bootstrapAdminUser({
        loginId,
        password: configuredPassword,
        deliverEnrollment: async (otpauthUrl) => {
          console.log('Scan this one-time authenticator URI now. It will not be shown again:')
          console.log(otpauthUrl)
        },
        readVerificationCode: () => terminal.question('Enter the current six-digit authenticator code: '),
      })

      if (result.status === 'ALREADY_ENABLED') {
        console.log(`App Admin "${loginId}" already has TOTP enabled; no factor was rotated.`)
      } else {
        console.log(`App Admin "${loginId}" is ready for production login.`)
        console.log(`User ID: ${result.userId}`)
        if (result.created) {
          console.log('Deliver the initial password out of band and require it to be changed after login.')
        }
      }
    } finally {
      terminal.close()
    }

    await mongoose.disconnect()
    console.log('Disconnected from database')
  } catch (error: any) {
    console.error('Error creating admin user:', error.message)
    await mongoose.disconnect()
    process.exit(1)
  }
}

if (require.main === module) {
  void createAdminUser()
}
