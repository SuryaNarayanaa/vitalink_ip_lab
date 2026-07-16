import 'package:frontend/core/di/app_dependencies.dart';

class AdminQueryKeys {
  AdminQueryKeys._();

  static List<Object> all() => ['admin', _scope];

  static List<Object> stats() => [...all(), 'stats'];

  static List<Object> analyticsDashboard(String period) =>
      [...all(), 'analytics', 'dashboard', period];

  static List<Object> doctors({
    required int page,
    required String search,
    required String statusFilter,
    required String departmentFilter,
    required int refreshKey,
  }) =>
      [
        ...all(),
        'doctors',
        page,
        search,
        statusFilter,
        departmentFilter,
        refreshKey,
      ];

  static List<Object> patients({
    required int page,
    required String search,
    required String statusFilter,
    required String doctorFilter,
    required int refreshKey,
  }) =>
      [
        ...all(),
        'patients',
        page,
        search,
        statusFilter,
        doctorFilter,
        refreshKey,
      ];

  static List<Object> hospitals({required int refreshKey}) =>
      [...all(), 'hospitals', refreshKey];

  static List<Object> users({required int refreshKey}) =>
      [...all(), 'users', refreshKey];

  static List<Object> roles({required int refreshKey}) =>
      [...all(), 'roles', refreshKey];

  static List<Object> invoices({required int refreshKey}) =>
      [...all(), 'invoices', refreshKey];

  static List<Object> auditLogs({
    required int page,
    required String actionFilter,
    required String successFilter,
    required String startDate,
    required String endDate,
    required int refreshKey,
  }) =>
      [
        ...all(),
        'audit-logs',
        page,
        actionFilter,
        successFilter,
        startDate,
        endDate,
        refreshKey,
      ];

  static String get _scope => AppDependencies.secureStorage.sessionScope;
}
