class AppStrings {
  AppStrings._();

  /// Build-time define key for backend API base URL.
  static const String apiBaseUrlDefine = 'API_BASE_URL';
  static const String apiPathPrefixDefine = 'API_PATH_PREFIX';

  /// Base URL for the backend API.
  ///
  /// On Flutter Web, default to an empty string so requests use same-origin
  /// paths (e.g. `/api/...`) and avoid mixed-content issues on HTTPS hosts.
  static const String apiBaseUrl = String.fromEnvironment(
    apiBaseUrlDefine,
    defaultValue: 'https://vitalink-uimf.onrender.com',
  );

  static const String apiPathPrefix = String.fromEnvironment(
    apiPathPrefixDefine,
    defaultValue: '/api/v1',
  );

  /// Auth endpoints.
  static const String loginPath = '$apiPathPrefix/auth/login';
  static const String loginOtpVerifyPath =
      '$apiPathPrefix/auth/login/otp/verify';
  static const String loginOtpResendPath =
      '$apiPathPrefix/auth/login/otp/resend';
  static const String loginTotpVerifyPath =
      '$apiPathPrefix/auth/login/totp/verify';
  static const String authRefreshPath = '$apiPathPrefix/auth/refresh';
  static const String authRevokePath = '$apiPathPrefix/auth/revoke';
  static const String logoutPath = '$apiPathPrefix/auth/logout';
  static const String adminTotpSetupPath =
      '$apiPathPrefix/auth/admin/mfa/totp/setup';
  static const String adminTotpActivatePath =
      '$apiPathPrefix/auth/admin/mfa/totp/activate';

  /// Doctor endpoints.
  static const String doctorPatientsPath = '$apiPathPrefix/doctors/patients';
  static const String doctorProfilePath = '$apiPathPrefix/doctors/profile';
  static const String doctorGetDoctorsPath = '$apiPathPrefix/doctors/doctors';
  static const String doctorNotificationsPath =
      '$apiPathPrefix/doctors/notifications';
  static const String doctorNotificationStreamPath =
      '$apiPathPrefix/doctors/notifications/stream';
  static const String patientNotificationStreamPath =
      '$apiPathPrefix/patient/notifications/stream';
  static const String patientNotificationsPath =
      '$apiPathPrefix/patient/notifications';

  /// Admin endpoints.
  static const String adminBasePath = '$apiPathPrefix/admin';
  static const String adminDoctorsPath = '$apiPathPrefix/admin/doctors';
  static const String adminPatientsPath = '$apiPathPrefix/admin/patients';
  static const String adminHospitalsPath = '$apiPathPrefix/admin/hospitals';
  static const String adminRolesPath = '$apiPathPrefix/admin/roles';
  static const String adminUsersPath = '$apiPathPrefix/admin/users';
  static const String adminInvoicesPath =
      '$apiPathPrefix/admin/billing/invoices';
  static const String adminCheckoutPath =
      '$apiPathPrefix/admin/billing/checkout';
  static const String adminReassignPath = '$apiPathPrefix/admin/reassign';
  static const String adminAuditLogsPath = '$apiPathPrefix/admin/audit-logs';
  static const String adminConfigPath = '$apiPathPrefix/admin/config';
  static const String adminNotificationsPath =
      '$apiPathPrefix/admin/notifications/broadcast';
  static const String adminBatchPath = '$apiPathPrefix/admin/users/batch';
  static const String adminHealthPath = '$apiPathPrefix/admin/system/health';
  static const String adminResetPasswordPath = '$apiPathPrefix/admin/users';

  /// Statistics endpoints.
  static const String statisticsAdminPath = '$apiPathPrefix/statistics/admin';
  static const String statisticsTrendsPath = '$apiPathPrefix/statistics/trends';
  static const String statisticsCompliancePath =
      '$apiPathPrefix/statistics/compliance';
  static const String statisticsWorkloadPath =
      '$apiPathPrefix/statistics/workload';

  /// Secure storage keys.
  static const String tokenKey = 'auth_token';
  static const String refreshTokenKey = 'auth_refresh_token';
  static const String authSessionKey = 'auth_session';
  static const String userKey = 'auth_user';
  static const String onboardingCompletedKey = 'onboarding_completed';
}
