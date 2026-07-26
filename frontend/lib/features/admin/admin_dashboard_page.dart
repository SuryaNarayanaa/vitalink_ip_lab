import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/query/admin_query_keys.dart';
import 'package:frontend/core/widgets/admin/admin_access_gate.dart';
import 'package:frontend/core/widgets/admin/admin_access_scope.dart';
import 'package:frontend/core/widgets/admin/admin_dialogs.dart';
import 'package:frontend/core/widgets/admin/admin_scaffold.dart';
import 'package:frontend/core/widgets/common/api_error_state.dart';
import 'package:frontend/core/widgets/common/page_skeleton.dart';
import 'package:frontend/features/admin/access_control_page.dart';
import 'package:frontend/features/admin/account_security_page.dart';
import 'package:frontend/features/admin/admin_accounts_page.dart';
import 'package:frontend/features/admin/admin_capabilities.dart';
import 'package:frontend/features/admin/analytics_dashboard_page.dart';
import 'package:frontend/features/admin/audit_logs_page.dart';
import 'package:frontend/features/admin/billing_invoices_page.dart';
import 'package:frontend/features/admin/data/admin_repository.dart';
import 'package:frontend/features/admin/doctor_management_page.dart';
import 'package:frontend/features/admin/hospital_management_page.dart';
import 'package:frontend/features/admin/models/admin_access_model.dart';
import 'package:frontend/features/admin/models/admin_stats_model.dart';
import 'package:frontend/features/admin/notification_broadcast_page.dart';
import 'package:frontend/features/admin/patient_management_page.dart';
import 'package:frontend/features/admin/platform_configuration_page.dart';
import 'package:frontend/features/admin/system_health_page.dart';

class AdminDestination {
  const AdminDestination({
    required this.id,
    required this.label,
    required this.icon,
    required this.selectedIcon,
    required this.builder,
    this.readCapabilities = const <String>[],
    this.actionCapability,
    this.allowedScope,
    this.allowedRoles = const <AdminRole>{},
  });

  final String id;
  final String label;
  final IconData icon;
  final IconData selectedIcon;
  final List<String> readCapabilities;
  final String? actionCapability;
  final AdminScope? allowedScope;
  final Set<AdminRole> allowedRoles;
  final WidgetBuilder builder;

  bool isReadable(AdminAccessModel access) {
    if (allowedScope != null && access.scope != allowedScope) return false;
    if (allowedRoles.isNotEmpty && !allowedRoles.contains(access.role)) {
      return false;
    }
    return readCapabilities.isEmpty || access.canAny(readCapabilities);
  }

  AdminNavigationItem get navigationItem => AdminNavigationItem(
    id: id,
    label: label,
    icon: icon,
    selectedIcon: selectedIcon,
  );
}

class AdminDashboardPage extends StatefulWidget {
  const AdminDashboardPage({super.key, this.repository});

  final AdminRepository? repository;

  @override
  State<AdminDashboardPage> createState() => _AdminDashboardPageState();
}

class _AdminDashboardPageState extends State<AdminDashboardPage> {
  late final AdminRepository _repository =
      widget.repository ?? AppDependencies.adminRepository;
  final Map<String, Widget> _pageCache = <String, Widget>{};
  final List<String> _visitedDestinationIds = <String>[];
  String? _selectedDestinationId;

  late final List<AdminDestination> _destinations = [
    AdminDestination(
      id: 'dashboard',
      label: 'Dashboard',
      icon: Icons.dashboard_outlined,
      selectedIcon: Icons.dashboard_rounded,
      readCapabilities: AdminCapabilities.dashboardRead,
      builder: (_) => _DashboardTab(repository: _repository),
    ),
    AdminDestination(
      id: 'hospitals',
      label: 'Hospitals',
      icon: Icons.local_hospital_outlined,
      selectedIcon: Icons.local_hospital_rounded,
      readCapabilities: const [AdminCapabilities.platformHospitalsRead],
      actionCapability: AdminCapabilities.platformHospitalsManage,
      allowedScope: AdminScope.global,
      builder: (_) => const HospitalManagementPage(),
    ),
    AdminDestination(
      id: 'doctors',
      label: 'Doctors',
      icon: Icons.medical_services_outlined,
      selectedIcon: Icons.medical_services_rounded,
      readCapabilities: const [AdminCapabilities.tenantDoctorsRead],
      actionCapability: AdminCapabilities.tenantDoctorsManage,
      allowedScope: AdminScope.tenant,
      builder: (_) => AdminAccessGate(
        anyCapabilities: const [AdminCapabilities.tenantDoctorsRead],
        roles: const {AdminRole.hospitalAdmin},
        scope: AdminScope.tenant,
        builder: (_) => const DoctorManagementPage(),
      ),
    ),
    AdminDestination(
      id: 'patients',
      label: 'Patients',
      icon: Icons.people_outline,
      selectedIcon: Icons.people_rounded,
      readCapabilities: const [AdminCapabilities.tenantPatientsRead],
      actionCapability: AdminCapabilities.tenantPatientsManage,
      allowedScope: AdminScope.tenant,
      builder: (_) => AdminAccessGate(
        anyCapabilities: const [AdminCapabilities.tenantPatientsRead],
        roles: const {AdminRole.hospitalAdmin},
        scope: AdminScope.tenant,
        builder: (_) => const PatientManagementPage(),
      ),
    ),
    AdminDestination(
      id: 'admin-accounts',
      label: 'Administrator Accounts',
      icon: Icons.manage_accounts_outlined,
      selectedIcon: Icons.manage_accounts_rounded,
      readCapabilities: const [AdminCapabilities.platformAdminAccountsRead],
      actionCapability: AdminCapabilities.platformAdminAccountsManage,
      allowedScope: AdminScope.global,
      allowedRoles: const {AdminRole.appAdmin},
      builder: (_) => AdminAccountsPage(repository: _repository),
    ),
    AdminDestination(
      id: 'access-control',
      label: 'Access Control',
      icon: Icons.admin_panel_settings_outlined,
      selectedIcon: Icons.admin_panel_settings_rounded,
      readCapabilities: const [AdminCapabilities.platformRolePolicyRead],
      actionCapability: AdminCapabilities.platformRolePolicyManage,
      allowedScope: AdminScope.global,
      allowedRoles: const {AdminRole.appAdmin, AdminRole.auditor},
      builder: (_) => AccessControlPage(repository: _repository),
    ),
    AdminDestination(
      id: 'billing',
      label: 'Billing',
      icon: Icons.receipt_long_outlined,
      selectedIcon: Icons.receipt_long_rounded,
      readCapabilities: AdminCapabilities.billingRead,
      builder: (_) => const BillingInvoicesPage(),
    ),
    AdminDestination(
      id: 'analytics',
      label: 'Analytics',
      icon: Icons.analytics_outlined,
      selectedIcon: Icons.analytics_rounded,
      readCapabilities: AdminCapabilities.analyticsRead,
      builder: (_) => AdminAccessGate(
        anyCapabilities: AdminCapabilities.analyticsRead,
        builder: (_) => const AnalyticsDashboardPage(),
      ),
    ),
    AdminDestination(
      id: 'notifications',
      label: 'Notifications',
      icon: Icons.notifications_outlined,
      selectedIcon: Icons.notifications_rounded,
      readCapabilities: AdminCapabilities.notificationActions,
      builder: (_) => AdminAccessGate(
        anyCapabilities: AdminCapabilities.notificationActions,
        builder: (_) => const NotificationBroadcastPage(),
      ),
    ),
    AdminDestination(
      id: 'audit',
      label: 'Audit Logs',
      icon: Icons.history_outlined,
      selectedIcon: Icons.history_rounded,
      readCapabilities: AdminCapabilities.auditRead,
      builder: (_) => AdminAccessGate(
        anyCapabilities: AdminCapabilities.auditRead,
        builder: (_) => const AuditLogsPage(),
      ),
    ),
    AdminDestination(
      id: 'personal-security',
      label: 'Personal Security',
      icon: Icons.phonelink_lock_outlined,
      selectedIcon: Icons.phonelink_lock_rounded,
      builder: (_) => AccountSecurityPage(repository: _repository),
    ),
    AdminDestination(
      id: 'platform-configuration',
      label: 'Platform Configuration',
      icon: Icons.tune_outlined,
      selectedIcon: Icons.tune_rounded,
      readCapabilities: const [AdminCapabilities.platformSystemConfigRead],
      actionCapability: AdminCapabilities.platformSystemConfigManage,
      allowedScope: AdminScope.global,
      allowedRoles: const {AdminRole.appAdmin},
      builder: (_) => PlatformConfigurationPage(repository: _repository),
    ),
    AdminDestination(
      id: 'platform-health',
      label: 'Platform Health',
      icon: Icons.monitor_heart_outlined,
      selectedIcon: Icons.monitor_heart_rounded,
      readCapabilities: const [AdminCapabilities.platformSystemHealthRead],
      allowedScope: AdminScope.global,
      allowedRoles: const {AdminRole.appAdmin, AdminRole.auditor},
      builder: (_) => PlatformHealthPage(repository: _repository),
    ),
    AdminDestination(
      id: 'operations-health',
      label: 'Operations Health',
      icon: Icons.health_and_safety_outlined,
      selectedIcon: Icons.health_and_safety_rounded,
      readCapabilities: const [AdminCapabilities.tenantOperationsHealthRead],
      allowedScope: AdminScope.tenant,
      allowedRoles: const {AdminRole.hospitalAdmin},
      builder: (_) => HospitalOperationsHealthPage(repository: _repository),
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final controller = AdminAccessScope.maybeOf(context);
    if (controller == null) {
      return const AccessDeniedState(
        title: 'Administrator access unavailable',
        message:
            'Open the administrator portal from a signed-in administrator session.',
      );
    }
    final access = controller.access;
    if (access == null) {
      if (controller.isLoading || !controller.hasLoaded) {
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
      }
      return Scaffold(
        body: AccessDeniedState(
          title: 'Could not verify administrator access',
          message:
              'VitaLink could not load your current administrator permissions. No administrator pages were loaded.',
          actionLabel: 'Try again',
          onAction: controller.refresh,
        ),
      );
    }

    final allowedDestinations = _destinations
        .where((destination) => destination.isReadable(access))
        .toList(growable: false);
    if (allowedDestinations.isEmpty) {
      return const Scaffold(
        body: AccessDeniedState(
          title: 'No administrator pages are available',
          message:
              'Your current policy does not include a readable administrator destination. Ask an Application Admin to review your role policy.',
        ),
      );
    }

    _reconcileAllowedDestinations(allowedDestinations);
    final selectedId = _selectedDestinationId!;
    final selectedDestination = allowedDestinations.firstWhere(
      (destination) => destination.id == selectedId,
    );
    _pageCache.putIfAbsent(
      selectedId,
      () => KeyedSubtree(
        key: ValueKey('admin-page-$selectedId'),
        child: Builder(builder: selectedDestination.builder),
      ),
    );
    if (!_visitedDestinationIds.contains(selectedId)) {
      _visitedDestinationIds.add(selectedId);
    }
    final selectedStackIndex = _visitedDestinationIds.indexOf(selectedId);

    return AdminScaffold(
      selectedDestinationId: selectedId,
      destinations: allowedDestinations
          .map((destination) => destination.navigationItem)
          .toList(growable: false),
      onDestinationSelected: (id) {
        if (id == _selectedDestinationId) return;
        setState(() => _selectedDestinationId = id);
      },
      body: IndexedStack(
        index: selectedStackIndex,
        children: _visitedDestinationIds
            .map((id) => _pageCache[id]!)
            .toList(growable: false),
      ),
    );
  }

  void _reconcileAllowedDestinations(
    List<AdminDestination> allowedDestinations,
  ) {
    final allowedIds = allowedDestinations
        .map((destination) => destination.id)
        .toSet();
    _pageCache.removeWhere((id, _) => !allowedIds.contains(id));
    _visitedDestinationIds.removeWhere((id) => !allowedIds.contains(id));
    if (_selectedDestinationId == null ||
        !allowedIds.contains(_selectedDestinationId)) {
      _selectedDestinationId = allowedDestinations.first.id;
    }
  }
}

class _DashboardTab extends StatelessWidget {
  const _DashboardTab({required this.repository});

  final AdminRepository repository;

  @override
  Widget build(BuildContext context) {
    return AdminAccessGate(
      anyCapabilities: AdminCapabilities.dashboardRead,
      builder: (context) {
        final access = AdminAccessScope.accessOf(context)!;
        final canReadAnalytics = access.canAny(AdminCapabilities.analyticsRead);
        final canReadPlatformHealth = access.can(
          AdminCapabilities.platformSystemHealthRead,
        );
        final canReadOperationsHealth = access.can(
          AdminCapabilities.tenantOperationsHealthRead,
        );
        final canAddDoctor = access.can(AdminCapabilities.tenantDoctorsManage);
        final canAddPatient = access.can(
          AdminCapabilities.tenantPatientsManage,
        );
        final theme = Theme.of(context);
        final body = ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              access.role == AdminRole.hospitalAdmin
                  ? 'Hospital Dashboard'
                  : 'Administrator Dashboard',
              style: theme.textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            Text(
              access.hospital?.name ??
                  access.hospital?.code ??
                  _formattedDate(),
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 20),
            if (canReadAnalytics)
              _StatsSection(repository: repository)
            else
              const _UnavailableDashboardWidget(
                icon: Icons.analytics_outlined,
                title: 'Operational analytics not included',
                message:
                    'Other permitted dashboard widgets remain available independently.',
              ),
            if (canAddDoctor || canAddPatient) ...[
              const SizedBox(height: 20),
              Text(
                'Quick Actions',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  if (canAddDoctor)
                    _QuickActionCard(
                      title: 'Add Doctor',
                      icon: Icons.person_add_rounded,
                      onTap: () => showAddDoctorDialog(context),
                    ),
                  if (canAddPatient)
                    _QuickActionCard(
                      title: 'Add Patient',
                      icon: Icons.person_add_alt_1_rounded,
                      onTap: () => showAddPatientDialog(context),
                    ),
                ],
              ),
            ],
            if (canReadPlatformHealth) ...[
              const SizedBox(height: 20),
              _PlatformHealthSummary(repository: repository),
            ],
            if (canReadOperationsHealth) ...[
              const SizedBox(height: 20),
              _ReminderDeliveryHealthCard(repository: repository),
            ],
            const SizedBox(height: 48),
          ],
        );
        if (AdminScaffold.showsSidebar(context)) {
          return Scaffold(
            appBar: AppBar(title: const Text('VitaLink Admin')),
            body: body,
          );
        }
        return body;
      },
    );
  }
}

class _StatsSection extends StatelessWidget {
  const _StatsSection({required this.repository});

  final AdminRepository repository;

  @override
  Widget build(BuildContext context) {
    return UseQuery<AdminStatsModel>(
      options: QueryOptions<AdminStatsModel>(
        queryKey: AdminQueryKeys.stats(),
        queryFn: repository.getAdminStats,
      ),
      builder: (context, query) {
        if (query.isLoading) return const PageSkeleton(cardCount: 4);
        if (query.isError) {
          return ApiErrorState(
            error: query.error,
            onRetry: query.refetch,
            title: 'Could not load operational analytics',
          );
        }
        final stats = query.data;
        return LayoutBuilder(
          builder: (context, constraints) {
            final width = constraints.maxWidth >= 720
                ? (constraints.maxWidth - 36) / 4
                : (constraints.maxWidth - 12) / 2;
            return Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                _StatsCard(
                  width: width,
                  title: 'Total Doctors',
                  value: '${stats?.doctorStats.total ?? 0}',
                  icon: Icons.medical_services_rounded,
                ),
                _StatsCard(
                  width: width,
                  title: 'Total Patients',
                  value: '${stats?.patientStats.total ?? 0}',
                  icon: Icons.people_rounded,
                ),
                _StatsCard(
                  width: width,
                  title: 'Active Doctors',
                  value: '${stats?.doctorStats.active ?? 0}',
                  icon: Icons.verified_user_rounded,
                ),
                _StatsCard(
                  width: width,
                  title: 'Active Patients',
                  value: '${stats?.patientStats.active ?? 0}',
                  icon: Icons.group_rounded,
                ),
              ],
            );
          },
        );
      },
    );
  }
}

class _PlatformHealthSummary extends StatelessWidget {
  const _PlatformHealthSummary({required this.repository});

  final AdminRepository repository;

  @override
  Widget build(BuildContext context) {
    return UseQuery<SystemHealthModel>(
      options: QueryOptions<SystemHealthModel>(
        queryKey: const ['admin', 'platform-health-summary'],
        queryFn: repository.getSystemHealth,
      ),
      builder: (context, query) {
        return Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                const Icon(Icons.monitor_heart_outlined),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Platform health',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      Text(
                        query.isLoading
                            ? 'Loading service status…'
                            : query.isError
                            ? 'Health is temporarily unavailable. Other dashboard widgets are unaffected.'
                            : 'Status: ${query.data?.status ?? 'unknown'}',
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: query.refetch,
                  tooltip: 'Refresh platform health',
                  icon: const Icon(Icons.refresh_rounded),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _ReminderDeliveryHealthCard extends StatelessWidget {
  const _ReminderDeliveryHealthCard({required this.repository});

  final AdminRepository repository;

  @override
  Widget build(BuildContext context) {
    return UseQuery<Map<String, dynamic>>(
      options: QueryOptions<Map<String, dynamic>>(
        queryKey: const ['admin', 'reminder-delivery-health'],
        queryFn: repository.getReminderDeliveryHealth,
      ),
      builder: (context, query) {
        final data = query.data ?? const <String, dynamic>{};
        final status = data['deliveriesByStatus'] is Map
            ? Map<String, dynamic>.from(data['deliveriesByStatus'] as Map)
            : const <String, dynamic>{};
        final overdue = (data['overdueDeliveries'] as num?)?.toInt() ?? 0;
        final recent = (data['remindersLast24Hours'] as num?)?.toInt() ?? 0;
        return Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.notifications_active_outlined),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Hospital reminder delivery health',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ),
                    IconButton(
                      onPressed: query.refetch,
                      tooltip: 'Refresh reminder health',
                      icon: const Icon(Icons.refresh_rounded),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                if (query.isLoading)
                  const LinearProgressIndicator()
                else if (query.isError)
                  const Text(
                    'Delivery health is temporarily unavailable. Other dashboard widgets are unaffected.',
                  )
                else
                  Wrap(
                    spacing: 24,
                    runSpacing: 12,
                    children: [
                      _ReminderMetric(label: 'Sent today', value: '$recent'),
                      _ReminderMetric(
                        label: 'Delivered',
                        value: '${status['SUCCEEDED'] ?? 0}',
                      ),
                      _ReminderMetric(
                        label: 'Needs attention',
                        value: '$overdue',
                      ),
                    ],
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _ReminderMetric extends StatelessWidget {
  const _ReminderMetric({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 140,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            value,
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
          ),
          Text(label, style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
    );
  }
}

class _StatsCard extends StatelessWidget {
  const _StatsCard({
    required this.width,
    required this.title,
    required this.value,
    required this.icon,
  });

  final double width;
  final String title;
  final String value;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SizedBox(
      width: width,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, color: theme.colorScheme.primary),
              const SizedBox(height: 12),
              Text(
                value,
                style: theme.textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              Text(
                title,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _QuickActionCard extends StatelessWidget {
  const _QuickActionCard({
    required this.title,
    required this.icon,
    required this.onTap,
  });

  final String title;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SizedBox(
      width: 220,
      child: Card(
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Icon(icon, color: theme.colorScheme.primary, size: 30),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    title,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _UnavailableDashboardWidget extends StatelessWidget {
  const _UnavailableDashboardWidget({
    required this.icon,
    required this.title,
    required this.message,
  });

  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(icon),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: Theme.of(context).textTheme.titleMedium),
                  Text(message),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

String _formattedDate() {
  final now = DateTime.now();
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return '${months[now.month - 1]} ${now.day}, ${now.year}';
}
