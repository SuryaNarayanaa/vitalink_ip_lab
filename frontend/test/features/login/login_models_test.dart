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
        'phone': {'masked': '+********1234', 'last4': '1234'},
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

    test('gates resend and verify from challenge cooldown, expiry, and budget', () {
      final coolingDown = LoginOtpChallenge.fromJson({
        'challenge_id': 'challenge-123',
        'purpose': 'PHONE_FIRST_LOGIN',
        'delivery_channel': 'SMS',
        'phone': {'masked': '+********1234'},
        'expires_at': DateTime.now().add(const Duration(minutes: 5)).toIso8601String(),
        'resend_available_at':
            DateTime.now().add(const Duration(seconds: 30)).toIso8601String(),
        'attempts_remaining': 4,
        'resend_count': 1,
        'max_resends': 3,
      });
      final exhausted = LoginOtpChallenge.fromJson({
        'challenge_id': 'challenge-123',
        'purpose': 'PHONE_FIRST_LOGIN',
        'delivery_channel': 'SMS',
        'phone': {'masked': '+********1234'},
        'expires_at': DateTime.now().add(const Duration(minutes: 5)).toIso8601String(),
        'resend_available_at':
            DateTime.now().subtract(const Duration(seconds: 1)).toIso8601String(),
        'attempts_remaining': 0,
        'resend_count': 3,
        'max_resends': 3,
      });
      final expired = LoginOtpChallenge.fromJson({
        'challenge_id': 'challenge-123',
        'purpose': 'PHONE_FIRST_LOGIN',
        'delivery_channel': 'SMS',
        'phone': {'masked': '+********1234'},
        'expires_at':
            DateTime.now().subtract(const Duration(seconds: 1)).toIso8601String(),
        'resend_available_at':
            DateTime.now().subtract(const Duration(seconds: 1)).toIso8601String(),
        'attempts_remaining': 2,
        'resend_count': 1,
        'max_resends': 3,
      });

      expect(coolingDown.canResendNow, isFalse);
      expect(coolingDown.canVerifyNow, isTrue);
      expect(exhausted.canResendNow, isFalse);
      expect(exhausted.hasResendsRemaining, isFalse);
      expect(exhausted.canVerifyNow, isFalse);
      expect(expired.isExpired, isTrue);
      expect(expired.canResendNow, isFalse);
      expect(expired.canVerifyNow, isFalse);
    });

    test(
      'builds verify and resend requests for backend login OTP endpoints',
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
      expect(challenge.isEnrollment, isFalse);
    });

    test('parses password-bound enrollment challenge and setup material', () {
      final challenge = LoginTotpChallenge.fromJson({
        'challenge_id': '64b1f0c8e4b0a1d2c3e4f567',
        'factor_type': 'AUTHENTICATOR_APP',
        'purpose': 'ENROLLMENT',
        'expires_at': DateTime.now().add(const Duration(minutes: 5)).toIso8601String(),
        'attempts_remaining': 5,
        'max_attempts': 5,
      });
      final material = LoginTotpEnrollmentMaterial.fromJson({
        'factor_type': 'AUTHENTICATOR_APP',
        'secret': 'JBSWY3DPEHPK3PXP',
        'otpauth_url': 'otpauth://totp/VitaLink:admin?secret=JBSWY3DPEHPK3PXP',
        'challenge_id': '64b1f0c8e4b0a1d2c3e4f567',
        'reused': true,
      });

      expect(challenge.isEnrollment, isTrue);
      expect(challenge.canVerifyNow, isTrue);
      expect(material.secret, 'JBSWY3DPEHPK3PXP');
      expect(material.otpauthUrl, startsWith('otpauth://totp/'));
      expect(material.reused, isTrue);
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

    test('builds password-bound enrollment setup and activate requests', () {
      final setup = EnrollAdminTotpSetupRequest(
        challengeId: '64b1f0c8e4b0a1d2c3e4f567',
      );
      final activate = EnrollAdminTotpActivateRequest(
        challengeId: '64b1f0c8e4b0a1d2c3e4f567',
        code: '123456',
      );

      expect(setup.path, AppStrings.loginTotpEnrollSetupPath);
      expect(setup.toJson(), {'challenge_id': '64b1f0c8e4b0a1d2c3e4f567'});
      expect(activate.path, AppStrings.loginTotpEnrollActivatePath);
      expect(activate.toJson(), {
        'challenge_id': '64b1f0c8e4b0a1d2c3e4f567',
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

    test('parses must_change_password and password_expired on user', () {
      final forced = UserModel.fromJson({
        '_id': 'user-1',
        'login_id': 'patient@example.test',
        'user_type': 'PATIENT',
        'is_active': true,
        'must_change_password': true,
        'password_expired': false,
      });
      final expired = UserModel.fromJson({
        '_id': 'user-2',
        'login_id': 'patient2@example.test',
        'user_type': 'PATIENT',
        'is_active': true,
        'must_change_password': false,
        'password_expired': true,
      });
      final normal = UserModel.fromJson({
        '_id': 'user-3',
        'login_id': 'patient3@example.test',
        'user_type': 'PATIENT',
        'is_active': true,
      });

      expect(forced.mustChangePassword, isTrue);
      expect(forced.passwordExpired, isFalse);
      expect(expired.mustChangePassword, isTrue);
      expect(expired.passwordExpired, isTrue);
      expect(normal.mustChangePassword, isFalse);
    });

    test('builds change-password request for backend endpoint', () {
      final request = ChangePasswordRequest(
        currentPassword: 'TempPass!1',
        newPassword: 'NewStrong!2',
      );

      expect(request.path, AppStrings.changePasswordPath);
      expect(request.toJson(), {
        'current_password': 'TempPass!1',
        'new_password': 'NewStrong!2',
      });
    });
  });
}
