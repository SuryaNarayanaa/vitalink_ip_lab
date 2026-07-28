import 'package:flutter/material.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/core/widgets/admin/admin_access_gate.dart';
import 'package:frontend/core/widgets/admin/admin_access_scope.dart';
import 'package:frontend/features/admin/admin_capabilities.dart';
import 'package:frontend/features/admin/admin_console_components.dart';
import 'package:frontend/features/admin/data/admin_repository.dart';
import 'package:frontend/features/admin/models/admin_access_model.dart';
import 'package:frontend/features/admin/models/admin_account_model.dart';
import 'package:qr_flutter/qr_flutter.dart';

class AdminAccountsPage extends StatefulWidget {
  const AdminAccountsPage({super.key, this.repository});

  final AdminRepository? repository;

  @override
  State<AdminAccountsPage> createState() => _AdminAccountsPageState();
}

class _AdminAccountsPageState extends State<AdminAccountsPage> {
  late final AdminRepository _repository =
      widget.repository ?? AppDependencies.adminRepository;
  final _searchController = TextEditingController();
  List<AdminAccountModel> _accounts = const [];
  Object? _error;
  bool _isLoading = false;
  bool _hasLoaded = false;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (_isLoading) return;
    setState(() {
      _isLoading = true;
      if (!silent) _error = null;
    });
    try {
      final accounts = await _repository.getAdminAccounts();
      if (!mounted) return;
      setState(() {
        _accounts = accounts;
        _error = null;
        _hasLoaded = true;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        // Still mark loaded so the error panel (not an empty list) is rendered,
        // and so build() does not schedule infinite auto-retries.
        _hasLoaded = true;
      });
      if (silent && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              error is ApiException
                  ? error.message
                  : 'Could not refresh administrator accounts.',
            ),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AdminAccessGate(
      anyCapabilities: const [AdminCapabilities.platformAdminAccountsRead],
      roles: const {AdminRole.appAdmin},
      scope: AdminScope.global,
      deniedMessage:
          'Only an Application Admin can manage Hospital Admin and System Auditor accounts.',
      builder: (context) {
        if (!_hasLoaded && !_isLoading) {
          WidgetsBinding.instance.addPostFrameCallback((_) => _load());
        }
        final canManage = AdminAccessScope.can(
          context,
          AdminCapabilities.platformAdminAccountsManage,
        );
        final query = _searchController.text.trim().toLowerCase();
        final visibleAccounts = _accounts
            .where((account) {
              return '${account.name} ${account.loginId} ${account.email ?? ''} ${account.role.wireValue}'
                  .toLowerCase()
                  .contains(query);
            })
            .toList(growable: false);

        final body = AdminListShell(
          title: 'Administrator Accounts',
          subtitle:
              'Manage Hospital Admin and System Auditor accounts. Application Admin accounts are never managed here.',
          searchController: _searchController,
          searchHint: 'Search administrators',
          onSearch: () => setState(() {}),
          actions: [
            if (canManage)
              FilledButton.icon(
                key: const Key('invite-admin-account'),
                onPressed: () => _showAccountDialog(),
                icon: const Icon(Icons.person_add_alt_rounded),
                label: const Text('Invite'),
              ),
          ],
          child: _buildBody(visibleAccounts, canManage),
        );
        return adminPageScaffold(context, 'Administrator Accounts', body);
      },
    );
  }

  Widget _buildBody(List<AdminAccountModel> accounts, bool canManage) {
    if (_isLoading && !_hasLoaded) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _accounts.isEmpty) {
      final message = _error is ApiException
          ? (_error as ApiException).message
          : 'Could not load administrator accounts.';
      return _InlineLoadError(message: message, onRetry: _load);
    }
    if (accounts.isEmpty) {
      return RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: const [
            SizedBox(height: 120),
            Icon(Icons.manage_accounts_outlined, size: 48),
            SizedBox(height: 12),
            Center(child: Text('No administrator accounts found')),
            SizedBox(height: 8),
            Padding(
              padding: EdgeInsets.symmetric(horizontal: 32),
              child: Text(
                'This list only shows Hospital Admin and System Auditor accounts. Application Admin accounts are not listed here. Use Invite to create one.',
                textAlign: TextAlign.center,
              ),
            ),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: accounts.length,
        itemBuilder: (context, index) {
          final account = accounts[index];
          return AdminRecordCard(
            icon: account.role == AdminRole.auditor
                ? Icons.visibility_outlined
                : Icons.admin_panel_settings_outlined,
            title: account.name,
            badge: adminRoleLabel(account.role),
            details: [
              AdminDetail(Icons.login_rounded, account.loginId),
              if (account.email != null)
                AdminDetail(Icons.mail_outline_rounded, account.email!),
              AdminDetail(
                account.hasBrokenHospitalAssignment
                    ? Icons.warning_amber_rounded
                    : Icons.local_hospital_outlined,
                account.hospitalDisplayLabel,
              ),
              AdminDetail(
                account.isActive
                    ? Icons.check_circle_outline
                    : Icons.block_outlined,
                account.isActive ? 'Active' : 'Suspended',
              ),
              AdminDetail(
                Icons.phonelink_lock_outlined,
                account.mfaEnabled ? 'MFA enabled' : 'MFA not enabled',
              ),
              if (account.assignmentError != null)
                AdminDetail(
                  Icons.error_outline_rounded,
                  account.assignmentError!,
                ),
            ],
            menu: canManage
                ? [
                    PopupMenuItem<String>(
                      value: 'edit',
                      onTap: () => Future.microtask(
                        () => _showAccountDialog(account: account),
                      ),
                      child: const Text('Edit role or scope'),
                    ),
                    PopupMenuItem<String>(
                      value: 'status',
                      onTap: () =>
                          Future.microtask(() => _toggleStatus(account)),
                      child: Text(account.isActive ? 'Suspend' : 'Restore'),
                    ),
                    PopupMenuItem<String>(
                      value: 'reset-mfa',
                      onTap: () => Future.microtask(() => _resetMfa(account)),
                      child: const Text('Reset authenticator'),
                    ),
                  ]
                : const [],
          );
        },
      ),
    );
  }

  Future<void> _showAccountDialog({AdminAccountModel? account}) async {
    final formKey = GlobalKey<FormState>();
    final nameController = TextEditingController(text: account?.name ?? '');
    final emailController = TextEditingController(
      text: account?.email ?? account?.loginId ?? '',
    );
    var role = account?.role ?? AdminRole.hospitalAdmin;
    String? hospitalId = account?.hospital?.id;
    final hospitalsFuture = _repository.getHospitals(status: 'active');

    await showDialog<void>(
      context: context,
      builder: (dialogContext) => FutureBuilder<Map<String, dynamic>>(
        future: hospitalsFuture,
        builder: (context, snapshot) {
          final hospitals = List<Map<String, dynamic>>.from(
            (snapshot.data?['hospitals'] as List? ?? const []).map(
              (item) => Map<String, dynamic>.from(item as Map),
            ),
          );
          // Include the account's current hospital even when it is no longer
          // active so DropdownButtonFormField never receives a missing value.
          final currentHospitalId = account?.hospital?.id;
          final hasCurrentHospital = currentHospitalId != null &&
              hospitals.any(
                (hospital) =>
                    '${hospital['id'] ?? hospital['_id']}' == currentHospitalId,
              );
          if (currentHospitalId != null &&
              currentHospitalId.isNotEmpty &&
              !hasCurrentHospital) {
            hospitals.insert(0, {
              'id': currentHospitalId,
              'name':
                  account?.hospital?.name ??
                  account?.hospital?.code ??
                  currentHospitalId,
              'code': account?.hospital?.code,
              'status': 'inactive',
            });
          }
          // Clear selection if the current id is still not representable.
          final selectableIds = hospitals
              .map((hospital) => '${hospital['id'] ?? hospital['_id']}')
              .toSet();
          final effectiveHospitalId =
              hospitalId != null && selectableIds.contains(hospitalId)
              ? hospitalId
              : null;
          return StatefulBuilder(
            builder: (context, setDialogState) {
              final needsHospital = role == AdminRole.hospitalAdmin;
              return AlertDialog(
                title: Text(
                  account == null
                      ? 'Invite administrator'
                      : 'Edit administrator',
                ),
                content: SizedBox(
                  width: 460,
                  child: Form(
                    key: formKey,
                    child: SingleChildScrollView(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          TextFormField(
                            key: const Key('admin-account-name'),
                            controller: nameController,
                            decoration: const InputDecoration(
                              labelText: 'Full name',
                            ),
                            validator: (value) =>
                                value == null || value.trim().isEmpty
                                ? 'Enter the administrator name.'
                                : null,
                          ),
                          const SizedBox(height: 12),
                          TextFormField(
                            key: const Key('admin-account-email'),
                            controller: emailController,
                            enabled: account == null,
                            keyboardType: TextInputType.emailAddress,
                            decoration: const InputDecoration(
                              labelText: 'Email',
                              helperText:
                                  'This email is also the administrator sign-in ID.',
                            ),
                            validator: (value) =>
                                value == null ||
                                    !RegExp(
                                      r'^[^@\s]+@[^@\s]+\.[^@\s]+$',
                                    ).hasMatch(value.trim())
                                ? 'Enter a valid email address.'
                                : null,
                          ),
                          const SizedBox(height: 12),
                          DropdownButtonFormField<AdminRole>(
                            key: const Key('admin-account-role'),
                            initialValue: role,
                            decoration: const InputDecoration(
                              labelText: 'Role',
                            ),
                            items: const [
                              DropdownMenuItem(
                                value: AdminRole.hospitalAdmin,
                                child: Text('Hospital Admin'),
                              ),
                              DropdownMenuItem(
                                value: AdminRole.auditor,
                                child: Text('System Auditor'),
                              ),
                            ],
                            onChanged: (value) => setDialogState(() {
                              role = value ?? role;
                              if (role == AdminRole.auditor) hospitalId = null;
                            }),
                          ),
                          if (needsHospital) ...[
                            const SizedBox(height: 12),
                            DropdownButtonFormField<String>(
                              key: const Key('admin-account-hospital'),
                              initialValue: effectiveHospitalId,
                              isExpanded: true,
                              decoration: InputDecoration(
                                labelText: 'Active hospital',
                                helperText: hasCurrentHospital ||
                                        account?.hospital == null
                                    ? 'Hospital Admin access is limited to this hospital.'
                                    : 'The currently assigned hospital is inactive. Select an active hospital to continue.',
                                errorText: snapshot.hasError
                                    ? 'Could not load active hospitals.'
                                    : null,
                              ),
                              items: hospitals
                                  .map((hospital) {
                                    final id =
                                        '${hospital['id'] ?? hospital['_id']}';
                                    final status =
                                        '${hospital['status'] ?? 'active'}';
                                    final label =
                                        '${hospital['name'] ?? hospital['code'] ?? id}';
                                    return DropdownMenuItem(
                                      value: id,
                                      child: Text(
                                        status == 'active'
                                            ? label
                                            : '$label (inactive)',
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    );
                                  })
                                  .toList(growable: false),
                              onChanged: snapshot.hasData
                                  ? (value) =>
                                        setDialogState(() => hospitalId = value)
                                  : null,
                              validator: (value) =>
                                  needsHospital &&
                                      (value == null || value.isEmpty)
                                  ? 'Select an active hospital.'
                                  : null,
                            ),
                          ],
                          if (account != null) ...[
                            const SizedBox(height: 16),
                            const Text(
                              'Changing this administrator’s role or hospital scope signs them out of all active sessions.',
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.pop(dialogContext),
                    child: const Text('Cancel'),
                  ),
                  FilledButton(
                    key: const Key('save-admin-account'),
                    onPressed: needsHospital && !snapshot.hasData
                        ? null
                        : () async {
                            if (!formKey.currentState!.validate()) return;
                            // System Auditors are global: omit hospital_id entirely.
                            // Sending null fails backend Zod validation
                            // (hospital_id is string|undefined, not null).
                            final payload = <String, dynamic>{
                              'name': nameController.text.trim(),
                              'role': role.wireValue,
                              if (role == AdminRole.hospitalAdmin)
                                'hospital_id': hospitalId,
                              if (account == null)
                                'email': emailController.text.trim(),
                            };
                            try {
                              final result = account == null
                                  ? await _repository.createAdminAccount(
                                      payload,
                                    )
                                  : await _repository.updateAdminAccount(
                                      account.id,
                                      payload,
                                    );
                              if (!dialogContext.mounted) return;
                              Navigator.pop(dialogContext);
                              await _load();
                              if (!mounted) return;
                              if (account == null) {
                                await _showInvitationResult(
                                  result.temporaryPassword,
                                );
                              }
                            } catch (error) {
                              if (dialogContext.mounted) {
                                _showSafeError(dialogContext, error);
                              }
                            }
                          },
                    child: Text(account == null ? 'Invite' : 'Save'),
                  ),
                ],
              );
            },
          );
        },
      ),
    );
    nameController.dispose();
    emailController.dispose();
  }

  Future<void> _toggleStatus(AdminAccountModel account) async {
    final action = account.isActive ? 'Suspend' : 'Restore';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('$action ${account.name}?'),
        content: Text(
          account.isActive
              ? 'Suspending this account signs the administrator out and prevents new sign-ins.'
              : 'Restoring this account allows the administrator to sign in under the current role policy.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(action),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await _repository.updateAdminAccount(account.id, {
        'is_active': !account.isActive,
      });
      await _load();
    } catch (error) {
      if (mounted) _showSafeError(context, error);
    }
  }

  Future<void> _resetMfa(AdminAccountModel account) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Reset authenticator?'),
        content: Text(
          'This replaces ${account.name}’s authenticator setup and signs them out of all active sessions. Share any replacement setup only through an approved secure channel.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Reset authenticator'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      final result = await _repository.resetAdminAccountMfa(account.id);
      if (!mounted) return;
      final setup = result['setup'] is Map
          ? Map<String, dynamic>.from(result['setup'] as Map)
          : result;
      await _showMfaResetResult(account.name, setup);
      await _load();
    } catch (error) {
      if (mounted) _showSafeError(context, error);
    }
  }

  Future<void> _showInvitationResult(String? temporaryPassword) {
    return showDialog<void>(
      context: context,
      // One-time secret: require an explicit dismiss so it is not lost to a
      // barrier tap.
      barrierDismissible: temporaryPassword == null,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Administrator invited'),
        content: SelectableText(
          temporaryPassword == null
              ? 'The administrator must complete the required sign-in setup and change their password when prompted.'
              : 'Share this temporary password securely. It is shown only now and must be changed at first sign-in:\n\n$temporaryPassword',
        ),
        actions: [
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Done'),
          ),
        ],
      ),
    );
  }

  Future<void> _showMfaResetResult(
    String accountName,
    Map<String, dynamic> setup,
  ) {
    final otpauthUrl = '${setup['otpauth_url'] ?? setup['otpauthUrl'] ?? ''}';
    final secret = '${setup['secret'] ?? ''}';
    return showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => AlertDialog(
        title: const Text('New authenticator setup'),
        content: SizedBox(
          width: 380,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '$accountName must enroll this replacement before signing in.',
              ),
              if (otpauthUrl.isNotEmpty) ...[
                const SizedBox(height: 16),
                Center(
                  child: QrImageView(
                    data: otpauthUrl,
                    size: 200,
                    backgroundColor: Colors.white,
                    semanticsLabel: 'Replacement authenticator setup QR code',
                  ),
                ),
              ],
              if (secret.isNotEmpty) ...[
                const SizedBox(height: 12),
                SelectableText('Manual setup key: $secret'),
              ],
              const SizedBox(height: 12),
              const Text(
                'This setup is shown only now. Do not send it through email or chat.',
              ),
            ],
          ),
        ),
        actions: [
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Done'),
          ),
        ],
      ),
    );
  }

  void _showSafeError(BuildContext context, Object error) {
    final message = error is ApiException
        ? error.message
        : 'The administrator account request could not be completed. Try again.';
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }
}

class _InlineLoadError extends StatelessWidget {
  const _InlineLoadError({required this.onRetry, required this.message});

  final Future<void> Function() onRetry;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off_outlined, size: 40),
            const SizedBox(height: 12),
            const Text(
              'Could not load administrator accounts.',
              textAlign: TextAlign.center,
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            Text(message, textAlign: TextAlign.center),
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
