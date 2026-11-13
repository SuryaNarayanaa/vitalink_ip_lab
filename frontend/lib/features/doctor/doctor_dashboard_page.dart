import 'package:frontend/core/config/app_properties.dart';
import 'package:frontend/features/doctor/widgets/patient_attention_summary.dart';
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/app/routers.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/query/doctor_query_keys.dart';
import 'package:frontend/core/widgets/index.dart';
import 'package:frontend/features/doctor/data/doctor_repository.dart';
import 'package:frontend/features/doctor/models/patient_model.dart';
import 'package:styled_widget/styled_widget.dart';
import 'package:frontend/features/doctor/add_patient_page.dart';
import 'package:frontend/features/doctor/doctor_profile_page.dart';
import 'package:frontend/features/doctor/doctor_reports_page.dart';
import 'package:frontend/features/doctor/view_patient_page.dart';
import 'package:frontend/features/patient/patient_dashboard_shell_page.dart'
    show computeActivatedTabsAfterSelection;
import 'package:frontend/services/realtime/doctor_update_realtime_service.dart';

class DoctorDashboardPage extends StatefulWidget {
  const DoctorDashboardPage({super.key});

  @override
  State<DoctorDashboardPage> createState() => _DoctorDashboardPageState();
}

class _DoctorDashboardPageState extends State<DoctorDashboardPage>
    with WidgetsBindingObserver {
  static const int _tabCount = 4;

  int _currentNavIndex = 0;
  bool _isTableView = false;
  bool _onlyAttention = true;
  bool _notificationPopupScheduled = false;

  /// Lazy-mount tabs (same pattern as patient) so heavy screens load on demand.
  final Set<int> _activatedTabs = <int>{0};
  final List<Widget?> _tabCache = List<Widget?>.filled(_tabCount, null);
  final Set<String> _seenAnnouncementIds = <String>{};
  final TextEditingController _searchController = TextEditingController();
  final DoctorRepository _doctorRepository = AppDependencies.doctorRepository;
  final DoctorUpdateRealtimeService _realtimeService =
      DoctorUpdateRealtimeService();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _searchController.addListener(() => setState(() {}));
    unawaited(
      _realtimeService.start(
        onDoctorUpdate: _refreshNotificationsUnread,
        onNotification: _handleRealtimeNotification,
      ),
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    unawaited(_realtimeService.stop());
    _searchController.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _refreshClinicalData();
    }
  }

  void _handleRealtimeNotification(Map<String, dynamic> notification) {
    if (!mounted) return;
    _refreshNotificationsUnread();

    final type = notification['type']?.toString();
    // Patient INR uploads arrive as REPORT_AVAILABLE without inferred urgency.
    // Bust patient list + that patient's report cache so Reports tab updates.
    if (type == 'REPORT_AVAILABLE' || type == 'CRITICAL_ALERT') {
      final data = notification['data'];
      final dataMap = data is Map<String, dynamic>
          ? data
          : data is Map
          ? Map<String, dynamic>.from(data)
          : const <String, dynamic>{};
      final patientOp =
          (dataMap['patient_login_id'] ??
                  dataMap['patient_op'] ??
                  dataMap['op_num'] ??
                  '')
              .toString()
              .trim();
      _refreshClinicalData(patientOp: patientOp.isEmpty ? null : patientOp);
    }

    if (_notificationPopupScheduled) return;
    if (type != 'SYSTEM_ANNOUNCEMENT' && type != 'REPORT_AVAILABLE') return;

    final id = notification['id']?.toString();
    if (id == null || id.isEmpty) return;
    if (_seenAnnouncementIds.contains(id)) return;
    _seenAnnouncementIds.add(id);

    _notificationPopupScheduled = true;

    final title = notification['title']?.toString().trim().isNotEmpty == true
        ? notification['title']!.toString()
        : 'System announcement';
    final message =
        notification['message']?.toString().trim().isNotEmpty == true
        ? notification['message']!.toString()
        : 'You have a new notification.';

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;

      showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(title),
          content: Text(message),
          actions: [
            FilledButton(
              onPressed: () => Navigator.of(context).pop(),
              child: Text(AppCopy.text('text.ok_85e4b82f')),
            ),
          ],
        ),
      ).whenComplete(() {
        _notificationPopupScheduled = false;
      });
    });
  }

  List<PatientModel> _filteredPatients(List<PatientModel> patients) {
    final query = _searchController.text.trim().toLowerCase();
    if (query.isEmpty) return patients;
    return patients
        .where(
          (p) =>
              p.name.toLowerCase().contains(query) ||
              (p.opNumber ?? '').toLowerCase().contains(query) ||
              (p.condition ?? '').toLowerCase().contains(query),
        )
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    return UseQuery<int>(
      options: QueryOptions<int>(
        queryKey: DoctorQueryKeys.notificationsUnread(),
        refetchOnWindowFocus: false,
        queryFn: () async {
          return AppDependencies.doctorRepository.getNotificationsUnreadCount();
        },
      ),
      builder: (context, notificationQuery) {
        final unreadNotifications = notificationQuery.data ?? 0;
        return DoctorScaffold(
          pageTitle: _titleForIndex(_currentNavIndex),
          currentNavIndex: _currentNavIndex,
          onNavChanged: _onNavChanged,
          notificationBadgeCount: unreadNotifications,
          onNotificationPressed: () async {
            await Navigator.of(
              context,
            ).pushNamed(AppRoutes.doctorNotifications);
            _refreshNotificationsUnread();
          },
          bodyDecoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color(0xFFC8B5E1), Color(0xFFF8C7D7)],
            ),
          ),
          body: SafeArea(
            top: false,
            // Instant tab switch — no crossfade/stack (avoids overlapping content).
            child: IndexedStack(
              index: _currentNavIndex,
              sizing: StackFit.expand,
              children: List<Widget>.generate(
                _tabCount,
                _tabForIndex,
                growable: false,
              ),
            ),
          ),
        );
      },
    );
  }

  void _onNavChanged(int index) {
    final clamped = index.clamp(0, _tabCount - 1).toInt();
    if (clamped == _currentNavIndex && _activatedTabs.contains(clamped)) {
      // Re-tapping Reports should still refresh clinical caches.
      if (clamped == 2) {
        _refreshClinicalData();
      }
      return;
    }
    setState(() {
      _currentNavIndex = clamped;
      final updated = computeActivatedTabsAfterSelection(
        activated: _activatedTabs,
        selectedIndex: clamped,
        tabCount: _tabCount,
      );
      _activatedTabs
        ..clear()
        ..addAll(updated);
    });
    // Entering Patients or Reports: drop stale list/report caches.
    if (clamped == 0 || clamped == 2) {
      _refreshClinicalData();
    }
  }

  Widget _tabForIndex(int index) {
    if (!_activatedTabs.contains(index)) {
      return const SizedBox.expand();
    }
    // Patients tab binds to parent toggle/search state — rebuild, don't cache.
    if (index == 0) {
      return KeyedSubtree(
        key: const ValueKey<String>('doctor-shell-tab-0'),
        child: _PatientsView(
          repository: _doctorRepository,
          isTableView: _isTableView,
          onToggleView: (table) => setState(() => _isTableView = table),
          searchController: _searchController,
          filterPatients: _filteredPatients,
          onlyAttention: _onlyAttention,
          onAttentionChanged: (only) => setState(() {
            _onlyAttention = only;
          }),
        ),
      );
    }
    return _tabCache[index] ??= KeyedSubtree(
      key: ValueKey<String>('doctor-shell-tab-$index'),
      child: _createTab(index),
    );
  }

  Widget _createTab(int index) {
    switch (index) {
      case 1:
        return const AddPatientForm();
      case 2:
        return const DoctorReportsPage();
      case 3:
        return const DoctorProfilePage();
      case 0:
      default:
        return const SizedBox.expand();
    }
  }

  void _refreshNotificationsUnread() {
    if (!mounted) return;
    final queryClient = QueryClientProvider.of(context);
    queryClient.invalidateQueries(DoctorQueryKeys.notificationsUnread());
    queryClient.invalidateQueries(DoctorQueryKeys.notifications());
  }

  /// Invalidate patient roster and optional per-patient report/detail caches.
  /// Also purges Hive entries so reopen does not restore a stale empty list.
  void _refreshClinicalData({String? patientOp}) {
    if (!mounted) return;
    final queryClient = QueryClientProvider.of(context);
    queryClient.invalidateQueries(DoctorQueryKeys.patients());
    queryClient.invalidateQueries(DoctorQueryKeys.notificationsUnread());
    queryClient.invalidateQueries(DoctorQueryKeys.notifications());
    unawaited(
      QueryCache.instance.remove(DoctorQueryKeys.patients().toString()),
    );
    final op = patientOp?.trim();
    if (op != null && op.isNotEmpty) {
      final reportsKey = DoctorQueryKeys.patientReports(op);
      final detailKey = DoctorQueryKeys.patientDetail(op);
      queryClient.invalidateQueries(reportsKey);
      queryClient.invalidateQueries(detailKey);
      queryClient.refetchQueries(reportsKey);
      unawaited(QueryCache.instance.remove(reportsKey.toString()));
      unawaited(QueryCache.instance.remove(detailKey.toString()));
    }
  }

  String _titleForIndex(int index) {
    switch (index) {
      case 1:
        return AppCopy.text('text.add_patient_243c1f9d');
      case 2:
        return AppCopy.text('text.reports_769d4ae8');
      case 3:
        return AppCopy.text('text.profile_cd17328e');
      case 0:
      default:
        return AppCopy.text('text.patient_overview_55ab78f9');
    }
  }
}

class _PatientsView extends StatelessWidget {
  const _PatientsView({
    required this.repository,
    required this.isTableView,
    required this.onToggleView,
    required this.searchController,
    required this.filterPatients,
    required this.onlyAttention,
    required this.onAttentionChanged,
  });

  final bool onlyAttention;
  final ValueChanged<bool> onAttentionChanged;
  final DoctorRepository repository;
  final bool isTableView;
  final ValueChanged<bool> onToggleView;
  final TextEditingController searchController;
  final List<PatientModel> Function(List<PatientModel>) filterPatients;

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    return UseQuery<List<PatientModel>>(
      options: QueryOptions<List<PatientModel>>(
        queryKey: DoctorQueryKeys.patients(),
        staleTime: Duration.zero,
        refetchOnWindowFocus: true,
        queryFn: repository.getPatients,
      ),
      builder: (context, query) {
        final patients = query.data ?? <PatientModel>[];
        final filtered = filterPatients(patients)
            .where((p) => !onlyAttention || p.attentionReasons.isNotEmpty)
            .toList();

        return SingleChildScrollView(
          padding: PortalLayout.doctorShellPadding,
          physics: const BouncingScrollPhysics(),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              LayoutBuilder(
                builder: (context, constraints) {
                  final selection = _ToggleGroup(
                    children: [
                      _TogglePill(
                        label: AppCopy.text(
                          'text.needs_attention_value1_143944af',
                          arguments: {
                            'value1':
                                (patients
                                        .where(
                                          (p) => p.attentionReasons.isNotEmpty,
                                        )
                                        .length)
                                    .toString(),
                          },
                        ),
                        isActive: onlyAttention,
                        onTap: () => onAttentionChanged(true),
                      ),
                      _TogglePill(
                        label: AppCopy.text(
                          'text.all_patients_value1_9b60fd61',
                          arguments: {'value1': (patients.length).toString()},
                        ),
                        isActive: !onlyAttention,
                        onTap: () => onAttentionChanged(false),
                      ),
                    ],
                  );
                  final views = _ToggleBar(
                    isTableView: isTableView,
                    onToggle: onToggleView,
                  );
                  final refresh = IconButton(
                    tooltip: AppCopy.text(
                      'text.refresh_patient_overview_4d662000',
                    ),
                    onPressed: () => query.refetch(),
                    icon: const Icon(Icons.refresh),
                  );
                  if (constraints.maxWidth >= 560) {
                    return Row(
                      children: [
                        selection,
                        const Spacer(),
                        views,
                        const SizedBox(width: 8),
                        refresh,
                      ],
                    );
                  }
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: selection,
                      ),
                      const SizedBox(height: 12),
                      Row(children: [views, const Spacer(), refresh]),
                    ],
                  );
                },
              ),
              PortalLayout.itemSpacer,
              _SearchBar(controller: searchController, count: filtered.length),
              PortalLayout.sectionSpacerTight,
              if (query.isLoading && !query.hasData)
                const ListSkeleton(itemCount: 4, shrinkWrap: true),
              if (query.isError)
                ApiErrorState(
                  error: query.error,
                  onRetry: () => query.refetch(),
                  compact: true,
                ),
              if (query.isError && query.hasData)
                Text(
                  AppCopy.text(
                    'text.showing_the_last_loaded_patient_data_refresh_fai_46adcc1e',
                  ),
                ),
              if (query.hasData || (!query.isLoading && !query.isError))
                isTableView
                    ? DoctorPatientTable(
                        filtered,
                        key: const ValueKey('patients-table-view'),
                      )
                    : _CardView(
                        filtered,
                        key: const ValueKey('patients-card-view'),
                      ),
            ],
          ),
        );
      },
    );
  }
}

class _SearchBar extends StatelessWidget {
  const _SearchBar({required this.controller, required this.count});
  final TextEditingController controller;
  final int count;

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    return TextField(
      controller: controller,
      decoration: InputDecoration(
        prefixIcon: Padding(
          padding: const EdgeInsets.only(left: 12, right: 8),
          child: const Icon(Icons.search, color: Color(0xFF6B7280)),
        ),
        prefixIconConstraints: const BoxConstraints(minWidth: 0, minHeight: 0),
        hintText: AppCopy.text(
          'text.search_value1_patients_by_name_or_op_number_89e85dcc',
          arguments: {'value1': (count).toString()},
        ),
        filled: true,
        fillColor: Colors.white,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: PortalLayout.cardPadding,
          vertical: 14,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(PortalLayout.pillRadius),
          borderSide: BorderSide.none,
        ),
      ),
    ).decorated(
      boxShadow: [
        BoxShadow(
          color: Colors.black.withValues(alpha: 0.06),
          blurRadius: 8,
          offset: const Offset(0, 4),
        ),
      ],
    );
  }
}

class _ToggleGroup extends StatelessWidget {
  final List<Widget> children;
  const _ToggleGroup({required this.children});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(4),
    decoration: BoxDecoration(
      color: Colors.white.withValues(alpha: 0.95),
      borderRadius: BorderRadius.circular(PortalLayout.cardRadius),
      boxShadow: [
        BoxShadow(
          color: Colors.black.withValues(alpha: 0.06),
          blurRadius: 8,
          offset: const Offset(0, 3),
        ),
      ],
    ),
    child: Row(mainAxisSize: MainAxisSize.min, children: children),
  );
}

class _ToggleBar extends StatelessWidget {
  const _ToggleBar({required this.isTableView, required this.onToggle});
  final bool isTableView;
  final ValueChanged<bool> onToggle;

  @override
  Widget build(BuildContext context) => _ToggleGroup(
    children: [
      _TogglePill(
        label: AppCopy.text('text.cards_2a273ae4'),
        isActive: !isTableView,
        onTap: () => onToggle(false),
      ),
      _TogglePill(
        label: AppCopy.text('text.table_d70ceb7f'),
        isActive: isTableView,
        onTap: () => onToggle(true),
      ),
    ],
  );
}

class _CardView extends StatelessWidget {
  const _CardView(this.patients, {super.key});
  final List<PatientModel> patients;

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    if (patients.isEmpty) return const _EmptyState();
    return Column(
      children: [
        for (int i = 0; i < patients.length; i++)
          Padding(
            padding: EdgeInsets.only(
              bottom: i == patients.length - 1 ? 0 : PortalLayout.itemGap,
            ),
            child: _PatientCard(
              patient: patients[i],
              allPatients: patients,
              index: i,
            ),
          ),
      ],
    );
  }
}

class DoctorPatientTable extends StatelessWidget {
  const DoctorPatientTable(this.patients, {super.key});
  final List<PatientModel> patients;

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    if (patients.isEmpty) return const _EmptyState();
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child:
          DataTable(
                dataRowMinHeight: 64,
                dataRowMaxHeight: double.infinity,
                columns: [
                  DataColumn(label: Text(AppCopy.text('text.name_fe07306'))),
                  DataColumn(label: Text(AppCopy.text('text.op_bb558927'))),
                  DataColumn(
                    label: Text(AppCopy.text('text.attention_8c14359')),
                  ),
                  DataColumn(label: Text(AppCopy.text('text.action_a77a91f'))),
                ],
                rows: patients
                    .asMap()
                    .entries
                    .map(
                      (entry) => DataRow(
                        cells: [
                          DataCell(Text(entry.value.name)),
                          DataCell(Text(entry.value.opNumber ?? '-')),
                          DataCell(
                            SizedBox(
                              width: 290,
                              child: PatientAttentionSummary(
                                patient: entry.value,
                                stacked: true,
                              ),
                            ),
                          ),
                          DataCell(
                            TextButton(
                              onPressed: entry.value.opNumber != null
                                  ? () {
                                      final client = QueryClientProvider.of(
                                        context,
                                      );
                                      Navigator.of(context)
                                          .push(
                                            FadeSlidePageRoute(
                                              builder: (_) => ViewPatientPage(
                                                opNumber: entry.value.opNumber!,
                                                allPatients: patients,
                                                initialIndex: entry.key,
                                              ),
                                            ),
                                          )
                                          .then((_) {
                                            client.invalidateQueries(
                                              DoctorQueryKeys.patients(),
                                            );
                                          });
                                    }
                                  : null,
                              child: Text(AppCopy.text('text.view_5e4baa18')),
                            ),
                          ),
                        ],
                      ),
                    )
                    .toList(),
              )
              .decorated(
                color: Colors.white,
                borderRadius: BorderRadius.circular(PortalLayout.cardRadius),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.06),
                    blurRadius: 12,
                    offset: const Offset(0, 6),
                  ),
                ],
              )
              .padding(all: AppSpacing.xxs),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    return Column(
          children: [
            Icon(Icons.search_off, size: 36, color: Colors.black54),
            SizedBox(height: AppSpacing.xs),
            Text(
              AppCopy.text(
                'text.no_patients_match_this_view_try_all_patients_or__71870c3',
              ),
            ),
          ],
        )
        .center()
        .padding(vertical: PortalLayout.pageBottomStandalone)
        .decorated(
          color: Colors.white,
          borderRadius: BorderRadius.circular(PortalLayout.cardRadius),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.05),
              blurRadius: 10,
              offset: const Offset(0, 4),
            ),
          ],
        );
  }
}

class _PatientCard extends StatelessWidget {
  final PatientModel patient;
  final List<PatientModel> allPatients;
  final int index;

  const _PatientCard({
    required this.patient,
    required this.allPatients,
    required this.index,
  });

  void _navigateToPatient(BuildContext context) {
    if (patient.opNumber != null) {
      final client = QueryClientProvider.of(context);
      Navigator.of(context)
          .push(
            FadeSlidePageRoute(
              builder: (_) => ViewPatientPage(
                opNumber: patient.opNumber!,
                allPatients: allPatients,
                initialIndex: index,
              ),
            ),
          )
          .then((_) {
            client.invalidateQueries(DoctorQueryKeys.patients());
          });
    }
  }

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    return PressScale(
      onTap: () => _navigateToPatient(context),
      child:
          <Widget>[
                Text(
                  patient.name,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: Colors.black87,
                  ),
                ),
                PortalLayout.metaSpacer,
                Text(
                  AppCopy.text(
                    'text.op_value1_3a304631',
                    arguments: {
                      'value1': (patient.opNumber ?? 'N/A').toString(),
                    },
                  ),
                  style: const TextStyle(color: Colors.black54, fontSize: 12),
                ),
                const SizedBox(height: 12),
                PatientAttentionSummary(patient: patient),
                const SizedBox(height: AppSpacing.sm - 2),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: () => _navigateToPatient(context),
                    child: Text(AppCopy.text('text.view_details_e2c15a0e')),
                  ),
                ),
              ]
              .toColumn(crossAxisAlignment: CrossAxisAlignment.start)
              .padding(all: PortalLayout.cardPadding)
              .decorated(
                color: Colors.white,
                borderRadius: BorderRadius.circular(PortalLayout.cardRadius),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.06),
                    blurRadius: 8,
                    offset: const Offset(0, 3),
                  ),
                ],
              ),
    );
  }
}

class _TogglePill extends StatelessWidget {
  final String label;
  final bool isActive;
  final VoidCallback onTap;

  const _TogglePill({
    required this.label,
    required this.isActive,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) => Semantics(
    selected: isActive,
    child: TextButton(
      onPressed: onTap,
      style: TextButton.styleFrom(
        minimumSize: const Size(0, 44),
        padding: const EdgeInsets.symmetric(horizontal: 14),
        foregroundColor: isActive ? Colors.white : const Color(0xFF6B7280),
        backgroundColor: isActive
            ? const Color(0xFFFF7643)
            : Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(PortalLayout.controlRadius),
        ),
        textStyle: const TextStyle(fontWeight: FontWeight.w600),
      ),
      child: Text(label),
    ),
  );
}
