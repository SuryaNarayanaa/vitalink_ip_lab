import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/core/constants/strings.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/features/admin/data/admin_repository.dart';
import 'package:frontend/features/admin/models/admin_access_model.dart';

class _RecordingApiClient extends ApiClient {
  final List<String> requests = [];
  final List<Object?> bodies = [];
  Map<String, dynamic> response = const {};

  @override
  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    bool authenticated = true,
  }) async {
    requests.add('GET $path');
    bodies.add(queryParameters);
    return response;
  }

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? data,
    bool authenticated = true,
  }) async {
    requests.add('POST $path');
    bodies.add(data);
    return response;
  }

  @override
  Future<Map<String, dynamic>> put(
    String path, {
    Map<String, dynamic>? data,
    bool authenticated = true,
  }) async {
    requests.add('PUT $path');
    bodies.add(data);
    return response;
  }
}

void main() {
  test('loads only V2 administrator accounts from the dedicated API', () async {
    final client = _RecordingApiClient()
      ..response = {
        'admin_accounts': [
          {
            'id': 'admin-1',
            'login_id': 'hospital@example.com',
            'name': 'Hospital Admin',
            'email': 'hospital@example.com',
            'role': 'hospital_admin',
            'hospital': {
              'id': 'hospital-1',
              'code': 'GH',
              'name': 'General Hospital',
            },
            'is_active': true,
            'mfa_enabled': false,
          },
        ],
      };
    final repository = AdminRepository(apiClient: client);

    final accounts = await repository.getAdminAccounts();

    expect(client.requests, ['GET ${AppStrings.adminAccountsPath}']);
    expect(accounts.single.role, AdminRole.hospitalAdmin);
    expect(accounts.single.hospital?.code, 'GH');
  });

  test(
    'policy preview and update send expected-version CAS payloads',
    () async {
      final client = _RecordingApiClient()
        ..response = {
          'role_key': 'auditor',
          'current_version': 4,
          'affected_active_accounts': 2,
          'added_capabilities': ['platform.audit.read'],
          'removed_capabilities': <String>[],
          'warnings': <String>[],
        };
      final repository = AdminRepository(apiClient: client);
      const capabilities = {'platform.audit.read': true};

      final preview = await repository.previewRolePolicy(
        role: AdminRole.auditor,
        capabilities: capabilities,
        expectedVersion: 4,
      );

      expect(preview.added, ['platform.audit.read']);
      expect(
        client.requests.single,
        'POST ${AppStrings.adminRolePoliciesPath}/auditor/preview',
      );
      expect(client.bodies.single, {
        'capabilities': capabilities,
        'expected_version': 4,
      });

      client.response = {
        'schema_version': 2,
        'role_key': 'auditor',
        'label': 'System Auditor',
        'description': 'Read-only oversight',
        'protected': false,
        'capabilities': capabilities,
        'policy_version': 5,
        'active_account_count': 2,
        'change_reason': 'Enable audit review',
      };
      final updated = await repository.updateRolePolicyV2(
        role: AdminRole.auditor,
        capabilities: capabilities,
        expectedVersion: 4,
        changeReason: 'Enable audit review',
      );

      expect(updated.policyVersion, 5);
      expect(
        client.requests.last,
        'PUT ${AppStrings.adminRolePoliciesPath}/auditor',
      );
      expect(client.bodies.last?['expected_version'], 4);
      expect(client.bodies.last?['change_reason'], 'Enable audit review');
    },
  );

  test(
    'restore always uses preview before the audited restore endpoint',
    () async {
      final client = _RecordingApiClient()
        ..response = {
          'role_key': 'hospital_admin',
          'current_version': 6,
          'affected_active_accounts': 3,
          'added_capabilities': <String>[],
          'removed_capabilities': ['tenant.billing.read'],
          'warnings': <String>[],
          'source_revision_id': '507f1f77bcf86cd799439011',
          'source_policy_version': 2,
        };
      final repository = AdminRepository(apiClient: client);

      await repository.previewRolePolicyRestore(
        role: AdminRole.hospitalAdmin,
        revisionId: '507f1f77bcf86cd799439011',
        expectedVersion: 6,
      );

      expect(
        client.requests.single,
        'POST ${AppStrings.adminRolePoliciesPath}/hospital_admin/restore-preview',
      );
      expect(client.bodies.single?['expected_version'], 6);
      expect(client.bodies.single?['revision_id'], '507f1f77bcf86cd799439011');

      client.response = {
        'schema_version': 2,
        'role_key': 'hospital_admin',
        'label': 'Hospital Admin',
        'description': 'Tenant operations',
        'protected': false,
        'capabilities': {'tenant.doctors.read': true},
        'policy_version': 7,
        'active_account_count': 3,
        'change_reason': 'Restore reviewed policy',
      };
      final restored = await repository.restoreRolePolicy(
        role: AdminRole.hospitalAdmin,
        revisionId: '507f1f77bcf86cd799439011',
        expectedVersion: 6,
        changeReason: 'Restore reviewed policy',
      );

      expect(restored.policyVersion, 7);
      expect(
        client.requests.last,
        'POST ${AppStrings.adminRolePoliciesPath}/hospital_admin/restore',
      );
      expect(client.bodies.last, {
        'revision_id': '507f1f77bcf86cd799439011',
        'expected_version': 6,
        'change_reason': 'Restore reviewed policy',
      });
    },
  );
}
