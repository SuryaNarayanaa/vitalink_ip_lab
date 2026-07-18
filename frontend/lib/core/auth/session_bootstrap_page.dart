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
    final route = await _resolveRoute();
    if (!mounted) return;
    Navigator.of(context).pushNamedAndRemoveUntil(route, (_) => false);
  }

  Future<String> _resolveRoute() async {
    try {
      final token = await _storage.readToken();
      final userJson = await _storage.readUser();

      if (token == null || token.isEmpty || userJson == null) {
        await _cleanupSession();
        return AppRoutes.login;
      }

      final user = UserModel.fromJson(userJson);
      if (!user.isActive) {
        await _cleanupSession();
        return AppRoutes.login;
      }

      if (user.isAdmin) return AppRoutes.adminDashboard;
      if (user.isDoctor) return AppRoutes.doctorDashboard;
      if (user.isPatient) return AppRoutes.patient;

      await _cleanupSession();
      return AppRoutes.login;
    } catch (_) {
      await _cleanupSession();
      return AppRoutes.login;
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
