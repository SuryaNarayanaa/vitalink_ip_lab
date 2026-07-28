import 'package:flutter/material.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/core/widgets/admin/admin_access_gate.dart';
import 'package:frontend/core/widgets/admin/admin_access_scope.dart';
import 'package:frontend/features/admin/admin_capabilities.dart';
import 'package:frontend/features/admin/admin_console_components.dart';
import 'package:frontend/features/admin/data/admin_repository.dart';
import 'package:frontend/features/admin/models/admin_access_model.dart';

class PlatformConfigurationPage extends StatefulWidget {
  const PlatformConfigurationPage({super.key, this.repository});

  final AdminRepository? repository;

  @override
  State<PlatformConfigurationPage> createState() =>
      _PlatformConfigurationPageState();
}

class _PlatformConfigurationPageState extends State<PlatformConfigurationPage> {
  late final AdminRepository _repository =
      widget.repository ?? AppDependencies.adminRepository;
  final _formKey = GlobalKey<FormState>();
  final _inrLowController = TextEditingController();
  final _inrHighController = TextEditingController();
  final _sessionTimeoutController = TextEditingController();
  final _maxRequestsController = TextEditingController();
  final _windowDurationController = TextEditingController();
  Map<String, bool> _featureFlags = const {};
  bool _isLoading = false;
  bool _hasLoaded = false;
  bool _hasUnsavedChanges = false;
  Object? _error;

  @override
  void dispose() {
    _inrLowController.dispose();
    _inrHighController.dispose();
    _sessionTimeoutController.dispose();
    _maxRequestsController.dispose();
    _windowDurationController.dispose();
    super.dispose();
  }

  Future<void> _load({bool discardDraft = false}) async {
    if (_isLoading) return;
    if (_hasUnsavedChanges && !discardDraft) {
      final discard = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Discard unsaved changes?'),
          content: const Text(
            'Reloading replaces your local platform configuration draft.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Keep editing'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Discard and reload'),
            ),
          ],
        ),
      );
      if (discard != true || !mounted) return;
    }
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final config = await _repository.getSystemConfig();
      final thresholds =
          config['inr_thresholds'] ?? config['medical_thresholds'] ?? const {};
      final rateLimit =
          config['rate_limiting'] ?? config['rate_limit'] ?? const {};
      if (!mounted) return;
      setState(() {
        _inrLowController.text =
            '${thresholds['critical_low'] ?? thresholds['inr_critical_low'] ?? 1.5}';
        _inrHighController.text =
            '${thresholds['critical_high'] ?? thresholds['inr_critical_high'] ?? 4.5}';
        _sessionTimeoutController.text =
            '${config['session_timeout_minutes'] ?? 30}';
        _maxRequestsController.text = '${rateLimit['max_requests'] ?? 100}';
        _windowDurationController.text = '${rateLimit['window_minutes'] ?? 15}';
        final rawFlags = config['feature_flags'];
        _featureFlags = rawFlags is Map
            ? rawFlags.map(
                (key, value) => MapEntry(key.toString(), value == true),
              )
            : {
                'maintenance_mode': false,
                'patient_registration_enabled': true,
                'notifications_enabled': true,
              };
        _hasLoaded = true;
        _hasUnsavedChanges = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        // Do not flip hasLoaded on first failure — that would render the empty
        // form defaults as if they were server state.
      });
      if (_hasLoaded && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              error is ApiException
                  ? error.message
                  : 'Could not refresh platform configuration.',
            ),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _save() async {
    final formState = _formKey.currentState;
    if (formState == null || !formState.validate()) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Save platform configuration?'),
        content: const Text(
          'These global settings take effect across VitaLink. Personal MFA and health information are not changed.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Save configuration'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _isLoading = true);
    try {
      await _repository.updateSystemConfig({
        'inr_thresholds': {
          'critical_low': double.parse(_inrLowController.text),
          'critical_high': double.parse(_inrHighController.text),
        },
        'session_timeout_minutes': int.parse(_sessionTimeoutController.text),
        'rate_limit': {
          'max_requests': int.parse(_maxRequestsController.text),
          'window_minutes': int.parse(_windowDurationController.text),
        },
        'feature_flags': _featureFlags,
      });
      if (!mounted) return;
      setState(() => _hasUnsavedChanges = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Platform configuration saved.')),
      );
    } catch (error) {
      if (mounted) {
        final message = error is ApiException
            ? error.message
            : 'The platform configuration could not be saved.';
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(message)));
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _markChanged(String _) {
    if (!_hasUnsavedChanges) setState(() => _hasUnsavedChanges = true);
  }

  @override
  Widget build(BuildContext context) {
    return AdminAccessGate(
      anyCapabilities: const [AdminCapabilities.platformSystemConfigRead],
      roles: const {AdminRole.appAdmin},
      scope: AdminScope.global,
      deniedMessage:
          'Global runtime configuration is available only to an Application Admin with platform configuration access.',
      builder: (context) {
        if (!_hasLoaded && !_isLoading) {
          WidgetsBinding.instance.addPostFrameCallback(
            (_) => _load(discardDraft: true),
          );
        }
        final canManage = AdminAccessScope.can(
          context,
          AdminCapabilities.platformSystemConfigManage,
        );
        final content = Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              AdminPageHeader(
                title: 'Platform Configuration',
                subtitle:
                    'Global runtime settings. Personal MFA and service health are separate surfaces.',
                actions: [
                  IconButton(
                    onPressed: _isLoading ? null : _load,
                    tooltip: 'Reload platform configuration',
                    icon: const Icon(Icons.refresh_rounded),
                  ),
                  if (canManage)
                    FilledButton.icon(
                      key: const Key('save-platform-configuration'),
                      onPressed: _isLoading || !_hasUnsavedChanges
                          ? null
                          : _save,
                      icon: const Icon(Icons.save_outlined),
                      label: const Text('Save'),
                    ),
                ],
              ),
              const SizedBox(height: 16),
              ..._buildBodyChildren(canManage),
              const SizedBox(height: 48),
            ],
          ),
        );
        return adminPageScaffold(context, 'Platform Configuration', content);
      },
    );
  }

  List<Widget> _buildBodyChildren(bool canManage) {
    if (_isLoading && !_hasLoaded) {
      return const [
        SizedBox(
          height: 160,
          child: Center(child: CircularProgressIndicator()),
        ),
      ];
    }
    if (_error != null && !_hasLoaded) {
      return [
        Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('Could not load platform configuration.'),
                const SizedBox(height: 12),
                FilledButton.icon(
                  onPressed: _isLoading
                      ? null
                      : () => _load(discardDraft: true),
                  icon: const Icon(Icons.refresh_rounded),
                  label: const Text('Try again'),
                ),
              ],
            ),
          ),
        ),
      ];
    }
    return [
      if (!canManage)
        const Card(
          child: Padding(
            padding: EdgeInsets.all(14),
            child: Text(
              'Read-only configuration access. Change controls are hidden.',
            ),
          ),
        ),
      if (!canManage) const SizedBox(height: 12),
      if (_hasUnsavedChanges)
        const Padding(
          padding: EdgeInsets.only(bottom: 12),
          child: Text('You have unsaved configuration changes.'),
        ),
      PlatformConfigurationSection(
        inrLowController: _inrLowController,
        inrHighController: _inrHighController,
        sessionTimeoutController: _sessionTimeoutController,
        maxRequestsController: _maxRequestsController,
        windowDurationController: _windowDurationController,
        featureFlags: _featureFlags,
        readOnly: !canManage,
        onFieldChanged: _markChanged,
        onFeatureFlagChanged: (key, value) => setState(() {
          _featureFlags = {..._featureFlags, key: value};
          _hasUnsavedChanges = true;
        }),
      ),
    ];
  }
}

class PlatformConfigurationSection extends StatelessWidget {
  const PlatformConfigurationSection({
    super.key,
    required this.inrLowController,
    required this.inrHighController,
    required this.sessionTimeoutController,
    required this.maxRequestsController,
    required this.windowDurationController,
    required this.featureFlags,
    required this.onFieldChanged,
    required this.onFeatureFlagChanged,
    this.readOnly = false,
  });

  final TextEditingController inrLowController;
  final TextEditingController inrHighController;
  final TextEditingController sessionTimeoutController;
  final TextEditingController maxRequestsController;
  final TextEditingController windowDurationController;
  final Map<String, bool> featureFlags;
  final bool readOnly;
  final ValueChanged<String> onFieldChanged;
  final void Function(String key, bool value) onFeatureFlagChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // INR Thresholds
        _PlatformConfigCard(
          theme,
          'Medical Thresholds',
          Icons.medical_services,
          Row(
            children: [
              Expanded(
                child: TextFormField(
                  controller: inrLowController,
                  enabled: !readOnly,
                  decoration: const InputDecoration(
                    labelText: 'INR Critical Low',
                    suffixText: 'INR',
                  ),
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  onChanged: onFieldChanged,
                  validator: (v) {
                    if (v == null || v.isEmpty) return 'Required';
                    final n = double.tryParse(v);
                    if (n == null || n < 0.5 || n > 10) {
                      return '0.5-10.0';
                    }
                    final high = double.tryParse(inrHighController.text);
                    if (high != null && n >= high) {
                      return 'Must be below critical high';
                    }
                    return null;
                  },
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: TextFormField(
                  controller: inrHighController,
                  enabled: !readOnly,
                  decoration: const InputDecoration(
                    labelText: 'INR Critical High',
                    suffixText: 'INR',
                  ),
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  onChanged: onFieldChanged,
                  validator: (v) {
                    if (v == null || v.isEmpty) return 'Required';
                    final n = double.tryParse(v);
                    if (n == null || n < 0.5 || n > 10) {
                      return '0.5-10.0';
                    }
                    final low = double.tryParse(inrLowController.text);
                    if (low != null && n <= low) {
                      return 'Must be above critical low';
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
        _PlatformConfigCard(
          theme,
          'Session Settings',
          Icons.timer,
          TextFormField(
            controller: sessionTimeoutController,
            enabled: !readOnly,
            decoration: const InputDecoration(
              labelText: 'Session Timeout',
              suffixText: 'min',
            ),
            keyboardType: TextInputType.number,
            onChanged: onFieldChanged,
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
        _PlatformConfigCard(
          theme,
          'Rate Limiting',
          Icons.speed,
          Row(
            children: [
              Expanded(
                child: TextFormField(
                  controller: maxRequestsController,
                  enabled: !readOnly,
                  decoration: const InputDecoration(labelText: 'Max Requests'),
                  keyboardType: TextInputType.number,
                  onChanged: onFieldChanged,
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
                  controller: windowDurationController,
                  enabled: !readOnly,
                  decoration: const InputDecoration(
                    labelText: 'Window Duration',
                    suffixText: 'min',
                  ),
                  keyboardType: TextInputType.number,
                  onChanged: onFieldChanged,
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
        _PlatformConfigCard(
          theme,
          'Feature Flags',
          Icons.flag,
          Column(
            children: featureFlags.entries
                .map(
                  (e) => SwitchListTile(
                    title: Text(e.key.replaceAll('_', ' ').toUpperCase()),
                    value: e.value,
                    onChanged: readOnly
                        ? null
                        : (v) => onFeatureFlagChanged(e.key, v),
                  ),
                )
                .toList(),
          ),
        ),
      ],
    );
  }
}

class _PlatformConfigCard extends StatelessWidget {
  const _PlatformConfigCard(this.theme, this.title, this.icon, this.content);

  final ThemeData theme;
  final String title;
  final IconData icon;
  final Widget content;

  @override
  Widget build(BuildContext context) {
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
}
