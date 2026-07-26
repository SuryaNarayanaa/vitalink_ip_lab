import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/core/widgets/admin/admin_access_scope.dart';
import 'package:frontend/features/admin/data/admin_access_repository.dart';
import 'package:frontend/features/admin/models/admin_access_model.dart';
import 'package:frontend/features/admin/state/admin_access_controller.dart';

class _ScopeRepository implements AdminAccessRepository {
  @override
  Future<AdminAccessModel> getCurrentAccess() async {
    return AdminAccessModel(
      schemaVersion: 2,
      userId: 'auditor-1',
      role: AdminRole.auditor,
      scope: AdminScope.global,
      hospital: null,
      effectiveCapabilities: const ['platform.audit.read'],
      policyVersion: 1,
      readOnly: true,
    );
  }

  @override
  Future<AdminAccessModel> fetchCurrentAccess() => getCurrentAccess();
}

void main() {
  testWidgets('scope exposes controller and rebuilds capability consumers', (
    tester,
  ) async {
    final controller = AdminAccessController(repository: _ScopeRepository());
    addTearDown(controller.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: AdminAccessScope(
          controller: controller,
          child: Builder(
            builder: (context) {
              final allowed = AdminAccessScope.can(
                context,
                'platform.audit.read',
              );
              return Text(allowed ? 'allowed' : 'denied');
            },
          ),
        ),
      ),
    );

    expect(find.text('denied'), findsOneWidget);

    await controller.refresh();
    await tester.pump();

    expect(find.text('allowed'), findsOneWidget);
  });

  testWidgets('maybeOf returns null outside an access scope', (tester) async {
    AdminAccessController? resolved;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            resolved = AdminAccessScope.maybeOf(context);
            return const SizedBox.shrink();
          },
        ),
      ),
    );

    expect(resolved, isNull);
  });
}
