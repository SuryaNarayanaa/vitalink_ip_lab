import { config } from '@alias/config'
import { recoverDueDeliveries } from '@alias/services/notification-delivery.service'
import logger from '@alias/utils/logger'

let recoveryTimer: ReturnType<typeof setInterval> | null = null
let running = false

export function startNotificationDeliveryRecovery(): void {
  if (!config.notificationDeliveryEnabled) return
  if (recoveryTimer) return

  const intervalMs = config.notificationDeliveryRecoveryIntervalMs

  const tick = async () => {
    if (running) return
    running = true
    try {
      await recoverDueDeliveries(50)
    } catch (error) {
      logger.error('notification_delivery.recovery_error', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      running = false
    }
  }

  // First pass shortly after boot to drain pending outbox rows.
  setTimeout(() => {
    void tick()
  }, 2_000)

  recoveryTimer = setInterval(() => {
    void tick()
  }, intervalMs)

  // Allow process to exit in tests without open handles.
  if (typeof recoveryTimer.unref === 'function') {
    recoveryTimer.unref()
  }

  logger.info('notification_delivery.recovery_started', { intervalMs })
}

export function stopNotificationDeliveryRecovery(): void {
  if (recoveryTimer) {
    clearInterval(recoveryTimer)
    recoveryTimer = null
    logger.info('notification_delivery.recovery_stopped')
  }
}
