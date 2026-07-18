import 'dotenv/config'
import mongoose from 'mongoose'
import { config } from '@alias/config'
import { User, AdminProfile } from '@alias/models'
import { generateTemporaryPassword } from '@alias/services/password.service'

async function createAdminUser() {
  try {
    await mongoose.connect(config.databaseUrl)
    console.log('Connected to database')

    const isProduction = config.nodeEnv === 'production'
    const configuredLoginId = process.env.DEFAULT_ADMIN_LOGIN?.trim()
    const configuredPassword = process.env.DEFAULT_ADMIN_PASSWORD?.trim()

    if (isProduction && !configuredLoginId) {
      throw new Error('DEFAULT_ADMIN_LOGIN is required in production')
    }

    if (isProduction && !configuredPassword) {
      throw new Error('DEFAULT_ADMIN_PASSWORD is required in production')
    }

    const loginId = configuredLoginId || 'admin'
    const password = configuredPassword || generateTemporaryPassword()

    // Check if admin already exists
    const existingAdmin = await User.findOne({ login_id: loginId })
    if (existingAdmin) {
      console.log(`Admin user "${loginId}" already exists. Skipping creation.`)
      await mongoose.disconnect()
      return
    }

    // Create admin profile
    const adminProfile = await AdminProfile.create({
      permission: 'FULL_ACCESS',
    })

    // Create admin user
    const adminUser = await User.create({
      login_id: loginId,
      password: password,
      user_type: 'ADMIN',
      profile_id: adminProfile._id,
      user_type_model: 'AdminProfile',
      must_change_password: true,
    })

    console.log('Admin user created successfully:')
    console.log(`  Login ID: ${loginId}`)
    console.log(`  User ID: ${adminUser._id}`)
    console.log(`  Profile ID: ${adminProfile._id}`)
    console.log('')
    console.log('IMPORTANT: Deliver the initial password out of band and change it after first login!')

    await mongoose.disconnect()
    console.log('Disconnected from database')
  } catch (error: any) {
    console.error('Error creating admin user:', error.message)
    await mongoose.disconnect()
    process.exit(1)
  }
}

createAdminUser()
