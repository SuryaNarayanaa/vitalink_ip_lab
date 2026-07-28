import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/features/admin/models/admin_access_model.dart';
import 'package:frontend/features/admin/models/admin_account_model.dart';
import 'package:frontend/features/admin/models/admin_role_policy_model.dart';

void main() {
  group('AdminAccessModel', () {
    test('parses the exact global effective-access response', () {
      final access = AdminAccessModel.fromJson({
        'schema_version': 2,
        'user_id': 'admin-1',
        'role': 'app_admin',
        'scope': 'global',
        'hospital': null,
        'effective_capabilities': [
          'platform.hospitals.read',
          'platform.role_policy.manage',
        ],
        'policy_version': 7,
        'read_only': false,
      });

      expect(access.schemaVersion, 2);
      expect(access.userId, 'admin-1');
      expect(access.role, AdminRole.appAdmin);
      expect(access.scope, AdminScope.global);
      expect(access.hospital, isNull);
      expect(access.policyVersion, 7);
      expect(access.readOnly, isFalse);
      expect(access.can('platform.hospitals.read'), isTrue);
      expect(access.can('tenant.doctors.read'), isFalse);
      expect(
        access.canAny(['tenant.doctors.read', 'platform.role_policy.manage']),
        isTrue,
      );
    });

    test(
      'parses tenant hospital identity and removes duplicate capabilities',
      () {
        final access = AdminAccessModel.fromJson({
          'schema_version': 2,
          'user_id': 'admin-2',
          'role': 'hospital_admin',
          'scope': 'tenant',
          'hospital': {
            'id': 'hospital-1',
            'code': 'PSG-01',
            'name': 'PSG Hospitals',
          },
          'effective_capabilities': [
            'tenant.doctors.read',
            'tenant.doctors.read',
          ],
          'policy_version': 4,
          'read_only': false,
        });

        expect(access.hospital?.id, 'hospital-1');
        expect(access.hospital?.code, 'PSG-01');
        expect(access.effectiveCapabilities, {'tenant.doctors.read'});
      },
    );

    test('fails closed for an invalid role/scope relationship', () {
      expect(
        () => AdminAccessModel.fromJson({
          'schema_version': 2,
          'user_id': 'admin-3',
          'role': 'hospital_admin',
          'scope': 'global',
          'hospital': null,
          'effective_capabilities': const <String>[],
          'policy_version': 1,
          'read_only': false,
        }),
        throwsFormatException,
      );
    });

    test('rejects a non-list effective_capabilities payload', () {
      expect(
        () => AdminAccessModel.fromJson({
          'schema_version': 2,
          'user_id': 'admin-3',
          'role': 'auditor',
          'scope': 'global',
          'hospital': null,
          'effective_capabilities': {'platform.audit.read': true},
          'policy_version': 1,
          'read_only': true,
        }),
        throwsFormatException,
      );
    });

    test('trims capability names and rejects blank capability entries', () {
      final access = AdminAccessModel.fromJson({
        'schema_version': 2,
        'user_id': 'admin-4',
        'role': 'auditor',
        'scope': 'global',
        'hospital': null,
        'effective_capabilities': ['  platform.audit.read  '],
        'policy_version': 2,
        'read_only': true,
      });

      expect(access.effectiveCapabilities, {'platform.audit.read'});
      expect(access.can('  platform.audit.read  '), isTrue);
      expect(access.can('   '), isFalse);
      expect(
        () => AdminAccessModel.fromJson({
          'schema_version': 2,
          'user_id': 'admin-4',
          'role': 'auditor',
          'scope': 'global',
          'hospital': null,
          'effective_capabilities': ['platform.audit.read', '   '],
          'policy_version': 2,
          'read_only': true,
        }),
        throwsFormatException,
      );
    });

    test('rejects missing or contradictory hospital identity', () {
      expect(
        () => AdminAccessModel.fromJson({
          'schema_version': 2,
          'user_id': 'admin-5',
          'role': 'hospital_admin',
          'scope': 'tenant',
          'hospital': null,
          'effective_capabilities': const <String>[],
          'policy_version': 1,
          'read_only': false,
        }),
        throwsFormatException,
      );
      expect(
        () => AdminAccessModel.fromJson({
          'schema_version': 2,
          'user_id': 'admin-6',
          'role': 'auditor',
          'scope': 'global',
          'hospital': {'id': 'hospital-1', 'code': 'GH'},
          'effective_capabilities': const <String>[],
          'policy_version': 1,
          'read_only': true,
        }),
        throwsFormatException,
      );
    });

    test('rejects unsupported roles and malformed scalar fields', () {
      final base = <String, dynamic>{
        'schema_version': 2,
        'user_id': 'admin-7',
        'role': 'auditor',
        'scope': 'global',
        'hospital': null,
        'effective_capabilities': const <String>[],
        'policy_version': 1,
        'read_only': true,
      };

      expect(
        () => AdminAccessModel.fromJson({...base, 'role': 'doctor'}),
        throwsFormatException,
      );
      expect(
        () => AdminAccessModel.fromJson({...base, 'policy_version': '1'}),
        throwsFormatException,
      );
      expect(
        () => AdminAccessModel.fromJson({...base, 'read_only': 1}),
        throwsFormatException,
      );
    });
  });

  group('related admin models', () {
    test('parses a normalized role policy and builds a CAS update body', () {
      final policy = AdminRolePolicyModel.fromJson({
        'schema_version': 2,
        'role_key': 'auditor',
        'label': 'System Auditor',
        'description': 'Global read-only oversight',
        'protected': true,
        'capabilities': {
          'platform.audit.read': true,
          'platform.billing.read': false,
        },
        'policy_version': 9,
        'active_account_count': 3,
        'updated_at': '2026-07-26T10:00:00.000Z',
        'updated_by': 'admin-1',
        'change_reason': 'Limit billing visibility',
      });

      expect(policy.role, AdminRole.auditor);
      expect(policy.enabledCapabilities, {'platform.audit.read'});
      expect(policy.can('platform.billing.read'), isFalse);
      expect(
        policy.toUpdateJson(
          expectedVersion: policy.policyVersion,
          changeReason: ' Enable reviewed access ',
        ),
        {
          'capabilities': {
            'platform.audit.read': true,
            'platform.billing.read': false,
          },
          'expected_version': 9,
          'change_reason': 'Enable reviewed access',
        },
      );
    });

    test('parses a hospital administrator account', () {
      final account = AdminAccountModel.fromJson({
        'id': 'account-1',
        'login_id': 'hospital.admin@example.test',
        'name': 'Hospital Admin',
        'email': 'hospital.admin@example.test',
        'role': 'hospital_admin',
        'hospital': {
          'id': 'hospital-1',
          'code': 'PSG-01',
          'name': 'PSG Hospitals',
        },
        'is_active': true,
        'mfa_enabled': true,
        'created_at': '2026-07-20T10:00:00.000Z',
        'updated_at': '2026-07-26T10:00:00.000Z',
      });

      expect(account.role, AdminRole.hospitalAdmin);
      expect(account.hospital?.code, 'PSG-01');
      expect(account.isActive, isTrue);
      expect(account.mfaEnabled, isTrue);
      expect(account.hasBrokenHospitalAssignment, isFalse);
    });

    test('parses degraded hospital admin with null hospital from list API', () {
      final account = AdminAccountModel.fromJson({
        'id': 'account-2',
        'login_id': 'broken.admin@example.test',
        'name': 'Broken Hospital Admin',
        'email': 'broken.admin@example.test',
        'role': 'hospital_admin',
        'hospital': null,
        'is_active': true,
        'mfa_enabled': false,
        'assignment_status': 'invalid',
        'assignment_error':
            'Hospital Admin account is not assigned to an active hospital',
      });

      expect(account.role, AdminRole.hospitalAdmin);
      expect(account.hospital, isNull);
      expect(account.hasBrokenHospitalAssignment, isTrue);
      expect(
        account.hospitalDisplayLabel,
        'Hospital Admin account is not assigned to an active hospital',
      );
    });
  });
}
