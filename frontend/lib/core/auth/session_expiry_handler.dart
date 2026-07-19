import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/app/routers.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/storage/secure_storage.dart';

class SessionExpiryHandler {
  SessionExpiryHandler._();

  static final SecureStorage _storage = SecureStorage();
  static Future<void>? _pendingReset;

  static Future<void> clearSessionAndRedirectToLogin() {
    return _pendingReset ??= _run().whenComplete(() => _pendingReset = null);
  }

  static Future<void> _run() async {
    try {
      await _storage.clearAuthData();
    } catch (_) {
      // Session expiry must still reach login if secure storage is unavailable.
    }
    try {
      AppDependencies.patientRepository.resetSessionState();
    } catch (_) {
      // In-flight report state is best-effort cleanup.
    }
    try {
      await QueryCache.instance.clear();
    } catch (_) {
      // Cache cleanup is best-effort and must not block login navigation.
    }

    final navigator = AppRouter.navigatorKey.currentState;
    if (navigator == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        AppRouter.navigatorKey.currentState?.pushNamedAndRemoveUntil(
          AppRoutes.login,
          (_) => false,
        );
      });
      return;
    }

    navigator.pushNamedAndRemoveUntil(AppRoutes.login, (_) => false);
  }
}
