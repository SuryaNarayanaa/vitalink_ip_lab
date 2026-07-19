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
import 'package:frontend/services/realtime/doctor_update_realtime_service.dart';

class DoctorDashboardPage extends StatefulWidget {
  const DoctorDashboardPage({super.key});

  @override
  State<DoctorDashboardPage> createState() => _DoctorDashboardPageState();
}

class _DoctorDashboardPageState extends State<DoctorDashboardPage> {
  int _currentNavIndex = 0;
  bool _isTableView = false;
  bool _notificationPopupScheduled = false;
  final Set<String> _seenAnnouncementIds = <String>{};
  final TextEditingController _searchController = TextEditingController();
  final DoctorRepository _doctorRepository = AppDependencies.doctorRepository;
  final DoctorUpdateRealtimeService _realtimeService =
      DoctorUpdateRealtimeService();

  @override
  void initState() {
    super.initState();
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
    unawaited(_realtimeService.stop());
    _searchController.dispose();
    super.dispose();
  }

  void _handleRealtimeNotification(Map<String, dynamic> notification) {
    if (!mounted) return;
    _refreshNotificationsUnread();
    if (_notificationPopupScheduled) return;

    final type = notification['type']?.toString();
    if (type != 'SYSTEM_ANNOUNCEMENT') return;

    final id = notification['id']?.toString();
    if (id == null || id.isEmpty) return;
    if (_seenAnnouncementIds.contains(id)) return;
    _seenAnnouncementIds.add(id);

    _notificationPopupScheduled = true;

    final title = notification['title']?.toString().trim().isNotEmpty == true
        ? notification['title']!.toString()
        : 'System announcement';
    final message = notification['message']?.toString().trim().isNotEmpty == true
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
              child: const Text('OK'),
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
        .where((p) =>
            p.name.toLowerCase().contains(query) ||
            (p.opNumber ?? '').toLowerCase().contains(query) ||
            (p.condition ?? '').toLowerCase().contains(query))
        .toList();
  }

  @override
  Widget build(BuildContext context) {
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
          onNavChanged: (index) {
            setState(() => _currentNavIndex = index);
          },
          notificationBadgeCount: unreadNotifications,
          onNotificationPressed: () async {
            await Navigator.of(context).pushNamed(AppRoutes.doctorNotifications);
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
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 250),
              layoutBuilder: (current, previousChildren) => Stack(
                alignment: Alignment.topCenter,
                children: [
                  ...previousChildren,
                  if (current != null)
                    Align(alignment: Alignment.topCenter, child: current),
                ],
              ),
              child: () {
                switch (_currentNavIndex) {
                  case 1:
                    return const KeyedSubtree(
                      key: ValueKey('doctor-nav-add'),
                      child: AddPatientForm(),
                    );
                  case 2:
                    return const KeyedSubtree(
                      key: ValueKey('doctor-nav-reports'),
                      child: DoctorReportsPage(),
                    );
                  case 3:
                    return const KeyedSubtree(
                      key: ValueKey('doctor-nav-profile'),
                      child: DoctorProfilePage(),
                    );
                  case 0:
                  default:
                    return KeyedSubtree(
                      key: const ValueKey('doctor-nav-patients'),
                      child: _PatientsView(
                        repository: _doctorRepository,
                        isTableView: _isTableView,
                        onToggleView: (table) =>
                            setState(() => _isTableView = table),
                        searchController: _searchController,
                        filterPatients: _filteredPatients,
                      ),
                    );
                }
              }(),
            ),
          ),
        );
      },
    );
  }

  void _refreshNotificationsUnread() {
    if (!mounted) return;
    final queryClient = QueryClientProvider.of(context);
    queryClient.invalidateQueries(DoctorQueryKeys.notificationsUnread());
    queryClient.invalidateQueries(DoctorQueryKeys.notifications());
  }

  String _titleForIndex(int index) {
    switch (index) {
      case 1:
        return 'Add Patient';
      case 2:
        return 'Reports';
      case 3:
        return 'Profile';
      case 0:
      default:
        return 'Patients';
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
  });

  final DoctorRepository repository;
  final bool isTableView;
  final ValueChanged<bool> onToggleView;
  final TextEditingController searchController;
  final List<PatientModel> Function(List<PatientModel>) filterPatients;

  @override
  Widget build(BuildContext context) {
    return UseQuery<List<PatientModel>>(
      options: QueryOptions<List<PatientModel>>(
        queryKey: DoctorQueryKeys.patients(),
        refetchOnWindowFocus: false,
        queryFn: repository.getPatients,
      ),
      builder: (context, query) {
        final patients = query.data ?? <PatientModel>[];
        final filtered = filterPatients(patients);

        return SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
          physics: const BouncingScrollPhysics(),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _ToggleBar(
                isTableView: isTableView,
                onToggle: onToggleView,
              ),
              const SizedBox(height: 12),
              _SearchBar(
                controller: searchController,
                count: filtered.length,
              ),
              const SizedBox(height: 16),
              if (query.isLoading)
                const Center(child: CircularProgressIndicator()),
              if (query.isError)
                ApiErrorState(
                  error: query.error,
                  onRetry: () => query.refetch(),
                  compact: true,
                ),
              if (!query.isLoading && !query.isError)
                AnimatedSwitcher(
                  duration: const Duration(milliseconds: 300),
                  switchInCurve: Curves.easeOutBack,
                  switchOutCurve: Curves.easeIn,
                  child: isTableView
                      ? _TableView(
                          filtered,
                          key: const ValueKey('patients-table-view'),
                        )
                      : _CardView(
                          filtered,
                          key: const ValueKey('patients-card-view'),
                        ),
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
    return TextField(
      controller: controller,
      decoration: InputDecoration(
        prefixIcon: Padding(
          padding: const EdgeInsets.only(left: 12, right: 8),
          child: const Icon(Icons.search, color: Color(0xFF6B7280)),
        ),
        prefixIconConstraints: const BoxConstraints(minWidth: 0, minHeight: 0),
        hintText: '$count Viewing Patients',
        filled: true,
        fillColor: Colors.white,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(32),
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

class _ToggleBar extends StatelessWidget {
  const _ToggleBar({required this.isTableView, required this.onToggle});
  final bool isTableView;
  final ValueChanged<bool> onToggle;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
        AnimatedContainer(
          duration: const Duration(milliseconds: 250),
          padding: const EdgeInsets.all(4),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.9),
            borderRadius: BorderRadius.circular(16),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.08),
                blurRadius: 10,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Row(
            children: [
              _TogglePill(
                label: 'Cards',
                isActive: !isTableView,
                onTap: () => onToggle(false),
              ),
              _TogglePill(
                label: 'Table',
                isActive: isTableView,
                onTap: () => onToggle(true),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _CardView extends StatelessWidget {
  const _CardView(this.patients, {super.key});
  final List<PatientModel> patients;

  @override
  Widget build(BuildContext context) {
    if (patients.isEmpty) return const _EmptyState();
    return Column(
      children: [
        for (int i = 0; i < patients.length; i++)
          _PatientCard(
            patient: patients[i],
            allPatients: patients,
            index: i,
          )
              .animate(const Duration(milliseconds: 300), Curves.easeOut)
              .padding(bottom: 12),
      ],
    );
  }
}

class _TableView extends StatelessWidget {
  const _TableView(this.patients, {super.key});
  final List<PatientModel> patients;

  @override
  Widget build(BuildContext context) {
    if (patients.isEmpty) return const _EmptyState();
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        columns: const [
          DataColumn(label: Text('Name')),
          DataColumn(label: Text('OP #')),
          DataColumn(label: Text('Age')),
          DataColumn(label: Text('Gender')),
          DataColumn(label: Text('Condition')),
          DataColumn(label: Text('Action')),
        ],
        rows: patients
            .asMap()
            .entries
            .map(
              (entry) => DataRow(
                cells: [
                  DataCell(Text(entry.value.name)),
                  DataCell(Text(entry.value.opNumber ?? '-')),
                  DataCell(Text(entry.value.age?.toString() ?? '-')),
                  DataCell(Text(entry.value.gender ?? '-')),
                  DataCell(
                    Text(entry.value.condition ?? 'Not Available'),
                  ),
                  DataCell(
                    TextButton(
                      onPressed: entry.value.opNumber != null
                          ? () {
                              Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) => ViewPatientPage(
                                    opNumber: entry.value.opNumber!,
                                    allPatients: patients,
                                    initialIndex: entry.key,
                                  ),
                                ),
                              );
                            }
                          : null,
                      child: const Text('View'),
                    ),
                  ),
                ],
              ),
            )
            .toList(),
      ).decorated(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 12,
            offset: const Offset(0, 6),
          ),
        ],
      ).padding(all: 4),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: const [
        Icon(Icons.search_off, size: 36, color: Colors.black54),
        SizedBox(height: 8),
        Text('No patients found'),
      ],
    ).center().padding(vertical: 32).decorated(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
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
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => ViewPatientPage(
            opNumber: patient.opNumber!,
            allPatients: allPatients,
            initialIndex: index,
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => _navigateToPatient(context),
      child: <Widget>[
        Text(
          patient.name,
          style: const TextStyle(
              fontSize: 16, fontWeight: FontWeight.w700, color: Colors.black87),
        ),
        const SizedBox(height: 4),
        Text('OP #: ${patient.opNumber ?? 'N/A'}',
            style: const TextStyle(color: Colors.black54, fontSize: 12)),
        Text('Age: ${patient.age ?? '-'}, Gender: ${patient.gender ?? '-'}',
            style: const TextStyle(color: Colors.black54, fontSize: 12)),
        // Text(
        //   'Condition: ${patient.condition ?? 'Not Available'}',
        //   style: const TextStyle(color: Colors.black54, fontSize: 12),
        // ),
        const SizedBox(height: 10),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton(
            onPressed: () => _navigateToPatient(context),
            child: const Text('View Details'),
          ),
        ),
      ]
          .toColumn(crossAxisAlignment: CrossAxisAlignment.start)
          .padding(all: 14)
          .decorated(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 12,
            offset: const Offset(0, 6),
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
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 220),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: isActive ? const Color(0xFFFF7643) : Colors.transparent,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontWeight: FontWeight.w600,
            color: isActive ? Colors.white : const Color(0xFF6B7280),
          ),
        ),
      ),
    );
  }
}
