import { User, Notification } from '@alias/models'
import { NotificationType, NotificationPriority } from '@alias/models/notification.model'
import { UserType } from '@alias/validators'
import { ApiError } from '@alias/utils'
import { StatusCodes } from 'http-status-codes'
import { publishGeneralNotificationToUser } from '@alias/services/realtime-notification.service'
import { getAdminContext, getTenantUserIdsForAdmin } from '@alias/services/admin.service'
import { isFeatureEnabled } from '@alias/services/config.service'
import { enqueueNotificationPush } from '@alias/services/notification-delivery.service'
import logger from '@alias/utils/logger'

export type BroadcastTarget = 'ALL' | 'DOCTORS' | 'PATIENTS' | 'SPECIFIC'

export async function broadcastNotification(
  title: string,
  message: string,
  target: BroadcastTarget,
  specificUserIds?: string[],
  priority: string = 'MEDIUM',
  actorUserId?: string
) {
  if (!await isFeatureEnabled('notifications_enabled')) {
    throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'Notifications are currently disabled.')
  }

  let userIds: string[] = []
  const ctx = await getAdminContext(actorUserId)
  const tenantUserIds = await getTenantUserIdsForAdmin(actorUserId)
  const tenantUserIdSet = tenantUserIds ? new Set(tenantUserIds.map(String)) : undefined
  const tenantFilter = (ids: string[]) => tenantUserIdSet ? ids.filter(id => tenantUserIdSet.has(id)) : ids

  switch (target) {
    case 'ALL':
      const allUsers = await User.find({ is_active: true }).select('_id')
      userIds = tenantFilter(allUsers.map(u => String(u._id)))
      break

    case 'DOCTORS':
      const doctors = await User.find({ user_type: UserType.DOCTOR, is_active: true }).select('_id')
      userIds = tenantFilter(doctors.map(u => String(u._id)))
      break

    case 'PATIENTS':
      const patients = await User.find({ user_type: UserType.PATIENT, is_active: true }).select('_id')
      userIds = tenantFilter(patients.map(u => String(u._id)))
      break

    case 'SPECIFIC':
      if (!specificUserIds || specificUserIds.length === 0) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'No user IDs provided for SPECIFIC target')
      }
      const distinctSpecificUserIds = [...new Set(specificUserIds.map(String))]
      if (!ctx.isAppAdmin) {
        const forbidden = distinctSpecificUserIds.some(id => !tenantUserIdSet?.has(id))
        if (forbidden) {
          throw new ApiError(StatusCodes.FORBIDDEN, 'Cross-tenant notification broadcast is not allowed')
        }
      }
      const eligibleUsers = await User.find({
        _id: { $in: distinctSpecificUserIds },
        is_active: true,
      }).select('_id')
      if (eligibleUsers.length !== distinctSpecificUserIds.length) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Every notification recipient must be an active user')
      }
      userIds = eligibleUsers.map(user => String(user._id))
      break
  }

  const notifications = userIds.map(userId => ({
    user_id: userId,
    type: NotificationType.SYSTEM_ANNOUNCEMENT,
    priority: (priority as NotificationPriority) || NotificationPriority.MEDIUM,
    title,
    message,
    push_delivery_required: true,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
  }))

  // Recipient resolution can be expensive; do not persist new intent after pause.
  if (!await isFeatureEnabled('notifications_enabled')) {
    throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'Notifications are currently disabled.')
  }

  const created = await Notification.insertMany(notifications)

  // Broadcasts are part of the documented push lifecycle, not in-app-only
  // messages. Await durable outbox creation for every persisted notification;
  // queue publication remains best-effort inside enqueueNotificationPush.
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
    recipients: userIds.length,
    created: created.length,
    push_outbox_persisted: pushOutboxPersisted,
  }
}

export async function getUserNotifications(
  userId: string,
  filters: { is_read?: boolean } = {},
  pagination: { page?: number; limit?: number } = {}
) {
  const page = pagination.page || 1
  const limit = pagination.limit || 20

  const query: any = { user_id: userId, push_delivery_cancelled_at: { $exists: false } }
  if (typeof filters.is_read === 'boolean') {
    query.is_read = filters.is_read
  }

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
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, user_id: userId, push_delivery_cancelled_at: { $exists: false } },
    { is_read: true, read_at: new Date() },
    { new: true }
  )
  return notification
}

export async function markAllNotificationsRead(userId: string) {
  const result = await Notification.updateMany(
    { user_id: userId, is_read: false, push_delivery_cancelled_at: { $exists: false } },
    { is_read: true, read_at: new Date() }
  )
  return result.modifiedCount ?? 0
}
