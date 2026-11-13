import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:frontend/features/patient/widgets/inr_history_trend.dart';

const trendHistory = <Map<String, dynamic>>[
  {'date': '12-11-2026', 'inr': 2.8},
  {'date': '01-06-2026', 'inr': 2.4},
  {'date': '01-11-2026', 'inr': 2.1},
  {'date': '31-05-2026', 'inr': 3.2},
  {'date': '01-12-2025', 'inr': 2.7},
  {'date': '30-11-2025', 'inr': 4.2},
  {'date': '14-11-2026', 'inr': 3.8},
  {'date': '31-02-2026', 'inr': 3.0},
  {'date': '13-11-2026', 'inr': 'invalid'},
];
void main() {
  Future<void> mount(
    WidgetTester tester,
    List<Map<String, dynamic>> history, {
    double width = 390,
  }) async {
    tester.view.physicalSize = Size(width, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: InrHistoryTrend(
              history: history,
              today: DateTime(2026, 11, 13),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets(
    'defaults to this month and spaces sorted readings by actual date',
    (tester) async {
      await mount(tester, trendHistory);
      expect(find.textContaining('1 Nov 2026 to 13 Nov 2026'), findsOneWidget);
      final data = tester.widget<LineChart>(find.byType(LineChart)).data;
      expect(data.lineBarsData.single.spots.map((p) => p.y), [2.1, 2.8]);
      expect(data.lineBarsData.single.spots.map((p) => p.x), [0.0, 11.0]);
      expect(data.lineBarsData.single.isCurved, isFalse);
      expect(tester.takeException(), isNull);
    },
  );
  for (final width in [390.0, 768.0, 1440.0]) {
    testWidgets(
      'six-month and yearly dropdown include correct boundaries at $width',
      (tester) async {
        await mount(tester, trendHistory, width: width);
        await tester.tap(find.byType(DropdownButtonFormField<int>));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Last 6 months').last);
        await tester.pumpAndSettle();
        expect(
          find.textContaining('1 Jun 2026 to 13 Nov 2026'),
          findsOneWidget,
        );
        expect(
          tester
              .widget<LineChart>(find.byType(LineChart))
              .data
              .lineBarsData
              .single
              .spots
              .map((p) => p.y),
          [2.4, 2.1, 2.8],
        );
        await tester.tap(find.byType(DropdownButtonFormField<int>));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Last 12 months').last);
        await tester.pumpAndSettle();
        expect(
          find.textContaining('1 Dec 2025 to 13 Nov 2026'),
          findsOneWidget,
        );
        expect(
          tester
              .widget<LineChart>(find.byType(LineChart))
              .data
              .lineBarsData
              .single
              .spots
              .map((p) => p.y),
          [2.7, 3.2, 2.4, 2.1, 2.8],
        );
        expect(tester.takeException(), isNull);
      },
    );
  }
  testWidgets('empty current month does not silently show older history', (
    tester,
  ) async {
    await mount(tester, [
      {'date': '01-10-2026', 'inr': 2.0},
    ]);
    expect(find.text('No INR results in this period.'), findsOneWidget);
    expect(find.byType(LineChart), findsNothing);
    expect(tester.takeException(), isNull);
  });
  testWidgets('a single result on the first day still renders safely', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: InrHistoryTrend(
            history: const [
              {'date': '01-11-2026', 'inr': 2.5},
            ],
            today: DateTime(2026, 11, 1),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<LineChart>(find.byType(LineChart))
          .data
          .lineBarsData
          .single
          .spots,
      hasLength(1),
    );
    expect(tester.takeException(), isNull);
  });
}
