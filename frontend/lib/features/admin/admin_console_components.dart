import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
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
    // Title/subtitle always use the full pane width (crossAxis stretch). Never
    // put title text in a flex child that can collapse to ~0 and wrap vertically.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(title, style: Theme.of(context).textTheme.titleLarge),
              Text(
                subtitle,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Theme.of(context).colorScheme.outline,
                ),
              ),
              if (searchController != null || actions.isNotEmpty) ...[
                const SizedBox(height: 12),
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
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
              ],
            ],
          ),
        ),
        Expanded(child: child),
      ],
    );
  }
}

class AdminQueryBody<T> extends StatelessWidget {
  const AdminQueryBody({
    super.key,
    required this.query,
    required this.child,
    required this.emptyIcon,
    required this.emptyText,
    this.isEmpty = false,
  });

  final QueryResult<T> query;
  final Widget child;
  final IconData emptyIcon;
  final String emptyText;
  final bool isEmpty;

  @override
  Widget build(BuildContext context) {
    if (query.isLoading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (query.isError) {
      return ApiErrorState(error: query.error, onRetry: () => query.refetch());
    }
    if (isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(emptyIcon, size: 48),
            const SizedBox(height: 12),
            Text(emptyText),
          ],
        ),
      );
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

class AdminStatusPill extends StatelessWidget {
  const AdminStatusPill({super.key, required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    final lower = label.toLowerCase().trim();
    final theme = Theme.of(context);
    // Evaluate negative / warning statuses before any positive "paid" match so
    // values like "Not Paid" never pick up green via a trailing " paid" suffix.
    final isWarning =
        lower.contains('suspend') ||
        lower.contains('overdue') ||
        lower == 'unpaid' ||
        lower.contains('unpaid') ||
        lower == 'not paid' ||
        lower.contains('not paid');
    final isPositive =
        !isWarning &&
        (lower == 'active' || lower == 'paid' || lower.endsWith(' paid'));
    final color = isPositive
        ? Colors.green
        : isWarning
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
  // Fill whatever box the admin shell assigned. The shell positions pages with
  // an explicit width/height; this keeps Column+Expanded pages valid.
  final filledBody = SizedBox.expand(child: body);
  if (!AdminScaffold.usesShellAppBar(context)) return filledBody;
  return Scaffold(
    appBar: AppBar(title: Text(title)),
    body: filledBody,
  );
}

/// Page title + subtitle + optional actions.
///
/// Titles are never placed inside [Expanded]/[Flexible]. That pattern collapses
/// to ~1px under some shell constraints and soft-wraps each glyph onto its own
/// line (the vertical-text admin bug).
class AdminPageHeader extends StatelessWidget {
  const AdminPageHeader({
    super.key,
    required this.title,
    required this.subtitle,
    this.actions = const [],
  });

  final String title;
  final String subtitle;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(title, style: theme.textTheme.titleLarge),
        const SizedBox(height: 4),
        Text(
          subtitle,
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        if (actions.isNotEmpty) ...[
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: actions,
          ),
        ],
      ],
    );
  }
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
