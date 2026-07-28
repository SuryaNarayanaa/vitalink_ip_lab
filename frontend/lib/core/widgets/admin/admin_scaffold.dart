import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/app/routers.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/widgets/admin/admin_access_gate.dart';
import 'package:frontend/core/widgets/admin/admin_access_scope.dart';
import 'package:frontend/core/widgets/common/logout_dialog.dart';

class AdminNavigationItem {
  const AdminNavigationItem({
    required this.id,
    required this.label,
    required this.icon,
    required this.selectedIcon,
  });

  final String id;
  final String label;
  final IconData icon;
  final IconData selectedIcon;
}

/// Admin layout wrapper with responsive sidebar/drawer navigation.
class AdminScaffold extends StatelessWidget {
  static const double tabletBreakpoint = 600;
  static const double desktopBreakpoint = 900;

  const AdminScaffold({
    super.key,
    required this.selectedDestinationId,
    required this.onDestinationSelected,
    required this.destinations,
    required this.body,
    this.actions,
  });

  final String selectedDestinationId;
  final ValueChanged<String> onDestinationSelected;
  final List<AdminNavigationItem> destinations;
  final Widget body;
  final List<Widget>? actions;

  static bool showsSidebar(BuildContext context) =>
      MediaQuery.sizeOf(context).width >= tabletBreakpoint;

  static bool usesShellAppBar(BuildContext context) => !showsSidebar(context);

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final isDesktop = width >= desktopBreakpoint;
    final showSidebar = showsSidebar(context);
    final controller = AdminAccessScope.maybeOf(context);
    final showReadOnlyBanner = controller?.access?.readOnly == true;
    final selectedIndex = destinations.indexWhere(
      (destination) => destination.id == selectedDestinationId,
    );
    final safeIndex = selectedIndex < 0 ? 0 : selectedIndex;
    final content = Column(
      children: [
        if (showReadOnlyBanner) const AdminReadOnlyBanner(),
        Expanded(child: body),
      ],
    );

    if (showSidebar) {
      // Pin the rail width so long destination labels never let the rail
      // consume the content pane (which collapses page titles to 1-glyph wrap).
      final railWidth = isDesktop ? 248.0 : 72.0;
      return Scaffold(
        body: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              width: railWidth,
              child: _AdminNavigationRail(
                destinations: destinations,
                selectedIndex: safeIndex,
                onDestinationSelected: (index) =>
                    onDestinationSelected(destinations[index].id),
                isExtended: isDesktop,
                width: railWidth,
              ),
            ),
            const VerticalDivider(thickness: 1, width: 1),
            Expanded(child: content),
          ],
        ),
      );
    }

    final selectedLabel = destinations.isEmpty
        ? 'VitaLink Admin'
        : destinations[safeIndex].label;
    return Scaffold(
      appBar: AppBar(
        title: Text(selectedLabel),
        actions: actions,
        leading: Builder(
          builder: (ctx) => IconButton(
            icon: const Icon(Icons.menu),
            tooltip: 'Open administrator navigation',
            onPressed: () => Scaffold.of(ctx).openDrawer(),
          ),
        ),
      ),
      drawer: Drawer(
        width: 300,
        child: SafeArea(
          child: _AdminNavigationRail(
            destinations: destinations,
            selectedIndex: safeIndex,
            onDestinationSelected: (index) {
              onDestinationSelected(destinations[index].id);
              Navigator.pop(context);
            },
            isExtended: true,
          ),
        ),
      ),
      body: content,
    );
  }
}

class _AdminNavigationRail extends StatelessWidget {
  const _AdminNavigationRail({
    required this.destinations,
    required this.selectedIndex,
    required this.onDestinationSelected,
    this.isExtended = true,
    this.width,
  });

  final List<AdminNavigationItem> destinations;
  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;
  final bool isExtended;
  /// When set (sidebar layout), keeps the rail from growing past the shell slot.
  final double? width;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    // Prefer an explicit shell width when provided; otherwise use Material defaults.
    final collapsedWidth = 72.0;
    final extendedWidth = width ?? 248.0;
    return NavigationRail(
      selectedIndex: selectedIndex,
      onDestinationSelected: onDestinationSelected,
      extended: isExtended,
      scrollable: true,
      minWidth: collapsedWidth,
      minExtendedWidth: extendedWidth < collapsedWidth
          ? collapsedWidth
          : extendedWidth,
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
          const SizedBox(height: 16),
        ],
      ),
      destinations: destinations
          .map(
            (destination) => NavigationRailDestination(
              icon: Icon(destination.icon),
              selectedIcon: Icon(destination.selectedIcon),
              label: Text(destination.label),
            ),
          )
          .toList(growable: false),
      trailing: Padding(
        padding: const EdgeInsets.only(top: 16, bottom: 24),
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
