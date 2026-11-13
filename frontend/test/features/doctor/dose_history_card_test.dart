import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/core/widgets/common/dose_history_card.dart';
import 'package:intl/intl.dart';

void main() {
  final history = {
    'today': '2026-10-25',
    'timezone': 'Asia/Kolkata',
    'days': List.generate(92, (i) {
      final date = DateTime(2026, 8, i + 1);
      final key = DateFormat('yyyy-MM-dd').format(date);
      return {
        'date': key,
        'amount': 2.5,
        'state': key == '2026-10-23'
            ? 'not_recorded'
            : key == '2026-10-25'
            ? 'pending'
            : key.compareTo('2026-10-25') > 0
            ? 'upcoming'
            : 'taken',
      };
    }),
  };

  testWidgets(
    'defaults to full month and selects days without extra detail text',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: DoseHistoryCard(history: history),
            ),
          ),
        ),
      );
      expect(find.text('October 2026'), findsOneWidget);
      expect(find.text('31'), findsOneWidget);
      await tester.ensureVisible(find.text('23').last);
      await tester.tap(find.text('23').last);
      await tester.pump();
      expect(find.byTooltip('2026-10-23 • Not recorded'), findsOneWidget);
      expect(find.textContaining('Current plan:'), findsNothing);
      expect(find.textContaining('not a confirmed missed dose'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('switches range and navigates to previous calendar month', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(child: DoseHistoryCard(history: history)),
        ),
      ),
    );
    await tester.tap(find.text('Last 7 days'));
    await tester.pump();
    expect(find.text('31'), findsNothing);
    expect(find.text('19'), findsOneWidget);
    await tester.tap(find.text('Month'));
    await tester.pump();
    await tester.tap(find.byTooltip('Previous month'));
    await tester.pump();
    expect(find.text('September 2026'), findsOneWidget);
    expect(find.text('31'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('unavailable history is not shown as zero missed doses', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: DoseHistoryCard(history: null))),
    );
    expect(find.textContaining('Dose history unavailable'), findsOneWidget);
    expect(find.text('0'), findsNothing);
  });
}
