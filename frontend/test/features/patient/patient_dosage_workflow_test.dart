import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/features/patient/patient_take_dosage_page.dart';
import 'package:frontend/features/patient/patient_dosage_calendar_page.dart';
import 'package:frontend/core/widgets/common/dose_history_card.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../fixtures/patient_dosage_fixture.dart';

void main() {
  setUp(() {
    GoogleFonts.config.allowRuntimeFetching = false;
  });
  tearDown(() async {
    await QueryCache.instance.clear();
  });
  for (final width in [390.0, 768.0, 1440.0]) {
    testWidgets('patient recent list hides older doses at width $width', (
      tester,
    ) async {
      tester.view.physicalSize = Size(width, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        QueryClientProvider(
          client: AppDependencies.createQueryClient(),
          child: MaterialApp(
            home: PatientTakeDosagePage(repository: FixturePatientRepository()),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('12-11-2026'), findsOneWidget);
      expect(find.text('02-02-2026'), findsNothing);
      expect(find.text('Remaining Missed Doses'), findsNothing);
      expect(find.text('Next'), findsNothing);
      expect(find.text('View Dosage Calendar'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
  testWidgets(
    'patient calendar uses shared doctor calendar and exposes older dates',
    (tester) async {
      tester.view.physicalSize = const Size(390, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        QueryClientProvider(
          client: AppDependencies.createQueryClient(),
          child: MaterialApp(
            home: PatientDosageCalendarPage(
              repository: FixturePatientRepository(),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(DoseHistoryCard), findsOneWidget);
      expect(find.text('November 2026'), findsOneWidget);
      for (var i = 0; i < 9; i++) {
        await tester.tap(find.byTooltip('Previous month'));
        await tester.pumpAndSettle();
      }
      expect(find.text('February 2026'), findsOneWidget);
      expect(find.byTooltip('2026-02-02 • Not recorded'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
