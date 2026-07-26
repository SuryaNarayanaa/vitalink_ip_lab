import 'package:flutter/material.dart';
import 'package:frontend/core/auth/session_bootstrap_page.dart';
import 'package:frontend/core/auth/session_route_guard.dart';
import 'package:frontend/features/login/change_password_page.dart';
import 'package:frontend/features/login/login_page.dart';
import 'package:frontend/features/patient/patient_dashboard_shell_page.dart';
import 'package:frontend/features/patient/patient_records_page.dart';
import 'package:frontend/features/patient/patient_dosage_calendar_page.dart';
import 'package:frontend/features/doctor/doctor_dashboard_page.dart';
import 'package:frontend/features/doctor/add_patient_page.dart';
import 'package:frontend/features/notifications/notification_center_page.dart';
import 'package:frontend/features/onboarding/onboarding_page.dart';
import 'package:frontend/features/admin/admin_dashboard_page.dart';

class AppRoutes {
  static const String sessionBootstrap = '/session-bootstrap';
  static const String login = '/login';
  static const String changePassword = '/change-password';
  static const String onboarding = '/onboarding';
  static const String patient = '/patient';
  static const String patientRecords = '/patient-records';
  static const String patientProfile = '/patient-profile';
  static const String patientUpdateINR = '/patient-update-inr';
  static const String patientTakeDosage = '/patient-take-dosage';
  static const String patientDosageCalendar = '/patient-dosage-calendar';
  static const String patientHealthReports = '/patient-health-reports';
  static const String patientNotifications = '/patient-notifications';
  static const String doctorDashboard = '/doctor-dashboard';
  static const String doctorAddPatient = '/doctor-add-patient';
  static const String doctorNotifications = '/doctor-notifications';
  static const String adminDashboard = '/admin-dashboard';
}

class AppRouter {
  static const String initialRoute = AppRoutes.sessionBootstrap;
  static final GlobalKey<NavigatorState> navigatorKey =
      GlobalKey<NavigatorState>();

  static final Map<String, WidgetBuilder> routes = {
    '/': (_) => const SessionBootstrapPage(),
    AppRoutes.sessionBootstrap: (_) => const SessionBootstrapPage(),
    AppRoutes.login: (_) => const LoginPage(),
    AppRoutes.changePassword: (context) {
      final args = ModalRoute.of(context)?.settings.arguments;
      final forced = args is bool ? args : null;
      return SessionRouteGuard(
        access: RouteAccess.authenticated,
        child: ChangePasswordPage(forced: forced),
      );
    },
    AppRoutes.onboarding: (_) => const SessionRouteGuard(
          access: RouteAccess.patientOrDoctor,
          child: OnboardingPage(),
        ),
    AppRoutes.patient: (_) => const SessionRouteGuard(
          access: RouteAccess.patient,
          child: PatientDashboardShellPage(initialTabIndex: 0),
        ),
    AppRoutes.patientUpdateINR: (_) => const SessionRouteGuard(
          access: RouteAccess.patient,
          child: PatientDashboardShellPage(initialTabIndex: 1),
        ),
    AppRoutes.patientTakeDosage: (_) => const SessionRouteGuard(
          access: RouteAccess.patient,
          child: PatientDashboardShellPage(initialTabIndex: 2),
        ),
    AppRoutes.patientDosageCalendar: (_) => const SessionRouteGuard(
          access: RouteAccess.patient,
          child: PatientDosageCalendarPage(),
        ),
    AppRoutes.patientHealthReports: (_) => const SessionRouteGuard(
          access: RouteAccess.patient,
          child: PatientDashboardShellPage(initialTabIndex: 3),
        ),
    AppRoutes.patientRecords: (_) => const SessionRouteGuard(
          access: RouteAccess.patient,
          child: PatientRecordsPage(),
        ),
    AppRoutes.patientProfile: (_) => const SessionRouteGuard(
          access: RouteAccess.patient,
          child: PatientDashboardShellPage(initialTabIndex: 4),
        ),
    AppRoutes.patientNotifications: (_) => const SessionRouteGuard(
          access: RouteAccess.patient,
          child: NotificationCenterPage(forDoctor: false),
        ),
    AppRoutes.doctorDashboard: (_) => const SessionRouteGuard(
          access: RouteAccess.doctor,
          child: DoctorDashboardPage(),
        ),
    AppRoutes.doctorAddPatient: (_) => const SessionRouteGuard(
          access: RouteAccess.doctor,
          child: AddPatientPage(),
        ),
    AppRoutes.doctorNotifications: (_) => const SessionRouteGuard(
          access: RouteAccess.doctor,
          child: NotificationCenterPage(forDoctor: true),
        ),
    AppRoutes.adminDashboard: (_) => const SessionRouteGuard(
          access: RouteAccess.admin,
          child: AdminDashboardPage(),
        ),
  };
}
