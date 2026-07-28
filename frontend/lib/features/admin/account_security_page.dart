import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/core/widgets/admin/admin_access_gate.dart';
import 'package:frontend/features/admin/admin_console_components.dart';
import 'package:frontend/features/admin/data/admin_repository.dart';
import 'package:frontend/features/admin/models/admin_mfa_model.dart';
import 'package:qr_flutter/qr_flutter.dart';

class AccountSecurityPage extends StatefulWidget {
  const AccountSecurityPage({super.key, this.repository});

  final AdminRepository? repository;

  @override
  State<AccountSecurityPage> createState() => _AccountSecurityPageState();
}

class _AccountSecurityPageState extends State<AccountSecurityPage> {
  late final AdminRepository _repository =
      widget.repository ?? AppDependencies.adminRepository;
  final _formKey = GlobalKey<FormState>();
  final _codeController = TextEditingController();
  AdminTotpEnrollment? _enrollment;
  AdminTotpStatus? _status;
  bool _isLoading = false;
  bool _isStarting = false;
  bool _isActivating = false;
  bool _hasLoaded = false;

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _loadStatus() async {
    if (_isLoading) return;
    setState(() => _isLoading = true);
    try {
      final status = await _repository.getAdminTotpStatus();
      if (!mounted) return;
      setState(() {
        _status = status;
        if (status.isEnabled) {
          _enrollment = null;
          _codeController.clear();
        }
        _hasLoaded = true;
      });
    } catch (error) {
      if (mounted) _showError(error, 'Could not load your MFA status.');
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _hasLoaded = true;
        });
      }
    }
  }

  Future<void> _startSetup() async {
    setState(() => _isStarting = true);
    try {
      final enrollment = await _repository.setupAdminTotp();
      if (!mounted) return;
      setState(() {
        _enrollment = enrollment;
        _codeController.clear();
        _status = AdminTotpStatus(
          factorType: enrollment.factorType,
          status: 'PENDING',
          enabled: false,
        );
      });
    } catch (error) {
      if (mounted) _showError(error, 'Could not start authenticator setup.');
    } finally {
      if (mounted) setState(() => _isStarting = false);
    }
  }

  Future<void> _activate() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _isActivating = true);
    try {
      final activation = await _repository.activateAdminTotp(
        _codeController.text.trim(),
      );
      if (!mounted) return;
      setState(() {
        _enrollment = null;
        _codeController.clear();
        _status = AdminTotpStatus(
          factorType: activation.factorType,
          status: activation.status,
          enabled: activation.isEnabled,
          activatedAt: DateTime.now(),
        );
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Authenticator MFA enabled.')),
      );
    } catch (error) {
      if (mounted) _showError(error, 'Could not activate authenticator MFA.');
    } finally {
      if (mounted) setState(() => _isActivating = false);
    }
  }

  Future<void> _copy(String label, String value) async {
    if (value.trim().isEmpty) return;
    await Clipboard.setData(ClipboardData(text: value));
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('$label copied.')));
  }

  void _showError(Object error, String fallback) {
    final message = error is ApiException ? error.message : fallback;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    return AdminAccessGate(
      builder: (context) {
        if (!_hasLoaded && !_isLoading) {
          WidgetsBinding.instance.addPostFrameCallback((_) => _loadStatus());
        }
        final content = ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const AdminPageHeader(
              title: 'Personal Security',
              subtitle:
                  'This authenticator belongs to your own administrator account. It is separate from platform configuration and health access.',
            ),
            const SizedBox(height: 16),
            if (_isLoading && !_hasLoaded)
              const Center(child: CircularProgressIndicator())
            else
              AccountSecurityMfaSection(
                formKey: _formKey,
                codeController: _codeController,
                enrollment: _enrollment,
                status: _status,
                isStartingTotp: _isStarting,
                isActivatingTotp: _isActivating,
                onStartSetup: _startSetup,
                onActivate: _activate,
                onCancelSetup: () => setState(() {
                  _enrollment = null;
                  _codeController.clear();
                }),
                onCopySetupValue: _copy,
              ),
          ],
        );
        return adminPageScaffold(context, 'Personal Security', content);
      },
    );
  }
}

class AccountSecurityMfaSection extends StatelessWidget {
  const AccountSecurityMfaSection({
    super.key,
    required this.formKey,
    required this.codeController,
    required this.enrollment,
    required this.status,
    required this.isStartingTotp,
    required this.isActivatingTotp,
    required this.onStartSetup,
    required this.onActivate,
    required this.onCancelSetup,
    required this.onCopySetupValue,
  });

  final GlobalKey<FormState> formKey;
  final TextEditingController codeController;
  final AdminTotpEnrollment? enrollment;
  final AdminTotpStatus? status;
  final bool isStartingTotp;
  final bool isActivatingTotp;
  final VoidCallback onStartSetup;
  final VoidCallback onActivate;
  final VoidCallback onCancelSetup;
  final Future<void> Function(String label, String value) onCopySetupValue;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final currentEnrollment = enrollment;
    final hasPendingSetup = currentEnrollment != null;
    final isEnabled = status?.isEnabled ?? false;
    final statusLabel = isEnabled
        ? 'Enabled'
        : hasPendingSetup || (status?.isPending ?? false)
        ? 'Setup pending'
        : 'Not set up';
    final statusColor = isEnabled
        ? Colors.green
        : hasPendingSetup || (status?.isPending ?? false)
        ? Colors.orange
        : theme.colorScheme.outline;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Form(
          key: formKey,
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
                  onPressed: isStartingTotp ? null : onStartSetup,
                  icon: isStartingTotp
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
                      border: Border.all(
                        color: theme.colorScheme.outlineVariant,
                      ),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: QrImageView(
                      data: currentEnrollment.otpauthUrl,
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
                  value: currentEnrollment.secret,
                  onCopy: () =>
                      onCopySetupValue('Setup key', currentEnrollment.secret),
                ),
                const SizedBox(height: 10),
                _SetupValueTile(
                  label: 'otpauth URL',
                  value: currentEnrollment.otpauthUrl,
                  onCopy: () => onCopySetupValue(
                    'otpauth URL',
                    currentEnrollment.otpauthUrl,
                  ),
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: codeController,
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
                        onPressed: isActivatingTotp ? null : onActivate,
                        icon: isActivatingTotp
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
                        onPressed: isActivatingTotp ? null : onCancelSetup,
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
