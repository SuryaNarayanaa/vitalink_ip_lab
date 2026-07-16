import { describe, expect, test } from '@jest/globals'
import { getRateLimitKey, getRateLimitWindowKey, nextRateLimitWindow, removeExpiredRateLimitWindows } from '@alias/config/ratelimiter'
import { updateSystemConfig, validateInrThresholds } from '@alias/services/config.service'
import { isControlPlaneRequest, isPatientRegistrationRequest } from '@alias/middlewares/systemConfig.middleware'
import { getRefreshTokenExpiry, getSessionExpiry, SESSION_ACCESS_TOKEN_LIFETIME_SECONDS } from '@alias/services/auth-session.service'
import { AuthSession, SystemConfig } from '@alias/models'
import { generateToken } from '@alias/utils/jwt.utils'
import jwt from 'jsonwebtoken'
import { UserType } from '@alias/validators'
import { config } from '@alias/config'

describe('system configuration runtime safeguards', () => {
  test('rejects equal and inverted INR critical thresholds', () => {
    expect(() => validateInrThresholds(2.5, 2.5)).toThrow('must be less')
    expect(() => validateInrThresholds(4.5, 1.5)).toThrow('must be less')
    expect(() => validateInrThresholds(1.5, 4.5)).not.toThrow()
  })

  test('uses a shared /56 bucket for IPv6 client addresses', () => {
    expect(getRateLimitKey('2001:db8:1234:5678:abcd::1'))
      .toBe(getRateLimitKey('2001:db8:1234:56ff:ffff::2'))
  })

  test('resets an existing rate-limit bucket when the configured window changes', () => {
    const current = { count: 4, resetAt: 10_000, windowMs: 60_000 }
    expect(nextRateLimitWindow(current, 1_000, 120_000))
      .toEqual({ count: 1, resetAt: 121_000, windowMs: 120_000 })
  })

  test('removes expired limiter buckets', () => {
    const windows = new Map([
      ['expired', { count: 1, resetAt: 100, windowMs: 60 }],
      ['active', { count: 1, resetAt: 200, windowMs: 60 }],
    ])
    removeExpiredRateLimitWindows(windows, 150)
    expect([...windows.keys()]).toEqual(['active'])
  })

  test('uses the bounded overflow bucket after the tracked-IP capacity is reached', () => {
    const windows = new Map<string, { count: number; resetAt: number; windowMs: number }>()
    for (let index = 0; index < 10_000; index += 1) {
      windows.set(`192.0.2.${index}`, { count: 1, resetAt: 1_000, windowMs: 60 })
    }
    expect(getRateLimitWindowKey(windows, '198.51.100.1')).toBe('__rate-limit-overflow__')
  })

  test('matches maintenance control-plane exemptions and both patient registration routes', () => {
    expect(isControlPlaneRequest('/auth/login')).toBe(true)
    expect(isControlPlaneRequest('/admin/config')).toBe(true)
    expect(isControlPlaneRequest('/health/ready')).toBe(true)
    expect(isControlPlaneRequest('/patient/reports')).toBe(false)
    expect(isPatientRegistrationRequest('POST', '/admin/patients')).toBe(true)
    expect(isPatientRegistrationRequest('POST', '/doctors/patients')).toBe(true)
    expect(isPatientRegistrationRequest('GET', '/admin/patients')).toBe(false)
  })

  test('derives session expiry directly from the configured timeout', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'))
    expect(getSessionExpiry(30).toISOString()).toBe('2026-01-01T00:30:00.000Z')
    jest.useRealTimers()
  })

  test('keeps refresh-family expiry separate from the short access timeout', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'))
    expect(getRefreshTokenExpiry().toISOString()).toBe(
      new Date(Date.UTC(2026, 0, 1 + config.refreshTokenExpiryDays)).toISOString(),
    )
    expect(getRefreshTokenExpiry().getTime()).toBeGreaterThan(getSessionExpiry(30).getTime())
    jest.useRealTimers()
  })

  test('applies the configured timeout to existing sessions when creating the first config', async () => {
    const createdConfig: any = {
      inr_thresholds: { critical_low: 1.5, critical_high: 4.5 },
      rate_limit: { max_requests: 100, window_minutes: 15 },
      feature_flags: new Map(),
      save: jest.fn().mockResolvedValue(undefined),
    }
    const findOne = jest.spyOn(SystemConfig, 'findOne').mockResolvedValue(null as any)
    const create = jest.spyOn(SystemConfig, 'create').mockResolvedValue(createdConfig)
    const updateMany = jest.spyOn(AuthSession, 'updateMany').mockResolvedValue({} as any)

    await updateSystemConfig({ session_timeout_minutes: 20 })

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ session_timeout_minutes: 20, is_active: true }))
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        revoked_at: { $exists: false },
        $or: [
          { access_expires_at: { $gt: expect.any(Date) } },
          { access_expires_at: { $exists: false } },
        ],
      }),
      expect.objectContaining({ $set: expect.objectContaining({ access_expires_at: expect.any(Date) }) }),
    )
    findOne.mockRestore()
    create.mockRestore()
    updateMany.mockRestore()
  })

  test('issues session JWTs with the maximum supported configurable lifetime', () => {
    const token = generateToken({ user_id: '507f1f77bcf86cd799439011', user_type: UserType.PATIENT, session_id: '507f1f77bcf86cd799439012', token_id: 'test-token' }, SESSION_ACCESS_TOKEN_LIFETIME_SECONDS)
    const decoded = jwt.decode(token) as jwt.JwtPayload
    expect(decoded.exp! - decoded.iat!).toBe(SESSION_ACCESS_TOKEN_LIFETIME_SECONDS)
  })
})
