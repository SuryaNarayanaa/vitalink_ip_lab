import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/core/widgets/admin/admin_access_gate.dart';
import 'package:frontend/core/widgets/admin/admin_access_scope.dart';
import 'package:frontend/core/widgets/admin/admin_scaffold.dart';
import 'package:frontend/features/admin/access_control_page.dart';
import 'package:frontend/features/admin/admin_accounts_page.dart';
import 'package:frontend/features/admin/admin_capabilities.dart';
import 'package:frontend/features/admin/admin_dashboard_page.dart';
import 'package:frontend/features/admin/data/admin_access_repository.dart';
import 'package:frontend/features/admin/data/admin_repository.dart';
import 'package:frontend/features/admin/models/admin_access_model.dart';
import 'package:frontend/features/admin/models/admin_account_model.dart';
import 'package:frontend/features/admin/models/admin_mfa_model.dart';
import 'package:frontend/features/admin/models/admin_policy_ui_models.dart';
import 'package:frontend/features/admin/models/admin_role_policy_model.dart';
import 'package:frontend/features/admin/models/admin_stats_model.dart';
import 'package:frontend/features/admin/platform_configuration_page.dart';
import 'package:frontend/features/admin/state/admin_access_controller.dart';
import 'package:frontend/features/admin/system_config_page.dart';
import 'package:frontend/features/admin/system_health_page.dart';

class _MutableAccessRepository implements AdminAccessRepository {
  _MutableAccessRepository(this.current);

  AdminAccessModel current;

  @override
  Future<AdminAccessModel> fetchCurrentAccess() => getCurrentAccess();

  @override
  Future<AdminAccessModel> getCurrentAccess() async => current;
}

class _FakeAdminRepository extends AdminRepository {
  _FakeAdminRepository() : super(apiClient: ApiClient());

  List<AdminRolePolicyModel> policies = const [];
  AdminRolePolicyModel? latestPolicy;
  List<AdminRolePolicyRevisionModel> revisions = const [];
  List<AdminAccountModel> accounts = const [];
  Map<String, dynamic>? createdAccountPayload;
  Object? previewPolicyError;
  Object? updatePolicyError;
  Object? restorePreviewError;
  Object? restorePolicyError;
  final List<String> policyMutationEvents = <String>[];
  int statsCalls = 0;
  int accountCalls = 0;
  int createAccountCalls = 0;
  int updateAccountCalls = 0;
  int resetAccountMfaCalls = 0;
  int policyReadCalls = 0;
  int previewPolicyCalls = 0;
  int updatePolicyCalls = 0;
  int restorePreviewCalls = 0;
  int restorePolicyCalls = 0;
  int configCalls = 0;
  int configMutationCalls = 0;
  int healthCalls = 0;
  int operationsHealthCalls = 0;
  int mfaStatusCalls = 0;

  @override
  Future<AdminStatsModel> getAdminStats() async {
    statsCalls++;
    return AdminStatsModel(doctors: DoctorStats(), patients: PatientStats());
  }

  @override
  Future<List<AdminRolePolicyModel>> getRolePolicies() async {
    policyReadCalls++;
    return policies;
  }

  @override
  Future<AdminRolePolicyModel> getRolePolicy(AdminRole role) async {
    return latestPolicy ?? policies.firstWhere((policy) => policy.role == role);
  }

  @override
  Future<List<AdminRolePolicyRevisionModel>> getRolePolicyHistory(
    AdminRole role, {
    int limit = 50,
    int? beforeVersion,
  }) async => revisions.where((revision) => revision.role == role).toList();

  @override
  Future<AdminRolePolicyPreviewModel> previewRolePolicy({
    required AdminRole role,
    required Map<String, bool> capabilities,
    required int expectedVersion,
  }) async {
    previewPolicyCalls++;
    policyMutationEvents.add('preview');
    final error = previewPolicyError;
    if (error != null) throw error;
    return AdminRolePolicyPreviewModel(
      role: role,
      currentVersion: expectedVersion,
      affectedActiveAccounts: 2,
      added: capabilities.entries
          .where((entry) => entry.value)
          .map((entry) => entry.key),
      removed: const [],
      warnings: const ['Changes apply on the next backend request.'],
    );
  }

  @override
  Future<AdminRolePolicyModel> updateRolePolicyV2({
    required AdminRole role,
    required Map<String, bool> capabilities,
    required int expectedVersion,
    required String changeReason,
  }) async {
    updatePolicyCalls++;
    policyMutationEvents.add('update');
    final error = updatePolicyError;
    if (error != null) throw error;
    final updated = latestPolicy ?? policies.first;
    policies = [
      for (final policy in policies)
        if (policy.role == role) updated else policy,
    ];
    return updated;
  }

  @override
  Future<AdminRolePolicyPreviewModel> previewRolePolicyRestore({
    required AdminRole role,
    required String revisionId,
    required int expectedVersion,
  }) async {
    restorePreviewCalls++;
    policyMutationEvents.add('restore-preview');
    final error = restorePreviewError;
    if (error != null) throw error;
    return AdminRolePolicyPreviewModel(
      role: role,
      currentVersion: expectedVersion,
      affectedActiveAccounts: 2,
      added: const [],
      removed: const [AdminCapabilities.tenantDoctorsRead],
      warnings: const ['Restore creates a new policy version.'],
      sourceRevisionId: revisionId,
      sourcePolicyVersion: expectedVersion - 1,
    );
  }

  @override
  Future<AdminRolePolicyModel> restoreRolePolicy({
    required AdminRole role,
    required String revisionId,
    required int expectedVersion,
    required String changeReason,
  }) async {
    restorePolicyCalls++;
    policyMutationEvents.add('restore');
    final error = restorePolicyError;
    if (error != null) throw error;
    final restored = latestPolicy ?? policies.first;
    policies = [
      for (final policy in policies)
        if (policy.role == role) restored else policy,
    ];
    return restored;
  }

  @override
  Future<List<AdminAccountModel>> getAdminAccounts() async {
    accountCalls++;
    return accounts;
  }

  @override
  Future<Map<String, dynamic>> getHospitals({
    String? status,
    String? search,
  }) async {
    return {
      'hospitals': [
        {
          'id': 'hospital-1',
          'name': 'General Hospital',
          'code': 'GH',
          'status': 'active',
        },
      ],
    };
  }

  @override
  Future<AdminAccountMutationResult> createAdminAccount(
    Map<String, dynamic> data,
  ) async {
    createAccountCalls++;
    createdAccountPayload = Map<String, dynamic>.from(data);
    return const AdminAccountMutationResult(payload: {});
  }

  @override
  Future<AdminAccountMutationResult> updateAdminAccount(
    String id,
    Map<String, dynamic> data,
  ) async {
    updateAccountCalls++;
    return const AdminAccountMutationResult(payload: {});
  }

  @override
  Future<Map<String, dynamic>> resetAdminAccountMfa(String id) async {
    resetAccountMfaCalls++;
    return const {};
  }

  @override
  Future<AdminTotpStatus> getAdminTotpStatus() async {
    mfaStatusCalls++;
    return AdminTotpStatus(
      factorType: 'TOTP',
      status: 'NOT_CONFIGURED',
      enabled: false,
    );
  }

  @override
  Future<Map<String, dynamic>> getSystemConfig() async {
    configCalls++;
    return const {};
  }

  @override
  Future<Map<String, dynamic>> updateSystemConfig(
    Map<String, dynamic> data,
  ) async {
    configMutationCalls++;
    return const {};
  }

  @override
  Future<SystemHealthModel> getSystemHealth() async {
    healthCalls++;
    return SystemHealthModel.fromJson({
      'status': 'healthy',
      'uptime': 10,
      'database': {'status': 'healthy'},
    });
  }

  @override
  Future<Map<String, dynamic>> getReminderDeliveryHealth() async {
    operationsHealthCalls++;
    return const {
      'remindersLast24Hours': 1,
      'overdueDeliveries': 0,
      'deliveriesByStatus': {'SUCCEEDED': 1},
    };
  }
}

AdminAccessModel _access(
  AdminRole role,
  Iterable<String> capabilities, {
  int policyVersion = 1,
}) {
  final tenant = role == AdminRole.hospitalAdmin;
  return AdminAccessModel(
    schemaVersion: 2,
    userId: '${role.wireValue}-1',
    role: role,
    scope: tenant ? AdminScope.tenant : AdminScope.global,
    hospital: tenant
        ? const AdminHospitalIdentity(
            id: 'hospital-1',
            code: 'GH',
            name: 'General Hospital',
          )
        : null,
    effectiveCapabilities: capabilities,
    policyVersion: policyVersion,
    readOnly: role == AdminRole.auditor,
  );
}

AdminRolePolicyModel _policy(
  AdminRole role, {
  int version = 1,
  bool enabled = false,
}) {
  final capability = role == AdminRole.hospitalAdmin
      ? AdminCapabilities.tenantDoctorsRead
      : AdminCapabilities.platformAuditRead;
  return AdminRolePolicyModel(
    schemaVersion: 2,
    role: role,
    label: role == AdminRole.hospitalAdmin
        ? 'Hospital Admin'
        : 'System Auditor',
    description: 'Policy description',
    isProtected: false,
    capabilities: {capability: enabled},
    policyVersion: version,
    activeAccountCount: 2,
    changeReason: 'Initial policy',
  );
}

AdminRolePolicyRevisionModel _revision(
  AdminRole role, {
  int previousVersion = 1,
  int newVersion = 2,
}) {
  final capability = role == AdminRole.hospitalAdmin
      ? AdminCapabilities.tenantDoctorsRead
      : AdminCapabilities.platformAuditRead;
  return AdminRolePolicyRevisionModel(
    id: 'revision-$newVersion',
    role: role,
    previousPolicyVersion: previousVersion,
    newPolicyVersion: newVersion,
    previousCapabilities: {capability: false},
    newCapabilities: {capability: true},
    actorRole: AdminRole.appAdmin,
    changeReason: 'Previous reviewed policy',
    affectedActiveAccountCount: 2,
  );
}

Future<AdminAccessController> _pumpWithAccess(
  WidgetTester tester, {
  required AdminAccessModel access,
  required Widget child,
  Size size = const Size(1200, 900),
  _MutableAccessRepository? accessRepository,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  final repository = accessRepository ?? _MutableAccessRepository(access);
  final controller = AdminAccessController(
    repository: repository,
    refreshInterval: Duration.zero,
  );
  await controller.refresh();
  addTearDown(controller.dispose);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    QueryClientProvider(
      client: AppDependencies.createQueryClient(),
      child: MaterialApp(
        home: AdminAccessScope(
          controller: controller,
          child: Scaffold(body: child),
        ),
      ),
    ),
  );
  await tester.pump();
  return controller;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(() async {
    await QueryCache.instance.clear();
  });

  testWidgets(
    'admin navigation shows only destinations readable by each role',
    (tester) async {
      final appRepository = _FakeAdminRepository();
      await _pumpWithAccess(
        tester,
        access: _access(AdminRole.appAdmin, const [
          AdminCapabilities.platformAnalyticsRead,
          AdminCapabilities.platformHospitalsRead,
          AdminCapabilities.platformAdminAccountsRead,
          AdminCapabilities.platformRolePolicyRead,
          AdminCapabilities.platformSystemConfigRead,
          AdminCapabilities.platformSystemHealthRead,
        ]),
        child: AdminDashboardPage(repository: appRepository),
      );
      await tester.pump();

      expect(find.text('Administrator Accounts'), findsOneWidget);
      expect(find.text('Access Control'), findsOneWidget);
      expect(find.text('Platform Configuration'), findsOneWidget);
      expect(find.text('Doctors'), findsNothing);
      expect(find.text('Operations Health'), findsNothing);

      await tester.pumpWidget(const SizedBox.shrink());

      final hospitalRepository = _FakeAdminRepository();
      await _pumpWithAccess(
        tester,
        access: _access(AdminRole.hospitalAdmin, const [
          AdminCapabilities.tenantDashboardRead,
          AdminCapabilities.tenantDoctorsRead,
          AdminCapabilities.tenantPatientsRead,
          AdminCapabilities.tenantOperationsHealthRead,
        ]),
        child: AdminDashboardPage(repository: hospitalRepository),
      );

      expect(find.text('Doctors'), findsOneWidget);
      expect(find.text('Patients'), findsOneWidget);
      expect(find.text('Operations Health'), findsOneWidget);
      expect(find.text('Administrator Accounts'), findsNothing);
      expect(find.text('Access Control'), findsNothing);
      expect(find.text('Personal Security'), findsOneWidget);
    },
  );

  testWidgets(
    'access refresh evicts a selected destination that became denied',
    (tester) async {
      final initialAccess = _access(AdminRole.appAdmin, const [
        AdminCapabilities.platformAnalyticsRead,
        AdminCapabilities.platformAdminAccountsRead,
      ]);
      final accessRepository = _MutableAccessRepository(initialAccess);
      final repository = _FakeAdminRepository();
      final controller = await _pumpWithAccess(
        tester,
        access: initialAccess,
        accessRepository: accessRepository,
        child: AdminDashboardPage(repository: repository),
      );
      await tester.pump();
      expect(repository.accountCalls, 0);

      await tester.tap(find.text('Administrator Accounts'));
      await tester.pump();
      await tester.pump();
      expect(repository.accountCalls, 1);
      expect(
        find.byKey(const ValueKey('admin-page-admin-accounts')),
        findsOneWidget,
      );

      accessRepository.current = _access(AdminRole.appAdmin, const [
        AdminCapabilities.platformAnalyticsRead,
      ], policyVersion: 2);
      await controller.refresh();
      await tester.pump();

      expect(find.text('Administrator Accounts'), findsNothing);
      expect(
        find.byKey(const ValueKey('admin-page-admin-accounts')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('admin-page-dashboard')),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'auditor sees persistent read-only explanation and no mutations',
    (tester) async {
      final repository = _FakeAdminRepository()
        ..policies = [_policy(AdminRole.auditor, enabled: true)];
      await _pumpWithAccess(
        tester,
        access: _access(AdminRole.auditor, const [
          AdminCapabilities.platformAnalyticsRead,
          AdminCapabilities.platformRolePolicyRead,
          AdminCapabilities.platformSystemHealthRead,
        ]),
        child: AdminDashboardPage(repository: repository),
      );
      await tester.pump();

      expect(
        find.textContaining('System Auditor read-only mode'),
        findsOneWidget,
      );
      expect(find.text('Access Control'), findsOneWidget);
      expect(find.text('Platform Health'), findsOneWidget);
      expect(find.text('Administrator Accounts'), findsNothing);
      expect(find.text('Platform Configuration'), findsNothing);
      expect(find.text('Notifications'), findsNothing);
      expect(find.text('Doctors'), findsNothing);

      await tester.tap(find.text('Access Control'));
      await tester.pump();
      await tester.pump();

      expect(find.textContaining('Read-only policy review'), findsOneWidget);
      expect(find.byType(Switch), findsNothing);
      expect(find.text('Preview changes'), findsNothing);
      expect(find.text('Restore'), findsNothing);
      expect(repository.previewPolicyCalls, 0);
      expect(repository.updatePolicyCalls, 0);
      expect(repository.restorePreviewCalls, 0);
      expect(repository.restorePolicyCalls, 0);
    },
  );

  testWidgets('direct access-control construction denies Hospital Admin', (
    tester,
  ) async {
    final repository = _FakeAdminRepository();
    await _pumpWithAccess(
      tester,
      access: _access(AdminRole.hospitalAdmin, const [
        AdminCapabilities.tenantDashboardRead,
      ]),
      child: AccessControlPage(repository: repository),
    );

    expect(
      find.textContaining('Hospital Admins cannot view or change'),
      findsOneWidget,
    );
    expect(find.byIcon(Icons.lock_outline_rounded), findsOneWidget);
    expect(repository.policyReadCalls, 0);
    expect(repository.previewPolicyCalls, 0);
    expect(repository.updatePolicyCalls, 0);
    expect(repository.restorePreviewCalls, 0);
    expect(repository.restorePolicyCalls, 0);
  });

  testWidgets('policy conflict preserves the local draft for comparison', (
    tester,
  ) async {
    final initial = _policy(AdminRole.hospitalAdmin);
    final server = _policy(AdminRole.hospitalAdmin, version: 2);
    final repository = _FakeAdminRepository()
      ..policies = [initial]
      ..latestPolicy = server
      ..updatePolicyError = ApiConflictException(
        'Policy changed',
        statusCode: 409,
      );
    await _pumpWithAccess(
      tester,
      access: _access(AdminRole.appAdmin, const [
        AdminCapabilities.platformRolePolicyRead,
        AdminCapabilities.platformRolePolicyManage,
      ]),
      child: AccessControlPage(repository: repository),
    );
    await tester.pump();

    await tester.tap(find.byType(Switch).first);
    await tester.pump();
    expect(tester.widget<Switch>(find.byType(Switch).first).value, isTrue);

    await tester.tap(find.text('Preview changes'));
    await tester.pump();
    await tester.enterText(
      find.byKey(const Key('policy-change-reason')),
      'Reviewed tenant access update',
    );
    await tester.tap(find.byKey(const Key('confirm-policy-change')));
    await tester.pump();
    await tester.pump();

    expect(find.textContaining('Server version 2 is newer'), findsOneWidget);
    expect(tester.widget<Switch>(find.byType(Switch).first).value, isTrue);
    expect(repository.policyMutationEvents, ['preview', 'update']);
    expect(repository.updatePolicyCalls, 1);
  });

  testWidgets('policy preview and save succeed in order and clear the draft', (
    tester,
  ) async {
    final initial = _policy(AdminRole.hospitalAdmin);
    final updated = _policy(AdminRole.hospitalAdmin, version: 2, enabled: true);
    final repository = _FakeAdminRepository()
      ..policies = [initial]
      ..latestPolicy = updated;
    await _pumpWithAccess(
      tester,
      access: _access(AdminRole.appAdmin, const [
        AdminCapabilities.platformRolePolicyRead,
        AdminCapabilities.platformRolePolicyManage,
      ]),
      child: AccessControlPage(repository: repository),
    );
    await tester.pump();

    await tester.tap(find.byType(Switch).first);
    await tester.pump();
    await tester.tap(find.text('Preview changes'));
    await tester.pump();

    expect(
      find.textContaining('2 active administrator account'),
      findsOneWidget,
    );
    expect(
      find.text('Changes apply on the next backend request.'),
      findsOneWidget,
    );

    await tester.enterText(
      find.byKey(const Key('policy-change-reason')),
      'Reviewed tenant access update',
    );
    await tester.tap(find.byKey(const Key('confirm-policy-change')));
    await tester.pump();
    await tester.pump();

    expect(repository.policyMutationEvents, ['preview', 'update']);
    expect(repository.previewPolicyCalls, 1);
    expect(repository.updatePolicyCalls, 1);
    expect(find.text('Access policy updated.'), findsOneWidget);
    expect(find.text('Preview changes'), findsNothing);
    expect(tester.widget<Switch>(find.byType(Switch).first).value, isTrue);
  });

  testWidgets('preview failure keeps the unsaved policy draft', (tester) async {
    final initial = _policy(AdminRole.hospitalAdmin);
    final repository = _FakeAdminRepository()
      ..policies = [initial]
      ..previewPolicyError = ApiException(
        'Preview unavailable',
        kind: ApiErrorKind.network,
      );
    await _pumpWithAccess(
      tester,
      access: _access(AdminRole.appAdmin, const [
        AdminCapabilities.platformRolePolicyRead,
        AdminCapabilities.platformRolePolicyManage,
      ]),
      child: AccessControlPage(repository: repository),
    );
    await tester.pump();

    await tester.tap(find.byType(Switch).first);
    await tester.pump();
    await tester.tap(find.text('Preview changes'));
    await tester.pump();

    expect(repository.previewPolicyCalls, 1);
    expect(repository.updatePolicyCalls, 0);
    expect(find.text('Preview unavailable'), findsOneWidget);
    expect(find.text('Preview changes'), findsOneWidget);
    expect(tester.widget<Switch>(find.byType(Switch).first).value, isTrue);
  });

  testWidgets('save network failure keeps the confirmed policy draft', (
    tester,
  ) async {
    final initial = _policy(AdminRole.hospitalAdmin);
    final repository = _FakeAdminRepository()
      ..policies = [initial]
      ..updatePolicyError = ApiException(
        'Network unavailable.',
        kind: ApiErrorKind.network,
      );
    await _pumpWithAccess(
      tester,
      access: _access(AdminRole.appAdmin, const [
        AdminCapabilities.platformRolePolicyRead,
        AdminCapabilities.platformRolePolicyManage,
      ]),
      child: AccessControlPage(repository: repository),
    );
    await tester.pump();

    await tester.tap(find.byType(Switch).first);
    await tester.pump();
    await tester.tap(find.text('Preview changes'));
    await tester.pump();
    await tester.enterText(
      find.byKey(const Key('policy-change-reason')),
      'Reviewed tenant access update',
    );
    await tester.tap(find.byKey(const Key('confirm-policy-change')));
    await tester.pump();
    await tester.pump();

    expect(repository.policyMutationEvents, ['preview', 'update']);
    expect(
      find.text('Network unavailable. Your draft was kept.'),
      findsOneWidget,
    );
    expect(find.text('Preview changes'), findsOneWidget);
    expect(tester.widget<Switch>(find.byType(Switch).first).value, isTrue);
  });

  testWidgets('policy restore always previews and writes a new version', (
    tester,
  ) async {
    final current = _policy(AdminRole.hospitalAdmin, version: 3, enabled: true);
    final restored = _policy(AdminRole.hospitalAdmin, version: 4);
    final repository = _FakeAdminRepository()
      ..policies = [current]
      ..latestPolicy = restored
      ..revisions = [
        _revision(AdminRole.hospitalAdmin, previousVersion: 1, newVersion: 2),
      ];
    await _pumpWithAccess(
      tester,
      access: _access(AdminRole.appAdmin, const [
        AdminCapabilities.platformRolePolicyRead,
        AdminCapabilities.platformRolePolicyManage,
      ]),
      child: AccessControlPage(repository: repository),
    );
    await tester.pump();

    await tester.tap(find.text('Policy history'));
    await tester.pumpAndSettle();
    final restore = find.text('Restore');
    await tester.ensureVisible(restore);
    await tester.tap(restore);
    await tester.pump();

    expect(find.text('Restore as new version'), findsOneWidget);
    expect(find.text('Restore creates a new policy version.'), findsOneWidget);
    await tester.enterText(
      find.byKey(const Key('policy-change-reason')),
      'Restore reviewed policy',
    );
    await tester.tap(find.byKey(const Key('confirm-policy-change')));
    await tester.pump();
    await tester.pump();

    expect(repository.policyMutationEvents, ['restore-preview', 'restore']);
    expect(repository.restorePreviewCalls, 1);
    expect(repository.restorePolicyCalls, 1);
    expect(
      find.text('Policy restored as a new policy version.'),
      findsOneWidget,
    );
    expect(find.text('Version 4'), findsOneWidget);
  });

  testWidgets('administrator form never offers app admin and scopes by role', (
    tester,
  ) async {
    final repository = _FakeAdminRepository();
    await _pumpWithAccess(
      tester,
      access: _access(AdminRole.appAdmin, const [
        AdminCapabilities.platformAdminAccountsRead,
        AdminCapabilities.platformAdminAccountsManage,
      ]),
      child: AdminAccountsPage(repository: repository),
    );
    await tester.pump();

    await tester.tap(find.byKey(const Key('invite-admin-account')));
    await tester.pump();
    await tester.pump();

    expect(find.text('Application Admin'), findsNothing);
    expect(find.byKey(const Key('admin-account-hospital')), findsOneWidget);

    await tester.tap(find.byKey(const Key('admin-account-role')));
    await tester.pump();
    await tester.tap(find.text('System Auditor').last);
    await tester.pump();

    expect(find.byKey(const Key('admin-account-hospital')), findsNothing);
    await tester.enterText(
      find.byKey(const Key('admin-account-name')),
      'Audit User',
    );
    await tester.enterText(
      find.byKey(const Key('admin-account-email')),
      'audit@example.com',
    );
    await tester.tap(find.byKey(const Key('save-admin-account')));
    await tester.pump();
    await tester.pump();

    expect(repository.createdAccountPayload?['role'], 'auditor');
    expect(repository.createdAccountPayload?['hospital_id'], isNull);
  });

  testWidgets('hospital administrator form requires an active hospital scope', (
    tester,
  ) async {
    final repository = _FakeAdminRepository();
    await _pumpWithAccess(
      tester,
      access: _access(AdminRole.appAdmin, const [
        AdminCapabilities.platformAdminAccountsRead,
        AdminCapabilities.platformAdminAccountsManage,
      ]),
      child: AdminAccountsPage(repository: repository),
    );
    await tester.pump();

    await tester.tap(find.byKey(const Key('invite-admin-account')));
    await tester.pump();
    await tester.pump();
    await tester.enterText(
      find.byKey(const Key('admin-account-name')),
      'Hospital Operator',
    );
    await tester.enterText(
      find.byKey(const Key('admin-account-email')),
      'operator@example.com',
    );
    await tester.tap(find.byKey(const Key('save-admin-account')));
    await tester.pump();

    expect(find.text('Select an active hospital.'), findsOneWidget);
    expect(repository.createAccountCalls, 0);

    await tester.tap(find.byKey(const Key('admin-account-hospital')));
    await tester.pump();
    await tester.tap(find.text('General Hospital').last);
    await tester.pump();
    await tester.tap(find.byKey(const Key('save-admin-account')));
    await tester.pump();
    await tester.pump();

    expect(repository.createAccountCalls, 1);
    expect(repository.createdAccountPayload?['role'], 'hospital_admin');
    expect(repository.createdAccountPayload?['hospital_id'], 'hospital-1');
  });

  testWidgets('read-only administrator account access hides all mutations', (
    tester,
  ) async {
    final repository = _FakeAdminRepository()
      ..accounts = const [
        AdminAccountModel(
          id: 'auditor-1',
          loginId: 'auditor@example.com',
          name: 'Read Only Auditor',
          role: AdminRole.auditor,
          isActive: true,
          mfaEnabled: true,
        ),
      ];
    await _pumpWithAccess(
      tester,
      access: _access(AdminRole.appAdmin, const [
        AdminCapabilities.platformAdminAccountsRead,
      ]),
      child: AdminAccountsPage(repository: repository),
    );
    await tester.pump();

    expect(find.byKey(const Key('invite-admin-account')), findsNothing);
    expect(find.byType(PopupMenuButton<String>), findsNothing);
    expect(repository.accountCalls, 1);
    expect(repository.createAccountCalls, 0);
    expect(repository.updateAccountCalls, 0);
    expect(repository.resetAccountMfaCalls, 0);
  });

  testWidgets('personal security does not load config or health surfaces', (
    tester,
  ) async {
    final repository = _FakeAdminRepository();
    await _pumpWithAccess(
      tester,
      access: _access(AdminRole.hospitalAdmin, const []),
      child: SystemConfigPage(repository: repository),
    );
    await tester.pump();

    expect(find.text('Personal Security'), findsOneWidget);
    expect(repository.mfaStatusCalls, 1);
    expect(repository.configCalls, 0);
    expect(repository.healthCalls, 0);
    expect(repository.operationsHealthCalls, 0);
  });

  testWidgets(
    'platform configuration is separate and read-only without manage',
    (tester) async {
      final repository = _FakeAdminRepository();
      await _pumpWithAccess(
        tester,
        access: _access(AdminRole.appAdmin, const [
          AdminCapabilities.platformSystemConfigRead,
        ]),
        child: PlatformConfigurationPage(repository: repository),
      );
      await tester.pump();

      expect(find.text('Platform Configuration'), findsWidgets);
      expect(find.text('Personal Security'), findsNothing);
      expect(find.text('Platform Health'), findsNothing);
      expect(
        find.byKey(const Key('save-platform-configuration')),
        findsNothing,
      );
      expect(
        tester.widget<TextFormField>(find.byType(TextFormField).first).enabled,
        isFalse,
      );
      expect(repository.configCalls, 1);
      expect(repository.configMutationCalls, 0);
      expect(repository.mfaStatusCalls, 0);
      expect(repository.healthCalls, 0);
      expect(repository.operationsHealthCalls, 0);
    },
  );

  testWidgets('platform health loads only global health data for an auditor', (
    tester,
  ) async {
    final repository = _FakeAdminRepository();
    await _pumpWithAccess(
      tester,
      access: _access(AdminRole.auditor, const [
        AdminCapabilities.platformSystemHealthRead,
      ]),
      child: PlatformHealthPage(repository: repository),
    );
    await tester.pump();

    expect(find.text('Platform Health'), findsWidgets);
    expect(repository.healthCalls, 1);
    expect(repository.operationsHealthCalls, 0);
    expect(repository.configCalls, 0);
    expect(repository.configMutationCalls, 0);
    expect(repository.mfaStatusCalls, 0);
  });

  testWidgets('hospital operations health never loads platform health', (
    tester,
  ) async {
    final repository = _FakeAdminRepository();
    await _pumpWithAccess(
      tester,
      access: _access(AdminRole.hospitalAdmin, const [
        AdminCapabilities.tenantOperationsHealthRead,
      ]),
      child: HospitalOperationsHealthPage(repository: repository),
    );
    await tester.pump();

    expect(find.text('Hospital Operations Health'), findsWidgets);
    expect(repository.operationsHealthCalls, 1);
    expect(repository.healthCalls, 0);
    expect(repository.configCalls, 0);
    expect(repository.configMutationCalls, 0);
    expect(repository.mfaStatusCalls, 0);
  });

  testWidgets('platform configuration direct denial makes no config request', (
    tester,
  ) async {
    final repository = _FakeAdminRepository();
    await _pumpWithAccess(
      tester,
      access: _access(AdminRole.hospitalAdmin, const []),
      child: PlatformConfigurationPage(repository: repository),
    );

    expect(find.textContaining('only to an Application Admin'), findsOneWidget);
    expect(repository.configCalls, 0);
    expect(repository.configMutationCalls, 0);
  });

  testWidgets('access control lays out at phone tablet and desktop widths', (
    tester,
  ) async {
    final repository = _FakeAdminRepository()
      ..policies = [_policy(AdminRole.hospitalAdmin)];
    await _pumpWithAccess(
      tester,
      size: const Size(390, 844),
      access: _access(AdminRole.appAdmin, const [
        AdminCapabilities.platformRolePolicyRead,
        AdminCapabilities.platformRolePolicyManage,
      ]),
      child: AccessControlPage(repository: repository),
    );
    await tester.pump();

    expect(find.text('Access Control'), findsWidgets);
    expect(tester.takeException(), isNull);

    tester.view.physicalSize = const Size(700, 900);
    await tester.pump();
    expect(find.text('Access Control'), findsWidgets);
    expect(tester.takeException(), isNull);

    tester.view.physicalSize = const Size(1200, 900);
    await tester.pump();
    expect(find.text('Access Control'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('permission controls and denial states expose semantics', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    final repository = _FakeAdminRepository()
      ..policies = [_policy(AdminRole.hospitalAdmin)];
    await _pumpWithAccess(
      tester,
      access: _access(AdminRole.appAdmin, const [
        AdminCapabilities.platformRolePolicyRead,
        AdminCapabilities.platformRolePolicyManage,
      ]),
      child: AccessControlPage(repository: repository),
    );
    await tester.pump();

    expect(
      find.bySemanticsLabel(RegExp(r'View doctors permission\. Disabled')),
      findsOneWidget,
    );

    await tester.pumpWidget(
      const MaterialApp(
        home: AccessDeniedState(
          title: 'Denied page',
          message: 'Ask an Application Admin.',
        ),
      ),
    );
    expect(
      find.bySemanticsLabel('Denied page. Ask an Application Admin.'),
      findsOneWidget,
    );
    semantics.dispose();
  });

  testWidgets('access-denied retry is keyboard focusable and operable', (
    tester,
  ) async {
    var retries = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: AccessDeniedState(
          message: 'Permissions could not be loaded.',
          actionLabel: 'Try again',
          onAction: () async => retries++,
        ),
      ),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    expect(FocusManager.instance.primaryFocus, isNotNull);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(retries, 1);
  });

  testWidgets('admin scaffold switches between drawer and navigation rail', (
    tester,
  ) async {
    const destinations = [
      AdminNavigationItem(
        id: 'one',
        label: 'One',
        icon: Icons.looks_one_outlined,
        selectedIcon: Icons.looks_one,
      ),
      AdminNavigationItem(
        id: 'two',
        label: 'Two',
        icon: Icons.looks_two_outlined,
        selectedIcon: Icons.looks_two,
      ),
    ];

    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: AdminScaffold(
          selectedDestinationId: 'one',
          onDestinationSelected: (_) {},
          destinations: destinations,
          body: const Text('Body'),
        ),
      ),
    );
    expect(find.byType(NavigationRail), findsNothing);
    await tester.tap(find.byTooltip('Open administrator navigation'));
    await tester.pumpAndSettle();
    expect(find.byType(Drawer), findsOneWidget);

    await tester.tapAt(const Offset(380, 400));
    await tester.pumpAndSettle();

    tester.view.physicalSize = const Size(700, 900);
    await tester.pump();
    expect(find.byType(NavigationRail), findsOneWidget);
    expect(
      tester.widget<NavigationRail>(find.byType(NavigationRail)).extended,
      isFalse,
    );
    expect(tester.takeException(), isNull);

    tester.view.physicalSize = const Size(1200, 900);
    await tester.pump();
    expect(find.byType(NavigationRail), findsOneWidget);
    expect(
      tester.widget<NavigationRail>(find.byType(NavigationRail)).extended,
      isTrue,
    );
    expect(tester.takeException(), isNull);
  });
}
