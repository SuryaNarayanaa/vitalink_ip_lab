import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/features/admin/models/admin_mfa_model.dart';

void main() {
  group('admin MFA models', () {
    test('parses TOTP setup response without storing activation state', () {
      final enrollment = AdminTotpEnrollment.fromJson({
        'factor_type': 'AUTHENTICATOR_APP',
        'secret': 'EXAMPLESETUPKEY',
        'otpauth_url': 'otpauth://totp/VitaLink:admin?secret=EXAMPLESETUPKEY',
      });

      expect(enrollment.factorType, 'AUTHENTICATOR_APP');
      expect(enrollment.secret, 'EXAMPLESETUPKEY');
      expect(enrollment.otpauthUrl, startsWith('otpauth://totp/'));
    });

    test('parses enabled activation response', () {
      final activation = AdminTotpActivation.fromJson({
        'factor_type': 'AUTHENTICATOR_APP',
        'status': 'ENABLED',
      });

      expect(activation.factorType, 'AUTHENTICATOR_APP');
      expect(activation.status, 'ENABLED');
      expect(activation.isEnabled, isTrue);
    });

    test('parses persistent TOTP status response', () {
      final status = AdminTotpStatus.fromJson({
        'factor_type': 'AUTHENTICATOR_APP',
        'status': 'ENABLED',
        'enabled': true,
        'activated_at': '2026-07-08T10:15:00.000Z',
      });

      expect(status.factorType, 'AUTHENTICATOR_APP');
      expect(status.status, 'ENABLED');
      expect(status.isEnabled, isTrue);
      expect(status.isPending, isFalse);
      expect(status.activatedAt, isNotNull);
    });
  });
}
