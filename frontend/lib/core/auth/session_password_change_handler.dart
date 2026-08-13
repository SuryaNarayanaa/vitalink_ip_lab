import 'package:flutter/material.dart';
import 'package:frontend/app/routers.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/network/api_client.dart';

/// Routes mid-session password-policy 403s to [ChangePasswordPage].
///
/// GET /auth/me remains allowed in that state; the handler refreshes persisted
/// user flags and reuses the login/bootstrap must-change-password gate.
class SessionPasswordChangeHandler {
  SessionPasswordChangeHandler._();

  static Future<void>? _pending;

  static Future<void> handle() {
    return _pending ??= _run().whenComplete(() => _pending = null);
  }

  static Future<void> _run() async {
    try {
      await AppDependencies.authRepository.refreshCurrentUser();
    } on ApiException catch (error) {
      if (error.shouldReturnToLogin) return;
      await AppDependencies.authRepository.markPasswordChangeRequired();
    } catch (_) {
      await AppDependencies.authRepository.markPasswordChangeRequired();
    }

    final navigator = AppRouter.navigatorKey.currentState;
    if (navigator == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _navigate(AppRouter.navigatorKey.currentState);
      });
      return;
    }
    _navigate(navigator);
  }

  static void _navigate(NavigatorState? navigator) {
    if (navigator == null) return;
    final currentName = ModalRoute.of(navigator.context)?.settings.name;
    if (currentName == AppRoutes.changePassword) return;
    navigator.pushNamedAndRemoveUntil(
      AppRoutes.changePassword,
      (_) => false,
      arguments: true,
    );
  }
}
