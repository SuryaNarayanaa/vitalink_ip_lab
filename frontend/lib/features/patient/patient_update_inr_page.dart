import 'package:flutter/material.dart';
import 'package:frontend/core/widgets/index.dart';
import 'package:frontend/app/routers.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/query/patient_query_keys.dart';
import 'package:frontend/core/widgets/common/file_preview_modal.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:intl/intl.dart';
import 'package:file_picker/file_picker.dart';

class PatientUpdateINRPage extends StatefulWidget {
  final bool embedInShell;
  final ValueChanged<int>? onTabChanged;

  const PatientUpdateINRPage({
    super.key,
    this.embedInShell = false,
    this.onTabChanged,
  });

  @override
  State<PatientUpdateINRPage> createState() => _PatientUpdateINRPageState();
}

class _PatientUpdateINRPageState extends State<PatientUpdateINRPage> {
  final int _currentNavIndex = 1;
  final _formKey = GlobalKey<FormState>();

  final TextEditingController _inrValueController = TextEditingController();
  final TextEditingController _testDateController = TextEditingController();

  PlatformFile? _selectedFile;
  DateTime _selectedDate = DateTime.now();

  @override
  void initState() {
    super.initState();
    _testDateController.text = DateFormat('dd-MM-yyyy').format(_selectedDate);
  }

  @override
  void dispose() {
    _inrValueController.dispose();
    _testDateController.dispose();
    super.dispose();
  }

  Future<void> _pickFile() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf', 'jpg', 'jpeg', 'png'],
      withData: true,
    );

    if (result != null) {
      setState(() {
        _selectedFile = result.files.first;
      });
    }
  }

  Future<void> _showDatePicker(BuildContext context) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedDate,
      firstDate: DateTime.now().subtract(const Duration(days: 365)),
      lastDate: DateTime.now(),
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: Theme.of(context).colorScheme.copyWith(
                  primary: const Color(0xFF0084FF),
                  onPrimary: Colors.white,
                  surface: Colors.white,
                  onSurface: Colors.black87,
                ),
          ),
          child: child!,
        );
      },
    );

    if (picked != null && picked != _selectedDate) {
      setState(() {
        _selectedDate = picked;
        _testDateController.text = DateFormat('dd-MM-yyyy').format(picked);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottomPadding = widget.embedInShell ? 24.0 : 32.0;

    return UseMutation<void, Map<String, dynamic>>(
      options: MutationOptions<void, Map<String, dynamic>>(
        mutationFn: (variables) =>
            AppDependencies.patientRepository.submitINRReport(
          inrValue: variables['inr_value'],
          testDate: variables['test_date'],
          fileBytes: variables['file_bytes'],
          fileName: variables['file_name'],
        ),
        onSuccess: (data, variables) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
                content: Text('Report submitted successfully!'),
                backgroundColor: Colors.green),
          );
          // Invalidate queries to refetch updated data
          final queryClient = QueryClientProvider.of(context);
          queryClient.invalidateQueries(PatientQueryKeys.homeData());
          queryClient.invalidateQueries(PatientQueryKeys.recordsFull());
          queryClient.invalidateQueries(PatientQueryKeys.profileFull());

          if (widget.embedInShell) {
            widget.onTabChanged?.call(3);
          } else {
            Navigator.of(context)
                .pushReplacementNamed(AppRoutes.patientHealthReports);
          }
        },
        onError: (error, variables) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
                content: Text('Error: ${error.toString()}'),
                backgroundColor: Colors.red),
          );
        },
      ),
      builder: (context, mutation) {
        return _buildPageContainer(
          bodyDecoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color(0xFFC8B5E1), Color(0xFFF8C7D7)],
            ),
          ),
          body: SingleChildScrollView(
            padding: EdgeInsets.fromLTRB(24, 32, 24, bottomPadding),
            child: Column(
              children: [
                Form(
                  key: _formKey,
                  child: Container(
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.5),
                      borderRadius: BorderRadius.circular(24),
                      border: Border.all(
                          color: Colors.white.withValues(alpha: 0.3)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('INR Value :',
                            style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                                color: Colors.black87)),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _inrValueController,
                          keyboardType: const TextInputType.numberWithOptions(
                              decimal: true),
                          decoration: _inputDecoration('Enter INR value'),
                          validator: (value) {
                            if (value == null || value.isEmpty) {
                              return 'Please enter INR value';
                            }
                            if (double.tryParse(value) == null) {
                              return 'Please enter a valid number';
                            }
                            return null;
                          },
                        ),
                        const SizedBox(height: 24),
                        const Text('Date of Test :',
                            style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                                color: Colors.black87)),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _testDateController,
                          readOnly: true,
                          onTap: () => _showDatePicker(context),
                          decoration:
                              _inputDecoration('dd-mm-yyyy --:--').copyWith(
                            suffixIcon: const Padding(
                              padding: EdgeInsets.symmetric(horizontal: 12.0),
                              child: Icon(Icons.calendar_month,
                                  color: Colors.black54),
                            ),
                          ),
                        ),
                        const SizedBox(height: 24),
                        const Text('Upload Document:',
                            style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                                color: Colors.black87)),
                        const SizedBox(height: 12),
                        GestureDetector(
                          onTap: _pickFile,
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 16, vertical: 16),
                            decoration: BoxDecoration(
                              color: const Color(0xFFF0E5F5)
                                  .withValues(alpha: 0.5),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: Colors.black12),
                            ),
                            child: Row(
                              children: [
                                const Icon(Icons.attach_file,
                                    color: Colors.black54, size: 20),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Text(
                                    _selectedFile?.name ?? 'Select a file',
                                    style: TextStyle(
                                      color: _selectedFile != null
                                          ? Colors.black87
                                          : Colors.black54,
                                      fontSize: 15,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 32),
                        SizedBox(
                          width: double.infinity,
                          height: 54,
                          child: ElevatedButton(
                            onPressed: mutation.isLoading
                                ? null
                                : () {
                                    if (_formKey.currentState!.validate()) {
                                      mutation.mutate({
                                        'inr_value': _inrValueController.text,
                                        'test_date': _testDateController.text,
                                        'file_bytes': _selectedFile?.bytes,
                                        'file_name': _selectedFile?.name,
                                      });
                                    }
                                  },
                            style: ElevatedButton.styleFrom(
                              backgroundColor: const Color(0xFF0084FF),
                              foregroundColor: Colors.white,
                              shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(12)),
                              elevation: 0,
                            ),
                            child: mutation.isLoading
                                ? const CircularProgressIndicator(
                                    color: Colors.white)
                                : const Text('Submit INR Report',
                                    style: TextStyle(
                                        fontSize: 16,
                                        fontWeight: FontWeight.w700)),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 32),
                _buildReportsHistory(),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildPageContainer({
    required Widget body,
    Decoration? bodyDecoration,
  }) {
    if (widget.embedInShell) {
      return body;
    }

    return PatientScaffold(
      pageTitle: 'Update INR',
      currentNavIndex: _currentNavIndex,
      onNavChanged: _handleNav,
      bodyDecoration: bodyDecoration,
      body: body,
    );
  }

  void _handleNav(int index) {
    if (index == _currentNavIndex) return;
    if (widget.embedInShell) {
      widget.onTabChanged?.call(index);
      return;
    }
    switch (index) {
      case 0:
        Navigator.of(context).pushReplacementNamed(AppRoutes.patient);
        break;
      case 1:
        break;
      case 2:
        Navigator.of(context).pushReplacementNamed(AppRoutes.patientTakeDosage);
        break;
      case 3:
        Navigator.of(context)
            .pushReplacementNamed(AppRoutes.patientHealthReports);
        break;
      case 4:
        Navigator.of(context).pushReplacementNamed(AppRoutes.patientProfile);
        break;
    }
  }

  Widget _buildReportsHistory() {
    return UseQuery<List<Map<String, dynamic>>>(
      options: QueryOptions(
        queryKey: PatientQueryKeys.inrHistory(),
        queryFn: () => AppDependencies.patientRepository.getINRHistory(),
      ),
      builder: (context, query) {
        if (query.isLoading) {
          return Container(
            padding: const EdgeInsets.all(32),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(24),
              border: Border.all(color: Colors.white.withValues(alpha: 0.3)),
            ),
            child: const Center(child: CircularProgressIndicator()),
          );
        }

        if (query.isError) {
          return Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(24),
              border: Border.all(color: Colors.white.withValues(alpha: 0.3)),
            ),
            child: const Text(
              'Error loading reports',
              style: TextStyle(color: Colors.red),
              textAlign: TextAlign.center,
            ),
          );
        }

        final reports = query.data ?? [];

        if (reports.isEmpty) {
          return Container(
            padding: const EdgeInsets.all(32),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(24),
              border: Border.all(color: Colors.white.withValues(alpha: 0.3)),
            ),
            child: Column(
              children: [
                Icon(Icons.description_outlined,
                    size: 48, color: Colors.grey[400]),
                const SizedBox(height: 16),
                const Text(
                  'No reports yet',
                  style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: Colors.black54),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Your submitted reports will appear here',
                  style: TextStyle(fontSize: 14, color: Colors.black45),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          );
        }

        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(Icons.history, size: 22, color: const Color(0xFF6B7280)),
                  const SizedBox(width: 10),
                  const Text(
                    'Previous Reports',
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                      color: Color(0xFF1F2937),
                      letterSpacing: -0.5,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              ...reports.map((report) => _buildReportCard(report)),
            ],
          ),
        );
      },
    );
  }

  Widget _buildReportCard(Map<String, dynamic> report) {
    final inrRaw = report['inr'];
    final inr = (inrRaw is num) ? inrRaw.toDouble() : 0.0;
    final isCritical = report['isCritical'] == true;
    final notes = (report['notes'] as String?) ?? '';
    final hasNotes = notes.isNotEmpty;
    final fileUrl = (report['fileUrl'] as String?) ?? '';
    final hasFile = fileUrl.isNotEmpty;

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.black.withValues(alpha: 0.1)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 10,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF3F4F6),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    'INR: ${inr.toStringAsFixed(1)}',
                    style: const TextStyle(
                      color: Color(0xFF1F2937),
                      fontWeight: FontWeight.w700,
                      fontSize: 15,
                      letterSpacing: -0.3,
                    ),
                  ),
                ),
                if (isCritical) ...[
                  const SizedBox(width: 8),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFEF2F2),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.priority_high,
                            color: Color(0xFF9CA3AF), size: 15),
                        SizedBox(width: 4),
                        Text(
                          'Needs Attention',
                          style: TextStyle(
                            color: Color(0xFF6B7280),
                            fontWeight: FontWeight.w600,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 14),
          Text(
            report['date'] as String,
            style: const TextStyle(
              fontSize: 13,
              color: Color(0xFF6B7280),
              fontWeight: FontWeight.w500,
            ),
          ),
          if (hasNotes) ...[
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFFF9FAFB),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.black.withValues(alpha: 0.08)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.medical_services_outlined,
                          size: 16, color: const Color(0xFF6B7280)),
                      const SizedBox(width: 8),
                      const Text(
                        'Doctor\'s Feedback',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: Color(0xFF374151),
                          letterSpacing: -0.2,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Text(
                    notes,
                    style: const TextStyle(
                      fontSize: 13,
                      color: Color(0xFF6B7280),
                      height: 1.5,
                    ),
                  ),
                ],
              ),
            ),
          ],
          if (hasFile) ...[
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: () {
                  FilePreviewModal.show(
                    context,
                    fileUrl: fileUrl,
                    fileName: 'INR_Report_${report['date']}.pdf',
                  );
                },
                icon: const Icon(Icons.description_outlined, size: 18),
                label: const Text(
                  'View Report',
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 14,
                  ),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF374151),
                  foregroundColor: Colors.white,
                  elevation: 0,
                  shadowColor: Colors.transparent,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  InputDecoration _inputDecoration(String hint) {
    return InputDecoration(
      hintText: hint,
      hintStyle: const TextStyle(color: Colors.black45, fontSize: 14),
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
      enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
      focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFF0084FF), width: 1.5)),
    );
  }
}
