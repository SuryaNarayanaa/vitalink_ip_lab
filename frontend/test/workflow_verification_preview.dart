import 'package:flutter/material.dart';
import 'package:frontend/features/patient/widgets/inr_history_trend.dart';
import 'package:frontend/features/doctor/view_patient_page.dart';
import 'package:frontend/features/doctor/models/patient_detail_model.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/features/doctor/doctor_dashboard_page.dart';
import 'package:frontend/features/doctor/data/doctor_repository.dart';
import 'package:frontend/features/patient/patient_take_dosage_page.dart';
import 'package:frontend/features/patient/patient_dosage_calendar_page.dart';
import 'package:frontend/app/routers.dart';
import 'attention_table_preview.dart';
import 'fixtures/doctor_workflow_fixture.dart';
import 'fixtures/patient_dosage_fixture.dart';

class DoctorSelectionPreview extends StatelessWidget {
  const DoctorSelectionPreview({super.key});
  @override
  Widget build(BuildContext context) => DoctorDashboardPage(
    repository: FixtureDoctorRepository(),
    realtimeService: FixtureRealtime(),
  );
}

class NavigationTimingRepository extends DoctorRepository {
  NavigationTimingRepository() : super(apiClient: ApiClient());
  @override
  Future<PatientDetailModel> getPatientDetail(String opNumber) async {
    debugPrint('verification_detail_fetch:$opNumber');
    await Future<void>.delayed(const Duration(seconds: 3));
    return PatientDetailModel(
      id: opNumber,
      name: 'Verification patient $opNumber',
      opNumber: opNumber,
      age: 42,
      gender: 'Male',
      medicalConfig: const {
        'therapy_drug': 'Warfarin',
        'therapy_start_date': '2026-02-01',
        'target_inr': {'min': 2.0, 'max': 3.0},
      },
      weeklyDosage: const {'monday': 2.5},
      doseHistory: fixtureHistory,
    );
  }
}

void main() => runApp(
  QueryClientProvider(
    client: AppDependencies.createQueryClient(),
    child: MaterialApp(
      theme: ThemeData(useMaterial3: true),
      routes: {
        AppRoutes.patientTakeDosage: (_) =>
            PatientTakeDosagePage(repository: FixturePatientRepository()),
        AppRoutes.patientDosageCalendar: (_) =>
            PatientDosageCalendarPage(repository: FixturePatientRepository()),
      },
      home: Uri.base.queryParameters['screen'] == 'trend'
          ? Scaffold(
              appBar: AppBar(
                title: const Text('Patient INR trend - synthetic data'),
              ),
              body: SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                child: InrHistoryTrend(
                  today: DateTime(2026, 11, 13),
                  history: const [
                    {'date': '01-12-2025', 'inr': 2.7},
                    {'date': '15-02-2026', 'inr': 3.1},
                    {'date': '01-06-2026', 'inr': 2.4},
                    {'date': '17-07-2026', 'inr': 3.2},
                    {'date': '15-09-2026', 'inr': 2.2},
                    {'date': '01-11-2026', 'inr': 2.1},
                    {'date': '05-11-2026', 'inr': 2.5},
                    {'date': '12-11-2026', 'inr': 2.8},
                  ],
                ),
              ),
            )
          : Uri.base.queryParameters['screen'] == 'details'
          ? ViewPatientPage(
              opNumber: 'DEMO01',
              allPatients: attentionPatients,
              initialIndex: 0,
              repository: NavigationTimingRepository(),
            )
          : Uri.base.queryParameters['screen'] == 'calendar'
          ? PatientDosageCalendarPage(repository: FixturePatientRepository())
          : Uri.base.queryParameters['screen'] == 'dosage'
          ? PatientTakeDosagePage(repository: FixturePatientRepository())
          : const DoctorSelectionPreview(),
    ),
  ),
);
