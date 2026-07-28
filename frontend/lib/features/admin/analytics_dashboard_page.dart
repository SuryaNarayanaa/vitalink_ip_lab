import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/core/query/admin_query_keys.dart';
import 'package:frontend/core/widgets/admin/admin_access_gate.dart';
import 'package:frontend/core/widgets/admin/admin_access_scope.dart';
import 'package:frontend/core/widgets/admin/admin_scaffold.dart';
import 'package:frontend/core/widgets/common/page_skeleton.dart';
import 'package:frontend/features/admin/admin_capabilities.dart';
import 'package:frontend/features/admin/data/admin_repository.dart';
import 'package:frontend/features/admin/models/admin_access_model.dart';
import 'package:frontend/features/admin/models/admin_stats_model.dart';

class AnalyticsDashboardPage extends StatefulWidget {
  const AnalyticsDashboardPage({super.key});

  @override
  State<AnalyticsDashboardPage> createState() => _AnalyticsDashboardPageState();
}

class _AnalyticsDashboardPageState extends State<AnalyticsDashboardPage> {
  final AdminRepository _repo = AppDependencies.adminRepository;
  String _selectedPeriod = '30d';

  Future<_AnalyticsDashboardAggregate> _fetchDashboardAggregate(
    AdminAccessModel access,
  ) async {
    final canLoadDashboardStats = access.canAny(AdminCapabilities.dashboardRead);
    final canLoadAnalytics = access.canAny(AdminCapabilities.analyticsRead);

    final statsFuture = canLoadDashboardStats
        ? _loadWithAuthStatus(_repo.getAdminStats)
        : Future.value(const _AuthLoadResult<AdminStatsModel>.skipped());
    final trendsFuture = canLoadAnalytics
        ? _loadWithAuthStatus(() => _repo.getTrends(period: _selectedPeriod))
        : Future.value(const _AuthLoadResult<RegistrationTrends>.skipped());
    final complianceFuture = canLoadAnalytics
        ? _loadWithAuthStatus(_repo.getCompliance)
        : Future.value(const _AuthLoadResult<InrComplianceStats>.skipped());
    final workloadFuture = canLoadAnalytics
        ? _loadWithAuthStatus(_repo.getWorkload)
        : Future.value(const _AuthLoadResult<List<DoctorWorkload>>.skipped());

    final stats = await statsFuture;
    final trends = await trendsFuture;
    final compliance = await complianceFuture;
    final workload = await workloadFuture;

    return _AnalyticsDashboardAggregate(
      stats: stats.value,
      statsDenied: stats.denied,
      trends: trends.value,
      trendsDenied: trends.denied,
      compliance: compliance.value,
      complianceDenied: compliance.denied,
      workload: workload.value ?? const [],
      workloadDenied: workload.denied,
    );
  }

  Future<_AuthLoadResult<T>> _loadWithAuthStatus<T>(
    Future<T> Function() loader,
  ) async {
    try {
      return _AuthLoadResult.ok(await loader());
    } on ApiException catch (error) {
      // Only capability denials are swallowed as section-level empty states.
      // Network/server/validation failures rethrow so UseQuery can surface them.
      if (error.statusCode == 403 || error.kind == ApiErrorKind.forbidden) {
        return _AuthLoadResult<T>.failed(denied: true);
      }
      rethrow;
    }
  }

  @override
  Widget build(BuildContext context) {
    return AdminAccessGate(
      anyCapabilities: [
        ...AdminCapabilities.dashboardRead,
        ...AdminCapabilities.analyticsRead,
      ],
      deniedTitle: 'Analytics not available',
      deniedMessage:
          'Your current administrator policy does not include dashboard or analytics access.',
      builder: (context) {
        final access = AdminAccessScope.accessOf(context)!;
        final showPageScaffold = !AdminScaffold.usesShellAppBar(context);
        final periodSelector = _PeriodSelector(
          selectedPeriod: _selectedPeriod,
          onChanged: (value) => setState(() => _selectedPeriod = value),
        );

        final body = UseQuery<_AnalyticsDashboardAggregate>(
          options: QueryOptions<_AnalyticsDashboardAggregate>(
            queryKey: [
              ...AdminQueryKeys.analyticsDashboard(_selectedPeriod),
              access.role.name,
              access.policyVersion,
              ...access.effectiveCapabilities,
            ],
            queryFn: () => _fetchDashboardAggregate(access),
          ),
          builder: (context, aggregateQuery) {
            if (aggregateQuery.isLoading) {
              return const PageSkeleton(cardCount: 4);
            }

            final aggregate = aggregateQuery.data;
            return SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final width = constraints.maxWidth;
                  final isDesktop = width > 900;
                  final isTablet = width > 600;
                  final chartHeight = isDesktop
                      ? 350.0
                      : isTablet
                          ? 330.0
                          : 300.0;

                  return Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (!showPageScaffold)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 16),
                            child: isTablet
                                ? Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          'Analytics Dashboard',
                                          style: Theme.of(
                                            context,
                                          ).textTheme.titleLarge,
                                        ),
                                      ),
                                      periodSelector,
                                    ],
                                  )
                                : Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        'Analytics Dashboard',
                                        style: Theme.of(
                                          context,
                                        ).textTheme.titleLarge,
                                      ),
                                      const SizedBox(height: 12),
                                      Align(
                                        alignment: Alignment.centerLeft,
                                        child: periodSelector,
                                      ),
                                    ],
                                  ),
                          ),
                        _SummaryCards(
                          stats: aggregate?.stats,
                          denied: aggregate?.statsDenied ?? false,
                        ),
                        const SizedBox(height: 24),
                        Wrap(
                          spacing: 16,
                          runSpacing: 16,
                          children: [
                            SizedBox(
                              width: isDesktop ? (width - 16) / 2 : width,
                              height: chartHeight,
                              child: _TrendsChart(
                                trends: aggregate?.trends,
                                denied: aggregate?.trendsDenied ?? false,
                              ),
                            ),
                            SizedBox(
                              width: isDesktop ? (width - 16) / 2 : width,
                              height: chartHeight,
                              child: _ComplianceChart(
                                compliance: aggregate?.compliance,
                                denied: aggregate?.complianceDenied ?? false,
                              ),
                            ),
                            SizedBox(
                              width: isDesktop ? (width - 16) / 2 : width,
                              height: chartHeight,
                              child: _WorkloadChart(
                                workload: aggregate?.workload ?? const [],
                                denied: aggregate?.workloadDenied ?? false,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  );
                },
              ),
            );
          },
        );

        if (!showPageScaffold) {
          return body;
        }

        return Scaffold(
          appBar: AppBar(
            title: const Text('Analytics Dashboard'),
            actions: [
              Padding(
                padding: const EdgeInsets.only(right: 16),
                child: _PeriodSelector(
                  selectedPeriod: _selectedPeriod,
                  onChanged: (value) => setState(() => _selectedPeriod = value),
                ),
              ),
            ],
          ),
          body: body,
        );
      },
    );
  }
}

class _AuthLoadResult<T> {
  const _AuthLoadResult._({
    this.value,
    this.denied = false,
  });

  const _AuthLoadResult.ok(T value) : this._(value: value);
  const _AuthLoadResult.failed({required bool denied}) : this._(denied: denied);
  const _AuthLoadResult.skipped() : this._(denied: true);

  final T? value;
  final bool denied;
}

class _AnalyticsDashboardAggregate {
  const _AnalyticsDashboardAggregate({
    required this.stats,
    required this.statsDenied,
    required this.trends,
    required this.trendsDenied,
    required this.compliance,
    required this.complianceDenied,
    required this.workload,
    required this.workloadDenied,
  });

  final AdminStatsModel? stats;
  final bool statsDenied;
  final RegistrationTrends? trends;
  final bool trendsDenied;
  final InrComplianceStats? compliance;
  final bool complianceDenied;
  final List<DoctorWorkload> workload;
  final bool workloadDenied;
}

class _PeriodSelector extends StatelessWidget {
  const _PeriodSelector({
    required this.selectedPeriod,
    required this.onChanged,
  });

  final String selectedPeriod;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButton<String>(
      value: selectedPeriod,
      underline: const SizedBox(),
      isDense: true,
      icon: const Icon(Icons.calendar_today_rounded, size: 20),
      items: const [
        DropdownMenuItem(value: '7d', child: Text('7 Days')),
        DropdownMenuItem(value: '30d', child: Text('30 Days')),
        DropdownMenuItem(value: '90d', child: Text('90 Days')),
        DropdownMenuItem(value: '1y', child: Text('1 Year')),
      ],
      onChanged: (value) {
        if (value != null) {
          onChanged(value);
        }
      },
    );
  }
}

// ─── Summary Cards ───
class _SummaryCards extends StatelessWidget {
  final AdminStatsModel? stats;
  final bool denied;
  const _SummaryCards({this.stats, this.denied = false});

  @override
  Widget build(BuildContext context) {
    if (denied && stats == null) {
      return const _DeniedPanel(
        title: 'Dashboard aggregates unavailable',
        message:
            'Your policy does not include dashboard aggregate access (tenant.dashboard.read or platform.analytics.read).',
      );
    }
    final s = stats;
    return LayoutBuilder(
      builder: (context, constraints) {
        final cards = [
          _SummaryCard(
            title: 'Total Patients',
            value: s?.patientStats.total.toString() ?? '--',
            icon: Icons.people_rounded,
            color: Colors.blue,
          ),
          _SummaryCard(
            title: 'Critical INR',
            value: s?.patientStats.criticalInr.toString() ?? '--',
            icon: Icons.warning_rounded,
            color: Colors.red,
          ),
          _SummaryCard(
            title: 'Active Doctors',
            value: s?.doctorStats.active.toString() ?? '--',
            icon: Icons.medical_services_rounded,
            color: Colors.green,
          ),
        ];
        final isNarrow = constraints.maxWidth < 720;

        if (isNarrow) {
          return Column(
            children: [
              for (var i = 0; i < cards.length; i++) ...[
                SizedBox(width: double.infinity, child: cards[i]),
                if (i != cards.length - 1) const SizedBox(height: 12),
              ],
            ],
          );
        }

        return Row(
          children: [
            for (var i = 0; i < cards.length; i++) ...[
              Expanded(child: cards[i]),
              if (i != cards.length - 1) const SizedBox(width: 16),
            ],
          ],
        );
      },
    );
  }
}

class _DeniedPanel extends StatelessWidget {
  const _DeniedPanel({required this.title, required this.message});

  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.lock_outline, color: theme.colorScheme.error),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    message,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  final String title, value;
  final IconData icon;
  final Color color;
  const _SummaryCard({
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

// ─── Chart Wrapper ───
class _ChartCard extends StatelessWidget {
  final String title;
  final Widget child;
  const _ChartCard({required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: Theme.of(
                context,
              ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 24),
            Expanded(child: child),
          ],
        ),
      ),
    );
  }
}

// ─── Registration Trends ───
class _TrendsChart extends StatelessWidget {
  final RegistrationTrends? trends;
  final bool denied;
  const _TrendsChart({this.trends, this.denied = false});

  @override
  Widget build(BuildContext context) {
    if (denied && trends == null) {
      return _ChartCard(
        title: 'Registration Trends',
        child: const Center(
          child: Text('Access denied for this analytics capability'),
        ),
      );
    }
    final data = trends?.dataPoints ?? [];
    if (data.isEmpty) {
      return _ChartCard(
        title: 'Registration Trends',
        child: const Center(child: Text('No data available')),
      );
    }

    final patientSpots = <FlSpot>[];
    final doctorSpots = <FlSpot>[];
    for (var i = 0; i < data.length; i++) {
      patientSpots.add(FlSpot(i.toDouble(), data[i].patients.toDouble()));
      doctorSpots.add(FlSpot(i.toDouble(), data[i].doctors.toDouble()));
    }
    final maxP = data.fold<int>(0, (m, t) => t.patients > m ? t.patients : m);
    final maxD = data.fold<int>(0, (m, t) => t.doctors > m ? t.doctors : m);
    final maxY = ((maxP > maxD ? maxP : maxD) * 1.2).ceilToDouble();

    return _ChartCard(
      title: 'Registration Trends',
      child: LineChart(
        LineChartData(
          gridData: FlGridData(show: true, drawVerticalLine: false),
          titlesData: FlTitlesData(
            topTitles: const AxisTitles(
              sideTitles: SideTitles(showTitles: false),
            ),
            rightTitles: const AxisTitles(
              sideTitles: SideTitles(showTitles: false),
            ),
            bottomTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: 30,
                interval:
                    data.length > 7 ? (data.length / 7).ceilToDouble() : 1,
                getTitlesWidget: (v, _) {
                  final i = v.toInt();
                  if (i >= 0 && i < data.length) {
                    final parts = data[i].date.split('-');
                    return Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        parts.length >= 2
                            ? '${parts[1]}/${parts.length > 2 ? parts[2] : ""}'
                            : '',
                        style: const TextStyle(fontSize: 10),
                      ),
                    );
                  }
                  return const Text('');
                },
              ),
            ),
            leftTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: 35,
                interval: maxY > 0 ? maxY / 4 : 1,
              ),
            ),
          ),
          borderData: FlBorderData(show: false),
          minY: 0,
          maxY: maxY > 0 ? maxY : 10,
          lineBarsData: [
            LineChartBarData(
              spots: patientSpots,
              isCurved: true,
              color: Colors.blue,
              barWidth: 3,
              belowBarData: BarAreaData(
                show: true,
                color: Colors.blue.withValues(alpha: 0.1),
              ),
            ),
            LineChartBarData(
              spots: doctorSpots,
              isCurved: true,
              color: Colors.green,
              barWidth: 3,
            ),
          ],
        ),
      ),
    );
  }
}

// ─── INR Compliance ───
class _ComplianceChart extends StatelessWidget {
  final InrComplianceStats? compliance;
  final bool denied;
  const _ComplianceChart({this.compliance, this.denied = false});

  @override
  Widget build(BuildContext context) {
    if (denied && compliance == null) {
      return _ChartCard(
        title: 'INR Compliance',
        child: const Center(
          child: Text('Access denied for this analytics capability'),
        ),
      );
    }
    final c = compliance;
    if (c == null || c.total == 0) {
      return _ChartCard(
        title: 'INR Compliance',
        child: const Center(child: Text('No data available')),
      );
    }

    final items = [
      _ComplianceLegendItem(
        label: 'In Range',
        color: Colors.green,
        percentage: c.inRangePercentage,
      ),
      _ComplianceLegendItem(
        label: 'Out of Range',
        color: Colors.orange,
        percentage: c.outOfRangePercentage,
      ),
      _ComplianceLegendItem(
        label: 'Critical',
        color: Colors.red,
        percentage: c.criticalPercentage,
      ),
    ].where((item) => item.percentage > 0).toList();

    return _ChartCard(
      title: 'INR Compliance',
      child: Column(
        children: [
          Expanded(
            child: PieChart(
              PieChartData(
                sectionsSpace: 2,
                centerSpaceRadius: 40,
                sections: items
                    .map(
                      (item) => PieChartSectionData(
                        color: item.color,
                        value: item.percentage,
                        title: '${item.percentage.toStringAsFixed(0)}%',
                        radius: 50,
                        titleStyle: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                      ),
                    )
                    .toList(),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: items
                .map(
                  (item) => _LegendChip(
                    color: item.color,
                    label:
                        '${item.label} (${item.percentage.toStringAsFixed(0)}%)',
                  ),
                )
                .toList(),
          ),
        ],
      ),
    );
  }
}

// ─── Doctor Workload ───
class _WorkloadChart extends StatelessWidget {
  final List<DoctorWorkload> workload;
  final bool denied;
  const _WorkloadChart({required this.workload, this.denied = false});

  @override
  Widget build(BuildContext context) {
    if (denied && workload.isEmpty) {
      return _ChartCard(
        title: 'Doctor Workload',
        child: const Center(
          child: Text('Access denied for this analytics capability'),
        ),
      );
    }
    if (workload.isEmpty) {
      return _ChartCard(
        title: 'Doctor Workload',
        child: const Center(child: Text('No data available')),
      );
    }
    final top = workload.take(10).toList();
    final maxP = top.fold<int>(
      0,
      (m, d) => d.patientCount > m ? d.patientCount : m,
    );
    final maxY = _roundedAxisMax(maxP);
    final interval = _niceAxisInterval(maxY);

    return _ChartCard(
      title: 'Doctor Workload',
      child: LayoutBuilder(
        builder: (context, constraints) {
          final isCompact = constraints.maxWidth < 420;
          return Column(
            children: [
              Expanded(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    SizedBox(
                      width: isCompact ? 24 : 32,
                      child: Center(
                        child: RotatedBox(
                          quarterTurns: 3,
                          child: Text(
                            'Patients Assigned',
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.bodySmall
                                ?.copyWith(fontWeight: FontWeight.w600),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: BarChart(
                        BarChartData(
                          alignment: BarChartAlignment.spaceAround,
                          maxY: maxY > 0 ? maxY : 20,
                          titlesData: FlTitlesData(
                            topTitles: const AxisTitles(
                              sideTitles: SideTitles(showTitles: false),
                            ),
                            rightTitles: const AxisTitles(
                              sideTitles: SideTitles(showTitles: false),
                            ),
                            bottomTitles: AxisTitles(
                              sideTitles: SideTitles(
                                showTitles: true,
                                reservedSize: isCompact ? 28 : 42,
                                getTitlesWidget: (v, _) {
                                  final i = v.toInt();
                                  if (i >= 0 && i < top.length) {
                                    final name = top[i].doctorName?.trim() ?? '';
                                    final shortLabel = _shortDoctorLabel(name);
                                    return Padding(
                                      padding: const EdgeInsets.only(top: 8),
                                      child: Text(
                                        shortLabel,
                                        textAlign: TextAlign.center,
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
                                          fontSize: 10,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    );
                                  }
                                  return const SizedBox.shrink();
                                },
                              ),
                            ),
                            leftTitles: AxisTitles(
                              sideTitles: SideTitles(
                                showTitles: true,
                                reservedSize: 42,
                                interval: interval,
                                getTitlesWidget: (value, _) => Text(
                                  value.round().toString(),
                                  style: const TextStyle(fontSize: 10),
                                ),
                              ),
                            ),
                          ),
                          gridData: FlGridData(
                            show: true,
                            drawVerticalLine: false,
                            horizontalInterval: interval,
                          ),
                          borderData: FlBorderData(show: false),
                          barGroups: top.asMap().entries.map((e) {
                            final hue = (200 + e.key * 15) % 360;
                            final color = HSLColor.fromAHSL(
                              1,
                              hue.toDouble(),
                              0.6,
                              0.5,
                            ).toColor();
                            return BarChartGroupData(
                              x: e.key,
                              showingTooltipIndicators: const [0],
                              barRods: [
                                BarChartRodData(
                                  toY: e.value.patientCount.toDouble(),
                                  color: color,
                                  width: isCompact ? 14 : 16,
                                  borderRadius: const BorderRadius.only(
                                    topLeft: Radius.circular(4),
                                    topRight: Radius.circular(4),
                                  ),
                                ),
                              ],
                            );
                          }).toList(),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 12,
                runSpacing: 8,
                children: [
                  for (final doctor in top)
                    Text(
                      '${_shortDoctorLabel(doctor.doctorName ?? '')}: ${doctor.patientCount}',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                ],
              ),
            ],
          );
        },
      ),
    );
  }
}

class _ComplianceLegendItem {
  const _ComplianceLegendItem({
    required this.label,
    required this.color,
    required this.percentage,
  });

  final String label;
  final Color color;
  final double percentage;
}

class _LegendChip extends StatelessWidget {
  const _LegendChip({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 8),
          Text(label),
        ],
      ),
    );
  }
}

double _roundedAxisMax(int maxValue) {
  if (maxValue <= 0) return 10;
  final padded = (maxValue * 1.2).ceil();
  if (padded <= 10) return 10;
  if (padded <= 20) return 20;
  final magnitude = padded.toString().length - 1;
  final base = magnitude <= 1 ? 5 : 10 * magnitude;
  return ((padded + base - 1) ~/ base * base).toDouble();
}

double _niceAxisInterval(double maxY) {
  if (maxY <= 10) return 2;
  if (maxY <= 20) return 5;
  if (maxY <= 50) return 10;
  return (maxY / 5).ceilToDouble();
}

String _shortDoctorLabel(String name) {
  final trimmed = name.trim();
  if (trimmed.isEmpty) return 'N/A';
  final parts = trimmed.split(RegExp(r'\s+')).where((part) => part.isNotEmpty);
  final abbreviations = parts.take(2).map((part) => part[0].toUpperCase());
  final short = abbreviations.join();
  if (short.length >= 2) return short;
  return trimmed.length <= 8 ? trimmed : '${trimmed.substring(0, 8)}…';
}
