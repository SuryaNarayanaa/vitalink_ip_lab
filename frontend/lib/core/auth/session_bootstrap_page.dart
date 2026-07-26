import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/app/routers.dart';
import 'package:frontend/core/storage/secure_storage.dart';
import 'package:frontend/features/login/models/login_models.dart';

/// Resolves the correct landing route from persisted session state.
class SessionBootstrapPage extends StatefulWidget {
  const SessionBootstrapPage({super.key});

  @override
  State<SessionBootstrapPage> createState() => _SessionBootstrapPageState();
}

class _SessionBootstrapPageState extends State<SessionBootstrapPage> {
  final SecureStorage _storage = SecureStorage();

  @override
  void initState() {
    super.initState();
    _resolveAndNavigate();
  }

  Future<void> _resolveAndNavigate() async {
    final destination = await _resolveDestination();
    if (!mounted) return;
    Navigator.of(context).pushNamedAndRemoveUntil(
      destination.route,
      (_) => false,
      arguments: destination.arguments,
    );
  }

  Future<_BootstrapDestination> _resolveDestination() async {
    try {
      final token = await _storage.readToken();
      final userJson = await _storage.readUser();

      if (token == null || token.isEmpty || userJson == null) {
        await _cleanupSession();
        return const _BootstrapDestination(AppRoutes.login);
      }

      final user = UserModel.fromJson(userJson);
      if (!user.isActive) {
        await _cleanupSession();
        return const _BootstrapDestination(AppRoutes.login);
      }

      // Password policy gate: only /auth/change-password is usable until
      // the temporary or expired password is replaced.
      if (user.mustChangePassword) {
        return const _BootstrapDestination(
          AppRoutes.changePassword,
          arguments: true,
        );
      }

      if (user.isAdmin) {
        return const _BootstrapDestination(AppRoutes.adminDashboard);
      }
      if (user.isDoctor) {
        return const _BootstrapDestination(AppRoutes.doctorDashboard);
      }
      if (user.isPatient) {
        return const _BootstrapDestination(AppRoutes.patient);
      }

      await _cleanupSession();
      return const _BootstrapDestination(AppRoutes.login);
    } catch (_) {
      await _cleanupSession();
      return const _BootstrapDestination(AppRoutes.login);
    }
  }

  Future<void> _cleanupSession() async {
    try {
      await _storage.clearAuthData();
    } catch (_) {
      // Session fallback must still reach login if secure storage is unavailable.
    }
    try {
      await QueryCache.instance.clear();
    } catch (_) {
      // Cache cleanup is best-effort and must not block login navigation.
    }
  }

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: CircularProgressIndicator()),
    );
  }
}

class _BootstrapDestination {
  const _BootstrapDestination(this.route, {this.arguments});

  final String route;
  final Object? arguments;
}
