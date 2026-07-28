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
  static const double extendedSidebarWidth = 248;
  static const double compactSidebarWidth = 72;

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
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (showReadOnlyBanner) const AdminReadOnlyBanner(),
        Expanded(child: body),
      ],
    );

    if (showSidebar) {
      final railWidth = isDesktop
          ? extendedSidebarWidth
          : compactSidebarWidth;
      return Scaffold(
        body: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              width: railWidth,
              child: _AdminSideNav(
                destinations: destinations,
                selectedIndex: safeIndex,
                onDestinationSelected: (index) =>
                    onDestinationSelected(destinations[index].id),
                extended: isDesktop,
              ),
            ),
            const VerticalDivider(thickness: 1, width: 1),
            Expanded(
              child: ColoredBox(
                color: Theme.of(context).colorScheme.surface,
                child: content,
              ),
            ),
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
          child: _AdminSideNav(
            destinations: destinations,
            selectedIndex: safeIndex,
            onDestinationSelected: (index) {
              onDestinationSelected(destinations[index].id);
              Navigator.pop(context);
            },
            extended: true,
          ),
        ),
      ),
      body: content,
    );
  }
}

/// Fixed-width admin navigation. Avoids [NavigationRail], whose intrinsic
/// sizing has collapsed the content pane to ~1 glyph on web.
class _AdminSideNav extends StatelessWidget {
  const _AdminSideNav({
    required this.destinations,
    required this.selectedIndex,
    required this.onDestinationSelected,
    required this.extended,
  });

  final List<AdminNavigationItem> destinations;
  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;
  final bool extended;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      color: theme.colorScheme.surface,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: EdgeInsets.fromLTRB(
              extended ? 16 : 8,
              16,
              extended ? 16 : 8,
              8,
            ),
            child: extended
                ? Row(
                    children: [
                      Icon(
                        Icons.monitor_heart_outlined,
                        size: 28,
                        color: theme.colorScheme.primary,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          'VitaLink',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.bold,
                            color: theme.colorScheme.primary,
                          ),
                        ),
                      ),
                    ],
                  )
                : Icon(
                    Icons.monitor_heart_outlined,
                    size: 28,
                    color: theme.colorScheme.primary,
                  ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              itemCount: destinations.length,
              itemBuilder: (context, index) {
                final destination = destinations[index];
                final selected = index == selectedIndex;
                final icon = Icon(
                  selected ? destination.selectedIcon : destination.icon,
                  color: selected
                      ? theme.colorScheme.primary
                      : theme.colorScheme.onSurfaceVariant,
                );
                if (!extended) {
                  return Padding(
                    padding: const EdgeInsets.symmetric(vertical: 2),
                    child: IconButton(
                      isSelected: selected,
                      tooltip: destination.label,
                      onPressed: () => onDestinationSelected(index),
                      icon: icon,
                    ),
                  );
                }
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: ListTile(
                    selected: selected,
                    selectedTileColor: theme.colorScheme.primaryContainer
                        .withValues(alpha: 0.45),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(24),
                    ),
                    leading: icon,
                    title: Text(
                      destination.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: selected
                            ? theme.colorScheme.primary
                            : theme.colorScheme.onSurfaceVariant,
                        fontWeight: selected
                            ? FontWeight.bold
                            : FontWeight.w500,
                      ),
                    ),
                    onTap: () => onDestinationSelected(index),
                    dense: true,
                    visualDensity: VisualDensity.compact,
                  ),
                );
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 8, 8, 16),
            child: extended
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
        ],
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
