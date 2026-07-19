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
  final List<PatientModel>? allPatients;
  final int? initialIndex;

  const ViewPatientPage({
    super.key,
    required this.opNumber,
    this.allPatients,
    this.initialIndex,
  });

  @override
  State<ViewPatientPage> createState() => _ViewPatientPageState();
}

class _ViewPatientPageState extends State<ViewPatientPage> {
  final DoctorRepository _repo = AppDependencies.doctorRepository;
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
          'Patient Details',
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
              controller: _pageController,
              itemCount: widget.allPatients!.length,
              onPageChanged: (index) {
                final patient = widget.allPatients![index];
                if (patient.opNumber != null) {
                  setState(() {
                    _currentIndex = index;
                    _currentOpNumber = patient.opNumber!;
                  });
                }
              },
              itemBuilder: (context, index) {
                final patient = widget.allPatients![index];
                if (patient.opNumber == null) {
                  return const Center(child: Text('Invalid patient'));
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
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: SafeArea(
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    _NavButton(
                      icon: Icons.chevron_left,
                      label: 'Previous',
                      enabled: _currentIndex > 0,
                      onTap: () => _navigateToPatient(_currentIndex - 1),
                    ),
                    _NavButton(
                      icon: Icons.chevron_right,
                      label: 'Next',
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
    return TextButton(
      onPressed: enabled ? onTap : null,
      style: TextButton.styleFrom(
        foregroundColor:
            enabled ? const Color(0xFF6366F1) : const Color(0xFFD1D5DB),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: iconAfter
            ? [
                Text(label,
                    style: const TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(width: 4),
                Icon(icon, size: 20),
              ]
            : [
                Icon(icon, size: 20),
                const SizedBox(width: 4),
                Text(label,
                    style: const TextStyle(fontWeight: FontWeight.w600)),
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
    return UseQuery<PatientDetailModel>(
      options: QueryOptions<PatientDetailModel>(
        queryKey: DoctorQueryKeys.patientDetail(widget.opNumber),
        queryFn: () => widget.repository.getPatientDetail(widget.opNumber),
      ),
      builder: (context, patientQuery) {
        if (patientQuery.isLoading) {
          return const Center(child: CircularProgressIndicator());
        }

        if (patientQuery.isError) {
          return _ErrorView(
            message: patientQuery.error.toString(),
            onRetry: () => patientQuery.refetch(),
          );
        }

        final patient = patientQuery.data;
        if (patient == null) {
          return const Center(child: Text('Patient not found'));
        }

        return RefreshIndicator(
          onRefresh: () async {
            await patientQuery.refetch();
          },
          child: SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Patient Header Card
                _PatientHeaderCard(
                  patient: patient,
                  opNumber: widget.opNumber
                ),

                const SizedBox(height: 16),

                // Quick Actions
                _QuickActionsCard(
                  opNumber: widget.opNumber,
                  patient: patient,
                  repository: widget.repository,
                  onPatientUpdated: () => patientQuery.refetch(),
                ),

                const SizedBox(height: 16),

                // Medical Configuration
                _MedicalConfigCard(patient: patient),

                const SizedBox(height: 16),

                // Weekly Dosage
                _DosageCard(
                  opNumber: widget.opNumber,
                  patient: patient,
                  repository: widget.repository,
                  onUpdated: () => patientQuery.refetch(),
                ),

                const SizedBox(height: 16),

                // Next of Kin
                _NextOfKinCard(patient: patient),

                const SizedBox(height: 16),

                // Medical History
                _MedicalHistoryCard(patient: patient),

                const SizedBox(height: 16),

                // INR Reports Section
                _InrReportsCard(
                  opNumber: widget.opNumber,
                  repository: widget.repository,
                  isExpanded: _showReports,
                  onToggle: () => setState(() => _showReports = !_showReports),
                ),

                const SizedBox(height: 32),
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

  const _PatientHeaderCard({
    required this.patient,
    required this.opNumber,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
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
          const SizedBox(width: 16),
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
                const SizedBox(height: 4),
                Row(
                  children: [
                    _InfoChip(
                      icon: Icons.badge_outlined,
                      label: 'OP #${patient.opNumber ?? opNumber}',
                      color: const Color(0xFF6366F1),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    if (patient.age != null) ...[
                      _InfoChip(
                        icon: Icons.cake_outlined,
                        label: '${patient.age} yrs',
                        color: const Color(0xFF059669),
                      ),
                      const SizedBox(width: 8),
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
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      const Icon(Icons.phone,
                          size: 14, color: Color(0xFF6B7280)),
                      const SizedBox(width: 4),
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
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
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
          const Text(
            'Quick Actions',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w600,
              color: Color(0xFF1F2937),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _ActionButton(
                  icon: Icons.calendar_month,
                  label: 'Update Review',
                  color: const Color(0xFF6366F1),
                  onTap: () => _showUpdateReviewDialog(context),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _ActionButton(
                  icon: Icons.swap_horiz,
                  label: 'Reassign',
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
            title: const Text('Update Next Review Date'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ListTile(
                  leading: const Icon(Icons.calendar_today),
                  title: Text(
                    selectedDate != null
                        ? DateFormat('dd-MM-yyyy').format(selectedDate!)
                        : 'Select Date',
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
                child: const Text('Cancel'),
              ),
              ElevatedButton(
                onPressed: selectedDate == null
                    ? null
                    : () async {
                        final dateStr =
                            DateFormat('dd-MM-yyyy').format(selectedDate!);
                        try {
                          await repository.updateNextReview(opNumber, dateStr);
                          if (ctx.mounted) {
                            Navigator.of(ctx).pop();
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                  content:
                                      Text('Review date updated successfully')),
                            );
                            onPatientUpdated();
                          }
                        } catch (e) {
                          if (ctx.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text('Error: $e')),
                            );
                          }
                        }
                      },
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF6366F1),
                  foregroundColor: Colors.white,
                ),
                child: const Text('Update'),
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
    return AlertDialog(
      title: const Text('Reassign Patient'),
      content: SizedBox(
        width: double.maxFinite,
        child: _loadingDoctors
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? Text('Error: $_error')
                : Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Select a doctor to reassign this patient:',
                        style:
                            TextStyle(fontSize: 14, color: Color(0xFF6B7280)),
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
                            final name =
                                profile?['name'] ?? loginId ?? 'Unknown';
                            final doctorId = loginId ?? '';
                            final selected = _selectedDoctorId == doctorId;

                            return ListTile(
                              dense: true,
                              onTap: doctorId.isEmpty
                                  ? null
                                  : () => setState(
                                      () => _selectedDoctorId = doctorId),
                              leading: Icon(
                                selected
                                    ? Icons.radio_button_checked
                                    : Icons.radio_button_unchecked,
                                color: selected
                                    ? const Color(0xFFF59E0B)
                                    : Colors.grey,
                              ),
                              title: Text(name),
                              subtitle:
                                  loginId != null ? Text('ID: $loginId') : null,
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
          child: const Text('Cancel'),
        ),
        ElevatedButton(
          onPressed: _selectedDoctorId == null || _isLoading
              ? null
              : () async {
                  final messenger = ScaffoldMessenger.of(context);
                  setState(() => _isLoading = true);
                  try {
                    await widget.repository
                        .reassignPatient(widget.opNumber, _selectedDoctorId!);
                    if (!mounted) return;
                    messenger.showSnackBar(
                      const SnackBar(
                          content: Text('Patient reassigned successfully')),
                    );
                    widget.onSuccess();
                  } catch (e) {
                    if (!mounted) return;
                    messenger.showSnackBar(
                      SnackBar(content: Text('Error: $e')),
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
                      strokeWidth: 2, color: Colors.white),
                )
              : const Text('Reassign'),
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
              Text(
                label,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: color,
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
    if (date == null) return 'Not set';
    try {
      final DateTime dt =
          date is DateTime ? date : DateTime.parse(date.toString());
      return DateFormat('dd MMM yyyy').format(dt);
    } catch (_) {
      return date.toString();
    }
  }

  @override
  Widget build(BuildContext context) {
    final config = patient.medicalConfig;
    final targetInr = config?['target_inr'] as Map<String, dynamic>?;

    return InfoCard(
      title: 'Medical Configuration',
      child: Column(
        children: [
          InfoRow(
            icon: Icons.medication,
            label: 'Therapy Drug',
            value: config?['therapy_drug']?.toString() ?? 'Not specified',
          ),
          InfoRow(
            icon: Icons.play_arrow,
            label: 'Start Date',
            value: _formatDate(config?['therapy_start_date']),
          ),
          InfoRow(
            icon: Icons.analytics,
            label: 'Target INR',
            value: targetInr != null
                ? '${targetInr['min'] ?? 2.0} - ${targetInr['max'] ?? 3.0}'
                : '2.0 - 3.0',
            valueColor: const Color(0xFF059669),
          ),
          InfoRow(
            icon: Icons.event,
            label: 'Next Review',
            value: _formatDate(config?['next_review_date']),
            valueColor: const Color(0xFF6366F1),
          ),
          if (config?['instructions'] != null &&
              (config!['instructions'] as List).isNotEmpty) ...[
            const Divider(height: 24),
            const Align(
              alignment: Alignment.centerLeft,
              child: Text(
                'Instructions',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: Color(0xFF1F2937),
                ),
              ),
            ),
            const SizedBox(height: 8),
            ...((config['instructions'] as List).map((instr) => Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('• ',
                          style: TextStyle(color: Color(0xFF6B7280))),
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
                ))),
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
        const SnackBar(content: Text('Dosage updated successfully')),
      );
      widget.onUpdated();
      setState(() => _isEditing = false);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error: $e')),
      );
    } finally {
      if (mounted) {
        setState(() => _isSaving = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return InfoCard(
      title: 'Weekly Dosage',
      actions: [
        if (!_isEditing && !_isSaving)
          IconButton(
            icon: const Icon(Icons.edit, size: 20, color: Color(0xFF6366F1)),
            onPressed: () => setState(() => _isEditing = true),
            tooltip: 'Edit Dosage',
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
    final kin = patient.nextOfKin;
    if (kin == null || (kin['name'] == null && kin['phone'] == null)) {
      return InfoCard(
        title: 'Next of Kin',
        child: const Text(
          'No next of kin information available',
          style: TextStyle(
            color: Color(0xFF6B7280),
            fontStyle: FontStyle.italic,
          ),
        ),
      );
    }

    return InfoCard(
      title: 'Next of Kin',
      child: Column(
        children: [
          if (kin['name'] != null)
            InfoRow(
              icon: Icons.person,
              label: 'Name',
              value: kin['name'].toString(),
            ),
          if (kin['relation'] != null)
            InfoRow(
              icon: Icons.family_restroom,
              label: 'Relation',
              value: kin['relation'].toString(),
            ),
          if (kin['phone'] != null)
            InfoRow(
              icon: Icons.phone,
              label: 'Phone',
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
    final history = patient.medicalHistory;
    if (history == null || history.isEmpty) {
      return InfoCard(
        title: 'Medical History',
        child: const Text(
          'No medical history recorded',
          style: TextStyle(
            color: Color(0xFF6B7280),
            fontStyle: FontStyle.italic,
          ),
        ),
      );
    }

    return InfoCard(
      title: 'Medical History',
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
                        diagnosis?.toString() ?? 'Unknown',
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: Color(0xFF1F2937),
                        ),
                      ),
                      if (durationValue != null && durationUnit != null)
                        Text(
                          'Duration: $durationValue $durationUnit',
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
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
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
            borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFEF3C7),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Icon(
                      Icons.science,
                      size: 20,
                      color: Color(0xFFF59E0B),
                    ),
                  ),
                  const SizedBox(width: 12),
                  const Expanded(
                    child: Text(
                      'INR Reports',
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
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: UseQuery<List<dynamic>>(
                options: QueryOptions<List<dynamic>>(
                  queryKey: DoctorQueryKeys.patientReports(opNumber),
                  queryFn: () => repository.getPatientReports(
                        opNumber,
                        includeUrls: true,
                      ),
                ),
                builder: (context, query) {
                  return InrReportsSection(
                    reports: query.data ?? [],
                    isLoading: query.isLoading,
                    error: query.isError ? _formatApiError(query.error) : null,
                    onRefresh: () => query.refetch(),
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
    return '${error.title}: ${error.message}';
  }
  return error?.toString() ?? 'Something went wrong';
}

class _ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _ErrorView({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(
              Icons.error_outline,
              size: 64,
              color: Color(0xFFDC2626),
            ),
            const SizedBox(height: 16),
            Text(
              'Something went wrong',
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
              style: const TextStyle(
                fontSize: 14,
                color: Color(0xFF6B7280),
              ),
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Try Again'),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF6366F1),
                foregroundColor: Colors.white,
                padding:
                    const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
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
