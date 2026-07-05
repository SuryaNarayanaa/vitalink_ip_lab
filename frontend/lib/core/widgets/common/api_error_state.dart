import 'package:flutter/material.dart';
import 'package:frontend/app/routers.dart';
import 'package:frontend/core/network/api_client.dart';

class ApiErrorState extends StatelessWidget {
  const ApiErrorState({
    super.key,
    required this.error,
    this.onRetry,
    this.compact = false,
    this.title,
    this.message,
  });

  final Object? error;
  final VoidCallback? onRetry;
  final bool compact;
  final String? title;
  final String? message;

  @override
  Widget build(BuildContext context) {
    final apiError = error is ApiException ? error as ApiException : null;
    final resolvedTitle = title ?? apiError?.title ?? 'Something went wrong';
    final resolvedMessage = message ?? apiError?.message ?? error?.toString() ?? 'Please try again.';
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final visual = _visualFor(apiError?.kind, scheme);
    final statusCode = apiError?.statusCode;
    final retryAfter = apiError?.retryAfter;

    final body = Container(
      width: double.infinity,
      constraints: BoxConstraints(maxWidth: compact ? 420 : 520),
      padding: EdgeInsets.all(compact ? 16 : 20),
      decoration: BoxDecoration(
        color: visual.background,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: visual.border),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(visual.icon, color: visual.foreground, size: compact ? 28 : 36),
          SizedBox(height: compact ? 8 : 12),
          Text(
            resolvedTitle,
            textAlign: TextAlign.center,
            style: textTheme.titleMedium?.copyWith(
              color: scheme.onSurface,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            resolvedMessage,
            textAlign: TextAlign.center,
            style: textTheme.bodyMedium?.copyWith(
              color: scheme.onSurfaceVariant,
              height: 1.35,
            ),
          ),
          if (retryAfter != null) ...[
            const SizedBox(height: 8),
            Text(
              'Try again in ${_formatDuration(retryAfter)}.',
              textAlign: TextAlign.center,
              style: textTheme.labelMedium?.copyWith(
                color: scheme.onSurfaceVariant,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
          if (statusCode != null) ...[
            const SizedBox(height: 10),
            _StatusPill(label: 'Status $statusCode'),
          ],
          if (apiError?.isDeprecatedApi == true && apiError?.sunset != null) ...[
            const SizedBox(height: 8),
            _StatusPill(label: 'Supported until ${apiError!.sunset}'),
          ],
          if (onRetry != null || apiError?.shouldReturnToLogin == true) ...[
            SizedBox(height: compact ? 12 : 16),
            FilledButton.icon(
              onPressed: () {
                if (apiError?.shouldReturnToLogin == true) {
                  Navigator.of(context).pushNamedAndRemoveUntil(
                    AppRoutes.login,
                    (_) => false,
                  );
                  return;
                }
                onRetry?.call();
              },
              icon: Icon(apiError?.shouldReturnToLogin == true
                  ? Icons.login_rounded
                  : Icons.refresh_rounded),
              label: Text(apiError?.actionLabel ?? 'Retry'),
            ),
          ],
        ],
      ),
    );

    if (compact) return body;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: body,
      ),
    );
  }

  _ErrorVisual _visualFor(ApiErrorKind? kind, ColorScheme scheme) {
    switch (kind) {
      case ApiErrorKind.locked:
      case ApiErrorKind.unauthorized:
      case ApiErrorKind.forbidden:
        return _ErrorVisual(
          icon: Icons.lock_outline_rounded,
          foreground: scheme.error,
          background: scheme.errorContainer.withValues(alpha: 0.5),
          border: scheme.error.withValues(alpha: 0.35),
        );
      case ApiErrorKind.rateLimited:
      case ApiErrorKind.timeout:
        return _ErrorVisual(
          icon: Icons.hourglass_empty_rounded,
          foreground: Colors.amber.shade800,
          background: Colors.amber.shade50,
          border: Colors.amber.shade200,
        );
      case ApiErrorKind.notFound:
      case ApiErrorKind.deprecatedApi:
        return _ErrorVisual(
          icon: Icons.api_rounded,
          foreground: scheme.primary,
          background: scheme.primaryContainer.withValues(alpha: 0.45),
          border: scheme.primary.withValues(alpha: 0.28),
        );
      case ApiErrorKind.requestTooLarge:
        return _ErrorVisual(
          icon: Icons.upload_file_rounded,
          foreground: Colors.deepOrange.shade700,
          background: Colors.deepOrange.shade50,
          border: Colors.deepOrange.shade200,
        );
      case ApiErrorKind.network:
      case ApiErrorKind.server:
      case ApiErrorKind.badRequest:
      case ApiErrorKind.malformedResponse:
      case ApiErrorKind.unknown:
      case null:
        return _ErrorVisual(
          icon: Icons.error_outline_rounded,
          foreground: scheme.error,
          background: scheme.errorContainer.withValues(alpha: 0.45),
          border: scheme.error.withValues(alpha: 0.3),
        );
    }
  }

  String _formatDuration(Duration value) {
    if (value.inMinutes >= 1) {
      return '${value.inMinutes} minute${value.inMinutes == 1 ? '' : 's'}';
    }
    return '${value.inSeconds} second${value.inSeconds == 1 ? '' : 's'}';
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: scheme.surface.withValues(alpha: 0.75),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelMedium?.copyWith(
              color: scheme.onSurfaceVariant,
              fontWeight: FontWeight.w700,
            ),
      ),
    );
  }
}

class _ErrorVisual {
  const _ErrorVisual({
    required this.icon,
    required this.foreground,
    required this.background,
    required this.border,
  });

  final IconData icon;
  final Color foreground;
  final Color background;
  final Color border;
}
