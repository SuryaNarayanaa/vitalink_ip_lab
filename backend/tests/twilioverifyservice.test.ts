import { TwilioVerifyService, maskPhoneNumber } from '@alias/services/twilio-verify.service'

describe('Twilio Verify service', () => {
  test('starts SMS verification through Twilio Verify API', async () => {
    const post = jest.fn().mockResolvedValue({
      data: {
        sid: 'test-verification-id',
        status: 'pending',
        channel: 'sms',
        to: '+15555550123',
      },
    })
    const service = new TwilioVerifyService({ post } as any)

    const result = await service.startVerification('+15555550123', 'sms')

    expect(post).toHaveBeenCalledTimes(1)
    const [url, body, options] = post.mock.calls[0]
    expect(url).toContain('/Verifications')
    expect(body.toString()).toBe('To=%2B15555550123&Channel=sms')
    expect(options.auth).toHaveProperty('username')
    expect(options.auth).toHaveProperty('password')
    expect(result).toEqual({
      sid: 'test-verification-id',
      status: 'pending',
      channel: 'sms',
      to: '+15555550123',
    })
  })

  test('checks verification code through Twilio Verify API', async () => {
    const post = jest.fn().mockResolvedValue({
      data: {
        sid: 'test-verification-id',
        status: 'approved',
        valid: true,
        to: '+15555550123',
      },
    })
    const service = new TwilioVerifyService({ post } as any)

    const result = await service.checkVerification('+15555550123', '123456')

    expect(post).toHaveBeenCalledTimes(1)
    const [url, body, options] = post.mock.calls[0]
    expect(url).toContain('/VerificationCheck')
    expect(body.toString()).toBe('To=%2B15555550123&Code=123456')
    expect(options.auth).toHaveProperty('username')
    expect(options.auth).toHaveProperty('password')
    expect(result).toEqual({
      sid: 'test-verification-id',
      status: 'approved',
      valid: true,
      to: '+15555550123',
    })
  })

  test('masks phone numbers for logs', () => {
    expect(maskPhoneNumber('+1 (555) 555-0123')).toBe('*******0123')
    expect(maskPhoneNumber('123')).toBe('****')
  })
})
