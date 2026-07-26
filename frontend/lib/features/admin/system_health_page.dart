import 'dart:async';

import 'package:flutter/material.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/core/widgets/admin/admin_access_gate.dart';
import 'package:frontend/features/admin/admin_capabilities.dart';
import 'package:frontend/features/admin/admin_console_components.dart';
import 'package:frontend/features/admin/data/admin_repository.dart';
import 'package:frontend/features/admin/models/admin_access_model.dart';
import 'package:frontend/features/admin/models/admin_stats_model.dart';

class PlatformHealthPage extends StatefulWidget {
  const PlatformHealthPage({super.key, this.repository});

  final AdminRepository? repository;

  @override
  State<PlatformHealthPage> createState() => _PlatformHealthPageState();
}

class _PlatformHealthPageState extends State<PlatformHealthPage> {
  late final AdminRepository _repository =
      widget.repository ?? AppDependencies.adminRepository;
  SystemHealthModel? _health;
  bool _isLoading = false;
  bool _hasLoaded = false;
  Object? _error;
  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    if (_isLoading) return;
    setState(() => _isLoading = true);
    try {
      final health = await _repository.getSystemHealth();
      if (!mounted) return;
      setState(() {
        _health = health;
        _error = null;
        _hasLoaded = true;
      });
      _timer ??= Timer.periodic(const Duration(seconds: 30), (_) => _load());
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _hasLoaded = true;
      });
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AdminAccessGate(
      anyCapabilities: const [AdminCapabilities.platformSystemHealthRead],
      roles: const {AdminRole.appAdmin, AdminRole.auditor},
      scope: AdminScope.global,
      deniedMessage:
          'Platform health is available only to an Application Admin or a configured read-only System Auditor.',
      builder: (context) {
        if (!_hasLoaded && !_isLoading) {
          WidgetsBinding.instance.addPostFrameCallback((_) => _load());
        }
        final body = ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Platform Health',
                        style: Theme.of(context).textTheme.headlineSmall,
                      ),
                      const Text(
                        'Global service and dependency status. Sensitive connection details are not displayed.',
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: _isLoading ? null : _load,
                  tooltip: 'Refresh platform health',
                  icon: const Icon(Icons.refresh_rounded),
                ),
              ],
            ),
            const SizedBox(height: 16),
            if (_isLoading && !_hasLoaded)
              const Center(child: CircularProgressIndicator())
            else
              SystemHealthSection(
                health: _health,
                healthUnavailable: _error != null,
              ),
          ],
        );
        return adminPageScaffold(context, 'Platform Health', body);
      },
    );
  }
}

class HospitalOperationsHealthPage extends StatefulWidget {
  const HospitalOperationsHealthPage({super.key, this.repository});

  final AdminRepository? repository;

  @override
  State<HospitalOperationsHealthPage> createState() =>
      _HospitalOperationsHealthPageState();
}

class _HospitalOperationsHealthPageState
    extends State<HospitalOperationsHealthPage> {
  late final AdminRepository _repository =
      widget.repository ?? AppDependencies.adminRepository;
  Map<String, dynamic>? _health;
  bool _isLoading = false;
  bool _hasLoaded = false;
  Object? _error;
  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    if (_isLoading) return;
    setState(() => _isLoading = true);
    try {
      final health = await _repository.getReminderDeliveryHealth();
      if (!mounted) return;
      setState(() {
        _health = health;
        _error = null;
        _hasLoaded = true;
      });
      _timer ??= Timer.periodic(const Duration(seconds: 30), (_) => _load());
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _hasLoaded = true;
      });
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AdminAccessGate(
      anyCapabilities: const [AdminCapabilities.tenantOperationsHealthRead],
      roles: const {AdminRole.hospitalAdmin},
      scope: AdminScope.tenant,
      deniedMessage:
          'Hospital operations health is available only to a Hospital Admin with reminder and delivery health access.',
      builder: (context) {
        if (!_hasLoaded && !_isLoading) {
          WidgetsBinding.instance.addPostFrameCallback((_) => _load());
        }
        final data = _health ?? const <String, dynamic>{};
        final statuses = data['deliveriesByStatus'] is Map
            ? Map<String, dynamic>.from(data['deliveriesByStatus'] as Map)
            : const <String, dynamic>{};
        final body = ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Hospital Operations Health',
                        style: Theme.of(context).textTheme.headlineSmall,
                      ),
                      const Text(
                        'Reminder and delivery status for your assigned hospital only.',
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: _isLoading ? null : _load,
                  tooltip: 'Refresh hospital operations health',
                  icon: const Icon(Icons.refresh_rounded),
                ),
              ],
            ),
            const SizedBox(height: 16),
            if (_isLoading && !_hasLoaded)
              const Center(child: CircularProgressIndicator())
            else if (_error != null && _health == null)
              _HealthLoadError(error: _error!, onRetry: _load)
            else
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(18),
                  child: Wrap(
                    spacing: 16,
                    runSpacing: 16,
                    children: [
                      _HealthMetric(
                        'Reminders (24h)',
                        '${data['remindersLast24Hours'] ?? 0}',
                        Icons.notifications_active_outlined,
                        Theme.of(context).colorScheme.primary,
                      ),
                      _HealthMetric(
                        'Delivered',
                        '${statuses['SUCCEEDED'] ?? 0}',
                        Icons.check_circle_outline,
                        Colors.green,
                      ),
                      _HealthMetric(
                        'Needs attention',
                        '${data['overdueDeliveries'] ?? 0}',
                        Icons.warning_amber_rounded,
                        Theme.of(context).colorScheme.error,
                      ),
                    ],
                  ),
                ),
              ),
          ],
        );
        return adminPageScaffold(context, 'Hospital Operations Health', body);
      },
    );
  }
}

class _HealthLoadError extends StatelessWidget {
  const _HealthLoadError({required this.error, required this.onRetry});

  final Object error;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final message = error is ApiException
        ? (error as ApiException).message
        : 'Hospital operations health could not be loaded.';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          children: [
            Text(message),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Try again'),
            ),
          ],
        ),
      ),
    );
  }
}

class SystemHealthSection extends StatelessWidget {
  const SystemHealthSection({
    super.key,
    required this.health,
    required this.healthUnavailable,
  });

  final SystemHealthModel? health;
  final bool healthUnavailable;

  String _formatUptime(double seconds) {
    final hours = (seconds / 3600).floor();
    final minutes = ((seconds % 3600) / 60).floor();
    if (hours > 24) {
      final days = (hours / 24).floor();
      return '${days}d ${hours % 24}h';
    }
    return '${hours}h ${minutes}m';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final h = health;
    final isHealthy = h?.status == 'healthy';

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Icon(Icons.monitor_heart, color: theme.colorScheme.primary),
                    const SizedBox(width: 8),
                    Text('System Health', style: theme.textTheme.titleLarge),
                  ],
                ),
                Chip(
                  label: Text(
                    h != null
                        ? (isHealthy ? 'Healthy' : 'Issues')
                        : (healthUnavailable ? 'Unavailable' : 'Loading...'),
                  ),
                  backgroundColor: h == null
                      ? Colors.grey.withValues(alpha: 0.1)
                      : (isHealthy
                            ? Colors.green.withValues(alpha: 0.1)
                            : Colors.red.withValues(alpha: 0.1)),
                ),
              ],
            ),
            const SizedBox(height: 16),
            if (h != null)
              Wrap(
                spacing: 16,
                runSpacing: 16,
                children: [
                  _HealthMetric(
                    'Database',
                    h.database.status.toUpperCase(),
                    Icons.check_circle,
                    isHealthy ? Colors.green : Colors.red,
                  ),
                  _HealthMetric(
                    'Uptime',
                    _formatUptime(h.uptime),
                    Icons.access_time,
                    Colors.blue,
                  ),
                ],
              )
            else if (healthUnavailable)
              const Text(
                'System health is unavailable or restricted for this account.',
              ),
          ],
        ),
      ),
    );
  }
}

class _HealthMetric extends StatelessWidget {
  final String label, value;
  final IconData icon;
  final Color color;
  const _HealthMetric(this.label, this.value, this.icon, this.color);

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 150,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: color),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: color,
                    fontWeight: FontWeight.bold,
                    fontSize: 12,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            value,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
        ],
      ),
    );
  }
}
