jest.unmock('@alias/services/firebase-phone-auth.service')

import { toFirebaseE164, verifyFirebasePhoneIdToken } from '@alias/services/firebase-phone-auth.service'

describe('Firebase phone auth service', () => {
  test('formats local Indian profile numbers for Firebase', () => {
    expect(toFirebaseE164('9000004444')).toBe('+919000004444')
    expect(toFirebaseE164('+91 90000 04444')).toBe('+919000004444')
  })

  test('accepts a signed token only when its phone claim matches the profile', async () => {
    const auth = {
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'firebase-user-1',
        phone_number: '+919000004444',
      }),
    }

    const token = await verifyFirebasePhoneIdToken(
      'signed-id-token',
      '9000004444',
      auth as any
    )

    expect(auth.verifyIdToken).toHaveBeenCalledWith('signed-id-token', true)
    expect(token.uid).toBe('firebase-user-1')
  })

  test('rejects a token for another phone', async () => {
    const auth = {
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'firebase-user-2',
        phone_number: '+919000009999',
      }),
    }

    await expect(verifyFirebasePhoneIdToken(
      'signed-id-token',
      '+919000004444',
      auth as any
    )).rejects.toThrow('does not match')
  })
})
