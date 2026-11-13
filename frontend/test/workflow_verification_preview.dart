import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/features/doctor/doctor_dashboard_page.dart';
import 'fixtures/doctor_workflow_fixture.dart';

class DoctorSelectionPreview extends StatelessWidget {
  const DoctorSelectionPreview({super.key});
  @override
  Widget build(BuildContext context) => DoctorDashboardPage(
    repository: FixtureDoctorRepository(),
    realtimeService: FixtureRealtime(),
  );
}


void main() => runApp(QueryClientProvider(client: AppDependencies.createQueryClient(), child: MaterialApp(theme: ThemeData(useMaterial3: true),  home: const DoctorSelectionPreview())));
