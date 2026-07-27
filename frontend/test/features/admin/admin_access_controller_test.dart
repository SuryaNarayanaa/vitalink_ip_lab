import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/features/admin/data/admin_access_repository.dart';
import 'package:frontend/features/admin/models/admin_access_model.dart';
import 'package:frontend/features/admin/state/admin_access_controller.dart';

class _FakeAdminAccessRepository implements AdminAccessRepository {
  final List<Future<AdminAccessModel> Function()> _responses = [];
  int calls = 0;

  void enqueue(Future<AdminAccessModel> Function() response) {
    _responses.add(response);
  }

  @override
  Future<AdminAccessModel> getCurrentAccess() {
    calls++;
    if (_responses.isEmpty) {
      throw StateError('No fake access response queued');
    }
    return _responses.removeAt(0)();
  }

  @override
  Future<AdminAccessModel> fetchCurrentAccess() => getCurrentAccess();
}

AdminAccessModel _access({
  int policyVersion = 1,
  Iterable<String> capabilities = const ['platform.audit.read'],
}) {
  return AdminAccessModel(
    schemaVersion: 2,
    userId: 'admin-1',
    role: AdminRole.auditor,
    scope: AdminScope.global,
    hospital: null,
    effectiveCapabilities: capabilities,
    policyVersion: policyVersion,
    readOnly: true,
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('refresh publishes access and capability helpers', () async {
    final repository = _FakeAdminAccessRepository()
      ..enqueue(() async => _access());
    final controller = AdminAccessController(repository: repository);
    addTearDown(controller.dispose);

    await controller.refresh();

    expect(controller.error, isNull);
    expect(controller.access?.policyVersion, 1);
    expect(controller.can('platform.audit.read'), isTrue);
    expect(
      controller.canAny(['platform.billing.read', 'platform.audit.read']),
      isTrue,
    );
    expect(controller.lastUpdatedAt, isNotNull);
  });

  test('failed refresh retains the last known access snapshot', () async {
    final repository = _FakeAdminAccessRepository()
      ..enqueue(() async => _access(policyVersion: 1))
      ..enqueue(() async => throw StateError('network unavailable'));
    final controller = AdminAccessController(repository: repository);
    addTearDown(controller.dispose);

    await controller.refresh();
    await controller.refresh();

    expect(controller.access?.policyVersion, 1);
    expect(controller.error, isA<StateError>());
    expect(controller.errorStackTrace, isNotNull);
    expect(controller.can('platform.audit.read'), isTrue);
    expect(controller.isRefreshing, isFalse);
  });

  test('initial refresh failure is recoverable and clears on retry', () async {
    final repository = _FakeAdminAccessRepository()
      ..enqueue(() async => throw StateError('offline'))
      ..enqueue(() async => _access(policyVersion: 2));
    final controller = AdminAccessController(repository: repository);
    addTearDown(controller.dispose);

    await controller.refresh();

    expect(controller.access, isNull);
    expect(controller.error, isA<StateError>());
    expect(controller.hasLoaded, isTrue);
    expect(controller.isLoading, isFalse);
    expect(controller.can('platform.audit.read'), isFalse);

    await controller.refresh();

    expect(controller.error, isNull);
    expect(controller.errorStackTrace, isNull);
    expect(controller.access?.policyVersion, 2);
  });

  test('concurrent refresh requests share one access request', () async {
    final completer = Completer<AdminAccessModel>();
    final repository = _FakeAdminAccessRepository()
      ..enqueue(() => completer.future);
    final controller = AdminAccessController(repository: repository);
    addTearDown(controller.dispose);

    final first = controller.refresh();
    final second = controller.refresh();

    expect(identical(first, second), isTrue);
    expect(repository.calls, 1);

    completer.complete(_access());
    await first;
    expect(controller.access, isNotNull);
  });

  test(
    'clear prevents an old session request from restoring capabilities',
    () async {
      final completer = Completer<AdminAccessModel>();
      final repository = _FakeAdminAccessRepository()
        ..enqueue(() => completer.future);
      final controller = AdminAccessController(repository: repository);
      addTearDown(controller.dispose);

      final refresh = controller.refresh();
      controller.clear();
      completer.complete(_access());
      await refresh;

      expect(controller.access, isNull);
      expect(controller.can('platform.audit.read'), isFalse);
    },
  );

  test('start refreshes initially and refreshes again on app resume', () async {
    final repository = _FakeAdminAccessRepository()
      ..enqueue(() async => _access(policyVersion: 1))
      ..enqueue(() async => _access(policyVersion: 2));
    final controller = AdminAccessController(
      repository: repository,
      refreshInterval: const Duration(hours: 1),
    );
    addTearDown(controller.dispose);

    await controller.start();
    controller.didChangeAppLifecycleState(AppLifecycleState.resumed);
    await Future<void>.delayed(Duration.zero);

    expect(repository.calls, 2);
    expect(controller.access?.policyVersion, 2);
    expect(controller.isStarted, isTrue);

    controller.stop();
    expect(controller.isStarted, isFalse);
  });

  test(
    'authorization denial refreshes when outside the throttle window',
    () async {
      final repository = _FakeAdminAccessRepository()
        ..enqueue(() async => _access(policyVersion: 1))
        ..enqueue(() async => _access(policyVersion: 2));
      final controller = AdminAccessController(
        repository: repository,
        denialRefreshMinInterval: Duration.zero,
      );
      addTearDown(controller.dispose);

      await controller.refresh();
      await controller.handleAuthorizationDenied();

      expect(repository.calls, 2);
      expect(controller.access?.policyVersion, 2);
    },
  );

  test(
    'authorization denial is throttled after a recent refresh attempt',
    () async {
      final repository = _FakeAdminAccessRepository()
        ..enqueue(() async => _access(policyVersion: 1))
        ..enqueue(() async => _access(policyVersion: 2));
      final controller = AdminAccessController(
        repository: repository,
        denialRefreshMinInterval: const Duration(seconds: 30),
      );
      addTearDown(controller.dispose);

      await controller.refresh();
      await controller.handleAuthorizationDenied();
      await controller.handleAuthorizationDenied();

      expect(repository.calls, 1);
      expect(controller.access?.policyVersion, 1);
    },
  );

  test(
    'forced refresh bypasses denial throttle for explicit retry',
    () async {
      final repository = _FakeAdminAccessRepository()
        ..enqueue(() async => _access(policyVersion: 1))
        ..enqueue(() async => _access(policyVersion: 2));
      final controller = AdminAccessController(
        repository: repository,
        denialRefreshMinInterval: const Duration(seconds: 30),
      );
      addTearDown(controller.dispose);

      await controller.refresh();
      await controller.handleAuthorizationDenied();
      expect(repository.calls, 1);

      await controller.refresh(force: true);
      expect(repository.calls, 2);
      expect(controller.access?.policyVersion, 2);
    },
  );

  test(
    'authorization denial is ignored without an active access session',
    () async {
      final repository = _FakeAdminAccessRepository();
      final controller = AdminAccessController(repository: repository);
      addTearDown(controller.dispose);

      await controller.handleAuthorizationDenied();

      expect(repository.calls, 0);
      expect(controller.access, isNull);
    },
  );

  testWidgets('periodic refresh runs only while the controller is started', (
    tester,
  ) async {
    final repository = _FakeAdminAccessRepository()
      ..enqueue(() async => _access(policyVersion: 1))
      ..enqueue(() async => _access(policyVersion: 2));
    final controller = AdminAccessController(
      repository: repository,
      refreshInterval: const Duration(seconds: 1),
    );
    addTearDown(controller.dispose);

    await controller.start();
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();

    expect(repository.calls, 2);
    expect(controller.access?.policyVersion, 2);

    controller.stop();
    await tester.pump(const Duration(seconds: 2));
    expect(repository.calls, 2);
  });
}
