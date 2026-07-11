import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/core/constants/strings.dart';
import 'package:frontend/features/login/models/login_models.dart';

void main() {
  group('login OTP models', () {
    test('parses Firebase-backed challenge response', () {
      final challenge = LoginOtpChallenge.fromJson({
        'challenge_id': 'challenge-123',
        'purpose': 'PHONE_FIRST_LOGIN',
        'delivery_channel': 'SMS',
        'phone': {
          'masked': '+********1234',
          'last4': '1234',
          'number': '+919000001234',
        },
        'expires_at': '2026-07-06T10:30:00.000Z',
        'resend_available_at': '2026-07-06T10:25:00.000Z',
        'attempts_remaining': 4,
        'max_attempts': 5,
        'resend_count': 1,
        'max_resends': 3,
      });

      expect(challenge.challengeId, 'challenge-123');
      expect(challenge.maskedPhone, '+********1234');
      expect(challenge.phone.last4, '1234');
      expect(challenge.phone.number, '+919000001234');
      expect(challenge.attemptsRemaining, 4);
      expect(challenge.maxResends, 3);
      expect(challenge.expiresAt, isNotNull);
      expect(challenge.resendAvailableAt, isNotNull);
    });

    test(
      'builds verify and resend requests for backend login OTP endpoints',
      () {
        final verify = VerifyLoginOtpRequest(
          challengeId: 'challenge-123',
          firebaseIdToken: 'firebase-id-token',
        );
        final resend = ResendLoginOtpRequest(challengeId: 'challenge-123');

        expect(verify.path, AppStrings.loginOtpVerifyPath);
        expect(verify.toJson(), {
          'challenge_id': 'challenge-123',
          'firebase_id_token': 'firebase-id-token',
        });
        expect(resend.path, AppStrings.loginOtpResendPath);
        expect(resend.toJson(), {'challenge_id': 'challenge-123'});
      },
    );

    test('parses backend admin TOTP challenge response', () {
      final challenge = LoginTotpChallenge.fromJson({
        'challenge_id': 'admin-mfa-123',
        'factor_type': 'AUTHENTICATOR_APP',
        'expires_at': '2026-07-06T10:30:00.000Z',
        'attempts_remaining': 3,
        'max_attempts': 5,
      });

      expect(challenge.challengeId, 'admin-mfa-123');
      expect(challenge.factorType, 'AUTHENTICATOR_APP');
      expect(challenge.attemptsRemaining, 3);
      expect(challenge.maxAttempts, 5);
      expect(challenge.expiresAt, isNotNull);
    });

    test('builds verify request for backend login TOTP endpoint', () {
      final verify = VerifyLoginTotpRequest(
        challengeId: 'admin-mfa-123',
        code: '123456',
      );

      expect(verify.path, AppStrings.loginTotpVerifyPath);
      expect(verify.toJson(), {
        'challenge_id': 'admin-mfa-123',
        'code': '123456',
      });
    });

    test(
      'builds refresh and revoke requests for backend session endpoints',
      () {
        final refresh = RefreshSessionRequest(refreshToken: 'refresh-token');
        final revoke = RevokeSessionRequest(refreshToken: 'refresh-token');

        expect(refresh.path, AppStrings.authRefreshPath);
        expect(refresh.toJson(), {'refresh_token': 'refresh-token'});
        expect(revoke.path, AppStrings.authRevokePath);
        expect(revoke.toJson(), {'refresh_token': 'refresh-token'});
      },
    );

    test('parses backend auth session metadata', () {
      final session = AuthSessionModel.fromJson({
        'session_id': 'session-123',
        'refresh_expires_at': '2026-08-06T12:00:00.000Z',
      });

      expect(session.sessionId, 'session-123');
      expect(session.refreshExpiresAt, isNotNull);
    });
  });
}
