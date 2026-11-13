import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/features/doctor/doctor_dashboard_page.dart';
import 'fixtures/doctor_workflow_fixture.dart';
import 'package:frontend/features/patient/patient_take_dosage_page.dart';
import 'package:frontend/features/patient/patient_dosage_calendar_page.dart';
import 'package:frontend/app/routers.dart';
import 'fixtures/patient_dosage_fixture.dart';

class DoctorSelectionPreview extends StatelessWidget {
  const DoctorSelectionPreview({super.key});
  @override
  Widget build(BuildContext context) => DoctorDashboardPage(
    repository: FixtureDoctorRepository(),
    realtimeService: FixtureRealtime(),
  );
}


void main() => runApp(QueryClientProvider(client: AppDependencies.createQueryClient(), child: MaterialApp(theme: ThemeData(useMaterial3: true), routes: {AppRoutes.patientDosageCalendar: (_) => PatientDosageCalendarPage(repository: FixturePatientRepository())}, home: Uri.base.queryParameters['screen'] == 'calendar' ? PatientDosageCalendarPage(repository: FixturePatientRepository()) : Uri.base.queryParameters['screen'] == 'dosage' ? PatientTakeDosagePage(repository: FixturePatientRepository()) : const DoctorSelectionPreview())));
