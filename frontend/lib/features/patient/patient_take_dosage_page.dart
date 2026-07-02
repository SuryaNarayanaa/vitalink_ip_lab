import 'package:flutter/material.dart';
import 'package:frontend/core/widgets/index.dart';
import 'package:frontend/app/routers.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/query/patient_query_keys.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';

class PatientTakeDosagePage extends StatefulWidget {
  final bool embedInShell;
  final ValueChanged<int>? onTabChanged;

  const PatientTakeDosagePage({
    super.key,
    this.embedInShell = false,
    this.onTabChanged,
  });

  @override
  State<PatientTakeDosagePage> createState() => _PatientTakeDosagePageState();
}

class _PatientTakeDosagePageState extends State<PatientTakeDosagePage> {
  final int _currentNavIndex = 2;
  int _currentPage = 1;
  final int _itemsPerPage = 8;

  @override
  Widget build(BuildContext context) {
    return UseQuery<Map<String, dynamic>>(
      options: QueryOptions<Map<String, dynamic>>(
        queryKey: PatientQueryKeys.missedDoses(),
        queryFn: () async {
          return await AppDependencies.patientRepository.getMissedDoses();
        },
      ),
      builder: (context, query) {
        if (query.isLoading) {
          return _buildPageContainer(
            body: const Center(child: CircularProgressIndicator()),
          );
        }

        if (query.isError) {
          return _buildPageContainer(
            body: Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text('Error: ${query.error}'),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: () => query.refetch(),
                    child: const Text('Retry'),
                  ),
                ],
              ),
            ),
          );
        }

        if (!query.hasData) {
          return _buildPageContainer(
            body: const Center(child: CircularProgressIndicator()),
          );
        }

        final data = query.data!;
        final recentDoses = data['recent_missed_doses'] as List<dynamic>;
        final remainingDoses = data['missed_doses'] as List<dynamic>;

        return UseMutation<void, Map<String, dynamic>>(
          options: MutationOptions<void, Map<String, dynamic>>(
            mutationFn: (variables) =>
                AppDependencies.patientRepository.markDoseAsTaken(
              date: variables['date'],
              dose: variables['dose'],
            ),
            onSuccess: (data, variables) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('Dose marked as taken!'),
                  backgroundColor: Colors.green,
                ),
              );
              // Invalidate queries to refetch updated data
              final queryClient = QueryClientProvider.of(context);
              queryClient.invalidateQueries(PatientQueryKeys.homeData());
              queryClient.invalidateQueries(PatientQueryKeys.recordsFull());
              query.refetch();
            },
            onError: (error, variables) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('Error: ${error.toString()}'),
                  backgroundColor: Colors.red,
                ),
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
              body: RefreshIndicator(
                onRefresh: () async => query.refetch(),
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                  physics: const AlwaysScrollableScrollPhysics(),
                  child: Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.9),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Calendar Button
                        Container(
                          margin: const EdgeInsets.only(bottom: 16),
                          width: double.infinity,
                          child: ElevatedButton.icon(
                            onPressed: () {
                              Navigator.of(context)
                                  .pushNamed(AppRoutes.patientDosageCalendar);
                            },
                            icon: const Icon(Icons.calendar_month_rounded,
                                size: 20),
                            label: const Text(
                              'View Dosage Calendar',
                              style: TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.blue.shade600,
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 20, vertical: 12),
                              elevation: 2,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                            ),
                          ),
                        ),
                        // Recent Missed Doses Section
                        DosageSection(
                          title: 'Missed Doses',
                          subtitle:
                              'Below are the missed doses for the last 7 days.\nClick on the date to mark it as taken.',
                          children: [
                            if (recentDoses.isEmpty)
                              Center(
                                child: Padding(
                                  padding: const EdgeInsets.all(20),
                                  child: Text(
                                    'No missed doses in the last 7 days',
                                    style: TextStyle(
                                      fontSize: 14,
                                      color: Colors.grey.shade600,
                                    ),
                                  ),
                                ),
                              )
                            else
                              LayoutBuilder(
                                builder: (context, constraints) {
                                  final isCompact = constraints.maxWidth < 360;

                                  return GridView.builder(
                                    shrinkWrap: true,
                                    physics:
                                        const NeverScrollableScrollPhysics(),
                                    gridDelegate:
                                        SliverGridDelegateWithFixedCrossAxisCount(
                                      crossAxisCount: isCompact ? 2 : 3,
                                      crossAxisSpacing: 12,
                                      mainAxisSpacing: 12,
                                      childAspectRatio: isCompact ? 2.8 : 2.5,
                                    ),
                                    itemCount: recentDoses.length,
                                    itemBuilder: (context, index) {
                                      final date = recentDoses[index] as String;
                                      return DosageDateCard(
                                        date: date,
                                        onTap: () => _showMarkAsTakenDialog(
                                          date,
                                          mutation,
                                        ),
                                      );
                                    },
                                  );
                                },
                              ),
                          ],
                        ),
                        const SizedBox(height: 24),

                        // Remaining Missed Doses Section
                        DosageSection(
                          title: 'Remaining Missed Doses',
                          children: [
                            if (remainingDoses.isEmpty)
                              Center(
                                child: Padding(
                                  padding: const EdgeInsets.all(20),
                                  child: Text(
                                    'No remaining missed doses',
                                    style: TextStyle(
                                      fontSize: 14,
                                      color: Colors.grey.shade600,
                                    ),
                                  ),
                                ),
                              )
                            else
                              _buildPaginatedRemainingDoses(remainingDoses),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            );
          },
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
      pageTitle: 'Dosage Management',
      currentNavIndex: _currentNavIndex,
      bodyDecoration: bodyDecoration,
      onNavChanged: _handleNav,
      body: body,
    );
  }

  Widget _buildPaginatedRemainingDoses(List<dynamic> doses) {
    final totalPages = (doses.length / _itemsPerPage).ceil();
    final safeTotalPages = totalPages > 0 ? totalPages : 1;
    final safeCurrentPage = _currentPage.clamp(1, safeTotalPages).toInt();

    if (safeCurrentPage != _currentPage) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          setState(() => _currentPage = safeCurrentPage);
        }
      });
    }

    final startIndex = (safeCurrentPage - 1) * _itemsPerPage;
    final endIndex = (startIndex + _itemsPerPage).clamp(0, doses.length);
    final currentPageDoses = doses.sublist(startIndex, endIndex);

    return Column(
      children: [
        LayoutBuilder(
          builder: (context, constraints) {
            final isCompact = constraints.maxWidth < 360;

            return GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: isCompact ? 1 : 2,
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
                childAspectRatio: isCompact ? 5.2 : 3.5,
              ),
              itemCount: currentPageDoses.length,
              itemBuilder: (context, index) {
                final date = currentPageDoses[index] as String;
                return RemainingDoseCard(date: date);
              },
            );
          },
        ),
        if (totalPages > 1) ...[
          const SizedBox(height: 20),
          Wrap(
            alignment: WrapAlignment.center,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 16,
            runSpacing: 12,
            children: [
              ElevatedButton(
                onPressed: safeCurrentPage > 1
                    ? () => setState(() => _currentPage = safeCurrentPage - 1)
                    : null,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF87CEEB),
                  foregroundColor: Colors.white,
                  disabledBackgroundColor: Colors.grey.shade300,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
                child: const Text('Previous'),
              ),
              Text(
                'Page $safeCurrentPage of $safeTotalPages',
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
              ElevatedButton(
                onPressed: safeCurrentPage < safeTotalPages
                    ? () => setState(() => _currentPage = safeCurrentPage + 1)
                    : null,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF0084FF),
                  foregroundColor: Colors.white,
                  disabledBackgroundColor: Colors.grey.shade300,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
                child: const Text('Next'),
              ),
            ],
          ),
        ],
      ],
    );
  }

  void _showMarkAsTakenDialog(
    String date,
    MutationResult<void, Map<String, dynamic>> mutation,
  ) {
    showDialog(
      context: context,
      barrierDismissible: true,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
        ),
        contentPadding: const EdgeInsets.all(24),
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.green.shade50,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(
                Icons.medication_rounded,
                color: Colors.green.shade700,
                size: 24,
              ),
            ),
            const SizedBox(width: 12),
            const Expanded(
              child: Text(
                'Mark Dose as Taken',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: Color(0xFF1A1A1A),
                ),
              ),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 8),
            const Text(
              'Are you sure you want to mark this dose as taken?',
              style: TextStyle(
                fontSize: 15,
                color: Color(0xFF666666),
                height: 1.5,
              ),
            ),
            const SizedBox(height: 20),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [Colors.green.shade50, Colors.green.shade100],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: Colors.green.shade200,
                  width: 1.5,
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.calendar_today_rounded,
                    size: 20,
                    color: Colors.green.shade700,
                  ),
                  const SizedBox(width: 12),
                  Text(
                    date,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: Colors.green.shade900,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => Navigator.pop(context),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    side: BorderSide(color: Colors.grey.shade300, width: 1.5),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: Text(
                    'Cancel',
                    style: TextStyle(
                      color: Colors.grey.shade700,
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton(
                  onPressed: mutation.isLoading
                      ? null
                      : () {
                          Navigator.pop(context);
                          mutation.mutate({
                            'date': date,
                            'dose': 5.0, // Default dose value
                          });
                        },
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    backgroundColor: Colors.green.shade600,
                    foregroundColor: Colors.white,
                    elevation: 0,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: mutation.isLoading
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.5,
                            color: Colors.white,
                          ),
                        )
                      : const Text(
                          'Confirm',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                ),
              ),
            ],
          ),
        ],
        actionsPadding: const EdgeInsets.fromLTRB(24, 0, 24, 20),
      ),
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
        Navigator.of(context).pushReplacementNamed(AppRoutes.patientUpdateINR);
        break;
      case 2:
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
}
