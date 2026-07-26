import 'package:flutter/material.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/core/widgets/admin/admin_scaffold.dart';
import 'package:frontend/core/widgets/common/api_error_state.dart';

class AdminListShell extends StatelessWidget {
  const AdminListShell({
    super.key,
    required this.title,
    required this.subtitle,
    required this.child,
    this.searchController,
    this.searchHint,
    this.onSearch,
    this.actions = const [],
  });

  final String title;
  final String subtitle;
  final Widget child;
  final TextEditingController? searchController;
  final String? searchHint;
  final VoidCallback? onSearch;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Wrap(
            spacing: 12,
            runSpacing: 12,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              SizedBox(
                width: 340,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: Theme.of(context).textTheme.titleLarge),
                    Text(
                      subtitle,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.outline,
                      ),
                    ),
                  ],
                ),
              ),
              if (searchController != null)
                SizedBox(
                  width: 320,
                  child: TextField(
                    controller: searchController,
                    decoration: InputDecoration(
                      hintText: searchHint,
                      prefixIcon: const Icon(Icons.search_rounded),
                    ),
                    onChanged: (_) => onSearch?.call(),
                  ),
                ),
              ...actions,
            ],
          ),
        ),
        Expanded(child: child),
      ],
    );
  }
}

class AdminQueryBody extends StatelessWidget {
  const AdminQueryBody({
    super.key,
    required this.query,
    required this.child,
    required this.emptyIcon,
    required this.emptyText,
  });

  final dynamic query;
  final Widget child;
  final IconData emptyIcon;
  final String emptyText;

  @override
  Widget build(BuildContext context) {
    if (query.isLoading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (query.isError) {
      return ApiErrorState(error: query.error, onRetry: () => query.refetch());
    }
    return child;
  }
}

class AdminRecordCard extends StatelessWidget {
  const AdminRecordCard({
    super.key,
    required this.icon,
    required this.title,
    required this.badge,
    required this.details,
    this.menu = const [],
  });

  final IconData icon;
  final String title;
  final String badge;
  final List<AdminDetail> details;
  final List<PopupMenuEntry<String>> menu;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            CircleAvatar(
              backgroundColor: theme.colorScheme.primaryContainer,
              child: Icon(icon, color: theme.colorScheme.onPrimaryContainer),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          title,
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      AdminStatusPill(label: badge),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 12,
                    runSpacing: 6,
                    children: [
                      for (final d in details)
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              d.icon,
                              size: 15,
                              color: theme.colorScheme.outline,
                            ),
                            const SizedBox(width: 4),
                            Text(d.text, style: theme.textTheme.bodySmall),
                          ],
                        ),
                    ],
                  ),
                ],
              ),
            ),
            if (menu.isNotEmpty)
              PopupMenuButton<String>(itemBuilder: (_) => menu),
          ],
        ),
      ),
    );
  }
}

class RoleCard extends StatelessWidget {
  const RoleCard({
    super.key,
    required this.roleKey,
    required this.role,
    required this.permissions,
    required this.onChanged,
    this.draft,
  });

  final String roleKey;
  final Map<String, dynamic> role;
  final List<String> permissions;
  final Map<String, dynamic>? draft;
  final void Function(String permission, bool value) onChanged;

  @override
  Widget build(BuildContext context) {
    final values = {
      ...((role['permissions'] as Map?)?.cast<String, dynamic>() ?? {}),
      ...?draft,
    };
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${role['label'] ?? roleKey}',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 2,
              children: [
                for (final permission in permissions)
                  FilterChip(
                    label: Text(permission.replaceAll('_', ' ')),
                    selected: values[permission] == true,
                    // Backend always retains app_admin.manage_roles so role policy cannot be locked out.
                    onSelected:
                        roleKey == 'app_admin' && permission == 'manage_roles'
                        ? null
                        : (value) => onChanged(permission, value),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class AdminStatusPill extends StatelessWidget {
  const AdminStatusPill({super.key, required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    final lower = label.toLowerCase();
    final theme = Theme.of(context);
    final color =
        (lower == 'active' || lower.contains(' paid') || lower == 'paid')
        ? Colors.green
        : lower.contains('suspend') || lower.contains('overdue')
        ? Colors.orange
        : theme.colorScheme.primary;
    return Chip(
      label: Text(label),
      visualDensity: VisualDensity.compact,
      backgroundColor: color.withValues(alpha: 0.12),
      labelStyle: TextStyle(color: color, fontWeight: FontWeight.w600),
    );
  }
}

class AdminDetail {
  const AdminDetail(this.icon, this.text);
  final IconData icon;
  final String text;
}

Widget adminPageScaffold(BuildContext context, String title, Widget body) {
  if (!AdminScaffold.usesShellAppBar(context)) return body;
  return Scaffold(
    appBar: AppBar(title: Text(title)),
    body: body,
  );
}

void showAdminError(BuildContext context, Object error) {
  final message = error is ApiException
      ? error.message
      : 'The administrator request could not be completed. Try again.';
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
}

String formatAdminDate(Object? raw) {
  if (raw == null) return '--';
  final parsed = DateTime.tryParse(raw.toString());
  if (parsed == null) return raw.toString();
  return '${parsed.year}-${parsed.month.toString().padLeft(2, '0')}-${parsed.day.toString().padLeft(2, '0')}';
}
