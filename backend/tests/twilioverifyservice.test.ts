import { TwilioVerifyService, maskPhoneNumber } from '@alias/services/twilio-verify.service'

describe('Twilio Verify service', () => {
  const recipient = 'patient-recipient alpha+sms'

  test('starts SMS verification through Twilio Verify API', async () => {
    const post = jest.fn().mockResolvedValue({
      data: {
        sid: 'test-verification-id',
        status: 'pending',
        channel: 'sms',
        to: recipient,
      },
    })
    const service = new TwilioVerifyService({ post } as any)

    const result = await service.startVerification(recipient, 'sms')

    expect(post).toHaveBeenCalledTimes(1)
    const [url, body, options] = post.mock.calls[0]
    expect(url).toContain('/Verifications')
    expect(body.toString()).toBe(new URLSearchParams({ To: recipient, Channel: 'sms' }).toString())
    expect(options.auth).toHaveProperty('username')
    expect(options.auth).toHaveProperty('password')
    expect(result).toEqual({
      sid: 'test-verification-id',
      status: 'pending',
      channel: 'sms',
      to: recipient,
    })
  })

  test('checks verification code through Twilio Verify API', async () => {
    const post = jest.fn().mockResolvedValue({
      data: {
        sid: 'test-verification-id',
        status: 'approved',
        valid: true,
        to: recipient,
      },
    })
    const service = new TwilioVerifyService({ post } as any)

    const result = await service.checkVerification(recipient, 'candidate-code')

    expect(post).toHaveBeenCalledTimes(1)
    const [url, body, options] = post.mock.calls[0]
    expect(url).toContain('/VerificationCheck')
    expect(body.toString()).toBe(new URLSearchParams({ To: recipient, Code: 'candidate-code' }).toString())
    expect(options.auth).toHaveProperty('username')
    expect(options.auth).toHaveProperty('password')
    expect(result).toEqual({
      sid: 'test-verification-id',
      status: 'approved',
      valid: true,
      to: recipient,
    })
  })

  test('masks phone numbers for logs', () => {
    expect(maskPhoneNumber('recipient-token-abcd1234efgh5678')).toBe('****5678')
    expect(maskPhoneNumber('recipient-ending-1234')).toBe('****')
  })
})
