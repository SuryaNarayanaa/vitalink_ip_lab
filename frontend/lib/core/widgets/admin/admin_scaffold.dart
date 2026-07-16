import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/app/routers.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/widgets/common/logout_dialog.dart';

/// Admin layout wrapper with responsive sidebar/drawer navigation.
class AdminScaffold extends StatelessWidget {
  static const double tabletBreakpoint = 600;
  static const double desktopBreakpoint = 900;

  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;
  final Widget body;
  final List<Widget>? actions;

  const AdminScaffold({
    super.key,
    required this.selectedIndex,
    required this.onDestinationSelected,
    required this.body,
    this.actions,
  });

  static bool showsSidebar(BuildContext context) =>
      MediaQuery.sizeOf(context).width >= tabletBreakpoint;

  static bool usesShellAppBar(BuildContext context) => !showsSidebar(context);

  static const _destinations = <_NavItem>[
    _NavItem(Icons.dashboard_outlined, Icons.dashboard_rounded, 'Dashboard'),
    _NavItem(
      Icons.local_hospital_outlined,
      Icons.local_hospital_rounded,
      'Hospitals',
    ),
    _NavItem(
      Icons.medical_services_outlined,
      Icons.medical_services_rounded,
      'Doctors',
    ),
    _NavItem(Icons.people_outline, Icons.people_rounded, 'Patients'),
    _NavItem(
      Icons.manage_accounts_outlined,
      Icons.manage_accounts_rounded,
      'Users',
    ),
    _NavItem(
      Icons.admin_panel_settings_outlined,
      Icons.admin_panel_settings_rounded,
      'Roles',
    ),
    _NavItem(
      Icons.receipt_long_outlined,
      Icons.receipt_long_rounded,
      'Billing',
    ),
    _NavItem(Icons.analytics_outlined, Icons.analytics_rounded, 'Analytics'),
    _NavItem(
      Icons.notifications_outlined,
      Icons.notifications_rounded,
      'Notifications',
    ),
    _NavItem(Icons.history_outlined, Icons.history_rounded, 'Audit Logs'),
    _NavItem(Icons.settings_outlined, Icons.settings_rounded, 'Settings'),
  ];

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final isDesktop = width >= desktopBreakpoint;
    final showSidebar = showsSidebar(context);

    if (showSidebar) {
      return Scaffold(
        body: Row(
          children: [
            _AdminNavigationRail(
              selectedIndex: selectedIndex,
              onDestinationSelected: onDestinationSelected,
              isExtended: isDesktop,
            ),
            const VerticalDivider(thickness: 1, width: 1),
            Expanded(child: body),
          ],
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('VitaLink Admin'),
        actions: actions,
        leading: Builder(
          builder: (ctx) => IconButton(
            icon: const Icon(Icons.menu),
            onPressed: () => Scaffold.of(ctx).openDrawer(),
          ),
        ),
      ),
      drawer: Drawer(
        width: 280,
        child: _AdminNavigationRail(
          selectedIndex: selectedIndex,
          onDestinationSelected: (i) {
            onDestinationSelected(i);
            Navigator.pop(context);
          },
          isExtended: true,
        ),
      ),
      body: body,
    );
  }
}

class _NavItem {
  final IconData icon;
  final IconData selectedIcon;
  final String label;
  const _NavItem(this.icon, this.selectedIcon, this.label);
}

class _AdminNavigationRail extends StatelessWidget {
  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;
  final bool isExtended;

  const _AdminNavigationRail({
    required this.selectedIndex,
    required this.onDestinationSelected,
    this.isExtended = true,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return NavigationRail(
      selectedIndex: selectedIndex,
      onDestinationSelected: onDestinationSelected,
      extended: isExtended,
      minWidth: 72,
      backgroundColor: theme.colorScheme.surface,
      selectedIconTheme: IconThemeData(color: theme.colorScheme.primary),
      unselectedIconTheme: IconThemeData(
        color: theme.colorScheme.onSurfaceVariant,
      ),
      selectedLabelTextStyle: TextStyle(
        color: theme.colorScheme.primary,
        fontWeight: FontWeight.bold,
      ),
      unselectedLabelTextStyle: TextStyle(
        color: theme.colorScheme.onSurfaceVariant,
      ),
      leading: Column(
        children: [
          const SizedBox(height: 16),
          Icon(
            Icons.monitor_heart_outlined,
            size: 32,
            color: theme.colorScheme.primary,
          ),
          if (isExtended) ...[
            const SizedBox(height: 8),
            Text(
              'VitaLink',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
                color: theme.colorScheme.primary,
              ),
            ),
          ],
          const SizedBox(height: 24),
        ],
      ),
      destinations: AdminScaffold._destinations
          .map(
            (d) => NavigationRailDestination(
              icon: Icon(d.icon),
              selectedIcon: Icon(d.selectedIcon),
              label: Text(d.label),
            ),
          )
          .toList(),
      trailing: Expanded(
        child: Align(
          alignment: Alignment.bottomCenter,
          child: Padding(
            padding: const EdgeInsets.only(bottom: 24),
            child: isExtended
                ? TextButton.icon(
                    onPressed: () => _showLogoutDialog(context),
                    icon: Icon(
                      Icons.logout_rounded,
                      color: theme.colorScheme.error,
                    ),
                    label: Text(
                      'Logout',
                      style: TextStyle(color: theme.colorScheme.error),
                    ),
                  )
                : IconButton(
                    onPressed: () => _showLogoutDialog(context),
                    icon: Icon(
                      Icons.logout_rounded,
                      color: theme.colorScheme.error,
                    ),
                    tooltip: 'Logout',
                  ),
          ),
        ),
      ),
    );
  }

  void _showLogoutDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (_) => LogoutDialog(
        onLogout: () async {
          await AppDependencies.authRepository.logout();
          await QueryCache.instance.clear();
          if (context.mounted) {
            Navigator.of(
              context,
            ).pushNamedAndRemoveUntil(AppRoutes.login, (_) => false);
          }
        },
      ),
    );
  }
}
