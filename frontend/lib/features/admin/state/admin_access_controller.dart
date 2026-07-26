import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:frontend/features/admin/data/admin_access_repository.dart';
import 'package:frontend/features/admin/models/admin_access_model.dart';

class AdminAccessController extends ChangeNotifier with WidgetsBindingObserver {
  AdminAccessController({
    required AdminAccessRepository repository,
    this.refreshInterval = const Duration(minutes: 5),
  }) : _repository = repository;

  final AdminAccessRepository _repository;
  final Duration refreshInterval;

  AdminAccessModel? _access;
  Object? _error;
  StackTrace? _errorStackTrace;
  DateTime? _lastUpdatedAt;
  Future<void>? _refreshFuture;
  Timer? _periodicTimer;
  bool _isRefreshing = false;
  bool _isStarted = false;
  bool _isDisposed = false;
  int _sessionGeneration = 0;

  AdminAccessModel? get access => _access;
  Object? get error => _error;
  StackTrace? get errorStackTrace => _errorStackTrace;
  DateTime? get lastUpdatedAt => _lastUpdatedAt;
  bool get isRefreshing => _isRefreshing;
  bool get isLoading => _access == null && _isRefreshing;
  bool get hasLoaded => _access != null || _error != null;
  bool get isStarted => _isStarted;

  bool can(String capability) => _access?.can(capability) ?? false;

  bool canAny(Iterable<String> capabilities) =>
      _access?.canAny(capabilities) ?? false;

  Future<void> start({bool refreshImmediately = true}) async {
    if (!_isStarted) {
      _isStarted = true;
      WidgetsBinding.instance.addObserver(this);
      if (refreshInterval > Duration.zero) {
        _periodicTimer = Timer.periodic(refreshInterval, (_) {
          unawaited(refresh());
        });
      }
    }
    if (refreshImmediately) await refresh();
  }

  void stop() {
    if (!_isStarted) return;
    _isStarted = false;
    WidgetsBinding.instance.removeObserver(this);
    _periodicTimer?.cancel();
    _periodicTimer = null;
  }

  Future<void> refresh() {
    final pending = _refreshFuture;
    if (pending != null) return pending;

    final generation = _sessionGeneration;
    _isRefreshing = true;
    _error = null;
    _errorStackTrace = null;
    _notifyListenersSafely();

    late final Future<void> operation;
    operation = _loadAccess(generation).whenComplete(() {
      if (identical(_refreshFuture, operation)) {
        _refreshFuture = null;
        _isRefreshing = false;
        _notifyListenersSafely();
      }
    });
    _refreshFuture = operation;
    return operation;
  }

  Future<void> _loadAccess(int generation) async {
    try {
      final access = await _repository.getCurrentAccess();
      if (_isDisposed || generation != _sessionGeneration) return;
      _access = access;
      _lastUpdatedAt = DateTime.now().toUtc();
      _error = null;
      _errorStackTrace = null;
    } catch (error, stackTrace) {
      if (_isDisposed || generation != _sessionGeneration) return;
      _error = error;
      _errorStackTrace = stackTrace;
    }
  }

  /// Refreshes the access snapshot after a backend denial without retrying the
  /// denied request itself.
  Future<void> handleAuthorizationDenied() {
    if (!_isStarted && _access == null) return Future<void>.value();
    return refresh();
  }

  Future<void> refreshAfterPolicyUpdate() => refresh();

  /// Removes all capability state when the authenticated session changes.
  /// Nothing is written to secure storage or another persistent cache.
  void clear() {
    _sessionGeneration++;
    _access = null;
    _error = null;
    _errorStackTrace = null;
    _lastUpdatedAt = null;
    _refreshFuture = null;
    _isRefreshing = false;
    _notifyListenersSafely();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (_isStarted && state == AppLifecycleState.resumed) {
      unawaited(refresh());
    }
  }

  void _notifyListenersSafely() {
    if (!_isDisposed) notifyListeners();
  }

  @override
  void dispose() {
    stop();
    _isDisposed = true;
    _sessionGeneration++;
    super.dispose();
  }
}
