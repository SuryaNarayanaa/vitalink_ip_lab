import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/core/widgets/admin/admin_action_confirmation.dart';

void main() {
  testWidgets('requires an explicit confirmation for admin actions', (tester) async {
    Future<bool>? result;
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => ElevatedButton(
          onPressed: () => result = showAdminActionConfirmation(
            context,
            title: 'Suspend North Hospital?',
            message: 'Staff and patients will lose access.',
            confirmLabel: 'Suspend',
          ),
          child: const Text('Open'),
        ),
      ),
    ));
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    expect(find.text('Suspend North Hospital?'), findsOneWidget);
    expect(find.text('Staff and patients will lose access.'), findsOneWidget);

    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(find.text('Suspend North Hospital?'), findsNothing);
    expect(await result, isFalse);
  });

  testWidgets('returns confirmation when the action button is selected', (tester) async {
    Future<bool>? result;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => ElevatedButton(
            onPressed: () {
              result = showAdminActionConfirmation(
                context,
                title: 'Generate invoices?',
                message: 'Create invoices for active hospitals.',
                confirmLabel: 'Generate',
              );
            },
            child: const Text('Open'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Generate'));
    await tester.pumpAndSettle();

    expect(await result, isTrue);
  });
}
