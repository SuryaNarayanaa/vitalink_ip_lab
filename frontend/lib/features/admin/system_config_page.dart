import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/widgets/admin/admin_scaffold.dart';
import 'package:frontend/features/admin/data/admin_repository.dart';
import 'package:frontend/features/admin/models/admin_mfa_model.dart';
import 'package:frontend/features/admin/models/admin_stats_model.dart';

class SystemConfigPage extends StatefulWidget {
  const SystemConfigPage({super.key});

  @override
  State<SystemConfigPage> createState() => _SystemConfigPageState();
}

class _SystemConfigPageState extends State<SystemConfigPage> {
  final AdminRepository _repo = AppDependencies.adminRepository;
  final _formKey = GlobalKey<FormState>();
  bool _isLoading = true;
  bool _hasUnsavedChanges = false;
  Timer? _healthTimer;

  // Controllers
  final _inrLowCtrl = TextEditingController();
  final _inrHighCtrl = TextEditingController();
  final _sessionTimeoutCtrl = TextEditingController();
  final _maxRequestsCtrl = TextEditingController();
  final _windowDurationCtrl = TextEditingController();
  final _totpCodeCtrl = TextEditingController();
  final _mfaFormKey = GlobalKey<FormState>();
  AdminTotpEnrollment? _totpEnrollment;
  AdminTotpStatus? _totpStatus;
  bool _isStartingTotp = false;
  bool _isActivatingTotp = false;

  Map<String, bool> _featureFlags = {
    'enable_notifications': true,
    'enable_pdf_export': true,
    'enable_patient_self_registration': false,
  };

  SystemHealthModel? _health;
  bool _healthUnavailable = false;

  @override
  void initState() {
    super.initState();
    _loadConfig();
    _loadTotpStatus();
    _loadHealth();
    _healthTimer = Timer.periodic(
      const Duration(seconds: 30),
      (_) => _loadHealth(),
    );
  }

  @override
  void dispose() {
    _healthTimer?.cancel();
    _inrLowCtrl.dispose();
    _inrHighCtrl.dispose();
    _sessionTimeoutCtrl.dispose();
    _maxRequestsCtrl.dispose();
    _windowDurationCtrl.dispose();
    _totpCodeCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadConfig() async {
    setState(() => _isLoading = true);
    try {
      final config = await _repo.getSystemConfig();
      final thresholds =
          config['inr_thresholds'] ?? config['medical_thresholds'] ?? {};
      _inrLowCtrl.text =
          (thresholds['critical_low'] ?? thresholds['inr_critical_low'] ?? 1.5)
              .toString();
      _inrHighCtrl.text = (thresholds['critical_high'] ??
              thresholds['inr_critical_high'] ??
              4.5)
          .toString();

      final session = config['session_settings'] ?? {};
      _sessionTimeoutCtrl.text = (session['timeout_minutes'] ?? 30).toString();

      final rateLimit = config['rate_limiting'] ?? config['rate_limit'] ?? {};
      _maxRequestsCtrl.text = (rateLimit['max_requests'] ?? 100).toString();
      _windowDurationCtrl.text =
          (rateLimit['window_seconds'] ?? rateLimit['window_ms'] != null
                  ? ((rateLimit['window_ms'] as int) / 1000).round()
                  : 60)
              .toString();

      if (config['feature_flags'] != null) {
        _featureFlags = Map<String, bool>.from(config['feature_flags']);
      }
      setState(() => _hasUnsavedChanges = false);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to load config: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _loadHealth() async {
    try {
      final health = await _repo.getSystemHealth();
      if (mounted) {
        setState(() {
          _health = health;
          _healthUnavailable = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _healthUnavailable = true);
    }
  }

  Future<void> _saveConfig() async {
    if (!_formKey.currentState!.validate()) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Save Configuration?'),
        content: const Text(
          'These changes will affect the entire system immediately. Are you sure?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Save Changes'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    setState(() => _isLoading = true);
    try {
      await _repo.updateSystemConfig({
        'inr_thresholds': {
          'critical_low': double.parse(_inrLowCtrl.text),
          'critical_high': double.parse(_inrHighCtrl.text),
        },
        'session_settings': {
          'timeout_minutes': int.parse(_sessionTimeoutCtrl.text),
        },
        'rate_limit': {
          'max_requests': int.parse(_maxRequestsCtrl.text),
          'window_ms': int.parse(_windowDurationCtrl.text) * 1000,
        },
        'feature_flags': _featureFlags,
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Configuration saved'),
            backgroundColor: Colors.green,
          ),
        );
        setState(() => _hasUnsavedChanges = false);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to save: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _startTotpSetup() async {
    setState(() => _isStartingTotp = true);
    try {
      final enrollment = await _repo.setupAdminTotp();
      if (!mounted) return;
      setState(() {
        _totpEnrollment = enrollment;
        _totpCodeCtrl.clear();
        _totpStatus = AdminTotpStatus(
          factorType: enrollment.factorType,
          status: 'PENDING',
          enabled: false,
        );
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Authenticator setup started')),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to start authenticator setup: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _isStartingTotp = false);
    }
  }

  Future<void> _activateTotp() async {
    if (!_mfaFormKey.currentState!.validate()) return;

    setState(() => _isActivatingTotp = true);
    try {
      final activation = await _repo.activateAdminTotp(
        _totpCodeCtrl.text.trim(),
      );
      if (!mounted) return;
      setState(() {
        _totpEnrollment = null;
        _totpCodeCtrl.clear();
        _totpStatus = AdminTotpStatus(
          factorType: activation.factorType,
          status: activation.status,
          enabled: activation.isEnabled,
          activatedAt: DateTime.now(),
        );
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Authenticator MFA enabled')),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to activate authenticator MFA: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _isActivatingTotp = false);
    }
  }

  Future<void> _copySetupValue(String label, String value) async {
    if (value.trim().isEmpty) return;
    await Clipboard.setData(ClipboardData(text: value));
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('$label copied')));
  }

  Future<void> _loadTotpStatus() async {
    try {
      final status = await _repo.getAdminTotpStatus();
      if (!mounted) return;
      setState(() {
        _totpStatus = status;
        if (status.isEnabled) {
          _totpEnrollment = null;
          _totpCodeCtrl.clear();
        }
      });
    } catch (_) {}
  }

  void _onFieldChanged(String _) {
    if (!_hasUnsavedChanges) setState(() => _hasUnsavedChanges = true);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final showPageScaffold = !AdminScaffold.usesShellAppBar(context);
    final body = _isLoading && !_hasUnsavedChanges
        ? const Center(child: CircularProgressIndicator())
        : Form(
            key: _formKey,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (!showPageScaffold)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: _isLoading ? null : _loadConfig,
                            icon: const Icon(Icons.refresh),
                            label: const Text('Reload'),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: FilledButton.icon(
                            onPressed: _isLoading ? null : _saveConfig,
                            icon: _isLoading
                                ? const SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: Colors.white,
                                    ),
                                  )
                                : const Icon(Icons.save),
                            label: const Text('Save'),
                          ),
                        ),
                      ],
                    ),
                  ),
                if (_hasUnsavedChanges)
                  Container(
                    padding: const EdgeInsets.all(12),
                    margin: const EdgeInsets.only(bottom: 16),
                    decoration: BoxDecoration(
                      color: Colors.orange.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Colors.orange),
                    ),
                    child: const Row(
                      children: [
                        Icon(Icons.warning_amber, color: Colors.orange),
                        SizedBox(width: 8),
                        Text(
                          'You have unsaved changes',
                          style: TextStyle(
                            color: Colors.orange,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                  ),

                // System Health
                _buildHealthSection(theme),
                const SizedBox(height: 16),

                _buildAdminMfaSection(theme),
                const SizedBox(height: 16),

                // INR Thresholds
                _buildCard(
                  theme,
                  'Medical Thresholds',
                  Icons.medical_services,
                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          controller: _inrLowCtrl,
                          decoration: const InputDecoration(
                            labelText: 'INR Critical Low',
                            suffixText: 'INR',
                          ),
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          onChanged: _onFieldChanged,
                          validator: (v) {
                            if (v == null || v.isEmpty) return 'Required';
                            final n = double.tryParse(v);
                            if (n == null || n < 0.5 || n > 10) {
                              return '0.5-10.0';
                            }
                            return null;
                          },
                        ),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: TextFormField(
                          controller: _inrHighCtrl,
                          decoration: const InputDecoration(
                            labelText: 'INR Critical High',
                            suffixText: 'INR',
                          ),
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          onChanged: _onFieldChanged,
                          validator: (v) {
                            if (v == null || v.isEmpty) return 'Required';
                            final n = double.tryParse(v);
                            if (n == null || n < 0.5 || n > 10) {
                              return '0.5-10.0';
                            }
                            return null;
                          },
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),

                // Session Settings
                _buildCard(
                  theme,
                  'Session Settings',
                  Icons.timer,
                  TextFormField(
                    controller: _sessionTimeoutCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Session Timeout',
                      suffixText: 'min',
                    ),
                    keyboardType: TextInputType.number,
                    onChanged: _onFieldChanged,
                    validator: (v) {
                      if (v == null || v.isEmpty) return 'Required';
                      final n = int.tryParse(v);
                      if (n == null || n < 1 || n > 1440) return '1-1440';
                      return null;
                    },
                  ),
                ),
                const SizedBox(height: 16),

                // Rate Limiting
                _buildCard(
                  theme,
                  'Rate Limiting',
                  Icons.speed,
                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          controller: _maxRequestsCtrl,
                          decoration: const InputDecoration(
                            labelText: 'Max Requests',
                          ),
                          keyboardType: TextInputType.number,
                          onChanged: _onFieldChanged,
                          validator: (v) {
                            if (v == null || v.isEmpty) return 'Required';
                            final n = int.tryParse(v);
                            if (n == null || n < 1) return '>0';
                            return null;
                          },
                        ),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: TextFormField(
                          controller: _windowDurationCtrl,
                          decoration: const InputDecoration(
                            labelText: 'Window Duration',
                            suffixText: 'sec',
                          ),
                          keyboardType: TextInputType.number,
                          onChanged: _onFieldChanged,
                          validator: (v) {
                            if (v == null || v.isEmpty) return 'Required';
                            final n = int.tryParse(v);
                            if (n == null || n < 1) return '>0';
                            return null;
                          },
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),

                // Feature Flags
                _buildCard(
                  theme,
                  'Feature Flags',
                  Icons.flag,
                  Column(
                    children: _featureFlags.entries
                        .map(
                          (e) => SwitchListTile(
                            title: Text(
                              e.key.replaceAll('_', ' ').toUpperCase(),
                            ),
                            value: e.value,
                            onChanged: (v) => setState(() {
                              _featureFlags[e.key] = v;
                              _hasUnsavedChanges = true;
                            }),
                          ),
                        )
                        .toList(),
                  ),
                ),
                const SizedBox(height: 64),
              ],
            ),
          );

    if (!showPageScaffold) {
      return body;
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('System Configuration'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _isLoading ? null : _loadConfig,
            tooltip: 'Reload',
          ),
          const SizedBox(width: 8),
          FilledButton.icon(
            onPressed: _isLoading ? null : _saveConfig,
            icon: _isLoading
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Icon(Icons.save),
            label: const Text('Save'),
          ),
          const SizedBox(width: 16),
        ],
      ),
      body: body,
    );
  }

  Widget _buildCard(
    ThemeData theme,
    String title,
    IconData icon,
    Widget content,
  ) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Text(title, style: theme.textTheme.titleLarge),
              ],
            ),
            const SizedBox(height: 16),
            content,
          ],
        ),
      ),
    );
  }

  Widget _buildAdminMfaSection(ThemeData theme) {
    final enrollment = _totpEnrollment;
    final hasPendingSetup = enrollment != null;
    final isEnabled = _totpStatus?.isEnabled ?? false;
    final statusLabel = isEnabled
        ? 'Enabled'
        : hasPendingSetup || (_totpStatus?.isPending ?? false)
            ? 'Setup pending'
            : 'Not set up';
    final statusColor = isEnabled
        ? Colors.green
        : hasPendingSetup || (_totpStatus?.isPending ?? false)
            ? Colors.orange
            : theme.colorScheme.outline;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Form(
          key: _mfaFormKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(
                    Icons.admin_panel_settings,
                    color: theme.colorScheme.primary,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Admin Authenticator MFA',
                      style: theme.textTheme.titleLarge,
                    ),
                  ),
                  Chip(
                    label: Text(statusLabel),
                    backgroundColor: statusColor.withValues(alpha: 0.1),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                'Use an authenticator app for admin login challenges.',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 16),
              if (isEnabled)
                OutlinedButton.icon(
                  onPressed: null,
                  icon: const Icon(Icons.verified_user_rounded),
                  label: const Text('Authenticator MFA is enabled'),
                )
              else if (!hasPendingSetup)
                FilledButton.icon(
                  onPressed: _isStartingTotp ? null : _startTotpSetup,
                  icon: _isStartingTotp
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.qr_code_2_rounded),
                  label: const Text('Start authenticator setup'),
                ),
              if (hasPendingSetup) ...[
                const SizedBox(height: 4),
                Text(
                  'Scan this QR code with your authenticator app.',
                  style: theme.textTheme.titleSmall,
                ),
                const SizedBox(height: 12),
                Center(
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      border: Border.all(color: theme.colorScheme.outlineVariant),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: QrImageView(
                      data: enrollment.otpauthUrl,
                      version: QrVersions.auto,
                      size: 208,
                      backgroundColor: Colors.white,
                      eyeStyle: const QrEyeStyle(
                        eyeShape: QrEyeShape.square,
                        color: Colors.black,
                      ),
                      dataModuleStyle: const QrDataModuleStyle(
                        dataModuleShape: QrDataModuleShape.square,
                        color: Colors.black,
                      ),
                      semanticsLabel: 'Authenticator app setup QR code',
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  'If your app cannot scan a code, use the setup key below instead.',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 12),
                _SetupValueTile(
                  label: 'Setup key',
                  value: enrollment.secret,
                  onCopy: () => _copySetupValue('Setup key', enrollment.secret),
                ),
                const SizedBox(height: 10),
                _SetupValueTile(
                  label: 'otpauth URL',
                  value: enrollment.otpauthUrl,
                  onCopy: () =>
                      _copySetupValue('otpauth URL', enrollment.otpauthUrl),
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _totpCodeCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Authenticator code',
                    prefixIcon: Icon(Icons.pin_outlined),
                  ),
                  keyboardType: TextInputType.number,
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(6),
                  ],
                  validator: (value) {
                    final code = value?.trim() ?? '';
                    if (code.isEmpty) return 'Code is required';
                    if (code.length != 6) return 'Enter 6 digits';
                    return null;
                  },
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: _isActivatingTotp ? null : _activateTotp,
                        icon: _isActivatingTotp
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : const Icon(Icons.verified_user_rounded),
                        label: const Text('Activate'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _isActivatingTotp
                            ? null
                            : () => setState(() {
                                  _totpEnrollment = null;
                                  _totpCodeCtrl.clear();
                                }),
                        icon: const Icon(Icons.close_rounded),
                        label: const Text('Cancel'),
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  String _formatUptime(double seconds) {
    final hours = (seconds / 3600).floor();
    final minutes = ((seconds % 3600) / 60).floor();
    if (hours > 24) {
      final days = (hours / 24).floor();
      return '${days}d ${hours % 24}h';
    }
    return '${hours}h ${minutes}m';
  }

  Widget _buildHealthSection(ThemeData theme) {
    final h = _health;
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
                        : (_healthUnavailable ? 'Unavailable' : 'Loading...'),
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
                  _HealthMetric(
                    'Memory',
                    h.memory.heapUsed,
                    Icons.memory,
                    Colors.orange,
                  ),
                ],
              )
            else if (_healthUnavailable)
              const Text(
                'System health is unavailable or restricted for this account.',
              ),
          ],
        ),
      ),
    );
  }
}

class _SetupValueTile extends StatelessWidget {
  const _SetupValueTile({
    required this.label,
    required this.value,
    required this.onCopy,
  });

  final String label;
  final String value;
  final VoidCallback onCopy;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: theme.colorScheme.outlineVariant),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 4),
                SelectableText(
                  value,
                  maxLines: 2,
                  style: theme.textTheme.bodySmall?.copyWith(
                    fontFamily: 'monospace',
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: onCopy,
            icon: const Icon(Icons.copy_rounded),
            tooltip: 'Copy',
          ),
        ],
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
              Text(
                label,
                style: TextStyle(
                  color: color,
                  fontWeight: FontWeight.bold,
                  fontSize: 12,
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
