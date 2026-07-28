import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:frontend/features/admin/data/admin_access_repository.dart';
import 'package:frontend/features/admin/models/admin_access_model.dart';

class AdminAccessController extends ChangeNotifier with WidgetsBindingObserver {
  AdminAccessController({
    required AdminAccessRepository repository,
    this.refreshInterval = const Duration(minutes: 5),
    /// Minimum gap between denial-driven refreshes so a burst of 403s does not
    /// each hit `/access/me`. Periodic, lifecycle, and explicit refreshes use
    /// [refresh] with `force: true` and are not throttled by this interval.
    this.denialRefreshMinInterval = const Duration(seconds: 15),
  }) : _repository = repository;

  final AdminAccessRepository _repository;
  final Duration refreshInterval;
  final Duration denialRefreshMinInterval;

  AdminAccessModel? _access;
  Object? _error;
  StackTrace? _errorStackTrace;
  DateTime? _lastUpdatedAt;
  DateTime? _lastRefreshAttemptAt;
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
          unawaited(refresh(force: true));
        });
      }
    }
    if (refreshImmediately) await refresh(force: true);
  }

  void stop() {
    if (!_isStarted) return;
    _isStarted = false;
    WidgetsBinding.instance.removeObserver(this);
    _periodicTimer?.cancel();
    _periodicTimer = null;
  }

  /// Reloads `/access/me`. Concurrent calls coalesce on one in-flight request.
  ///
  /// When [force] is false, a refresh is skipped if another attempt ran within
  /// [denialRefreshMinInterval] (used by denial-driven refresh). Explicit user
  /// retries, periodic refresh, lifecycle resume, and policy-update refresh
  /// should pass `force: true` (the default).
  Future<void> refresh({bool force = true}) {
    final pending = _refreshFuture;
    if (pending != null) return pending;

    if (!force && _isDenialRefreshThrottled()) {
      return Future<void>.value();
    }

    final generation = _sessionGeneration;
    _lastRefreshAttemptAt = DateTime.now().toUtc();
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

  bool _isDenialRefreshThrottled() {
    final last = _lastRefreshAttemptAt;
    if (last == null) return false;
    if (denialRefreshMinInterval <= Duration.zero) return false;
    return DateTime.now().toUtc().difference(last) < denialRefreshMinInterval;
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
      // Keep the last good snapshot on transient load failures; session teardown
      // paths call clear() so capabilities cannot outlive logout/expiry.
      _error = error;
      _errorStackTrace = stackTrace;
    }
  }

  /// Refreshes the access snapshot after a backend denial without retrying the
  /// denied request itself. Throttled so sequential 403 bursts do not each hit
  /// `/access/me`; use [refresh] with `force: true` for an explicit retry.
  Future<void> handleAuthorizationDenied() {
    if (!_isStarted && _access == null) return Future<void>.value();
    return refresh(force: false);
  }

  Future<void> refreshAfterPolicyUpdate() => refresh(force: true);

  /// Removes all capability state when the authenticated session changes.
  /// Nothing is written to secure storage or another persistent cache.
  void clear() {
    _sessionGeneration++;
    _access = null;
    _error = null;
    _errorStackTrace = null;
    _lastUpdatedAt = null;
    _lastRefreshAttemptAt = null;
    _refreshFuture = null;
    _isRefreshing = false;
    _notifyListenersSafely();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (_isStarted && state == AppLifecycleState.resumed) {
      unawaited(refresh(force: true));
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
