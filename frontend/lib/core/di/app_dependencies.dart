import 'dart:async';

import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/core/auth/session_password_change_handler.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/core/storage/secure_storage.dart';
import 'package:frontend/features/login/data/auth_repository.dart';
import 'package:frontend/features/doctor/data/doctor_repository.dart';
import 'package:frontend/features/admin/data/admin_access_repository.dart';
import 'package:frontend/features/admin/data/admin_repository.dart';
import 'package:frontend/features/admin/state/admin_access_controller.dart';
import 'package:frontend/features/patient/data/patient_repository.dart';
import 'package:frontend/services/push_notification_service.dart';

/// Simple service locator for app-wide singletons. Replace with a proper DI
/// solution (Provider/riverpod/get_it) if the project grows.
class AppDependencies {
  AppDependencies._();

  static final SecureStorage secureStorage = SecureStorage();
  static final ApiClient apiClient = _createApiClient();
  static final PushNotificationService pushNotifications =
      PushNotificationService(apiClient: apiClient);
  static final AdminAccessRepository adminAccessRepository =
      AdminAccessRepository(apiClient: apiClient);
  static final AdminAccessController adminAccessController =
      AdminAccessController(repository: adminAccessRepository);
  static final PatientRepository patientRepository = PatientRepository(
    apiClient: apiClient,
    secureStorage: secureStorage,
  );
  static final AuthRepository authRepository = AuthRepository(
    apiClient: apiClient,
    secureStorage: secureStorage,
    pushNotifications: pushNotifications,
    onLocalSessionCleared: _resetSessionState,
  );
  static final DoctorRepository doctorRepository = DoctorRepository(
    apiClient: apiClient,
  );
  static final AdminRepository adminRepository = AdminRepository(
    apiClient: apiClient,
  );

  static ApiClient _createApiClient() {
    final client = ApiClient(secureStorage: secureStorage);
    client.setAuthorizationDeniedHandler(() {
      unawaited(adminAccessController.handleAuthorizationDenied());
    });
    client.setPasswordChangeRequiredHandler(() {
      unawaited(SessionPasswordChangeHandler.handle());
    });
    return client;
  }

  static void _resetSessionState() {
    patientRepository.resetSessionState();
    adminAccessController.clear();
  }

  /// Clears in-memory session caches after forced logout / token expiry.
  /// Mirrors [AuthRepository.clearLocalSession] feature teardown.
  static void clearSessionCaches() => _resetSessionState();

  static QueryClient createQueryClient({
    void Function(String error)? onError,
    void Function()? onSuccess,
  }) {
    return QueryClient(
      cache: QueryCache.instance,
      networkPolicy: NetworkPolicy.instance,
      onError: onError,
      onSuccess: onSuccess,
    );
  }
}
