import 'package:flutter/material.dart';
import 'package:frontend/core/widgets/index.dart';
import 'package:frontend/app/routers.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/query/patient_query_keys.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';

class PatientRecordsPage extends StatefulWidget {
  const PatientRecordsPage({super.key});

  @override
  State<PatientRecordsPage> createState() => _PatientRecordsPageState();
}

class _PatientRecordsPageState extends State<PatientRecordsPage> {
  final int _currentNavIndex = 3;
  int _selectedTabIndex = 0;

  @override
  Widget build(BuildContext context) {
    const bottomPadding = 28.0;

    return UseQuery<Map<String, dynamic>>(
      options: QueryOptions<Map<String, dynamic>>(
        queryKey: PatientQueryKeys.recordsFull(),
        queryFn: () async {
          final profile = await AppDependencies.patientRepository.getProfile();
          final history =
              await AppDependencies.patientRepository.getINRHistory();
          return {
            'profile': profile,
            'history': history,
          };
        },
      ),
      builder: (context, query) {
        if (query.isLoading) {
          return PatientScaffold(
            pageTitle: 'My Records',
            currentNavIndex: 3,
            onNavChanged: (index) => _handleNav(index),
            body: const Center(child: CircularProgressIndicator()),
          );
        }

        if (query.isError) {
          return PatientScaffold(
            pageTitle: 'My Records',
            currentNavIndex: 3,
            onNavChanged: (index) => _handleNav(index),
            body: Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text('Error: ${query.error}'),
                  const SizedBox(height: 16),
                  ElevatedButton(
                      onPressed: () => query.refetch(),
                      child: const Text('Retry')),
                ],
              ),
            ),
          );
        }

        if (!query.hasData) {
          return PatientScaffold(
            pageTitle: 'My Records',
            currentNavIndex: 3,
            onNavChanged: (index) => _handleNav(index),
            body: const Center(child: CircularProgressIndicator()),
          );
        }

        final data = query.data!;
        final profile = data['profile'] as Map<String, dynamic>;
        final history = data['history'] as List<Map<String, dynamic>>;

        return PatientScaffold(
          pageTitle: 'My Records',
          currentNavIndex: _currentNavIndex,
          bodyDecoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color(0xFFC8B5E1), Color(0xFFF8C7D7)],
            ),
          ),
          onNavChanged: (index) => _handleNav(index),
          body: RefreshIndicator(
            onRefresh: () async => query.refetch(),
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, bottomPadding),
              physics: const AlwaysScrollableScrollPhysics(),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Tabs
                  _buildTabBar(),
                  const SizedBox(height: 20),

                  // Content based on selected tab
                  if (_selectedTabIndex == 0)
                    _buildINRHistory(profile, history)
                  else if (_selectedTabIndex == 1)
                    _buildHealthLogs(
                      profile,
                      onDataChanged: () async => query.refetch(),
                    )
                  else
                    _buildDosageSchedule(profile),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  void _handleNav(int index) {
    if (index == _currentNavIndex) return;
    switch (index) {
      case 0:
        Navigator.of(context).pushReplacementNamed(AppRoutes.patient);
        break;
      case 1:
        Navigator.of(context).pushReplacementNamed(AppRoutes.patientUpdateINR);
        break;
      case 2:
        Navigator.of(context).pushReplacementNamed(AppRoutes.patientTakeDosage);
        break;
      case 3:
        break;
      case 4:
        Navigator.of(context).pushReplacementNamed(AppRoutes.patientProfile);
        break;
    }
  }

  Widget _buildTabItem(int index, String label) {
    final isSelected = _selectedTabIndex == index;
    return GestureDetector(
      onTap: () => setState(() => _selectedTabIndex = index),
      child: Container(
        constraints: const BoxConstraints(minWidth: 110),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        decoration: BoxDecoration(
          border: isSelected
              ? Border(
                  bottom: BorderSide(
                    color: Colors.pink[400]!,
                    width: 3,
                  ),
                )
              : null,
        ),
        child: Text(
          label,
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            color: isSelected ? Colors.pink[400] : Colors.grey[600],
          ),
        ),
      ),
    );
  }

  Widget _buildTabBar() {
    return Container(
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(color: Colors.grey.shade300, width: 1),
        ),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            _buildTabItem(0, 'INR History'),
            _buildTabItem(1, 'Health Logs'),
            _buildTabItem(2, 'Dosage'),
          ],
        ),
      ),
    );
  }

  Widget _buildINRHistory(
      Map<String, dynamic> profile, List<Map<String, dynamic>> history) {
    final targetINR = profile['targetINR'] ?? '2.0 - 3.0';

    return Column(
      children: [
        // Summary card
        Card(
          elevation: 2,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Target INR Range',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: Colors.grey[600],
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Text(
                      targetINR,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                        color: Colors.black87,
                      ),
                    ),
                    const Spacer(),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.green.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: const Text(
                        'On Track',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: Colors.green,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 20),

        // INR history list
        Text(
          'Test History',
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            color: Colors.black87,
          ),
        ),
        const SizedBox(height: 12),
        if (history.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Center(child: Text('No INR reports found.')),
          )
        else
          ...history.map((record) {
            final status = record['status'] as String? ?? 'Normal';
            final isCritical = record['isCritical'] == true ||
                status == 'Critical' ||
                status == 'High' ||
                status == 'Low';

            return Card(
              elevation: 1,
              margin: const EdgeInsets.only(bottom: 12),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: BorderSide(
                  color: isCritical
                      ? Colors.orange.withValues(alpha: 0.3)
                      : Colors.green.withValues(alpha: 0.2),
                  width: 1,
                ),
              ),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          record['date'] ?? 'N/A',
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: Colors.black87,
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: isCritical
                                ? Colors.orange.withValues(alpha: 0.1)
                                : Colors.green.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            'INR: ${record['inr']}',
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: isCritical
                                  ? Colors.orange[700]
                                  : Colors.green[700],
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    if (record['notes'] != null &&
                        record['notes'] != 'No notes')
                      Text(
                        record['notes'],
                        style: TextStyle(
                          fontSize: 13,
                          color: Colors.grey[700],
                        ),
                      ),
                  ],
                ),
              ),
            );
          }),
      ],
    );
  }

  Widget _buildHealthLogs(
    Map<String, dynamic> profile, {
    required Future<void> Function() onDataChanged,
  }) {
    final logs =
        profile['healthLogs'] as List? ?? profile['health_logs'] as List? ?? [];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ElevatedButton.icon(
          onPressed: () =>
              _showAddHealthLogDialog(onDataChanged: onDataChanged),
          icon: const Icon(Icons.add),
          label: const Text('Add Health Log'),
          style: ElevatedButton.styleFrom(
            backgroundColor: Colors.pink[400],
            minimumSize: const Size.fromHeight(44),
          ),
        ),
        const SizedBox(height: 16),
        if (logs.isEmpty)
          Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: Column(
                children: [
                  Icon(Icons.favorite, size: 64, color: Colors.grey[300]),
                  const SizedBox(height: 16),
                  Text(
                    'No health logs',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w500,
                      color: Colors.grey[600],
                    ),
                  ),
                ],
              ),
            ),
          )
        else
          ...logs.map((log) {
            final type = log['type'] ?? 'OTHER';
            final severity = log['severity'] ?? 'Normal';
            final isResolved = log['is_resolved'] ?? true;
            final dateStr =
                AppDependencies.patientRepository.formatDate(log['date']);

            return Card(
              elevation: 1,
              margin: const EdgeInsets.only(bottom: 12),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _getLogTypeLabel(type),
                              style: const TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                                color: Colors.black87,
                              ),
                            ),
                            Text(
                              dateStr,
                              style: TextStyle(
                                fontSize: 12,
                                color: Colors.grey[600],
                              ),
                            ),
                          ],
                        ),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                                vertical: 4,
                              ),
                              decoration: BoxDecoration(
                                color: _getSeverityColor(severity),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(
                                severity,
                                style: const TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                  color: Colors.white,
                                ),
                              ),
                            ),
                            const SizedBox(height: 4),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color: isResolved
                                    ? Colors.green.withValues(alpha: 0.1)
                                    : Colors.orange.withValues(alpha: 0.1),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(
                                isResolved ? 'Resolved' : 'Ongoing',
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                  color: isResolved
                                      ? Colors.green[700]
                                      : Colors.orange[700],
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      log['description'] ?? 'No description',
                      style: TextStyle(
                        fontSize: 13,
                        color: Colors.grey[700],
                      ),
                    ),
                  ],
                ),
              ),
            );
          }),
      ],
    );
  }

  Widget _buildDosageSchedule(Map<String, dynamic> profile) {
    const days = [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ];
    const dayKeys = [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ];

    final weeklyDosage = profile['weeklyDosage'] as Map<String, dynamic>? ?? {};
    double totalWeeklyDose = 0;
    for (final key in dayKeys) {
      final value = weeklyDosage[key];
      if (value is num) {
        totalWeeklyDose += value.toDouble();
      } else if (value is String) {
        totalWeeklyDose += double.tryParse(value) ?? 0.0;
      }
    }

    return Column(
      children: [
        Card(
          elevation: 2,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Weekly Dosage Summary',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: Colors.grey[600],
                  ),
                ),
                const SizedBox(height: 8),
                Wrap(
                  alignment: WrapAlignment.spaceBetween,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: 12,
                  runSpacing: 8,
                  children: [
                    Text(
                      '${totalWeeklyDose.toStringAsFixed(1)} mg',
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                        color: Colors.black87,
                      ),
                    ),
                    Text(
                      'Total Weekly',
                      style: TextStyle(
                        fontSize: 13,
                        color: Colors.grey[600],
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 20),
        Text(
          'Daily Schedule',
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            color: Colors.black87,
          ),
        ),
        const SizedBox(height: 12),
        LayoutBuilder(
          builder: (context, constraints) {
            final isCompact = constraints.maxWidth < 360;

            return GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: isCompact ? 2 : 3,
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
                childAspectRatio: isCompact ? 1.5 : 1.2,
              ),
              itemCount: days.length,
              itemBuilder: (context, index) {
                final value = weeklyDosage[dayKeys[index]];
                double dose = 0.0;
                if (value is num) {
                  dose = value.toDouble();
                } else if (value is String) {
                  dose = double.tryParse(value) ?? 0.0;
                }

                return Card(
                  elevation: 1,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        days[index].substring(0, 3),
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: Colors.grey[600],
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        dose.toStringAsFixed(1),
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: Colors.black87,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'mg',
                        style: TextStyle(
                          fontSize: 11,
                          color: Colors.grey[600],
                        ),
                      ),
                    ],
                  ),
                );
              },
            );
          },
        ),
      ],
    );
  }

  void _showAddHealthLogDialog(
      {required Future<void> Function() onDataChanged}) {
    final descriptionController = TextEditingController();
    String selectedType = 'SIDE_EFFECT';
    bool isSubmitting = false;

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: const Text('Add Health Log'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Log Type',
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                  ),
                ),
                const SizedBox(height: 8),
                DropdownButton<String>(
                  isExpanded: true,
                  value: selectedType,
                  items: const [
                    DropdownMenuItem(
                      value: 'SIDE_EFFECT',
                      child: Text('Side Effect'),
                    ),
                    DropdownMenuItem(
                      value: 'ILLNESS',
                      child: Text('Illness'),
                    ),
                    DropdownMenuItem(
                      value: 'LIFESTYLE',
                      child: Text('Lifestyle Change'),
                    ),
                    DropdownMenuItem(
                      value: 'OTHER_MEDS',
                      child: Text('Other Medications'),
                    ),
                  ],
                  onChanged: isSubmitting
                      ? null
                      : (value) {
                          if (value == null) return;
                          setDialogState(() => selectedType = value);
                        },
                ),
                const SizedBox(height: 16),
                const Text(
                  'Description',
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: descriptionController,
                  decoration: InputDecoration(
                    hintText: 'Enter details...',
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                    contentPadding: const EdgeInsets.all(12),
                  ),
                  maxLines: 3,
                  enabled: !isSubmitting,
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed:
                  isSubmitting ? null : () => Navigator.pop(dialogContext),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: isSubmitting
                  ? null
                  : () async {
                      final dialogNavigator = Navigator.of(dialogContext);
                      final description = descriptionController.text.trim();
                      if (description.isEmpty) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Please enter a description'),
                            backgroundColor: Colors.orange,
                          ),
                        );
                        return;
                      }

                      setDialogState(() => isSubmitting = true);
                      try {
                        await AppDependencies.patientRepository.submitHealthLog(
                          type: selectedType,
                          description: description,
                        );

                        if (!mounted) return;
                        if (dialogNavigator.canPop()) {
                          dialogNavigator.pop();
                        }
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Health log added successfully'),
                            backgroundColor: Colors.green,
                            duration: Duration(seconds: 2),
                          ),
                        );

                        final queryClient = QueryClientProvider.of(context);
                        queryClient.invalidateQueries(
                          PatientQueryKeys.recordsFull(),
                        );
                        queryClient.invalidateQueries(
                          PatientQueryKeys.profileFull(),
                        );
                        queryClient.invalidateQueries(
                          PatientQueryKeys.homeData(),
                        );
                        await onDataChanged();
                      } catch (error) {
                        if (!mounted) return;
                        setDialogState(() => isSubmitting = false);
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text('Error: ${error.toString()}'),
                            backgroundColor: Colors.red,
                          ),
                        );
                      }
                    },
              child: isSubmitting
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Add'),
            ),
          ],
        ),
      ),
    ).then((_) => descriptionController.dispose());
  }

  String _getLogTypeLabel(String type) {
    const labels = {
      'SIDE_EFFECT': 'Side Effect',
      'ILLNESS': 'Illness',
      'LIFESTYLE': 'Lifestyle Change',
      'OTHER_MEDS': 'Other Medications',
    };
    return labels[type] ?? type;
  }

  Color _getSeverityColor(String severity) {
    switch (severity) {
      case 'Emergency':
        return Colors.red;
      case 'High':
        return Colors.orange;
      default:
        return Colors.green;
    }
  }
}
