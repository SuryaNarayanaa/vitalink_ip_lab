import 'package:frontend/core/config/app_properties.dart';
import 'package:frontend/core/widgets/common/dose_history_card.dart';
import 'package:frontend/features/doctor/doctor_reports_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/core/query/doctor_query_keys.dart';
import 'package:frontend/core/widgets/index.dart';
import 'package:frontend/features/doctor/data/doctor_repository.dart';
import 'package:frontend/features/doctor/models/patient_detail_model.dart';
import 'package:frontend/features/doctor/models/patient_model.dart';
import 'package:intl/intl.dart';

/// Page to view and manage a single patient's details.
class ViewPatientPage extends StatefulWidget {
  final String opNumber;
  final DoctorRepository? repository;
  final List<PatientModel>? allPatients;
  final int? initialIndex;

  const ViewPatientPage({
    super.key,
    required this.opNumber,
    this.repository,
    this.allPatients,
    this.initialIndex,
  });

  @override
  State<ViewPatientPage> createState() => _ViewPatientPageState();
}

class _ViewPatientPageState extends State<ViewPatientPage> {
  late final DoctorRepository _repo =
      widget.repository ?? AppDependencies.doctorRepository;
  late PageController _pageController;
  late int _currentIndex;
  late String _currentOpNumber;

  @override
  void initState() {
    super.initState();
    _currentIndex = widget.initialIndex ?? 0;
    _currentOpNumber = widget.opNumber;
    _pageController = PageController(initialPage: _currentIndex);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _scheduleAdjacentPrefetch();
  }

  void _scheduleAdjacentPrefetch() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final patients = widget.allPatients;
      if (patients == null || patients.length < 2) return;
      final client = QueryClientProvider.of(context);
      for (final index in [_currentIndex + 1, _currentIndex - 1]) {
        if (index < 0 || index >= patients.length) continue;
        final op = patients[index].opNumber;
        if (op == null || op.trim().isEmpty || op == _currentOpNumber) continue;
        // Creating the existing query starts its fetch. Opening that page uses
        // the same instance, including an in-flight request or completed data.
        client.getQuery<PatientDetailModel>(
          DoctorQueryKeys.patientDetail(op),
          () => _repo.getPatientDetail(op),
        );
      }
    });
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  void _navigateToPatient(int index) {
    if (widget.allPatients == null ||
        index < 0 ||
        index >= widget.allPatients!.length) {
      return;
    }
    final patient = widget.allPatients![index];
    if (patient.opNumber == null) {
      return;
    }
    setState(() {
      _currentIndex = index;
      _currentOpNumber = patient.opNumber!;
    });
    _pageController.animateToPage(
      index,
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeInOut,
    );
  }

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    final hasMultiple =
        widget.allPatients != null && widget.allPatients!.length > 1;

    return Scaffold(
      backgroundColor: const Color(0xFFF5F5F7),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Color(0xFF1F2937)),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: Text(
          AppCopy.text('text.patient_details_d6e0a188'),
          style: const TextStyle(
            color: Color(0xFF1F2937),
            fontWeight: FontWeight.w600,
            fontSize: 18,
          ),
        ),
        centerTitle: true,
        actions: [
          if (hasMultiple)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Center(
                child: Text(
                  '${_currentIndex + 1}/${widget.allPatients!.length}',
                  style: const TextStyle(
                    color: Color(0xFF6B7280),
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ),
        ],
      ),
      body: hasMultiple
          ? PageView.builder(
              allowImplicitScrolling: true,
              controller: _pageController,
              itemCount: widget.allPatients!.length,
              onPageChanged: (index) {
                final patient = widget.allPatients![index];
                if (patient.opNumber != null) {
                  setState(() {
                    _currentIndex = index;
                    _currentOpNumber = patient.opNumber!;
                  });
                  _scheduleAdjacentPrefetch();
                }
              },
              itemBuilder: (context, index) {
                final patient = widget.allPatients![index];
                if (patient.opNumber == null) {
                  return Center(
                    child: Text(AppCopy.text('text.invalid_patient_fcb41989')),
                  );
                }
                return _PatientDetailContent(
                  key: ValueKey(patient.opNumber),
                  opNumber: patient.opNumber!,
                  repository: _repo,
                );
              },
            )
          : _PatientDetailContent(
              opNumber: _currentOpNumber,
              repository: _repo,
            ),
      bottomNavigationBar: hasMultiple
          ? Container(
              color: Colors.white,
              padding: const EdgeInsets.symmetric(
                horizontal: PortalLayout.pageGutter,
                vertical: PortalLayout.itemGap,
              ),
              child: SafeArea(
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    _NavButton(
                      icon: Icons.chevron_left,
                      label: AppCopy.text('text.previous_ead1fb48'),
                      enabled: _currentIndex > 0,
                      onTap: () => _navigateToPatient(_currentIndex - 1),
                    ),
                    _NavButton(
                      icon: Icons.chevron_right,
                      label: AppCopy.text('text.next_dce2da08'),
                      iconAfter: true,
                      enabled: _currentIndex < widget.allPatients!.length - 1,
                      onTap: () => _navigateToPatient(_currentIndex + 1),
                    ),
                  ],
                ),
              ),
            )
          : null,
    );
  }
}

class _NavButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool enabled;
  final VoidCallback onTap;
  final bool iconAfter;

  const _NavButton({
    required this.icon,
    required this.label,
    required this.enabled,
    required this.onTap,
    this.iconAfter = false,
  });

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    return TextButton(
      onPressed: enabled ? onTap : null,
      style: TextButton.styleFrom(
        foregroundColor: enabled
            ? const Color(0xFF6366F1)
            : const Color(0xFFD1D5DB),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: iconAfter
            ? [
                Text(
                  label,
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                const SizedBox(width: 4),
                Icon(icon, size: 20),
              ]
            : [
                Icon(icon, size: 20),
                const SizedBox(width: 4),
                Text(
                  label,
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ],
      ),
    );
  }
}

class _PatientDetailContent extends StatefulWidget {
  final String opNumber;
  final DoctorRepository repository;

  const _PatientDetailContent({
    super.key,
    required this.opNumber,
    required this.repository,
  });

  @override
  State<_PatientDetailContent> createState() => _PatientDetailContentState();
}

class _PatientDetailContentState extends State<_PatientDetailContent> {
  bool _showReports = false;

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    return UseQuery<PatientDetailModel>(
      options: QueryOptions<PatientDetailModel>(
        queryKey: DoctorQueryKeys.patientDetail(widget.opNumber),
        queryFn: () => widget.repository.getPatientDetail(widget.opNumber),
      ),
      builder: (context, patientQuery) {
        if (patientQuery.isLoading && !patientQuery.hasData) {
          return const Center(child: CircularProgressIndicator());
        }

        if (patientQuery.isError && !patientQuery.hasData) {
          return _ErrorView(
            message: patientQuery.error.toString(),
            onRetry: () => patientQuery.refetch(),
          );
        }

        final patient = patientQuery.data;
        if (patient == null) {
          return Center(
            child: Text(AppCopy.text('text.patient_not_found_ae477cdf')),
          );
        }

        return RefreshIndicator(
          onRefresh: () async {
            await patientQuery.refetch();
          },
          child: SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: PortalLayout.pagePadding(embedInShell: false),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (patientQuery.isLoading) const LinearProgressIndicator(),
                if (patientQuery.isError)
                  ApiErrorState(
                    error: patientQuery.error,
                    onRetry: () => patientQuery.refetch(),
                    compact: true,
                  ),
                // Patient Header Card — primary identity
                _PatientHeaderCard(patient: patient, opNumber: widget.opNumber),

                PortalLayout.sectionSpacer,

                // Quick Actions
                _QuickActionsCard(
                  opNumber: widget.opNumber,
                  patient: patient,
                  repository: widget.repository,
                  onPatientUpdated: () => patientQuery.refetch(),
                ),

                PortalLayout.sectionSpacer,

                // Medical Configuration
                _MedicalConfigCard(patient: patient),

                PortalLayout.sectionSpacerTight,

                // Weekly Dosage
                _DosageCard(
                  opNumber: widget.opNumber,
                  patient: patient,
                  repository: widget.repository,
                  onUpdated: () => patientQuery.refetch(),
                ),

                PortalLayout.sectionSpacerTight,

                // Next of Kin
                _NextOfKinCard(patient: patient),

                PortalLayout.sectionSpacerTight,

                // Medical History
                _MedicalHistoryCard(patient: patient),

                PortalLayout.sectionSpacerTight,

                // Side effects & other monitoring logs from patient health reports
                _MonitoringLogsCard(patient: patient),

                PortalLayout.sectionSpacer,

                OutlinedButton.icon(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => Scaffold(
                        appBar: AppBar(
                          title: Text(
                            AppCopy.text(
                              'text.review_patient_reports_cfde8ef7',
                            ),
                          ),
                        ),
                        body: DoctorReportsPage(
                          initialPatientOp: widget.opNumber,
                          initialPatientName: patient.name,
                        ),
                      ),
                    ),
                  ),
                  icon: const Icon(Icons.fact_check_outlined),
                  label: Text(
                    AppCopy.text('text.review_patient_reports_cfde8ef7'),
                  ),
                ),
                PortalLayout.sectionSpacerTight,
                // INR Reports Section
                _InrReportsCard(
                  opNumber: widget.opNumber,
                  repository: widget.repository,
                  isExpanded: _showReports,
                  onToggle: () => setState(() => _showReports = !_showReports),
                ),
                PortalLayout.sectionSpacer,
                DoseHistoryCard(
                  key: ValueKey(widget.opNumber),
                  history: patient.doseHistory,
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _PatientHeaderCard extends StatelessWidget {
  final PatientDetailModel patient;
  final String opNumber;

  const _PatientHeaderCard({required this.patient, required this.opNumber});

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    return Container(
      padding: PortalLayout.cardInsetsComfortable,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(PortalLayout.cardRadius),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        children: [
          // Avatar
          Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              color: const Color(0xFFEEF2FF),
              shape: BoxShape.circle,
              border: Border.all(color: const Color(0xFF6366F1), width: 2),
            ),
            child: Center(
              child: Text(
                patient.name.isNotEmpty ? patient.name[0].toUpperCase() : '?',
                style: const TextStyle(
                  fontSize: 28,
                  fontWeight: FontWeight.w700,
                  color: Color(0xFF6366F1),
                ),
              ),
            ),
          ),
          const SizedBox(width: PortalLayout.cardPadding),
          // Info
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  patient.name,
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                    color: Color(0xFF1F2937),
                  ),
                ),
                PortalLayout.metaSpacer,
                Row(
                  children: [
                    _InfoChip(
                      icon: Icons.badge_outlined,
                      label: AppCopy.text(
                        'text.op_value1_38c57f2b',
                        arguments: {
                          'value1': (patient.opNumber ?? opNumber).toString(),
                        },
                      ),
                      color: const Color(0xFF6366F1),
                    ),
                  ],
                ),
                PortalLayout.labelSpacer,
                Row(
                  children: [
                    if (patient.age != null) ...[
                      _InfoChip(
                        icon: Icons.cake_outlined,
                        label: AppCopy.text(
                          'text.value1_yrs_bf2538c5',
                          arguments: {'value1': (patient.age).toString()},
                        ),
                        color: const Color(0xFF059669),
                      ),
                      PortalLayout.inlineSpacer,
                    ],
                    if (patient.gender != null)
                      _InfoChip(
                        icon: patient.gender == 'Male'
                            ? Icons.male
                            : Icons.female,
                        label: patient.gender!,
                        color: const Color(0xFFF59E0B),
                      ),
                  ],
                ),
                if (patient.phone != null) ...[
                  PortalLayout.labelSpacer,
                  Row(
                    children: [
                      const Icon(
                        Icons.phone,
                        size: 14,
                        color: Color(0xFF6B7280),
                      ),
                      const SizedBox(width: AppSpacing.xxs),
                      Text(
                        patient.phone!,
                        style: const TextStyle(
                          fontSize: 13,
                          color: Color(0xFF6B7280),
                        ),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoChip extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;

  const _InfoChip({
    required this.icon,
    required this.label,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}

class _QuickActionsCard extends StatelessWidget {
  final String opNumber;
  final PatientDetailModel patient;
  final DoctorRepository repository;
  final VoidCallback onPatientUpdated;

  const _QuickActionsCard({
    required this.opNumber,
    required this.patient,
    required this.repository,
    required this.onPatientUpdated,
  });

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    return Container(
      padding: PortalLayout.cardInsets,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(PortalLayout.cardRadius),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            AppCopy.text('text.quick_actions_8d04349f'),
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w600,
              color: Color(0xFF1F2937),
            ),
          ),
          PortalLayout.itemSpacer,
          Row(
            children: [
              Expanded(
                child: _ActionButton(
                  icon: Icons.calendar_month,
                  label: AppCopy.text('text.update_review_bc953400'),
                  color: const Color(0xFF6366F1),
                  onTap: () => _showUpdateReviewDialog(context),
                ),
              ),
              PortalLayout.columnSpacer,
              Expanded(
                child: _ActionButton(
                  icon: Icons.swap_horiz,
                  label: AppCopy.text('text.reassign_9376a1e1'),
                  color: const Color(0xFFF59E0B),
                  onTap: () => _showReassignDialog(context),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _showUpdateReviewDialog(BuildContext context) {
    DateTime? selectedDate;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) {
          return AlertDialog(
            title: Text(AppCopy.text('text.update_next_review_date_c90de269')),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ListTile(
                  leading: const Icon(Icons.calendar_today),
                  title: Text(
                    selectedDate != null
                        ? DateFormat('dd-MM-yyyy').format(selectedDate!)
                        : AppCopy.text('text.select_date_8c838bf3'),
                  ),
                  onTap: () async {
                    final date = await showDatePicker(
                      context: context,
                      initialDate: DateTime.now().add(const Duration(days: 7)),
                      firstDate: DateTime.now(),
                      lastDate: DateTime.now().add(const Duration(days: 365)),
                    );
                    if (date != null) {
                      setDialogState(() => selectedDate = date);
                    }
                  },
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                    side: const BorderSide(color: Color(0xFFE5E7EB)),
                  ),
                ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child: Text(AppCopy.text('text.cancel_35afca3b')),
              ),
              ElevatedButton(
                onPressed: selectedDate == null
                    ? null
                    : () async {
                        final dateStr = DateFormat(
                          'dd-MM-yyyy',
                        ).format(selectedDate!);
                        try {
                          await repository.updateNextReview(opNumber, dateStr);
                          if (ctx.mounted) {
                            Navigator.of(ctx).pop();
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text(
                                  AppCopy.text(
                                    'text.review_date_updated_successfully_1e37dfc5',
                                  ),
                                ),
                              ),
                            );
                            onPatientUpdated();
                          }
                        } catch (e) {
                          if (ctx.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text(
                                  AppCopy.text(
                                    'text.error_value1_caf169bf',
                                    arguments: {'value1': (e).toString()},
                                  ),
                                ),
                              ),
                            );
                          }
                        }
                      },
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF6366F1),
                  foregroundColor: Colors.white,
                ),
                child: Text(AppCopy.text('text.update_6e230e94')),
              ),
            ],
          );
        },
      ),
    );
  }

  void _showReassignDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => _ReassignDialog(
        opNumber: opNumber,
        repository: repository,
        onSuccess: () {
          Navigator.of(ctx).pop();
          onPatientUpdated();
        },
      ),
    );
  }
}

class _ReassignDialog extends StatefulWidget {
  final String opNumber;
  final DoctorRepository repository;
  final VoidCallback onSuccess;

  const _ReassignDialog({
    required this.opNumber,
    required this.repository,
    required this.onSuccess,
  });

  @override
  State<_ReassignDialog> createState() => _ReassignDialogState();
}

class _ReassignDialogState extends State<_ReassignDialog> {
  String? _selectedDoctorId;
  bool _isLoading = false;
  List<dynamic> _doctors = [];
  bool _loadingDoctors = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadDoctors();
  }

  Future<void> _loadDoctors() async {
    try {
      final doctors = await widget.repository.getDoctors();
      if (!mounted) return;
      setState(() {
        _doctors = doctors;
        _loadingDoctors = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loadingDoctors = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    return AlertDialog(
      title: Text(AppCopy.text('text.reassign_patient_8d604fc4')),
      content: SizedBox(
        width: double.maxFinite,
        child: _loadingDoctors
            ? const Center(child: CircularProgressIndicator())
            : _error != null
            ? Text(
                AppCopy.text(
                  'text.error_value1_caf169bf',
                  arguments: {'value1': (_error).toString()},
                ),
              )
            : Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    AppCopy.text(
                      'text.select_a_doctor_to_reassign_this_patient_d5fef877',
                    ),
                    style: TextStyle(fontSize: 14, color: Color(0xFF6B7280)),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    height: 200,
                    child: ListView.builder(
                      shrinkWrap: true,
                      itemCount: _doctors.length,
                      itemBuilder: (context, index) {
                        final doctor = _doctors[index];
                        final loginId = doctor['login_id'] as String?;
                        final profile =
                            doctor['profile_id'] as Map<String, dynamic>?;
                        final name = profile?['name'] ?? loginId ?? 'Unknown';
                        final doctorId = loginId ?? '';
                        final selected = _selectedDoctorId == doctorId;

                        return ListTile(
                          dense: true,
                          onTap: doctorId.isEmpty
                              ? null
                              : () => setState(
                                  () => _selectedDoctorId = doctorId,
                                ),
                          leading: Icon(
                            selected
                                ? Icons.radio_button_checked
                                : Icons.radio_button_unchecked,
                            color: selected
                                ? const Color(0xFFF59E0B)
                                : Colors.grey,
                          ),
                          title: Text(name),
                          subtitle: loginId != null
                              ? Text(
                                  AppCopy.text(
                                    'text.id_value1_33495a',
                                    arguments: {'value1': (loginId).toString()},
                                  ),
                                )
                              : null,
                        );
                      },
                    ),
                  ),
                ],
              ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(AppCopy.text('text.cancel_35afca3b')),
        ),
        ElevatedButton(
          onPressed: _selectedDoctorId == null || _isLoading
              ? null
              : () async {
                  final messenger = ScaffoldMessenger.of(context);
                  setState(() => _isLoading = true);
                  try {
                    await widget.repository.reassignPatient(
                      widget.opNumber,
                      _selectedDoctorId!,
                    );
                    if (!mounted) return;
                    messenger.showSnackBar(
                      SnackBar(
                        content: Text(
                          AppCopy.text(
                            'text.patient_reassigned_successfully_a95fba9c',
                          ),
                        ),
                      ),
                    );
                    widget.onSuccess();
                  } catch (e) {
                    if (!mounted) return;
                    messenger.showSnackBar(
                      SnackBar(
                        content: Text(
                          AppCopy.text(
                            'text.error_value1_caf169bf',
                            arguments: {'value1': (e).toString()},
                          ),
                        ),
                      ),
                    );
                  } finally {
                    if (mounted) {
                      setState(() => _isLoading = false);
                    }
                  }
                },
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFFF59E0B),
            foregroundColor: Colors.white,
          ),
          child: _isLoading
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                )
              : Text(AppCopy.text('text.reassign_9376a1e1')),
        ),
      ],
    );
  }
}

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  const _ActionButton({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    return Material(
      color: color.withValues(alpha: 0.1),
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 12),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 20, color: color),
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: color,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MedicalConfigCard extends StatelessWidget {
  final PatientDetailModel patient;

  const _MedicalConfigCard({required this.patient});

  String _formatDate(dynamic date) {
    if (date == null) return AppCopy.text('text.not_set_d7958fc6');
    try {
      final DateTime dt = date is DateTime
          ? date
          : DateTime.parse(date.toString());
      return DateFormat('dd MMM yyyy').format(dt);
    } catch (_) {
      return date.toString();
    }
  }

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    final config = patient.medicalConfig;
    final targetInr = config?['target_inr'] as Map<String, dynamic>?;

    return InfoCard(
      title: AppCopy.text('text.medical_configuration_ba44351e'),
      child: Column(
        children: [
          InfoRow(
            icon: Icons.medication,
            label: AppCopy.text('text.therapy_drug_5d5334d0'),
            value: config?['therapy_drug']?.toString() ?? 'Not specified',
          ),
          InfoRow(
            icon: Icons.play_arrow,
            label: AppCopy.text('text.start_date_1a637601'),
            value: _formatDate(config?['therapy_start_date']),
          ),
          InfoRow(
            icon: Icons.analytics,
            label: AppCopy.text('text.target_inr_625b0bf'),
            value: targetInr != null
                ? '${targetInr['min'] ?? 2.0} - ${targetInr['max'] ?? 3.0}'
                : '2.0 - 3.0',
            valueColor: const Color(0xFF059669),
          ),
          InfoRow(
            icon: Icons.event,
            label: AppCopy.text('text.next_review_fbb4bd7c'),
            value: _formatDate(config?['next_review_date']),
            valueColor: const Color(0xFF6366F1),
          ),
          if (config?['instructions'] != null &&
              (config!['instructions'] as List).isNotEmpty) ...[
            const Divider(height: PortalLayout.sectionGap),
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                AppCopy.text('text.instructions_48d33564'),
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: Color(0xFF1F2937),
                ),
              ),
            ),
            PortalLayout.labelSpacer,
            ...((config['instructions'] as List).map(
              (instr) => Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.xxs),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      '• ',
                      style: TextStyle(color: Color(0xFF6B7280)),
                    ),
                    Expanded(
                      child: Text(
                        instr.toString(),
                        style: const TextStyle(
                          fontSize: 14,
                          color: Color(0xFF4B5563),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            )),
          ],
        ],
      ),
    );
  }
}

class _DosageCard extends StatefulWidget {
  final String opNumber;
  final PatientDetailModel patient;
  final DoctorRepository repository;
  final VoidCallback onUpdated;

  const _DosageCard({
    required this.opNumber,
    required this.patient,
    required this.repository,
    required this.onUpdated,
  });

  @override
  State<_DosageCard> createState() => _DosageCardState();
}

class _DosageCardState extends State<_DosageCard> {
  bool _isEditing = false;
  bool _isSaving = false;

  Future<void> _saveDosage(Map<String, double> dosage) async {
    setState(() => _isSaving = true);
    try {
      await widget.repository.updatePatientDosage(widget.opNumber, dosage);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppCopy.text('text.dosage_updated_successfully_9ac4e458'),
          ),
        ),
      );
      widget.onUpdated();
      setState(() => _isEditing = false);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppCopy.text(
              'text.error_value1_caf169bf',
              arguments: {'value1': (e).toString()},
            ),
          ),
        ),
      );
    } finally {
      if (mounted) {
        setState(() => _isSaving = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    return InfoCard(
      title: AppCopy.text('text.weekly_dosage_ce5489d7'),
      actions: [
        if (!_isEditing && !_isSaving)
          IconButton(
            icon: const Icon(Icons.edit, size: 20, color: Color(0xFF6366F1)),
            onPressed: () => setState(() => _isEditing = true),
            tooltip: AppCopy.text('text.edit_dosage_ba49486e'),
          ),
      ],
      child: _isSaving
          ? const Center(
              child: Padding(
                padding: EdgeInsets.all(16),
                child: CircularProgressIndicator(),
              ),
            )
          : _isEditing
          ? DosageEditor(
              initialDosage: widget.patient.weeklyDosage,
              readOnly: false,
              onSave: _saveDosage,
              onCancel: () => setState(() => _isEditing = false),
            )
          : DosageDisplay(dosage: widget.patient.weeklyDosage),
    );
  }
}

class _NextOfKinCard extends StatelessWidget {
  final PatientDetailModel patient;

  const _NextOfKinCard({required this.patient});

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    final kin = patient.nextOfKin;
    if (kin == null || (kin['name'] == null && kin['phone'] == null)) {
      return InfoCard(
        title: AppCopy.text('text.next_of_kin_3c1ef5f'),
        child: Text(
          AppCopy.text('text.no_next_of_kin_information_available_ad71489f'),
          style: TextStyle(
            color: Color(0xFF6B7280),
            fontStyle: FontStyle.italic,
          ),
        ),
      );
    }

    return InfoCard(
      title: AppCopy.text('text.next_of_kin_3c1ef5f'),
      child: Column(
        children: [
          if (kin['name'] != null)
            InfoRow(
              icon: Icons.person,
              label: AppCopy.text('text.name_fe07306'),
              value: kin['name'].toString(),
            ),
          if (kin['relation'] != null)
            InfoRow(
              icon: Icons.family_restroom,
              label: AppCopy.text('text.relation_b4b329c1'),
              value: kin['relation'].toString(),
            ),
          if (kin['phone'] != null)
            InfoRow(
              icon: Icons.phone,
              label: AppCopy.text('text.phone_4930944f'),
              value: kin['phone'].toString(),
            ),
        ],
      ),
    );
  }
}

class _MedicalHistoryCard extends StatelessWidget {
  final PatientDetailModel patient;

  const _MedicalHistoryCard({required this.patient});

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    final history = patient.medicalHistory;
    if (history == null || history.isEmpty) {
      return InfoCard(
        title: AppCopy.text('text.medical_history_880a54f4'),
        child: Text(
          AppCopy.text('text.no_medical_history_recorded_ba32ccf3'),
          style: TextStyle(
            color: Color(0xFF6B7280),
            fontStyle: FontStyle.italic,
          ),
        ),
      );
    }

    return InfoCard(
      title: AppCopy.text('text.medical_history_880a54f4'),
      child: Column(
        children: history.map((item) {
          final diagnosis = item['diagnosis'];
          final durationValue = item['duration_value'];
          final durationUnit = item['duration_unit'];

          return Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFFF9FAFB),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: const Color(0xFFE5E7EB)),
            ),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: const Color(0xFFDCFCE7),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(
                    Icons.medical_information,
                    size: 20,
                    color: Color(0xFF16A34A),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        diagnosis?.toString() ??
                            AppCopy.text('text.unknown_cc200e59'),
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: Color(0xFF1F2937),
                        ),
                      ),
                      if (durationValue != null && durationUnit != null)
                        Text(
                          AppCopy.text(
                            'text.duration_value1_value2_2c32b336',
                            arguments: {
                              'value1': (durationValue).toString(),
                              'value2': (durationUnit).toString(),
                            },
                          ),
                          style: const TextStyle(
                            fontSize: 12,
                            color: Color(0xFF6B7280),
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          );
        }).toList(),
      ),
    );
  }
}

class _MonitoringLogsCard extends StatelessWidget {
  final PatientDetailModel patient;

  const _MonitoringLogsCard({required this.patient});

  static List<({String type, String label, String fallback})> get _entries =>
      <({String type, String label, String fallback})>[
        (
          type: 'SIDE_EFFECT',
          label: AppCopy.text('text.side_effects_f5502c5c'),
          fallback: 'None reported',
        ),
        (
          type: 'ILLNESS',
          label: AppCopy.text('text.illness_e44308a7'),
          fallback: 'None reported',
        ),
        (
          type: 'LIFESTYLE',
          label: AppCopy.text('text.lifestyle_ae65f0a0'),
          fallback: 'Stable',
        ),
        (
          type: 'OTHER_MEDS',
          label: AppCopy.text('text.other_medications_41658fc9'),
          fallback: 'None reported',
        ),
      ];

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    final logs = patient.healthLogs;
    final hasAny =
        logs != null &&
        logs.any((log) {
          if (log is! Map) return false;
          final description = log['description']?.toString().trim();
          return description != null && description.isNotEmpty;
        });

    return InfoCard(
      title: AppCopy.text('text.monitoring_logs_6584b3a6'),
      child: hasAny
          ? Column(
              children: _entries.map((entry) {
                final description = patient.healthLogDescription(
                  entry.type,
                  fallback: entry.fallback,
                );
                final dateRaw = patient.healthLogDate(entry.type);
                final dateLabel = _formatLogDate(dateRaw);
                final isReported = description != entry.fallback;

                return Container(
                  width: double.infinity,
                  margin: const EdgeInsets.only(bottom: 10),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: isReported
                        ? const Color(0xFFFEF3C7)
                        : const Color(0xFFF9FAFB),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: isReported
                          ? const Color(0xFFFCD34D)
                          : const Color(0xFFE5E7EB),
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(
                            isReported
                                ? Icons.warning_amber_rounded
                                : Icons.check_circle_outline,
                            size: 18,
                            color: isReported
                                ? const Color(0xFFD97706)
                                : const Color(0xFF9CA3AF),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              entry.label,
                              style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w700,
                                color: isReported
                                    ? const Color(0xFF92400E)
                                    : const Color(0xFF6B7280),
                              ),
                            ),
                          ),
                          if (dateLabel != null)
                            Text(
                              dateLabel,
                              style: const TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w500,
                                color: Color(0xFF6B7280),
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        description,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: isReported
                              ? FontWeight.w600
                              : FontWeight.w500,
                          color: isReported
                              ? const Color(0xFF1F2937)
                              : const Color(0xFF9CA3AF),
                          fontStyle: isReported
                              ? FontStyle.normal
                              : FontStyle.italic,
                        ),
                      ),
                    ],
                  ),
                );
              }).toList(),
            )
          : Text(
              AppCopy.text(
                'text.no_monitoring_logs_reported_by_the_patient_yet_e7b66bf',
              ),
              style: TextStyle(
                color: Color(0xFF6B7280),
                fontStyle: FontStyle.italic,
              ),
            ),
    );
  }

  String? _formatLogDate(String? raw) {
    if (raw == null || raw.trim().isEmpty) return null;
    final parsed = DateTime.tryParse(raw);
    if (parsed == null) return raw;
    return DateFormat('dd-MM-yyyy').format(parsed.toLocal());
  }
}

class _InrReportsCard extends StatelessWidget {
  final String opNumber;
  final DoctorRepository repository;
  final bool isExpanded;
  final VoidCallback onToggle;

  const _InrReportsCard({
    required this.opNumber,
    required this.repository,
    required this.isExpanded,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(PortalLayout.cardRadius),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        children: [
          // Header
          InkWell(
            onTap: onToggle,
            borderRadius: const BorderRadius.vertical(
              top: Radius.circular(PortalLayout.cardRadius),
            ),
            child: Padding(
              padding: PortalLayout.cardInsets,
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(AppSpacing.xs),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFEF3C7),
                      borderRadius: BorderRadius.circular(AppSpacing.xs),
                    ),
                    child: const Icon(
                      Icons.science,
                      size: 20,
                      color: Color(0xFFF59E0B),
                    ),
                  ),
                  PortalLayout.columnSpacer,
                  Expanded(
                    child: Text(
                      AppCopy.text('text.inr_reports_1bb989f7'),
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        color: Color(0xFF1F2937),
                      ),
                    ),
                  ),
                  Icon(
                    isExpanded ? Icons.expand_less : Icons.expand_more,
                    color: const Color(0xFF6B7280),
                  ),
                ],
              ),
            ),
          ),
          // Content
          if (isExpanded)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                PortalLayout.cardPadding,
                0,
                PortalLayout.cardPadding,
                PortalLayout.cardPadding,
              ),
              child: UseQuery<List<dynamic>>(
                options: QueryOptions<List<dynamic>>(
                  queryKey: DoctorQueryKeys.patientReports(opNumber),
                  staleTime: Duration.zero,
                  refetchOnWindowFocus: true,
                  queryFn: () =>
                      repository.getPatientReports(opNumber, includeUrls: true),
                ),
                builder: (context, query) {
                  return InrReportsSection(
                    reports: query.data ?? [],
                    isLoading: query.isLoading && !query.hasData,
                    error: query.isError ? _formatApiError(query.error) : null,
                    onRefresh: () async {
                      // Single refresh path: drop Hive entry, then one forced
                      // network refetch (do not also invalidate — that double-fetches).
                      final key = DoctorQueryKeys.patientReports(opNumber);
                      await QueryCache.instance.remove(key.toString());
                      await query.refetch();
                    },
                    enableReportViewAction: true,
                  );
                },
              ),
            ),
        ],
      ),
    );
  }
}

String _formatApiError(Object? error) {
  if (error is ApiException) {
    return "${(error.title).toString()}: ${(error.message).toString()}";
  }
  return error?.toString() ??
      AppCopy.text('text.something_went_wrong_76fc465e');
}

class _ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _ErrorView({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 64, color: Color(0xFFDC2626)),
            const SizedBox(height: 16),
            Text(
              AppCopy.text('text.something_went_wrong_76fc465e'),
              style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w600,
                color: Color(0xFF1F2937),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 14, color: Color(0xFF6B7280)),
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: Text(AppCopy.text('text.try_again_f5b37c9a')),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF6366F1),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(
                  horizontal: 24,
                  vertical: 12,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
