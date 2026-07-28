import { AdminProfile, DoctorProfile, Notification, PatientProfile, User } from '@alias/models'
import { NotificationType, NotificationPriority } from '@alias/models/notification.model'
import { UserType } from '@alias/validators'
import { ApiError } from '@alias/utils'
import { StatusCodes } from 'http-status-codes'
import { publishGeneralNotificationToUser } from '@alias/services/realtime-notification.service'
import { isFeatureEnabled } from '@alias/services/config.service'
import { enqueueNotificationPush } from '@alias/services/notification-delivery.service'
import logger from '@alias/utils/logger'
import type { AdminAccessContext } from '@alias/types/admin-access'
import { hasAdminCapability } from '@alias/types/admin-access'
import type { AdminCapability } from '@alias/constants/admin-capabilities'

export type BroadcastTarget = 'ALL' | 'DOCTORS' | 'PATIENTS' | 'SPECIFIC'

function forbidden(message: string, requiredCapability?: AdminCapability): ApiError {
  const error = new ApiError(StatusCodes.FORBIDDEN, message)
  if (requiredCapability) Object.assign(error, { requiredCapability })
  return error
}

function assertBroadcastAccess(access: AdminAccessContext): AdminCapability {
  const capability: AdminCapability = access.scope === 'global'
    ? 'platform.notifications.broadcast'
    : 'tenant.notifications.broadcast'
  if (access.readOnly || access.role === 'auditor' || !hasAdminCapability(access, capability)) {
    throw forbidden('Administrator notification broadcast access is not permitted.', capability)
  }
  if (access.scope === 'tenant' && !access.hospitalId) {
    throw forbidden('Active hospital administrator scope is required.', capability)
  }
  return capability
}

async function getTenantRecipientUserIds(access: AdminAccessContext): Promise<string[]> {
  if (access.scope !== 'tenant' || !access.hospitalId) return []
  const [doctorProfiles, patientProfiles, adminProfiles] = await Promise.all([
    DoctorProfile.find({ hospital_id: access.hospitalId }).select('_id').lean(),
    PatientProfile.find({ hospital_id: access.hospitalId }).select('_id').lean(),
    AdminProfile.find({ hospital_id: access.hospitalId }).select('_id').lean(),
  ])
  const profileIds = [
    ...doctorProfiles.map(profile => profile._id),
    ...patientProfiles.map(profile => profile._id),
    ...adminProfiles.map(profile => profile._id),
  ]
  if (!profileIds.length) return []
  const users = await User.find({ profile_id: { $in: profileIds }, is_active: true }).select('_id').lean()
  return users.map(user => String(user._id))
}

export async function resolveBroadcastRecipientIds(
  access: AdminAccessContext,
  target: BroadcastTarget,
  specificUserIds?: string[],
): Promise<string[]> {
  assertBroadcastAccess(access)
  const tenantUserIds = access.scope === 'tenant' ? await getTenantRecipientUserIds(access) : undefined
  const tenantUserIdSet = tenantUserIds ? new Set(tenantUserIds) : undefined
  const baseFilter: Record<string, unknown> = { is_active: true }
  if (tenantUserIds) baseFilter._id = { $in: tenantUserIds }

  switch (target) {
    case 'ALL': {
      const users = await User.find(baseFilter).select('_id').lean()
      return users.map(user => String(user._id))
    }
    case 'DOCTORS': {
      const users = await User.find({ ...baseFilter, user_type: UserType.DOCTOR }).select('_id').lean()
      return users.map(user => String(user._id))
    }
    case 'PATIENTS': {
      const users = await User.find({ ...baseFilter, user_type: UserType.PATIENT }).select('_id').lean()
      return users.map(user => String(user._id))
    }
    case 'SPECIFIC': {
      if (!specificUserIds?.length) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'No user IDs provided for SPECIFIC target')
      }
      const distinctIds = [...new Set(specificUserIds.map(String))]
      if (tenantUserIdSet && distinctIds.some(id => !tenantUserIdSet.has(id))) {
        throw forbidden('Cross-tenant notification broadcast is not allowed', 'tenant.notifications.broadcast')
      }
      const users = await User.find({
        _id: { $in: distinctIds },
        is_active: true,
      }).select('_id').lean()
      if (users.length !== distinctIds.length) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Every notification recipient must be an active user')
      }
      return users.map(user => String(user._id))
    }
    default:
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Unsupported notification broadcast target')
  }
}

export async function broadcastNotification(
  title: string,
  message: string,
  target: BroadcastTarget,
  specificUserIds: string[] | undefined,
  priority: string = 'MEDIUM',
  access: AdminAccessContext,
) {
  assertBroadcastAccess(access)
  if (!await isFeatureEnabled('notifications_enabled')) {
    throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'Notifications are currently disabled.')
  }

  const userIds = await resolveBroadcastRecipientIds(access, target, specificUserIds)
  const notifications = userIds.map(userId => ({
    user_id: userId,
    type: NotificationType.SYSTEM_ANNOUNCEMENT,
    priority: (priority as NotificationPriority) || NotificationPriority.MEDIUM,
    title,
    message,
    push_delivery_required: true,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  }))

  // Recipient resolution can be expensive; do not persist new intent after pause.
  if (!await isFeatureEnabled('notifications_enabled')) {
    throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'Notifications are currently disabled.')
  }

  const created = await Notification.insertMany(notifications)
  const pushResults = await Promise.all(created.map(notification =>
    enqueueNotificationPush({
      notificationId: String(notification._id),
      userId: String(notification.user_id),
      title: notification.title,
      body: notification.message,
      data: { notification_type: String(notification.type) },
    })
  ))
  const pushOutboxPersisted = pushResults.filter(Boolean).length
  if (pushOutboxPersisted !== created.length) {
    logger.error('notification.broadcast_outbox_incomplete', {
      notificationsCreated: created.length,
      pushOutboxPersisted,
      scope: access.scope,
    })
  }

  for (const notification of created) {
    await publishGeneralNotificationToUser(String(notification.user_id), 'notification', {
      id: String(notification._id),
      title: notification.title,
      message: notification.message,
      type: notification.type,
      priority: notification.priority,
      is_read: notification.is_read,
      created_at: notification.createdAt,
      data: notification.data,
    })
  }

  return {
    message: 'Notification broadcast successful',
    target,
    scope: access.scope,
    recipients: userIds.length,
    created: created.length,
    push_outbox_persisted: pushOutboxPersisted,
  }
}

export async function getUserNotifications(
  userId: string,
  filters: { is_read?: boolean } = {},
  pagination: { page?: number; limit?: number } = {},
) {
  const page = pagination.page || 1
  const limit = pagination.limit || 20

  const query: any = { user_id: userId, push_delivery_cancelled_at: { $exists: false } }
  if (typeof filters.is_read === 'boolean') query.is_read = filters.is_read

  const notifications = await Notification.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
  const total = await Notification.countDocuments(query)

  return {
    notifications,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  }
}

export async function markNotificationRead(notificationId: string, userId: string) {
  return Notification.findOneAndUpdate(
    { _id: notificationId, user_id: userId, push_delivery_cancelled_at: { $exists: false } },
    { is_read: true, read_at: new Date() },
    { new: true },
  )
}

export async function markAllNotificationsRead(userId: string) {
  const result = await Notification.updateMany(
    { user_id: userId, is_read: false, push_delivery_cancelled_at: { $exists: false } },
    { is_read: true, read_at: new Date() },
  )
  return result.modifiedCount ?? 0
}
