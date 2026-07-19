import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/di/theme.dart';
import 'package:frontend/core/query/doctor_query_keys.dart';
import 'package:frontend/core/query/patient_query_keys.dart';
import 'package:frontend/core/widgets/common/api_error_state.dart';

class NotificationCenterPage extends StatefulWidget {
  const NotificationCenterPage({
    super.key,
    required this.forDoctor,
  });

  final bool forDoctor;

  @override
  State<NotificationCenterPage> createState() => _NotificationCenterPageState();
}

class _NotificationCenterPageState extends State<NotificationCenterPage> {
  bool _markAllLoading = false;
  bool _showUnreadOnly = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final pageTop = isDark
        ? const Color(0xFF1B1E28)
        : Color.alphaBlend(
            AppColors.primary.withValues(alpha: 0.10),
            Colors.white,
          );
    final pageBottom = isDark
        ? const Color(0xFF12141C)
        : Color.alphaBlend(
            AppColors.secondary.withValues(alpha: 0.06),
            Colors.white,
          );

    return UseQuery<Map<String, dynamic>>(
      options: QueryOptions<Map<String, dynamic>>(
        queryKey: widget.forDoctor
            ? DoctorQueryKeys.notifications()
            : PatientQueryKeys.notifications(),
        queryFn: () {
          if (widget.forDoctor) {
            return AppDependencies.doctorRepository.getNotifications(limit: 50);
          }
          return AppDependencies.patientRepository.getNotifications(limit: 50);
        },
      ),
      builder: (context, query) {
        final data = query.data ?? <String, dynamic>{};
        final notifications =
            (data['notifications'] as List?)?.cast<Map<String, dynamic>>() ??
                <Map<String, dynamic>>[];
        final unreadCount = (data['unreadCount'] as num?)?.toInt() ?? 0;
        final filteredNotifications = _showUnreadOnly
            ? notifications.where((item) => item['isRead'] != true).toList()
            : notifications;

        return Scaffold(
          backgroundColor: pageBottom,
          appBar: AppBar(
            backgroundColor: pageTop,
            elevation: 0,
            scrolledUnderElevation: 0,
            title: const Text('Notifications'),
            actions: [
              TextButton.icon(
                onPressed: (!_markAllLoading && unreadCount > 0)
                    ? () => _markAllAsRead(query.refetch)
                    : null,
                icon: _markAllLoading
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.done_all_rounded, size: 18),
                label: _markAllLoading
                    ? const Text('Updating')
                    : const Text('Mark all read'),
              ),
              const SizedBox(width: 8),
            ],
          ),
          body: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [pageTop, pageBottom],
              ),
            ),
            child: query.isLoading
                ? const _LoadingState()
                : query.isError
                    ? ApiErrorState(
                        error: query.error,
                        onRetry: () => query.refetch(),
                      )
                    : notifications.isEmpty
                        ? const _EmptyState(isFiltered: false)
                        : RefreshIndicator(
                            onRefresh: () async => query.refetch(),
                            child: CustomScrollView(
                              physics: const AlwaysScrollableScrollPhysics(),
                              slivers: [
                                SliverToBoxAdapter(
                                  child: _NotificationSummaryCard(
                                    totalCount: notifications.length,
                                    unreadCount: unreadCount,
                                    showUnreadOnly: _showUnreadOnly,
                                    onToggleFilter: (value) {
                                      setState(() => _showUnreadOnly = value);
                                    },
                                  ),
                                ),
                                if (filteredNotifications.isEmpty)
                                  const SliverFillRemaining(
                                    hasScrollBody: false,
                                    child: _EmptyState(isFiltered: true),
                                  )
                                else
                                  SliverPadding(
                                    padding: const EdgeInsets.fromLTRB(
                                      16,
                                      6,
                                      16,
                                      20,
                                    ),
                                    sliver: SliverList.separated(
                                      itemCount: filteredNotifications.length,
                                      separatorBuilder: (_, __) =>
                                          const SizedBox(height: 12),
                                      itemBuilder: (context, index) {
                                        final item =
                                            filteredNotifications[index];
                                        return _NotificationTile(
                                          item: item,
                                          onTap: () =>
                                              _markSingleAsReadIfNeeded(
                                            item,
                                            query.refetch,
                                          ),
                                        );
                                      },
                                    ),
                                  ),
                              ],
                            ),
                          ),
          ),
        );
      },
    );
  }

  Future<void> _markSingleAsReadIfNeeded(
    Map<String, dynamic> item,
    Future<void> Function() refetch,
  ) async {
    if (item['isRead'] == true) return;
    final id = item['id']?.toString() ?? '';
    if (id.isEmpty) return;

    if (widget.forDoctor) {
      await AppDependencies.doctorRepository.markNotificationAsRead(id);
    } else {
      await AppDependencies.patientRepository.markNotificationAsRead(id);
    }
    await _invalidateNotificationKeys();
    await refetch();
  }

  Future<void> _markAllAsRead(Future<void> Function() refetch) async {
    setState(() => _markAllLoading = true);
    try {
      if (widget.forDoctor) {
        await AppDependencies.doctorRepository.markAllNotificationsAsRead();
      } else {
        await AppDependencies.patientRepository.markAllNotificationsAsRead();
      }
      await _invalidateNotificationKeys();
      await refetch();
    } finally {
      if (mounted) setState(() => _markAllLoading = false);
    }
  }

  Future<void> _invalidateNotificationKeys() async {
    if (!mounted) return;
    final queryClient = QueryClientProvider.of(context);
    if (widget.forDoctor) {
      queryClient.invalidateQueries(DoctorQueryKeys.notifications());
      queryClient.invalidateQueries(DoctorQueryKeys.notificationsUnread());
      return;
    }

    queryClient.invalidateQueries(PatientQueryKeys.notifications());
    queryClient.invalidateQueries(PatientQueryKeys.notificationsUnread());
    queryClient.invalidateQueries(PatientQueryKeys.doctorUpdatesUnread());
    queryClient.invalidateQueries(PatientQueryKeys.profileFull());
  }
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({
    required this.item,
    required this.onTap,
  });

  final Map<String, dynamic> item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final isRead = item['isRead'] == true;
    final priority = item['priority']?.toString() ?? 'MEDIUM';
    final priorityVisual = _priorityVisual(priority, scheme);

    return InkWell(
      borderRadius: BorderRadius.circular(20),
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: isRead
                ? [
                    scheme.surface,
                    scheme.surface,
                  ]
                : [
                    scheme.primary.withValues(alpha: 0.08),
                    scheme.surface,
                  ],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isRead
                ? scheme.outlineVariant.withValues(alpha: 0.6)
                : priorityVisual.color.withValues(alpha: 0.45),
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.05),
              blurRadius: 14,
              offset: const Offset(0, 6),
            ),
          ],
        ),
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(
                    color: priorityVisual.color.withValues(alpha: 0.15),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    priorityVisual.icon,
                    size: 18,
                    color: priorityVisual.color,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item['title']?.toString() ?? 'Notification',
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.1,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _formatTimeAgo(item['createdAt']),
                        style: theme.textTheme.labelMedium?.copyWith(
                          color: scheme.onSurfaceVariant,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
                if (!isRead)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: scheme.secondaryContainer,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      'NEW',
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: scheme.onSecondaryContainer,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              item['message']?.toString() ?? '',
              style: theme.textTheme.bodyMedium?.copyWith(
                height: 1.35,
                color: scheme.onSurface.withValues(alpha: 0.85),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                _PriorityChip(priority: priority),
                const Spacer(),
                Icon(
                  isRead ? Icons.drafts_outlined : Icons.markunread_outlined,
                  size: 15,
                  color: scheme.onSurfaceVariant,
                ),
                const SizedBox(width: 4),
                Text(
                  isRead ? 'Read' : 'Unread',
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _PriorityChip extends StatelessWidget {
  const _PriorityChip({required this.priority});
  final String priority;

  @override
  Widget build(BuildContext context) {
    final visual = _priorityVisual(priority, Theme.of(context).colorScheme);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: visual.color.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        priority,
        style: TextStyle(
          color: visual.color,
          fontSize: 11.5,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.3,
        ),
      ),
    );
  }
}

class _NotificationSummaryCard extends StatelessWidget {
  const _NotificationSummaryCard({
    required this.totalCount,
    required this.unreadCount,
    required this.showUnreadOnly,
    required this.onToggleFilter,
  });

  final int totalCount;
  final int unreadCount;
  final bool showUnreadOnly;
  final ValueChanged<bool> onToggleFilter;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 10),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(24),
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              AppColors.primary.withValues(alpha: 0.2),
              AppColors.secondary.withValues(alpha: 0.2),
            ],
          ),
          boxShadow: [
            BoxShadow(
              color: scheme.primary.withValues(alpha: 0.15),
              blurRadius: 24,
              offset: const Offset(0, 10),
            ),
          ],
        ),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Inbox',
              style: theme.textTheme.titleLarge?.copyWith(
                color: scheme.onSurface,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                _StatBadge(
                  label: 'Unread',
                  value: unreadCount.toString(),
                ),
                const SizedBox(width: 8),
                _StatBadge(
                  label: 'Total',
                  value: totalCount.toString(),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: _FilterPill(
                    label: 'All',
                    selected: !showUnreadOnly,
                    onTap: () => onToggleFilter(false),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _FilterPill(
                    label: 'Unread',
                    selected: showUnreadOnly,
                    onTap: () => onToggleFilter(true),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _StatBadge extends StatelessWidget {
  const _StatBadge({
    required this.label,
    required this.value,
  });

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: scheme.surface.withValues(alpha: 0.72),
        borderRadius: BorderRadius.circular(999),
      ),
      child: RichText(
        text: TextSpan(
          style: theme.textTheme.labelLarge?.copyWith(
            color: scheme.onSurface,
          ),
          children: [
            TextSpan(
              text: value,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
            TextSpan(
              text: ' $label',
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ],
        ),
      ),
    );
  }
}

class _FilterPill extends StatelessWidget {
  const _FilterPill({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 220),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: selected
              ? scheme.primary
              : scheme.surface.withValues(alpha: 0.75),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Center(
          child: Text(
            label,
            style: theme.textTheme.labelLarge?.copyWith(
              color: selected ? scheme.onPrimary : scheme.onSurface,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ),
    );
  }
}

class _LoadingState extends StatelessWidget {
  const _LoadingState();

  @override
  Widget build(BuildContext context) {
    return const Center(child: CircularProgressIndicator());
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.isFiltered});

  final bool isFiltered;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final title = isFiltered ? 'No unread notifications' : 'All caught up';
    final subtitle = isFiltered
        ? 'Switch to "All" to review older updates.'
        : 'You will see new updates from your care team here.';

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                color: scheme.primary.withValues(alpha: 0.14),
                shape: BoxShape.circle,
              ),
              child: Icon(
                isFiltered
                    ? Icons.mark_email_read_rounded
                    : Icons.notifications,
                color: scheme.primary,
                size: 34,
              ),
            ),
            const SizedBox(height: 18),
            Text(
              title,
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              subtitle,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: scheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PriorityVisual {
  const _PriorityVisual({
    required this.color,
    required this.icon,
  });

  final Color color;
  final IconData icon;
}

_PriorityVisual _priorityVisual(String priority, ColorScheme scheme) {
  return switch (priority) {
    'URGENT' => _PriorityVisual(
        color: scheme.error,
        icon: Icons.notification_important_rounded,
      ),
    'HIGH' => _PriorityVisual(
        color: AppColors.warning,
        icon: Icons.priority_high_rounded,
      ),
    'LOW' => _PriorityVisual(
        color: AppColors.success,
        icon: Icons.task_alt_rounded,
      ),
    _ => _PriorityVisual(
        color: scheme.primary,
        icon: Icons.notifications_active_rounded,
      ),
  };
}

String _formatTimeAgo(dynamic raw) {
  final timestamp = raw?.toString();
  if (timestamp == null || timestamp.isEmpty) return 'Unknown time';

  final createdAt = DateTime.tryParse(timestamp)?.toLocal();
  if (createdAt == null) return timestamp;

  final now = DateTime.now();
  final diff = now.difference(createdAt);

  if (diff.inMinutes < 1) return 'Just now';
  if (diff.inHours < 1) return '${diff.inMinutes}m ago';
  if (diff.inDays < 1) return '${diff.inHours}h ago';
  if (diff.inDays < 7) return '${diff.inDays}d ago';

  const months = <String>[
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  final month = months[createdAt.month - 1];
  return '$month ${createdAt.day}, ${createdAt.year}';
}
