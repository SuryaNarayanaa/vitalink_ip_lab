import 'package:flutter/material.dart';
import 'package:frontend/features/admin/account_security_page.dart';
import 'package:frontend/features/admin/data/admin_repository.dart';

/// Compatibility entry point retained for older navigation callers.
///
/// V2 intentionally separates personal MFA from platform configuration and
/// health. The administrator shell exposes those global/tenant surfaces as
/// independent capability-gated destinations.
@Deprecated('Use AccountSecurityPage, PlatformConfigurationPage, or PlatformHealthPage')
class SystemConfigPage extends StatelessWidget {
  const SystemConfigPage({super.key, this.repository});

  final AdminRepository? repository;

  @override
  Widget build(BuildContext context) {
    return AccountSecurityPage(repository: repository);
  }
}
