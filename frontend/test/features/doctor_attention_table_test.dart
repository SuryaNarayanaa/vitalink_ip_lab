import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:google_fonts/google_fonts.dart';
import '../fixtures/doctor_workflow_fixture.dart';
import 'package:frontend/core/widgets/doctor/doctor_bottom_nav.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/features/doctor/widgets/patient_attention_summary.dart';
import 'package:frontend/features/doctor/models/patient_model.dart';
import '../attention_table_preview.dart';
import 'package:frontend/features/doctor/doctor_dashboard_page.dart';

void main() {
  for (final scale in [1.0, 2.0]) {
    testWidgets('four reasons stay inside the patient row at scale $scale', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(1440, 1200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          home: MediaQuery(
            data: MediaQueryData(textScaler: TextScaler.linear(scale)),
            child: const Scaffold(
              body: SingleChildScrollView(
                child: DoctorPatientTable(attentionPatients),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final summaries = find.byType(PatientAttentionSummary);
      final first = tester.getRect(summaries.at(0));
      final next = tester.getRect(summaries.at(1));
      final chips = find.descendant(
        of: summaries.at(0),
        matching: find.byType(Chip),
      );
      expect(chips, findsNWidgets(4));
      for (var i = 0; i < 4; i++) {
        final bounds = tester.getRect(chips.at(i));
        expect(bounds.top, greaterThanOrEqualTo(first.top + 12));
        expect(bounds.bottom, lessThanOrEqualTo(first.bottom - 12));
      }
      expect(first.bottom, lessThanOrEqualTo(next.top));
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('row selection enables Reports and follows the chosen patient', (
    tester,
  ) async {
    PatientModel? selected;
    String? openedOp;
    await tester.pumpWidget(
      MaterialApp(
        home: StatefulBuilder(
          builder: (context, setState) => Scaffold(
            bottomNavigationBar: DoctorBottomNavBar(
              currentIndex: 0,
              reportsEnabled: selected != null,
              onTap: (index) {
                if (index == 2) openedOp = selected?.opNumber;
              },
            ),
            body: SingleChildScrollView(
              child: DoctorPatientTable(
                attentionPatients,
                selectedPatientId: selected?.id,
                onPatientSelected: (p) => setState(() => selected = p),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Reports'));
    expect(openedOp, isNull);
    await tester.tap(find.text('Test patient, four reasons'));
    await tester.pumpAndSettle();
    expect(
      tester.widget<DataTable>(find.byType(DataTable)).rows.first.selected,
      isTrue,
    );
    await tester.tap(find.text('Reports'));
    expect(openedOp, 'DEMO01');
    await tester.tap(find.text('Next patient'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Reports'));
    expect(openedOp, 'DEMO02');
    final table = tester.widget<DataTable>(find.byType(DataTable));
    expect(table.rows.first.selected, isFalse);
    expect(table.columns.map((c) => (c.label as Text).data), [
      'Name',
      'OP #',
      'Action',
      'Attention',
    ]);
    expect(tester.takeException(), isNull);
  });
  for (final op in <String?>[null, '', '   ']) {
    testWidgets('missing OP $op prevents selection and record access', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: DoctorPatientTable([
              PatientModel(
                id: 'missing',
                name: 'Missing identifier',
                opNumber: op,
              ),
            ], onPatientSelected: (_) => fail('Must not select missing OP')),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final row = tester.widget<DataTable>(find.byType(DataTable)).rows.single;
      expect(row.onSelectChanged, isNull);
      expect(find.text('OP number missing'), findsOneWidget);
      expect(find.text('View'), findsNothing);
    });
  }

  testWidgets(
    'actual shell opens selected patient reports in two taps and updates selection',
    (tester) async {
      GoogleFonts.config.allowRuntimeFetching = false;
      final repository = FixtureDoctorRepository();
      tester.view.physicalSize = const Size(1440, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(() => QueryCache.instance.clear());
      await tester.pumpWidget(
        QueryClientProvider(
          client: AppDependencies.createQueryClient(),
          child: MaterialApp(
            home: DoctorDashboardPage(
              repository: repository,
              realtimeService: FixtureRealtime(),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Cards'), findsNothing);
      await tester.tap(find.text('Reports'));
      await tester.pumpAndSettle();
      expect(repository.requestedOp, isNull);
      await tester.tap(find.text('Test patient, four reasons'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Reports'));
      await tester.pumpAndSettle();
      expect(repository.requestedOp, 'DEMO01');
      expect(find.text('Patient Reports'), findsOneWidget);
      await tester.tap(find.text('Home'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Next patient'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Reports'));
      await tester.pumpAndSettle();
      expect(repository.requestedOp, 'DEMO02');
      expect(tester.takeException(), isNull);
    },
  );
}
