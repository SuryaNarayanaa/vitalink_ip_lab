import { config } from '@alias/config'
import logger from '@alias/utils/logger'

export interface SmsMessage {
  to: string
  body: string
  metadata?: Record<string, unknown>
}

export interface SmsSendResult {
  accepted: boolean
  provider: string
  messageId?: string
}

export interface SmsProvider {
  readonly name: string
  send(message: SmsMessage): Promise<SmsSendResult>
}

export function maskPhoneNumber(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, '')
  if (digits.length <= 4) return '****'
  return `${'*'.repeat(Math.max(digits.length - 4, 0))}${digits.slice(-4)}`
}

export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock'

  async send(message: SmsMessage): Promise<SmsSendResult> {
    logger.info('Mock SMS provider accepted message', {
      provider: this.name,
      to: maskPhoneNumber(message.to),
      messageLength: message.body.length,
      metadata: message.metadata,
    })

    return {
      accepted: true,
      provider: this.name,
      messageId: `mock-${Date.now()}`,
    }
  }
}

export function createSmsProvider(providerName = config.smsProvider): SmsProvider {
  switch (providerName) {
    case 'mock':
      return new MockSmsProvider()
    default:
      logger.warn('Unsupported SMS provider configured; falling back to mock provider', {
        provider: providerName,
      })
      return new MockSmsProvider()
  }
}

export const smsProvider = createSmsProvider()
