import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/features/admin/models/admin_access_model.dart';
import 'package:frontend/features/admin/models/admin_policy_ui_models.dart';

void main() {
  test('policy preview parses snake_case and restore metadata', () {
    final preview = AdminRolePolicyPreviewModel.fromJson({
      'role_key': 'hospital_admin',
      'current_version': 7,
      'affected_active_accounts': 4,
      'added_capabilities': ['tenant.doctors.read'],
      'removed_capabilities': ['tenant.billing.read'],
      'warnings': ['Access changes immediately'],
      'source_revision_id': '507f1f77bcf86cd799439011',
      'source_policy_version': 3,
    });

    expect(preview.role, AdminRole.hospitalAdmin);
    expect(preview.currentVersion, 7);
    expect(preview.affectedActiveAccounts, 4);
    expect(preview.hasChanges, isTrue);
    expect(preview.sourcePolicyVersion, 3);
  });

  test('policy revision parses immutable capability snapshots', () {
    final revision = AdminRolePolicyRevisionModel.fromJson({
      '_id': '507f1f77bcf86cd799439011',
      'role_key': 'auditor',
      'previous_policy_version': 1,
      'new_policy_version': 2,
      'previous_capabilities': {'platform.audit.read': false},
      'new_capabilities': {'platform.audit.read': true},
      'actor_user_id': '507f191e810c19729de860ea',
      'actor_role': 'app_admin',
      'change_reason': 'Enable audit review',
      'affected_active_account_count': 2,
      'createdAt': '2026-07-26T12:00:00.000Z',
    });

    expect(revision.role, AdminRole.auditor);
    expect(revision.actorRole, AdminRole.appAdmin);
    expect(revision.newCapabilities['platform.audit.read'], isTrue);
    expect(
      () => revision.newCapabilities['platform.audit.read'] = false,
      throwsUnsupportedError,
    );
  });

  test('administrator mutation result keeps one-time password separate', () {
    final result = AdminAccountMutationResult.fromJson({
      'account': {'id': 'admin-1', 'role': 'auditor'},
      'temporary_password': 'one-time-value',
    });

    expect(result.payload['id'], 'admin-1');
    expect(result.temporaryPassword, 'one-time-value');
  });
}
