import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/features/doctor/widgets/patient_attention_summary.dart';
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
}
