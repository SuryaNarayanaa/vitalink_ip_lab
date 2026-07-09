import { User, Notification } from '@alias/models'
import { NotificationType, NotificationPriority } from '@alias/models/notification.model'
import { UserType } from '@alias/validators'
import { ApiError } from '@alias/utils'
import { StatusCodes } from 'http-status-codes'
import { publishNotificationToUser } from '@alias/services/realtime-notification.service'
import { getAdminContext, getTenantUserIdsForAdmin } from '@alias/services/admin.service'

export type BroadcastTarget = 'ALL' | 'DOCTORS' | 'PATIENTS' | 'SPECIFIC'

export async function broadcastNotification(
  title: string,
  message: string,
  target: BroadcastTarget,
  specificUserIds?: string[],
  priority: string = 'MEDIUM',
  actorUserId?: string
) {
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
      if (!ctx.isAppAdmin) {
        const forbidden = specificUserIds.some(id => !tenantUserIdSet?.has(String(id)))
        if (forbidden) {
          throw new ApiError(StatusCodes.FORBIDDEN, 'Cross-tenant notification broadcast is not allowed')
        }
      }
      userIds = specificUserIds
      break
  }

  const notifications = userIds.map(userId => ({
    user_id: userId,
    type: NotificationType.SYSTEM_ANNOUNCEMENT,
    priority: (priority as NotificationPriority) || NotificationPriority.MEDIUM,
    title,
    message,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
  }))

  const created = await Notification.insertMany(notifications)

  for (const notification of created) {
    publishNotificationToUser(String(notification.user_id), 'notification', {
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
  }
}

export async function getUserNotifications(
  userId: string,
  filters: { is_read?: boolean } = {},
  pagination: { page?: number; limit?: number } = {}
) {
  const page = pagination.page || 1
  const limit = pagination.limit || 20

  const query: any = { user_id: userId }
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
    { _id: notificationId, user_id: userId },
    { is_read: true, read_at: new Date() },
    { new: true }
  )
  return notification
}

export async function markAllNotificationsRead(userId: string) {
  const result = await Notification.updateMany(
    { user_id: userId, is_read: false },
    { is_read: true, read_at: new Date() }
  )
  return result.modifiedCount ?? 0
}
