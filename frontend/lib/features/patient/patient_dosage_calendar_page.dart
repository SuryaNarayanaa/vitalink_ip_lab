import 'package:frontend/core/config/app_properties.dart';
import 'package:flutter/material.dart';
import 'package:frontend/features/patient/data/patient_repository.dart';
import 'package:frontend/core/widgets/index.dart';
import 'package:frontend/core/widgets/common/dose_history_card.dart';
import 'package:frontend/app/routers.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/query/patient_query_keys.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';

class PatientDosageCalendarPage extends StatelessWidget {
  const PatientDosageCalendarPage({super.key, this.repository});
  final PatientRepository? repository;

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    return UseQuery<Map<String, dynamic>>(
      options: QueryOptions<Map<String, dynamic>>(
        queryKey: PatientQueryKeys.dosageCalendar(3),
        staleTime: Duration.zero,
        queryFn: () => (repository ?? AppDependencies.patientRepository)
            .getDosageCalendar(),
      ),
      builder: (context, query) => PatientScaffold(
        pageTitle: AppCopy.text('screens.dosageCalendar.title'),
        currentNavIndex: 2,
        onNavChanged: (index) {
          final routes = [
            AppRoutes.patient,
            AppRoutes.patientUpdateINR,
            AppRoutes.patientTakeDosage,
            AppRoutes.patientHealthReports,
            AppRoutes.patientProfile,
          ];
          Navigator.of(context).pushReplacementNamed(routes[index]);
        },
        body: query.isError
            ? ApiErrorState(error: query.error, onRetry: () => query.refetch())
            : query.isLoading || !query.hasData
            ? const PageSkeleton(cardCount: 2)
            : RefreshIndicator(
                onRefresh: () async {
                  await query.refetch();
                },
                child: SingleChildScrollView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: PortalLayout.pagePadding(embedInShell: false),
                  child: DoseHistoryCard(
                    history:
                        query.data!['dose_history'] as Map<String, dynamic>?,
                  ),
                ),
              ),
      ),
    );
  }
}
