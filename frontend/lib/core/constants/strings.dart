class AppStrings {
  AppStrings._();

  /// Build-time define key for backend API base URL.
  static const String apiBaseUrlDefine = 'API_BASE_URL';

  /// Base URL for the backend API.
  ///
  /// On Flutter Web, default to an empty string so requests use same-origin
  /// paths (e.g. `/api/...`) and avoid mixed-content issues on HTTPS hosts.
  static const String apiBaseUrl = String.fromEnvironment(
    apiBaseUrlDefine,
    defaultValue: 'https://vitalink-uimf.onrender.com',
  );

  /// Auth endpoints.
  static const String loginPath = '/api/auth/login';

  /// Doctor endpoints.
  static const String doctorPatientsPath = '/api/doctors/patients';
  static const String doctorProfilePath = '/api/doctors/profile';
  static const String doctorGetDoctorsPath = '/api/doctors/doctors';
  static const String doctorNotificationsPath = '/api/doctors/notifications';
  static const String doctorNotificationStreamPath =
      '/api/doctors/notifications/stream';
  static const String patientNotificationStreamPath =
      '/api/patient/notifications/stream';
  static const String patientNotificationsPath = '/api/patient/notifications';

  /// Admin endpoints.
  static const String adminBasePath = '/api/admin';
  static const String adminDoctorsPath = '/api/admin/doctors';
  static const String adminPatientsPath = '/api/admin/patients';
  static const String adminReassignPath = '/api/admin/reassign';
  static const String adminAuditLogsPath = '/api/admin/audit-logs';
  static const String adminConfigPath = '/api/admin/config';
  static const String adminNotificationsPath =
      '/api/admin/notifications/broadcast';
  static const String adminBatchPath = '/api/admin/users/batch';
  static const String adminHealthPath = '/api/admin/system/health';
  static const String adminResetPasswordPath = '/api/admin/users';

  /// Statistics endpoints.
  static const String statisticsAdminPath = '/api/statistics/admin';
  static const String statisticsTrendsPath = '/api/statistics/trends';
  static const String statisticsCompliancePath = '/api/statistics/compliance';
  static const String statisticsWorkloadPath = '/api/statistics/workload';

  /// Secure storage keys.
  static const String tokenKey = 'auth_token';
  static const String userKey = 'auth_user';
  static const String onboardingCompletedKey = 'onboarding_completed';
}
