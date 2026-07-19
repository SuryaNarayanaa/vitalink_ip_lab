import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/query/doctor_query_keys.dart';
import 'package:frontend/features/doctor/data/doctor_repository.dart';
import 'package:frontend/features/doctor/models/patient_model.dart';
import 'package:frontend/core/widgets/common/api_error_state.dart';
import 'package:frontend/core/widgets/common/premium_report_card.dart';
import 'package:google_fonts/google_fonts.dart';

class DoctorReportsPage extends StatefulWidget {
  const DoctorReportsPage({super.key});

  @override
  State<DoctorReportsPage> createState() => _DoctorReportsPageState();
}

class _DoctorReportsPageState extends State<DoctorReportsPage> {
  final DoctorRepository _repository = AppDependencies.doctorRepository;
  String? _selectedPatientOp;
  String? _selectedPatientName;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Patient Selector Header
        _buildHeader(),

        // Reports Content
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
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Patient Reports',
            style: GoogleFonts.outfit(
              fontSize: 24,
              fontWeight: FontWeight.w800,
              color: const Color(0xFF1E1E5E),
            ),
          ),
          const SizedBox(height: 16),
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
                                'OP #${_selectedPatientOp ?? 'N/A'}',
                                style: GoogleFonts.outfit(
                                  fontSize: 12.5,
                                  fontWeight: FontWeight.w500,
                                  color: const Color(0xFF6B7280),
                                ),
                              ),
                            ],
                          )
                        : Text(
                            'Select patient to view reports',
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
          setState(() {
            _selectedPatientOp = selectedOp;
            _selectedPatientName = p.name;
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
            child: Icon(Icons.analytics_outlined,
                size: 80,
                color: const Color(0xFF6366F1).withValues(alpha: 0.2)),
          ),
          const SizedBox(height: 24),
          Text(
            'No Patient Selected',
            style: GoogleFonts.outfit(
              fontSize: 20,
              fontWeight: FontWeight.w700,
              color: const Color(0xFF1E1E5E),
            ),
          ),
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 48),
            child: Text(
              'Please select a patient from the dropdown above to view their INR report history.',
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
        queryFn: () => _repository.getPatientReports(
              _selectedPatientOp!,
              includeUrls: true,
            ),
      ),
      builder: (context, query) {
        if (query.isLoading) {
          return const Center(child: CircularProgressIndicator());
        }

        if (query.isError) {
          return ApiErrorState(
            error: query.error,
            onRetry: () => query.refetch(),
          );
        }

        final reports = query.data ?? [];
        if (reports.isEmpty) {
          return Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.history_rounded,
                    size: 64, color: Colors.grey.withValues(alpha: 0.3)),
                const SizedBox(height: 16),
                Text(
                  'No reports found for ${_selectedPatientName ?? 'selected patient'}'
                  ' (OP #${_selectedPatientOp ?? 'N/A'})',
                  style: GoogleFonts.outfit(color: Colors.grey),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          );
        }

        return RefreshIndicator(
          onRefresh: () async => query.refetch(),
          child: ListView.builder(
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 40),
            itemCount: reports.length,
            itemBuilder: (context, index) {
              final report = reports[index];
              return PremiumReportCard(
                report: report,
                showActions: true,
                onUpdatePressed: () =>
                    _updateDialog(context, _repository, report),
              );
            },
          ),
        );
      },
    );
  }

  void _updateDialog(
      BuildContext context, DoctorRepository repository, dynamic report) {
    final notesController = TextEditingController(text: report['notes'] ?? '');
    bool isCrit = report['is_critical'] == true;
    final String rId = report['_id'] ?? '';
    final qClient = QueryClientProvider.of(context);

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => UseMutation<void, Map<String, dynamic>>(
        options: MutationOptions<void, Map<String, dynamic>>(
          mutationFn: (vars) =>
              repository.updateReport(_selectedPatientOp!, rId, vars),
          onSuccess: (_, __) {
            qClient.invalidateQueries(
              DoctorQueryKeys.patientReports(_selectedPatientOp!),
            );
            Navigator.pop(ctx);
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Report Updated Successfully')),
            );
          },
          onError: (e, _) {
            ScaffoldMessenger.of(context)
                .showSnackBar(SnackBar(content: Text('Error: $e')));
          },
        ),
        builder: (context, mutation) {
          return StatefulBuilder(
            builder: (ctx, setS) {
              return Container(
                padding: EdgeInsets.only(
                    bottom: MediaQuery.of(context).viewInsets.bottom),
                decoration: const BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(28),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Medical Intervention',
                        style: GoogleFonts.outfit(
                            fontSize: 24,
                            fontWeight: FontWeight.w800,
                            color: const Color(0xFF1E1E5E)),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Update notes or critical status for this report.',
                        style: GoogleFonts.outfit(color: Colors.grey[600]),
                      ),
                      const SizedBox(height: 24),
                      TextField(
                        controller: notesController,
                        maxLines: 4,
                        style: GoogleFonts.outfit(),
                        decoration: InputDecoration(
                          hintText:
                              'Enter clinical observations and instructions...',
                          fillColor: const Color(0xFFF9FAFB),
                          filled: true,
                          border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(16),
                              borderSide: BorderSide(color: Colors.grey[200]!)),
                          enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(16),
                              borderSide: BorderSide(color: Colors.grey[200]!)),
                        ),
                      ),
                      const SizedBox(height: 20),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 16, vertical: 8),
                        decoration: BoxDecoration(
                          color: isCrit
                              ? Colors.red.withValues(alpha: 0.05)
                              : Colors.grey[50],
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(
                              color: isCrit
                                  ? Colors.red.withValues(alpha: 0.2)
                                  : Colors.grey[200]!),
                        ),
                        child: SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text('Critical Status',
                              style: GoogleFonts.outfit(
                                  fontWeight: FontWeight.bold,
                                  color: isCrit ? Colors.red : Colors.black87)),
                          subtitle: Text(
                              'Flags this report for immediate attention',
                              style: GoogleFonts.outfit(fontSize: 12)),
                          value: isCrit,
                          activeThumbColor: Colors.red,
                          onChanged: (v) => setS(() => isCrit = v),
                        ),
                      ),
                      const SizedBox(height: 32),
                      SizedBox(
                        width: double.infinity,
                        height: 56,
                        child: ElevatedButton(
                          onPressed: mutation.isLoading
                              ? null
                              : () {
                                  mutation.mutate({
                                    'notes': notesController.text.trim(),
                                    'is_critical': isCrit
                                  });
                                },
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF6366F1),
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(16)),
                            elevation: 0,
                          ),
                          child: mutation.isLoading
                              ? const CircularProgressIndicator(
                                  color: Colors.white)
                              : Text('Save Observations',
                                  style: GoogleFonts.outfit(
                                      fontSize: 16,
                                      fontWeight: FontWeight.bold,
                                      color: Colors.white)),
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          );
        },
      ),
    ).then((_) => notesController.dispose());
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
          .where((p) =>
              p.name.toLowerCase().contains(query.toLowerCase()) ||
              (p.opNumber?.toLowerCase().contains(query.toLowerCase()) ??
                  false))
          .toList();
    });
  }

  @override
  Widget build(BuildContext context) {
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
                  borderRadius: BorderRadius.circular(2))),
          Padding(
            padding: const EdgeInsets.all(24),
            child: Row(
              children: [
                Text(
                  'Select Patient',
                  style: GoogleFonts.outfit(
                      fontSize: 22, fontWeight: FontWeight.bold),
                ),
                const Spacer(),
                IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close)),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: TextField(
              controller: _searchController,
              onChanged: _filter,
              decoration: InputDecoration(
                hintText: 'Search by name or OP number...',
                prefixIcon: const Icon(Icons.search),
                filled: true,
                fillColor: const Color(0xFFF3F4F6),
                border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(16),
                    borderSide: BorderSide.none),
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
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  leading: CircleAvatar(
                    backgroundColor: canSelect
                        ? const Color(0xFF6366F1).withValues(alpha: 0.1)
                        : Colors.grey.withValues(alpha: 0.1),
                    child: Text(
                      patientName.isNotEmpty ? patientName[0] : '?',
                      style: TextStyle(
                        color:
                            canSelect ? const Color(0xFF6366F1) : Colors.grey,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  title: Text(
                    canSelect ? '${p.name}  ·  OP #$patientOp' : p.name,
                    style: GoogleFonts.outfit(
                      fontWeight: FontWeight.w600,
                      color: canSelect
                          ? const Color(0xFF111827)
                          : const Color(0xFF9CA3AF),
                    ),
                  ),
                  subtitle: Text(
                    canSelect ? 'Tap to select' : 'OP/Login ID unavailable',
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
