import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/core/constants/strings.dart';
import 'package:frontend/features/login/models/login_models.dart';

void main() {
  group('login OTP models', () {
    test('parses backend challenge response without full phone data', () {
      final challenge = LoginOtpChallenge.fromJson({
        'challenge_id': 'challenge-123',
        'purpose': 'PHONE_FIRST_LOGIN',
        'delivery_channel': 'SMS',
        'phone': {
          'masked': '+********1234',
          'last4': '1234',
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
      expect(challenge.attemptsRemaining, 4);
      expect(challenge.maxResends, 3);
      expect(challenge.expiresAt, isNotNull);
      expect(challenge.resendAvailableAt, isNotNull);
    });

    test('builds verify and resend requests for backend login OTP endpoints',
        () {
      final verify = VerifyLoginOtpRequest(
        challengeId: 'challenge-123',
        code: 'test-code',
      );
      final resend = ResendLoginOtpRequest(challengeId: 'challenge-123');

      expect(verify.path, AppStrings.loginOtpVerifyPath);
      expect(verify.toJson(), {
        'challenge_id': 'challenge-123',
        'code': 'test-code',
      });
      expect(resend.path, AppStrings.loginOtpResendPath);
      expect(resend.toJson(), {'challenge_id': 'challenge-123'});
    });
  });
}
