import 'package:frontend/core/config/app_properties.dart';
import 'package:frontend/features/doctor/widgets/report_review_sheet.dart';
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/query/doctor_query_keys.dart';
import 'package:frontend/features/doctor/data/doctor_repository.dart';
import 'package:frontend/features/doctor/models/patient_model.dart';
import 'package:frontend/core/constants/layout.dart';
import 'package:frontend/core/widgets/common/api_error_state.dart';
import 'package:frontend/core/widgets/common/page_skeleton.dart';
import 'package:frontend/core/widgets/common/premium_report_card.dart';
import 'package:google_fonts/google_fonts.dart';

class DoctorReportsPage extends StatefulWidget {
  final DoctorRepository? repository;
  final String? initialPatientOp;
  final String? initialPatientName;
  const DoctorReportsPage({
    super.key,
    this.initialPatientOp,
    this.repository,
    this.initialPatientName,
  });

  @override
  State<DoctorReportsPage> createState() => _DoctorReportsPageState();
}

class _DoctorReportsPageState extends State<DoctorReportsPage> {
  DoctorRepository get _repository =>
      widget.repository ?? AppDependencies.doctorRepository;
  String? _selectedPatientOp;
  String? _selectedPatientName;

  @override
  void initState() {
    super.initState();
    _selectedPatientOp = widget.initialPatientOp;
    _selectedPatientName = widget.initialPatientName;
  }

  Future<void> _refreshSelectedReports({
    Future<void> Function()? awaitReportsRefetch,
  }) async {
    final op = _selectedPatientOp;
    if (op == null || op.isEmpty || !mounted) return;
    final queryClient = QueryClientProvider.of(context);
    final reportsKey = DoctorQueryKeys.patientReports(op);
    // Drop Hive entry so reopen never restores a stale empty list.
    await QueryCache.instance.remove(reportsKey.toString());
    // Prefer a single awaited refetch when available (RefreshIndicator path).
    // Outside UseQuery, fire one client refetch — never invalidate+refetch.
    if (awaitReportsRefetch != null) {
      await awaitReportsRefetch();
    } else {
      queryClient.refetchQueries(reportsKey);
    }
    // Refresh the workflow summary after clinical report changes.
    queryClient.invalidateQueries(DoctorQueryKeys.patients());
  }

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    return Column(
      children: [
        _buildHeader(),
        Expanded(
          child: _selectedPatientOp == null
              ? _buildNoSelectionState()
              : _buildReportsView(),
        ),
      ],
    );
  }

  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        PortalLayout.pageGutter,
        PortalLayout.pageTop,
        PortalLayout.pageGutter,
        AppSpacing.xs,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            AppCopy.text('text.patient_reports_c22ba0a9'),
            style: GoogleFonts.outfit(
              fontSize: 24,
              fontWeight: FontWeight.w800,
              color: const Color(0xFF1E1E5E),
            ),
          ),
          PortalLayout.sectionSpacerTight,
          _buildPatientPicker(),
        ],
      ),
    );
  }

  Widget _buildPatientPicker() {
    return UseQuery<List<PatientModel>>(
      options: QueryOptions<List<PatientModel>>(
        queryKey: DoctorQueryKeys.patients(),
        queryFn: _repository.getPatients,
      ),
      builder: (context, query) {
        final patients = query.data ?? [];
        final bool hasSelection = _selectedPatientName != null;

        return InkWell(
          onTap: query.isLoading ? null : () => _showPatientSearch(patients),
          borderRadius: BorderRadius.circular(28),
          child: Material(
            color: Colors.transparent,
            child: Ink(
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 15),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(28),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.06),
                    blurRadius: 10,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.person_search_rounded,
                    color: hasSelection
                        ? const Color(0xFF4F46E5)
                        : const Color(0xFF6B7280),
                    size: 22,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: hasSelection
                        ? Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _selectedPatientName!,
                                style: GoogleFonts.outfit(
                                  fontSize: 15.5,
                                  fontWeight: FontWeight.w600,
                                  color: const Color(0xFF1F2937),
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                AppCopy.text(
                                  'text.op_value1_38c57f2b',
                                  arguments: {
                                    'value1': (_selectedPatientOp ?? 'N/A')
                                        .toString(),
                                  },
                                ),
                                style: GoogleFonts.outfit(
                                  fontSize: 12.5,
                                  fontWeight: FontWeight.w500,
                                  color: const Color(0xFF6B7280),
                                ),
                              ),
                            ],
                          )
                        : Text(
                            AppCopy.text(
                              'text.select_patient_to_view_reports_2e7c5299',
                            ),
                            style: GoogleFonts.outfit(
                              fontSize: 15.5,
                              fontWeight: FontWeight.w500,
                              color: const Color(0xFF6B7280),
                            ),
                          ),
                  ),
                  Icon(
                    Icons.keyboard_arrow_down_rounded,
                    color: hasSelection
                        ? const Color(0xFF4F46E5)
                        : const Color(0xFF6B7280),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  void _showPatientSearch(List<PatientModel> patients) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => _PatientSearchSheet(
        patients: patients,
        onSelected: (p) {
          final selectedOp = p.opNumber?.trim();
          if (selectedOp == null || selectedOp.isEmpty) {
            return;
          }
          final samePatient = selectedOp == _selectedPatientOp;
          setState(() {
            _selectedPatientOp = selectedOp;
            _selectedPatientName = p.name;
          });
          // Re-selecting (or switching patients) must hit the network — the
          // default 5m query cache otherwise keeps an empty/outdated list.
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (!mounted) return;
            final queryClient = QueryClientProvider.of(context);
            if (samePatient) {
              unawaited(_refreshSelectedReports());
            } else {
              queryClient.invalidateQueries(
                DoctorQueryKeys.patientReports(selectedOp),
              );
            }
          });
        },
      ),
    );
  }

  Widget _buildNoSelectionState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(32),
            decoration: BoxDecoration(
              color: const Color(0xFF6366F1).withValues(alpha: 0.05),
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.analytics_outlined,
              size: 80,
              color: const Color(0xFF6366F1).withValues(alpha: 0.2),
            ),
          ),
          PortalLayout.sectionSpacer,
          Text(
            AppCopy.text('text.no_patient_selected_983f52fc'),
            style: GoogleFonts.outfit(
              fontSize: 20,
              fontWeight: FontWeight.w700,
              color: const Color(0xFF1E1E5E),
            ),
          ),
          PortalLayout.labelSpacer,
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xxl),
            child: Text(
              AppCopy.text(
                'text.please_select_a_patient_from_the_dropdown_above__8cdb7ce3',
              ),
              textAlign: TextAlign.center,
              style: GoogleFonts.outfit(
                fontSize: 15,
                color: const Color(0xFF6B7280),
                height: 1.5,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildReportsView() {
    return UseQuery<List<dynamic>>(
      options: QueryOptions<List<dynamic>>(
        queryKey: DoctorQueryKeys.patientReports(_selectedPatientOp!),
        // Clinical report lists must not sit on the default 5-minute stale window.
        staleTime: Duration.zero,
        refetchOnWindowFocus: true,
        queryFn: () => _repository.getPatientReports(
          _selectedPatientOp!,
          includeUrls: true,
        ),
      ),
      builder: (context, query) {
        Future<void> onRefresh() async {
          await _refreshSelectedReports(awaitReportsRefetch: query.refetch);
        }

        final Widget child;
        if (query.isError) {
          child = KeyedSubtree(
            key: const ValueKey('doctor-reports-error'),
            child: ApiErrorState(
              error: query.error,
              onRetry: () => onRefresh(),
            ),
          );
        } else if (query.isLoading && !query.hasData) {
          child = const KeyedSubtree(
            key: ValueKey('doctor-reports-loading'),
            child: Padding(
              padding: EdgeInsets.all(PortalLayout.pageGutter),
              child: ListSkeleton(itemCount: 4, shrinkWrap: true),
            ),
          );
        } else {
          final reports = List<dynamic>.from(query.data ?? []);
          int reviewOrder(dynamic report) =>
              report['review_status'] == 'pending'
              ? 0
              : report['review_status'] == 'reviewed'
              ? 2
              : 1;
          reports.sort((a, b) {
            final order = reviewOrder(a).compareTo(reviewOrder(b));
            if (order != 0) return order;
            final first = DateTime.tryParse(
              (a['uploaded_at'] ?? a['test_date']).toString(),
            );
            final second = DateTime.tryParse(
              (b['uploaded_at'] ?? b['test_date']).toString(),
            );
            if (first == null || second == null) return 0;
            return reviewOrder(a) == 0
                ? first.compareTo(second)
                : second.compareTo(first);
          });
          if (reports.isEmpty) {
            // Empty state must still be pull-to-refreshable; a non-scrollable
            // Center previously swallowed refresh after patient uploads.
            child = KeyedSubtree(
              key: const ValueKey('doctor-reports-empty'),
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(
                  PortalLayout.pageGutter,
                  PortalLayout.pageTop,
                  PortalLayout.pageGutter,
                  PortalLayout.pageBottomShell,
                ),
                children: [
                  const SizedBox(height: 80),
                  Icon(
                    Icons.history_rounded,
                    size: 64,
                    color: Colors.grey.withValues(alpha: 0.3),
                  ),
                  PortalLayout.sectionSpacerTight,
                  Text(
                    'No reports found for ${_selectedPatientName ?? 'selected patient'}'
                    ' (OP #${_selectedPatientOp ?? 'N/A'})',
                    style: GoogleFonts.outfit(color: Colors.grey),
                    textAlign: TextAlign.center,
                  ),
                  PortalLayout.sectionSpacer,
                  Text(
                    AppCopy.text(
                      'text.pull_down_to_refresh_after_a_patient_uploads_a_n_d05d2b8c',
                    ),
                    style: GoogleFonts.outfit(
                      color: Colors.grey.withValues(alpha: 0.85),
                      fontSize: 13,
                    ),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            );
          } else {
            child = KeyedSubtree(
              key: ValueKey(
                'doctor-reports-$_selectedPatientOp-${reports.length}',
              ),
              child: ListView.builder(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(
                  PortalLayout.pageGutter,
                  PortalLayout.pageTop,
                  PortalLayout.pageGutter,
                  PortalLayout.pageBottomShell,
                ),
                itemCount: reports.length,
                itemBuilder: (context, index) {
                  final report = reports[index];
                  return Padding(
                    padding: EdgeInsets.only(
                      bottom: index == reports.length - 1
                          ? 0
                          : PortalLayout.itemGap,
                    ),
                    child: PremiumReportCard(
                      report: report,
                      showActions: true,
                      onUpdatePressed: () =>
                          _updateDialog(context, _repository, report),
                    ),
                  );
                },
              ),
            );
          }
        }

        return RefreshIndicator(onRefresh: onRefresh, child: child);
      },
    );
  }

  Future<void> _updateDialog(
    BuildContext context,
    DoctorRepository repository,
    dynamic report,
  ) async {
    final op = _selectedPatientOp;
    if (op == null) return;
    final client = QueryClientProvider.of(context);
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => ReportReviewSheet(
        initialNotes: report['notes']?.toString() ?? '',
        onSave: (notes, reviewed) => repository.updateReport(
          op,
          report['_id'].toString(),
          {'notes': notes, if (reviewed) 'mark_reviewed': true},
        ),
      ),
    );
    if (saved != true || !context.mounted) return;
    client.invalidateQueries(DoctorQueryKeys.patientReports(op));
    client.invalidateQueries(DoctorQueryKeys.patients());
    client.invalidateQueries(DoctorQueryKeys.patientDetail(op));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(AppCopy.text('text.report_review_saved_94bda632')),
      ),
    );
  }
}

class _PatientSearchSheet extends StatefulWidget {
  final List<PatientModel> patients;
  final Function(PatientModel) onSelected;

  const _PatientSearchSheet({required this.patients, required this.onSelected});

  @override
  State<_PatientSearchSheet> createState() => _PatientSearchSheetState();
}

class _PatientSearchSheetState extends State<_PatientSearchSheet> {
  late List<PatientModel> _filteredPatients;
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _filteredPatients = widget.patients;
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _filter(String query) {
    setState(() {
      _filteredPatients = widget.patients
          .where(
            (p) =>
                p.name.toLowerCase().contains(query.toLowerCase()) ||
                (p.opNumber?.toLowerCase().contains(query.toLowerCase()) ??
                    false),
          )
          .toList();
    });
  }

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    return Container(
      height: MediaQuery.of(context).size.height * 0.75,
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
      ),
      child: Column(
        children: [
          const SizedBox(height: 12),
          Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: Colors.grey[300],
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(24),
            child: Row(
              children: [
                Text(
                  AppCopy.text('text.select_patient_d1dca630'),
                  style: GoogleFonts.outfit(
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const Spacer(),
                IconButton(
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: TextField(
              controller: _searchController,
              onChanged: _filter,
              decoration: InputDecoration(
                hintText: AppCopy.text(
                  'text.search_by_name_or_op_number_a9148b68',
                ),
                prefixIcon: const Icon(Icons.search),
                filled: true,
                fillColor: const Color(0xFFF3F4F6),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(16),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              itemCount: _filteredPatients.length,
              itemBuilder: (context, index) {
                final p = _filteredPatients[index];
                final patientOp = p.opNumber?.trim();
                final canSelect = patientOp != null && patientOp.isNotEmpty;
                final patientName = p.name.trim();
                return ListTile(
                  enabled: canSelect,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 4,
                  ),
                  leading: CircleAvatar(
                    backgroundColor: canSelect
                        ? const Color(0xFF6366F1).withValues(alpha: 0.1)
                        : Colors.grey.withValues(alpha: 0.1),
                    child: Text(
                      patientName.isNotEmpty ? patientName[0] : '?',
                      style: TextStyle(
                        color: canSelect
                            ? const Color(0xFF6366F1)
                            : Colors.grey,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  title: Text(
                    canSelect
                        ? AppCopy.text(
                            'text.value1_op_value2_8ec19247',
                            arguments: {
                              'value1': (p.name).toString(),
                              'value2': (patientOp).toString(),
                            },
                          )
                        : p.name,
                    style: GoogleFonts.outfit(
                      fontWeight: FontWeight.w600,
                      color: canSelect
                          ? const Color(0xFF111827)
                          : const Color(0xFF9CA3AF),
                    ),
                  ),
                  subtitle: Text(
                    canSelect
                        ? AppCopy.text('text.tap_to_select_9375b5f9')
                        : AppCopy.text('text.op_login_id_unavailable_2388dde7'),
                    style: GoogleFonts.outfit(fontSize: 12),
                  ),
                  onTap: canSelect
                      ? () {
                          widget.onSelected(p);
                          Navigator.pop(context);
                        }
                      : null,
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
