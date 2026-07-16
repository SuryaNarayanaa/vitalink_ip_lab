import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/query/admin_query_keys.dart';
import 'package:frontend/core/widgets/admin/admin_scaffold.dart';
import 'package:frontend/core/widgets/admin/admin_dialogs.dart';
import 'package:frontend/core/widgets/common/api_error_state.dart';
import 'package:frontend/features/admin/data/admin_repository.dart';
import 'package:frontend/features/admin/models/admin_stats_model.dart';
import 'package:frontend/features/admin/doctor_management_page.dart';
import 'package:frontend/features/admin/patient_management_page.dart';
import 'package:frontend/features/admin/admin_console_pages.dart';
import 'package:frontend/features/admin/analytics_dashboard_page.dart';
import 'package:frontend/features/admin/notification_broadcast_page.dart';
import 'package:frontend/features/admin/audit_logs_page.dart';
import 'package:frontend/features/admin/system_config_page.dart';

class AdminDashboardPage extends StatefulWidget {
  const AdminDashboardPage({super.key});

  @override
  State<AdminDashboardPage> createState() => _AdminDashboardPageState();
}

class _AdminDashboardPageState extends State<AdminDashboardPage> {
  int _selectedIndex = 0;
  final AdminRepository _repo = AppDependencies.adminRepository;

  @override
  Widget build(BuildContext context) {
    final tabs = [
      _DashboardTab(repo: _repo),
      const HospitalManagementPage(),
      const DoctorManagementPage(),
      const PatientManagementPage(),
      const UserLifecyclePage(),
      const RolesRbacPage(),
      const BillingInvoicesPage(),
      const AnalyticsDashboardPage(),
      const NotificationBroadcastPage(),
      const AuditLogsPage(),
      const SystemConfigPage(),
    ];

    return AdminScaffold(
      selectedIndex: _selectedIndex,
      onDestinationSelected: (i) => setState(() => _selectedIndex = i),
      body: IndexedStack(index: _selectedIndex, children: tabs),
    );
  }
}

// ─── Dashboard Home Tab ───

class _DashboardTab extends StatelessWidget {
  final AdminRepository repo;
  const _DashboardTab({required this.repo});

  @override
  Widget build(BuildContext context) {
    return UseQuery<AdminStatsModel>(
      options: QueryOptions<AdminStatsModel>(
        queryKey: AdminQueryKeys.stats(),
        queryFn: repo.getAdminStats,
      ),
      builder: (context, query) {
        final refreshableBody = RefreshIndicator(
          onRefresh: () async {
            await query.refetch();
          },
          child: query.isLoading
              ? const _ScrollableCentered(child: CircularProgressIndicator())
              : query.isError
                  ? ApiErrorState(
                      error: query.error,
                      onRetry: () => query.refetch(),
                      title: 'Could not load dashboard',
                    )
                  : _DashboardContent(stats: query.data, repo: repo),
        );

        if (AdminScaffold.showsSidebar(context)) {
          return Scaffold(
            appBar: AppBar(
              title: const Text('VitaLink Admin'),
              centerTitle: true,
            ),
            body: refreshableBody,
          );
        }

        return refreshableBody;
      },
    );
  }
}

class _ScrollableCentered extends StatelessWidget {
  final Widget child;

  const _ScrollableCentered({required this.child});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final height = constraints.hasBoundedHeight
            ? constraints.maxHeight
            : MediaQuery.sizeOf(context).height;

        return ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [SizedBox(height: height, child: Center(child: child))],
        );
      },
    );
  }
}

class _DashboardContent extends StatelessWidget {
  final AdminStatsModel? stats;
  final AdminRepository repo;
  const _DashboardContent({this.stats, required this.repo});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final s = stats;

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(16),
      children: [
        // Welcome
        Text(
          'Welcome, Admin!',
          style: theme.textTheme.headlineSmall?.copyWith(
            fontWeight: FontWeight.bold,
          ),
        ),
        Text(
          _formattedDate(),
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.outline,
          ),
        ),
        const SizedBox(height: 24),

        // Stats grid
        Row(
          children: [
            Expanded(
              child: _StatsCard(
                title: 'Total Doctors',
                value: s?.doctorStats.total.toString() ?? '--',
                icon: Icons.medical_services_rounded,
                color: Colors.blue,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _StatsCard(
                title: 'Total Patients',
                value: s?.patientStats.total.toString() ?? '--',
                icon: Icons.people_rounded,
                color: Colors.green,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: _StatsCard(
                title: 'Active Doctors',
                value: s?.doctorStats.active.toString() ?? '--',
                icon: Icons.verified_user_rounded,
                color: Colors.teal,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _StatsCard(
                title: 'Active Patients',
                value: s?.patientStats.active.toString() ?? '--',
                icon: Icons.group_rounded,
                color: Colors.purple,
              ),
            ),
          ],
        ),
        const SizedBox(height: 24),

        // Quick Actions
        Text(
          'Quick Actions',
          style: theme.textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _QuickActionCard(
                title: 'Add Doctor',
                icon: Icons.person_add_rounded,
                color: Colors.blue,
                onTap: () => showAddDoctorDialog(context),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _QuickActionCard(
                title: 'Add Patient',
                icon: Icons.person_add_alt_1_rounded,
                color: Colors.green,
                onTap: () => showAddPatientDialog(context),
              ),
            ),
          ],
        ),
        const SizedBox(height: 24),
        _ReminderDeliveryHealthCard(repo: repo),
      ],
    );
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
}

class _ReminderDeliveryHealthCard extends StatelessWidget {
  const _ReminderDeliveryHealthCard({required this.repo});
  final AdminRepository repo;

  @override
  Widget build(BuildContext context) {
    return UseQuery<Map<String, dynamic>>(
      options: QueryOptions<Map<String, dynamic>>(
        queryKey: const ['admin', 'reminder-delivery-health'],
        queryFn: repo.getReminderDeliveryHealth,
      ),
      builder: (context, query) {
        final data = query.data ?? const <String, dynamic>{};
        final status =
            data['deliveriesByStatus'] as Map<String, dynamic>? ?? const {};
        final overdue = (data['overdueDeliveries'] as num?)?.toInt() ?? 0;
        final recent = (data['remindersLast24Hours'] as num?)?.toInt() ?? 0;
        final scheme = Theme.of(context).colorScheme;
        return Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Icon(Icons.notifications_active_outlined,
                      color: overdue > 0 ? scheme.error : scheme.primary),
                  const SizedBox(width: 8),
                  Expanded(
                      child: Text('Reminder delivery health',
                          style: Theme.of(context)
                              .textTheme
                              .titleMedium
                              ?.copyWith(fontWeight: FontWeight.w700))),
                  IconButton(
                      onPressed: query.refetch,
                      tooltip: 'Refresh reminder health',
                      icon: const Icon(Icons.refresh)),
                ]),
                const SizedBox(height: 8),
                if (query.isLoading)
                  const LinearProgressIndicator()
                else if (query.isError)
                  Text('Unable to load delivery health. Refresh to try again.',
                      style: TextStyle(color: scheme.error))
                else
                  Row(children: [
                    Expanded(
                        child: _ReminderMetric(
                            label: 'Sent today',
                            value: '$recent',
                            color: scheme.primary)),
                    Expanded(
                        child: _ReminderMetric(
                            label: 'Delivered',
                            value: '${status['SUCCEEDED'] ?? 0}',
                            color: Colors.green)),
                    Expanded(
                        child: _ReminderMetric(
                            label: 'Needs attention',
                            value: '$overdue',
                            color: overdue > 0
                                ? scheme.error
                                : scheme.onSurfaceVariant)),
                  ]),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _ReminderMetric extends StatelessWidget {
  const _ReminderMetric(
      {required this.label, required this.value, required this.color});
  final String label;
  final String value;
  final Color color;
  @override
  Widget build(BuildContext context) =>
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(value,
            style: Theme.of(context)
                .textTheme
                .titleLarge
                ?.copyWith(fontWeight: FontWeight.w800, color: color)),
        Text(label, style: Theme.of(context).textTheme.bodySmall),
      ]);
}

class _StatsCard extends StatelessWidget {
  final String title;
  final String value;
  final IconData icon;
  final Color color;

  const _StatsCard({
    required this.title,
    required this.value,
    required this.icon,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: color),
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
                color: theme.colorScheme.outline,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _QuickActionCard extends StatelessWidget {
  final String title;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;

  const _QuickActionCard({
    required this.title,
    required this.icon,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: color, size: 32),
              ),
              const SizedBox(height: 8),
              Text(
                title,
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
