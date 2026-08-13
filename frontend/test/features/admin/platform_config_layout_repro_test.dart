import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/core/widgets/admin/admin_access_scope.dart';
import 'package:frontend/features/admin/admin_capabilities.dart';
import 'package:frontend/features/admin/admin_console_components.dart';
import 'package:frontend/features/admin/admin_dashboard_page.dart';
import 'package:frontend/features/admin/data/admin_access_repository.dart';
import 'package:frontend/features/admin/data/admin_repository.dart';
import 'package:frontend/features/admin/models/admin_access_model.dart';
import 'package:frontend/features/admin/models/admin_account_model.dart';
import 'package:frontend/features/admin/models/admin_stats_model.dart';
import 'package:frontend/features/admin/state/admin_access_controller.dart';

class _AccessRepo implements AdminAccessRepository {
  _AccessRepo(this.current);
  final AdminAccessModel current;
  @override
  Future<AdminAccessModel> fetchCurrentAccess() async => current;
  @override
  Future<AdminAccessModel> getCurrentAccess() async => current;
}

class _Repo extends AdminRepository {
  _Repo() : super(apiClient: ApiClient());

  @override
  Future<AdminStatsModel> getAdminStats() async =>
      AdminStatsModel(doctors: DoctorStats(), patients: PatientStats());

  @override
  Future<Map<String, dynamic>> getSystemConfig() async {
    return {
      'inr_thresholds': {'critical_low': 1.5, 'critical_high': 4.5},
      'session_timeout_minutes': 30,
      'rate_limit': {'max_requests': 100, 'window_minutes': 15},
      'feature_flags': {'maintenance_mode': false},
    };
  }

  @override
  Future<Map<String, dynamic>> updateSystemConfig(
    Map<String, dynamic> data,
  ) async => data;

  @override
  Future<List<AdminAccountModel>> getAdminAccounts() async => const [];
}

AdminAccessModel _appAdminAccess() {
  return AdminAccessModel(
    schemaVersion: 2,
    userId: 'app-admin-1',
    role: AdminRole.appAdmin,
    scope: AdminScope.global,
    hospital: null,
    effectiveCapabilities: const [
      AdminCapabilities.platformAnalyticsRead,
      AdminCapabilities.platformHospitalsRead,
      AdminCapabilities.platformAdminAccountsRead,
      AdminCapabilities.platformRolePolicyRead,
      AdminCapabilities.platformSystemConfigRead,
      AdminCapabilities.platformSystemConfigManage,
      AdminCapabilities.platformSystemHealthRead,
      AdminCapabilities.platformBillingRead,
      AdminCapabilities.platformAuditRead,
    ],
    policyVersion: 1,
    readOnly: false,
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(() async {
    await QueryCache.instance.clear();
  });

  testWidgets(
    'platform config title keeps readable width in admin shell',
    (tester) async {
      tester.view.physicalSize = const Size(1280, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final controller = AdminAccessController(
        repository: _AccessRepo(_appAdminAccess()),
        refreshInterval: Duration.zero,
      );
      await controller.refresh();
      addTearDown(controller.dispose);

      await tester.pumpWidget(
        QueryClientProvider(
          client: AppDependencies.createQueryClient(),
          child: MaterialApp(
            home: AdminAccessScope(
              controller: controller,
              child: AdminDashboardPage(repository: _Repo()),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Platform Configuration').last);
      await tester.pumpAndSettle();

      final subtitle = find.textContaining('Global runtime settings');
      expect(subtitle, findsOneWidget);
      final subtitleBox = tester.renderObject<RenderBox>(subtitle);
      expect(
        subtitleBox.size.width,
        greaterThan(200),
        reason: 'Title/subtitle must not collapse to single-character wrap',
      );
      // Single-character wrap would make this ~20 * char-count tall.
      expect(subtitleBox.size.height, lessThan(80));

      // Page title instance (not the sidebar label) must be wide and short.
      final pageTitles = find.text('Platform Configuration');
      final pageTitleBox = pageTitles
          .evaluate()
          .map((e) => e.renderObject! as RenderBox)
          .reduce((a, b) => a.size.width >= b.size.width ? a : b);
      expect(pageTitleBox.size.width, greaterThan(200));
      expect(pageTitleBox.size.height, lessThan(40));

      // Header must not use Expanded-around-title (that caused the glyph column).
      expect(find.byType(AdminPageHeader), findsOneWidget);

      expect(find.text('Medical Thresholds'), findsOneWidget);
      expect(
        find.byKey(const Key('save-platform-configuration')),
        findsOneWidget,
      );

      // Sidebar is a fixed-width panel, not NavigationRail.
      expect(find.byType(NavigationRail), findsNothing);
      expect(find.text('VitaLink'), findsWidgets);
    },
  );

  testWidgets(
    'administrator accounts title keeps readable width in admin shell',
    (tester) async {
      tester.view.physicalSize = const Size(1280, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final controller = AdminAccessController(
        repository: _AccessRepo(_appAdminAccess()),
        refreshInterval: Duration.zero,
      );
      await controller.refresh();
      addTearDown(controller.dispose);

      await tester.pumpWidget(
        QueryClientProvider(
          client: AppDependencies.createQueryClient(),
          child: MaterialApp(
            home: AdminAccessScope(
              controller: controller,
              child: AdminDashboardPage(repository: _Repo()),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Administrator Accounts').last);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      final subtitle = find.textContaining('Manage Hospital Admin');
      expect(subtitle, findsOneWidget);
      final box = tester.renderObject<RenderBox>(subtitle);
      expect(box.size.width, greaterThan(200));
      expect(box.size.height, lessThan(80));
      expect(find.byIcon(Icons.search_rounded), findsOneWidget);
    },
  );

  testWidgets(
    'sidebar stays compact-width on tablet breakpoint',
    (tester) async {
      tester.view.physicalSize = const Size(700, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final controller = AdminAccessController(
        repository: _AccessRepo(_appAdminAccess()),
        refreshInterval: Duration.zero,
      );
      await controller.refresh();
      addTearDown(controller.dispose);

      await tester.pumpWidget(
        QueryClientProvider(
          client: AppDependencies.createQueryClient(),
          child: MaterialApp(
            home: AdminAccessScope(
              controller: controller,
              child: AdminDashboardPage(repository: _Repo()),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(NavigationRail), findsNothing);
      // Compact mode uses icon buttons with tooltips instead of labels.
      expect(find.byTooltip('Platform Configuration'), findsOneWidget);
      expect(find.text('Platform Configuration'), findsNothing);
    },
  );
}
