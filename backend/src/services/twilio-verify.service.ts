import axios, { AxiosInstance } from 'axios'
import { config } from '@alias/config'
import logger from '@alias/utils/logger'

const TWILIO_VERIFY_BASE_URL = 'https://verify.twilio.com/v2'

export interface StartVerificationResult {
  sid?: string
  status?: string
  channel?: string
  to?: string
}

export interface CheckVerificationResult {
  sid?: string
  status?: string
  valid?: boolean
  to?: string
}

export interface TwilioVerifyClient {
  startVerification(to: string, channel?: string): Promise<StartVerificationResult>
  checkVerification(to: string, code: string): Promise<CheckVerificationResult>
}

export function maskPhoneNumber(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, '')
  if (digits.length <= 4) return '****'
  return `${'*'.repeat(Math.max(digits.length - 4, 0))}${digits.slice(-4)}`
}

function buildTwilioVerifyUrl(path: string): string {
  const encodedServiceSid = encodeURIComponent(config.twilioVerifyServiceSid)
  return `${TWILIO_VERIFY_BASE_URL}/Services/${encodedServiceSid}/${path}`
}

function sanitizeTwilioError(error: unknown): Error {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    const code = (error.response?.data as any)?.code
    const message = status
      ? `Twilio Verify request failed with status ${status}${code ? ` and code ${code}` : ''}`
      : 'Twilio Verify request failed'
    return new Error(message)
  }

  return error instanceof Error ? new Error(error.message) : new Error('Twilio Verify request failed')
}

export class TwilioVerifyService implements TwilioVerifyClient {
  private readonly httpClient: AxiosInstance

  constructor(httpClient: AxiosInstance = axios.create()) {
    this.httpClient = httpClient
  }

  async startVerification(to: string, channel = config.twilioVerifyChannel): Promise<StartVerificationResult> {
    try {
      const response = await this.httpClient.post(
        buildTwilioVerifyUrl('Verifications'),
        new URLSearchParams({
          To: to,
          Channel: channel,
        }),
        {
          auth: {
            username: config.twilioAccountSid,
            password: config.twilioAuthToken,
          },
        }
      )

      logger.info('Twilio Verify verification started', {
        to: maskPhoneNumber(to),
        channel,
        provider: 'twilio_verify',
        status: response.data?.status,
      })

      return {
        sid: response.data?.sid,
        status: response.data?.status,
        channel: response.data?.channel,
        to: response.data?.to,
      }
    } catch (error) {
      logger.warn('Twilio Verify verification start failed', {
        to: maskPhoneNumber(to),
        channel,
        provider: 'twilio_verify',
      })
      throw sanitizeTwilioError(error)
    }
  }

  async checkVerification(to: string, code: string): Promise<CheckVerificationResult> {
    try {
      const response = await this.httpClient.post(
        buildTwilioVerifyUrl('VerificationCheck'),
        new URLSearchParams({
          To: to,
          Code: code,
        }),
        {
          auth: {
            username: config.twilioAccountSid,
            password: config.twilioAuthToken,
          },
        }
      )

      logger.info('Twilio Verify verification check completed', {
        to: maskPhoneNumber(to),
        provider: 'twilio_verify',
        status: response.data?.status,
        valid: response.data?.valid,
      })

      return {
        sid: response.data?.sid,
        status: response.data?.status,
        valid: response.data?.valid,
        to: response.data?.to,
      }
    } catch (error) {
      logger.warn('Twilio Verify verification check failed', {
        to: maskPhoneNumber(to),
        provider: 'twilio_verify',
      })
      throw sanitizeTwilioError(error)
    }
  }
}

export const twilioVerifyService = new TwilioVerifyService()
