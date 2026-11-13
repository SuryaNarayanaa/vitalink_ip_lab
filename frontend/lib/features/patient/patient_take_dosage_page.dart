import 'package:frontend/core/config/app_properties.dart';
import 'package:flutter/material.dart';
import 'package:frontend/features/patient/data/patient_repository.dart';
import 'package:frontend/core/widgets/index.dart';
import 'package:frontend/app/routers.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/query/patient_query_keys.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';

class PatientTakeDosagePage extends StatefulWidget {
  final PatientRepository? repository;
  final bool embedInShell;
  final ValueChanged<int>? onTabChanged;

  const PatientTakeDosagePage({
    super.key,
    this.embedInShell = false,
    this.repository,
    this.onTabChanged,
  });

  @override
  State<PatientTakeDosagePage> createState() => _PatientTakeDosagePageState();
}

class _PatientTakeDosagePageState extends State<PatientTakeDosagePage> {
  final int _currentNavIndex = 2;

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    return UseQuery<Map<String, dynamic>>(
      options: QueryOptions<Map<String, dynamic>>(
        queryKey: PatientQueryKeys.missedDoses(),
        queryFn: () async {
          return await (widget.repository ?? AppDependencies.patientRepository)
              .getMissedDoses();
        },
      ),
      builder: (context, query) {
        final data = query.data;
        final recentDoses =
            (data?['recent_missed_doses'] as List<dynamic>?) ?? const [];

        return UseMutation<void, Map<String, dynamic>>(
          options: MutationOptions<void, Map<String, dynamic>>(
            mutationFn: (variables) =>
                (widget.repository ?? AppDependencies.patientRepository)
                    .markDoseAsTaken(
                      date: variables['date'],
                      dose: variables['dose'],
                    ),
            onSuccess: (data, variables) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                    AppCopy.text('text.dose_marked_as_taken_10499f6f'),
                  ),
                  backgroundColor: Colors.green,
                ),
              );
              final queryClient = QueryClientProvider.of(context);
              queryClient.invalidateQueries(PatientQueryKeys.homeData());
              queryClient.invalidateQueries(PatientQueryKeys.recordsFull());
              queryClient.invalidateQueries(PatientQueryKeys.dosageCalendar(3));
              query.refetch();
            },
            onError: (error, variables) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(error.toString()),
                  backgroundColor: Colors.red,
                ),
              );
            },
          ),
          builder: (context, mutation) {
            final Widget body;
            if (query.isError) {
              body = KeyedSubtree(
                key: const ValueKey('patient-dosage-error'),
                child: ApiErrorState(
                  error: query.error,
                  onRetry: () => query.refetch(),
                ),
              );
            } else if (query.isLoading || !query.hasData) {
              body = KeyedSubtree(
                key: const ValueKey('patient-dosage-loading'),
                child: PageSkeleton(
                  cardCount: 3,
                  padding: PortalLayout.pagePadding(
                    embedInShell: widget.embedInShell,
                  ),
                ),
              );
            } else {
              body = KeyedSubtree(
                key: const ValueKey('patient-dosage-ready'),
                child: RefreshIndicator(
                  onRefresh: () async => query.refetch(),
                  child: SingleChildScrollView(
                    padding: PortalLayout.pagePadding(
                      embedInShell: widget.embedInShell,
                    ),
                    physics: const AlwaysScrollableScrollPhysics(),
                    child: Container(
                      padding: PortalLayout.cardInsetsComfortable,
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.9),
                        borderRadius: BorderRadius.circular(
                          PortalLayout.cardRadius,
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.06),
                            blurRadius: 8,
                            offset: const Offset(0, 3),
                          ),
                        ],
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SizedBox(
                            width: double.infinity,
                            child: ElevatedButton.icon(
                              onPressed: () {
                                Navigator.of(
                                  context,
                                ).pushNamed(AppRoutes.patientDosageCalendar);
                              },
                              icon: const Icon(
                                Icons.calendar_month_rounded,
                                size: 20,
                              ),
                              label: Text(
                                AppCopy.text(
                                  'text.view_dosage_calendar_9b4abf99',
                                ),
                                style: TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: Colors.blue.shade600,
                                foregroundColor: Colors.white,
                                minimumSize: const Size.fromHeight(48),
                                padding: const EdgeInsets.symmetric(
                                  horizontal:
                                      PortalLayout.cardPaddingComfortable,
                                  vertical: PortalLayout.itemGap,
                                ),
                                elevation: 0,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(
                                    PortalLayout.controlRadius,
                                  ),
                                ),
                              ),
                            ),
                          ),
                          PortalLayout.sectionSpacerTight,
                          DosageSection(
                            title: AppCopy.text('text.missed_doses_22386d06'),
                            subtitle: AppCopy.text(
                              'text.missed_doses_from_the_last_7_days_tap_a_date_to__6902e33d',
                            ),
                            children: [
                              if (recentDoses.isEmpty)
                                Center(
                                  child: Padding(
                                    padding: PortalLayout.cardInsetsComfortable,
                                    child: Text(
                                      AppCopy.text(
                                        'text.no_missed_doses_in_the_last_7_days_93fe0353',
                                      ),
                                      style: TextStyle(
                                        fontSize: 14,
                                        color: Colors.grey.shade700,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                  ),
                                )
                              else
                                LayoutBuilder(
                                  builder: (context, constraints) {
                                    final isCompact =
                                        constraints.maxWidth < 360;
                                    return GridView.builder(
                                      shrinkWrap: true,
                                      physics:
                                          const NeverScrollableScrollPhysics(),
                                      gridDelegate:
                                          SliverGridDelegateWithFixedCrossAxisCount(
                                            crossAxisCount: isCompact ? 2 : 3,
                                            crossAxisSpacing:
                                                PortalLayout.itemGap,
                                            mainAxisSpacing:
                                                PortalLayout.itemGap,
                                            childAspectRatio: isCompact
                                                ? 2.8
                                                : 2.5,
                                          ),
                                      itemCount: recentDoses.length,
                                      itemBuilder: (context, index) {
                                        final date =
                                            recentDoses[index] as String;
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
                        ],
                      ),
                    ),
                  ),
                ),
              );
            }

            return _buildPageContainer(
              bodyDecoration: PatientScaffold.dosageBodyDecoration,
              body: body,
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
      pageTitle: AppCopy.text('text.dosage_management_e665ec7f'),
      currentNavIndex: _currentNavIndex,
      bodyDecoration: bodyDecoration,
      onNavChanged: _handleNav,
      body: body,
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
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
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
            Expanded(
              child: Text(
                AppCopy.text('text.mark_dose_as_taken_e1d250c0'),
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
            Text(
              AppCopy.text(
                'text.are_you_sure_you_want_to_mark_this_dose_as_taken_567c56a5',
              ),
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
                border: Border.all(color: Colors.green.shade200, width: 1.5),
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
                    AppCopy.text('text.cancel_35afca3b'),
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
                      : Text(
                          AppCopy.text('text.confirm_a183c9ef'),
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
        Navigator.of(
          context,
        ).pushReplacementNamed(AppRoutes.patientHealthReports);
        break;
      case 4:
        Navigator.of(context).pushReplacementNamed(AppRoutes.patientProfile);
        break;
    }
  }
}
