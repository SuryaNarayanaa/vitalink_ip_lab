import 'package:flutter/material.dart';
import 'package:frontend/core/auth/session_bootstrap_page.dart';
import 'package:frontend/core/storage/secure_storage.dart';
import 'package:frontend/features/login/models/login_models.dart';

enum RouteAccess {
  authenticated,
  patient,
  doctor,
  admin,
  patientOrDoctor,
}

/// Guards route widgets using persisted auth session and role checks.
class SessionRouteGuard extends StatefulWidget {
  const SessionRouteGuard({
    super.key,
    required this.access,
    required this.child,
  });

  final RouteAccess access;
  final Widget child;

  @override
  State<SessionRouteGuard> createState() => _SessionRouteGuardState();
}

class _SessionRouteGuardState extends State<SessionRouteGuard> {
  final SecureStorage _storage = SecureStorage();
  late final Future<bool> _isAllowedFuture = _isAllowed();

  Future<bool> _isAllowed() async {
    try {
      final results = await Future.wait([
        _storage.readToken(),
        _storage.readUser(),
      ]);
      final token = results[0] as String?;
      final userJson = results[1] as Map<String, dynamic>?;
      if (token == null || token.isEmpty || userJson == null) return false;

      final user = UserModel.fromJson(userJson);
      if (!user.isActive) return false;

      switch (widget.access) {
        case RouteAccess.authenticated:
          return user.isAdmin || user.isDoctor || user.isPatient;
        case RouteAccess.patient:
          return user.isPatient;
        case RouteAccess.doctor:
          return user.isDoctor;
        case RouteAccess.admin:
          return user.isAdmin;
        case RouteAccess.patientOrDoctor:
          return user.isPatient || user.isDoctor;
      }
    } catch (_) {
      return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<bool>(
      future: _isAllowedFuture,
      builder: (context, snapshot) {
        if (!snapshot.hasData) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        if (snapshot.data == true) return widget.child;
        return const SessionBootstrapPage();
      },
    );
  }
}
