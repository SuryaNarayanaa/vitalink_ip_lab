import 'package:flutter/material.dart';
import 'package:frontend/core/widgets/admin/admin_access_scope.dart';
import 'package:frontend/features/admin/models/admin_access_model.dart';

class AdminAccessGate extends StatelessWidget {
  const AdminAccessGate({
    super.key,
    required this.builder,
    this.anyCapabilities = const <String>[],
    this.roles = const <AdminRole>{},
    this.scope,
    this.deniedTitle,
    this.deniedMessage,
  });

  final WidgetBuilder builder;
  final List<String> anyCapabilities;
  final Set<AdminRole> roles;
  final AdminScope? scope;
  final String? deniedTitle;
  final String? deniedMessage;

  @override
  Widget build(BuildContext context) {
    final controller = AdminAccessScope.maybeOf(context);
    if (controller == null) {
      return AccessDeniedState(
        title: deniedTitle ?? 'Administrator access unavailable',
        message:
            deniedMessage ??
            'This page must be opened from the administrator portal. Sign in again or contact an Application Admin if the problem continues.',
      );
    }

    final access = controller.access;
    if (access == null) {
      if (controller.isLoading || !controller.hasLoaded) {
        return Center(
          child: Semantics(
            label: 'Loading administrator permissions',
            child: CircularProgressIndicator(),
          ),
        );
      }
      return AccessDeniedState(
        title: 'Could not verify administrator access',
        message:
            'VitaLink could not load your current permissions. Check your connection and try again. No administrative data was loaded.',
        actionLabel: 'Try again',
        onAction: controller.refresh,
      );
    }

    final capabilityAllowed =
        anyCapabilities.isEmpty || access.canAny(anyCapabilities);
    final roleAllowed = roles.isEmpty || roles.contains(access.role);
    final scopeAllowed = scope == null || access.scope == scope;
    if (!capabilityAllowed || !roleAllowed || !scopeAllowed) {
      return AccessDeniedState(
        title: deniedTitle ?? 'You do not have access to this page',
        message:
            deniedMessage ??
            'Your current administrator policy does not include this page. Ask an Application Admin to review your role policy if you need access.',
      );
    }

    return builder(context);
  }
}

class AccessDeniedState extends StatelessWidget {
  const AccessDeniedState({
    super.key,
    this.title = 'Access not available',
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  final String title;
  final String message;
  final String? actionLabel;
  final Future<void> Function()? onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Semantics(
          container: true,
          label: '$title. $message',
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.lock_outline_rounded,
                      size: 48,
                      color: theme.colorScheme.error,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      title,
                      textAlign: TextAlign.center,
                      style: theme.textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      message,
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    if (actionLabel != null && onAction != null) ...[
                      const SizedBox(height: 20),
                      FilledButton.icon(
                        onPressed: () => onAction!(),
                        icon: const Icon(Icons.refresh_rounded),
                        label: Text(actionLabel!),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class AdminReadOnlyBanner extends StatelessWidget {
  const AdminReadOnlyBanner({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      container: true,
      label:
          'System Auditor read-only mode. You can review permitted information but cannot make changes.',
      child: Material(
        color: theme.colorScheme.secondaryContainer,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Row(
            children: [
              Icon(
                Icons.visibility_outlined,
                color: theme.colorScheme.onSecondaryContainer,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'System Auditor read-only mode: you can review permitted information, but all changes are disabled.',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSecondaryContainer,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
