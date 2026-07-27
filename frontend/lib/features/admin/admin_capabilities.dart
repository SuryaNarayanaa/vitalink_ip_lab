import 'package:flutter/material.dart';
import 'package:frontend/features/admin/models/admin_access_model.dart';

abstract final class AdminCapabilities {
  static const platformHospitalsRead = 'platform.hospitals.read';
  static const platformHospitalsManage = 'platform.hospitals.manage';
  static const platformAdminAccountsRead = 'platform.admin_accounts.read';
  static const platformAdminAccountsManage = 'platform.admin_accounts.manage';
  static const platformRolePolicyRead = 'platform.role_policy.read';
  static const platformRolePolicyManage = 'platform.role_policy.manage';
  static const platformAuditRead = 'platform.audit.read';
  static const platformAnalyticsRead = 'platform.analytics.read';
  static const platformBillingRead = 'platform.billing.read';
  static const platformBillingManage = 'platform.billing.manage';
  static const platformSystemConfigRead = 'platform.system_config.read';
  static const platformSystemConfigManage = 'platform.system_config.manage';
  static const platformSystemHealthRead = 'platform.system_health.read';
  static const platformNotificationsBroadcast =
      'platform.notifications.broadcast';

  static const tenantDashboardRead = 'tenant.dashboard.read';
  static const tenantDoctorsRead = 'tenant.doctors.read';
  static const tenantDoctorsManage = 'tenant.doctors.manage';
  static const tenantPatientsRead = 'tenant.patients.read';
  static const tenantPatientsManage = 'tenant.patients.manage';
  static const tenantPatientsAssign = 'tenant.patients.assign';
  static const tenantAccountsStatusManage = 'tenant.accounts.status.manage';
  static const tenantCredentialsReset = 'tenant.credentials.reset';
  static const tenantAuditRead = 'tenant.audit.read';
  static const tenantAnalyticsRead = 'tenant.analytics.read';
  static const tenantBillingRead = 'tenant.billing.read';
  static const tenantBillingCheckout = 'tenant.billing.checkout';
  static const tenantNotificationsBroadcast = 'tenant.notifications.broadcast';
  static const tenantOperationsHealthRead = 'tenant.operations_health.read';

  /// Matches `GET /statistics/admin` (`platform.analytics.read` | `tenant.dashboard.read`).
  static const dashboardRead = [
    tenantDashboardRead,
    platformAnalyticsRead,
  ];

  /// Matches trends/workload/period analytics routes (`platform.analytics.read` | `tenant.analytics.read`).
  static const analyticsRead = [platformAnalyticsRead, tenantAnalyticsRead];
  static const billingRead = [platformBillingRead, tenantBillingRead];
  static const auditRead = [platformAuditRead, tenantAuditRead];
  static const notificationActions = [
    platformNotificationsBroadcast,
    tenantNotificationsBroadcast,
  ];
}

class AdminCapabilityInfo {
  const AdminCapabilityInfo({
    required this.label,
    required this.description,
    required this.area,
    required this.icon,
  });

  final String label;
  final String description;
  final String area;
  final IconData icon;
}

const adminCapabilityInfo = <String, AdminCapabilityInfo>{
  AdminCapabilities.platformHospitalsRead: AdminCapabilityInfo(
    label: 'View hospitals',
    description: 'Read the hospital directory and operational metadata.',
    area: 'Hospitals',
    icon: Icons.local_hospital_outlined,
  ),
  AdminCapabilities.platformHospitalsManage: AdminCapabilityInfo(
    label: 'Manage hospitals',
    description: 'Create, update, suspend, or reactivate hospitals.',
    area: 'Hospitals',
    icon: Icons.local_hospital_outlined,
  ),
  AdminCapabilities.platformAdminAccountsRead: AdminCapabilityInfo(
    label: 'View administrator accounts',
    description: 'Read Hospital Admin and System Auditor accounts.',
    area: 'Administrator accounts',
    icon: Icons.manage_accounts_outlined,
  ),
  AdminCapabilities.platformAdminAccountsManage: AdminCapabilityInfo(
    label: 'Manage administrator accounts',
    description:
        'Invite, update, suspend, restore, or reset MFA for administrators.',
    area: 'Administrator accounts',
    icon: Icons.manage_accounts_outlined,
  ),
  AdminCapabilities.platformRolePolicyRead: AdminCapabilityInfo(
    label: 'View access policies',
    description: 'Read fixed administrator policies and their history.',
    area: 'Access control',
    icon: Icons.admin_panel_settings_outlined,
  ),
  AdminCapabilities.platformRolePolicyManage: AdminCapabilityInfo(
    label: 'Manage access policies',
    description: 'Update or restore editable administrator policies.',
    area: 'Access control',
    icon: Icons.admin_panel_settings_outlined,
  ),
  AdminCapabilities.platformAuditRead: AdminCapabilityInfo(
    label: 'View global audit',
    description: 'Read global operational audit events.',
    area: 'Oversight',
    icon: Icons.history_outlined,
  ),
  AdminCapabilities.platformAnalyticsRead: AdminCapabilityInfo(
    label: 'View global analytics',
    description: 'Read global non-clinical operational analytics.',
    area: 'Oversight',
    icon: Icons.analytics_outlined,
  ),
  AdminCapabilities.platformBillingRead: AdminCapabilityInfo(
    label: 'View platform billing',
    description: 'Read platform billing and invoices.',
    area: 'Billing',
    icon: Icons.receipt_long_outlined,
  ),
  AdminCapabilities.platformBillingManage: AdminCapabilityInfo(
    label: 'Manage platform billing',
    description: 'Generate invoices and run platform billing operations.',
    area: 'Billing',
    icon: Icons.receipt_long_outlined,
  ),
  AdminCapabilities.platformSystemConfigRead: AdminCapabilityInfo(
    label: 'View platform configuration',
    description: 'Read global runtime configuration.',
    area: 'Platform',
    icon: Icons.tune_outlined,
  ),
  AdminCapabilities.platformSystemConfigManage: AdminCapabilityInfo(
    label: 'Manage platform configuration',
    description: 'Change global runtime configuration.',
    area: 'Platform',
    icon: Icons.tune_outlined,
  ),
  AdminCapabilities.platformSystemHealthRead: AdminCapabilityInfo(
    label: 'View platform health',
    description: 'Read global service and dependency health.',
    area: 'Platform',
    icon: Icons.monitor_heart_outlined,
  ),
  AdminCapabilities.platformNotificationsBroadcast: AdminCapabilityInfo(
    label: 'Broadcast globally',
    description: 'Send a global administrative notification.',
    area: 'Communications',
    icon: Icons.campaign_outlined,
  ),
  AdminCapabilities.tenantDashboardRead: AdminCapabilityInfo(
    label: 'View hospital dashboard',
    description: 'Read the hospital-scoped operational dashboard.',
    area: 'Hospital operations',
    icon: Icons.dashboard_outlined,
  ),
  AdminCapabilities.tenantDoctorsRead: AdminCapabilityInfo(
    label: 'View doctors',
    description: 'List Doctor accounts in the assigned hospital.',
    area: 'Hospital accounts',
    icon: Icons.medical_services_outlined,
  ),
  AdminCapabilities.tenantDoctorsManage: AdminCapabilityInfo(
    label: 'Manage doctors',
    description: 'Create and update non-clinical Doctor account data.',
    area: 'Hospital accounts',
    icon: Icons.medical_services_outlined,
  ),
  AdminCapabilities.tenantPatientsRead: AdminCapabilityInfo(
    label: 'View patients',
    description: 'List Patient accounts in the assigned hospital.',
    area: 'Hospital accounts',
    icon: Icons.people_outline,
  ),
  AdminCapabilities.tenantPatientsManage: AdminCapabilityInfo(
    label: 'Manage patients',
    description: 'Create and update non-clinical Patient account data.',
    area: 'Hospital accounts',
    icon: Icons.people_outline,
  ),
  AdminCapabilities.tenantPatientsAssign: AdminCapabilityInfo(
    label: 'Assign patients',
    description: 'Assign Patients to eligible Doctors in the same hospital.',
    area: 'Hospital accounts',
    icon: Icons.assignment_ind_outlined,
  ),
  AdminCapabilities.tenantAccountsStatusManage: AdminCapabilityInfo(
    label: 'Manage account status',
    description: 'Suspend or restore eligible Doctor and Patient accounts.',
    area: 'Hospital accounts',
    icon: Icons.toggle_on_outlined,
  ),
  AdminCapabilities.tenantCredentialsReset: AdminCapabilityInfo(
    label: 'Reset credentials',
    description: 'Reset Doctor or Patient credentials in the hospital.',
    area: 'Hospital accounts',
    icon: Icons.password_outlined,
  ),
  AdminCapabilities.tenantAuditRead: AdminCapabilityInfo(
    label: 'View hospital audit',
    description: 'Read audit events for the assigned hospital.',
    area: 'Oversight',
    icon: Icons.history_outlined,
  ),
  AdminCapabilities.tenantAnalyticsRead: AdminCapabilityInfo(
    label: 'View hospital analytics',
    description: 'Read non-clinical analytics for the assigned hospital.',
    area: 'Oversight',
    icon: Icons.analytics_outlined,
  ),
  AdminCapabilities.tenantBillingRead: AdminCapabilityInfo(
    label: 'View hospital billing',
    description: 'Read invoices belonging to the assigned hospital.',
    area: 'Billing',
    icon: Icons.receipt_long_outlined,
  ),
  AdminCapabilities.tenantBillingCheckout: AdminCapabilityInfo(
    label: 'Start invoice checkout',
    description: 'Start checkout for an eligible hospital invoice.',
    area: 'Billing',
    icon: Icons.payment_outlined,
  ),
  AdminCapabilities.tenantNotificationsBroadcast: AdminCapabilityInfo(
    label: 'Broadcast within hospital',
    description: 'Send notifications to eligible hospital users.',
    area: 'Communications',
    icon: Icons.campaign_outlined,
  ),
  AdminCapabilities.tenantOperationsHealthRead: AdminCapabilityInfo(
    label: 'View hospital operations health',
    description: 'Read hospital reminder and delivery health.',
    area: 'Hospital operations',
    icon: Icons.health_and_safety_outlined,
  ),
};

String adminRoleLabel(AdminRole role) => switch (role) {
  AdminRole.appAdmin => 'Application Admin',
  AdminRole.hospitalAdmin => 'Hospital Admin',
  AdminRole.auditor => 'System Auditor',
};
