import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/query/admin_query_keys.dart';
import 'package:frontend/core/widgets/admin/admin_action_confirmation.dart';
import 'package:frontend/core/widgets/admin/admin_scaffold.dart';
import 'package:frontend/core/widgets/common/api_error_state.dart';

class HospitalManagementPage extends StatefulWidget {
  const HospitalManagementPage({super.key});

  @override
  State<HospitalManagementPage> createState() => _HospitalManagementPageState();
}

class _HospitalManagementPageState extends State<HospitalManagementPage> {
  final _repo = AppDependencies.adminRepository;
  final _search = TextEditingController();
  int _refreshKey = 0;
  String? _status;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _refresh() => setState(() => _refreshKey++);

  @override
  Widget build(BuildContext context) {
    return UseQuery<Map<String, dynamic>>(
      options: QueryOptions<Map<String, dynamic>>(
        queryKey: AdminQueryKeys.hospitals(refreshKey: _refreshKey),
        queryFn: () => _repo.getHospitals(
          search: _search.text.trim(),
          status: _status,
        ),
      ),
      builder: (context, query) {
        final hospitals = query.data?['hospitals'] as List? ?? const [];
        final content = _AdminListShell(
          title: 'Hospitals',
          subtitle: 'Manage hospital tenants, status, and platform access.',
          searchController: _search,
          searchHint: 'Search hospitals',
          onSearch: _refresh,
          actions: [
            DropdownButton<String?>(
              value: _status,
              hint: const Text('All status'),
              items: const [
                DropdownMenuItem(value: null, child: Text('All status')),
                DropdownMenuItem(value: 'active', child: Text('Active')),
                DropdownMenuItem(value: 'suspended', child: Text('Suspended')),
                DropdownMenuItem(value: 'inactive', child: Text('Inactive')),
              ],
              onChanged: (value) => setState(() => _status = value),
            ),
            FilledButton.icon(
              onPressed: () => _showHospitalDialog(context),
              icon: const Icon(Icons.add_business_rounded),
              label: const Text('Add'),
            ),
          ],
          child: _QueryBody(
            query: query,
            emptyIcon: Icons.local_hospital_outlined,
            emptyText: 'No hospitals found',
            child: ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: hospitals.length,
              itemBuilder: (context, index) {
                final h = hospitals[index] as Map<String, dynamic>;
                final id = (h['id'] ?? h['_id']).toString();
                final name = (h['name'] ?? 'Hospital').toString();
                final status = (h['status'] ?? 'inactive').toString();
                return _AdminRecordCard(
                  icon: Icons.local_hospital_rounded,
                  title: name,
                  badge: status,
                  details: [
                    _Detail(Icons.tag_rounded, id),
                    _Detail(Icons.place_rounded, '${h['location'] ?? '--'}'),
                    _Detail(
                        Icons.mail_outline_rounded, '${h['admin'] ?? '--'}'),
                    _Detail(
                      Icons.medical_services_outlined,
                      '${h['doctors'] ?? 0} doctors',
                    ),
                    _Detail(
                        Icons.people_outline, '${h['patients'] ?? 0} patients'),
                  ],
                  menu: [
                    PopupMenuItem(
                      value: 'edit',
                      child: const Text('Edit hospital'),
                      onTap: () => Future.microtask(
                        // ignore: use_build_context_synchronously
                        () => _showHospitalDialog(context, hospital: h),
                      ),
                    ),
                    PopupMenuItem(
                      value: 'status',
                      child: Text(status == 'active' ? 'Suspend' : 'Activate'),
                      onTap: () => Future.microtask(
                        () => _confirmHospitalStatus(
                          name,
                          id,
                          status == 'active' ? 'suspended' : 'active',
                        ),
                      ),
                    ),
                    PopupMenuItem(
                      value: 'delete',
                      child: const Text('Deactivate'),
                      onTap: () => Future.microtask(
                        () => _confirmHospitalDeactivation(name, id),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        );
        return _pageScaffold(context, 'Hospitals', content);
      },
    );
  }

  Future<void> _confirmHospitalStatus(
    String hospitalName,
    String id,
    String status,
  ) async {
    final action = status == 'suspended' ? 'Suspend' : 'Activate';
    final confirmed = await showAdminActionConfirmation(
      context,
      title: '$action $hospitalName?',
      message: status == 'suspended'
          ? 'Staff and patients will lose access until this hospital is reactivated.'
          : 'This restores hospital access. Deactivated user accounts must be reactivated separately.',
      confirmLabel: action,
    );
    if (!confirmed || !mounted) return;
    await _runAction(
      () => _repo.updateHospitalStatus(id, status),
      status == 'suspended'
          ? '$hospitalName suspended successfully.'
          : '$hospitalName activated. Deactivated user accounts remain inactive until reactivated.',
    );
  }

  Future<void> _confirmHospitalDeactivation(String hospitalName, String id) async {
    final confirmed = await showAdminActionConfirmation(
      context,
      title: 'Deactivate $hospitalName?',
      message: 'This removes platform access for the hospital. You can reactivate it later.',
      confirmLabel: 'Deactivate',
    );
    if (!confirmed || !mounted) return;
    await _runAction(
      () => _repo.deleteHospital(id),
      '$hospitalName deactivated successfully.',
    );
  }

  Future<void> _runAction(
    Future<dynamic> Function() action,
    String successMessage,
  ) async {
    try {
      await action();
      if (!mounted) return;
      _refresh();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(successMessage)),
      );
    } catch (e) {
      if (mounted) _showError(context, e);
    }
  }

  Future<void> _showHospitalDialog(
    BuildContext context, {
    Map<String, dynamic>? hospital,
  }) async {
    final name = TextEditingController(text: '${hospital?['name'] ?? ''}');
    final location =
        TextEditingController(text: '${hospital?['location'] ?? ''}');
    final admin = TextEditingController(text: '${hospital?['admin'] ?? ''}');
    var status = '${hospital?['status'] ?? 'active'}';
    final id = '${hospital?['id'] ?? hospital?['_id'] ?? ''}';
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(hospital == null ? 'Add Hospital' : 'Edit Hospital'),
        content: SizedBox(
          width: 420,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                  controller: name,
                  decoration:
                      const InputDecoration(labelText: 'Hospital name')),
              const SizedBox(height: 12),
              TextField(
                  controller: location,
                  decoration: const InputDecoration(labelText: 'Location')),
              const SizedBox(height: 12),
              TextField(
                  controller: admin,
                  decoration: const InputDecoration(labelText: 'Admin email')),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: status,
                decoration: const InputDecoration(labelText: 'Status'),
                items: const [
                  DropdownMenuItem(value: 'active', child: Text('Active')),
                  DropdownMenuItem(
                      value: 'suspended', child: Text('Suspended')),
                ],
                onChanged: (value) => status = value ?? status,
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Cancel')),
          FilledButton(
            onPressed: () async {
              final data = {
                'name': name.text.trim(),
                'location': location.text.trim(),
                'admin_email': admin.text.trim(),
                'status': status,
              };
              try {
                if (hospital == null) {
                  await _repo.createHospital(data);
                } else {
                  await _repo.updateHospital(id, data);
                }
                if (dialogContext.mounted) Navigator.pop(dialogContext);
                _refresh();
              } catch (e) {
                if (dialogContext.mounted) _showError(dialogContext, e);
              }
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }
}

class UserLifecyclePage extends StatefulWidget {
  const UserLifecyclePage({super.key});

  @override
  State<UserLifecyclePage> createState() => _UserLifecyclePageState();
}

class _UserLifecyclePageState extends State<UserLifecyclePage> {
  final _repo = AppDependencies.adminRepository;
  final _search = TextEditingController();
  int _refreshKey = 0;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _refresh() => setState(() => _refreshKey++);

  @override
  Widget build(BuildContext context) {
    return UseQuery<Map<String, dynamic>>(
      options: QueryOptions<Map<String, dynamic>>(
        queryKey: AdminQueryKeys.users(refreshKey: _refreshKey),
        queryFn: _repo.getUsers,
      ),
      builder: (context, query) {
        final all = query.data?['users'] as List? ?? const [];
        final q = _search.text.toLowerCase();
        final users = all.where((item) {
          final user = item as Map<String, dynamic>;
          return '${user['name']} ${user['email']} ${user['role']}'
              .toLowerCase()
              .contains(q);
        }).toList();
        final content = _AdminListShell(
          title: 'Users',
          subtitle: 'Invite admins, assign roles, and suspend access.',
          searchController: _search,
          searchHint: 'Search users',
          onSearch: () => setState(() {}),
          actions: [
            FilledButton.icon(
              onPressed: () => _showInviteDialog(context),
              icon: const Icon(Icons.person_add_alt_rounded),
              label: const Text('Invite'),
            ),
          ],
          child: _QueryBody(
            query: query,
            emptyIcon: Icons.people_outline,
            emptyText: 'No users found',
            child: ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: users.length,
              itemBuilder: (context, index) {
                final u = users[index] as Map<String, dynamic>;
                final id = '${u['id']}';
                final role = '${u['role'] ?? 'user'}';
                final status = '${u['status'] ?? 'inactive'}';
                return _AdminRecordCard(
                  icon: Icons.account_circle_rounded,
                  title: '${u['name'] ?? u['email'] ?? 'User'}',
                  badge: role.replaceAll('_', ' '),
                  details: [
                    _Detail(
                        Icons.mail_outline_rounded, '${u['email'] ?? '--'}'),
                    _Detail(Icons.local_hospital_outlined,
                        '${u['hospital'] ?? 'ALL'}'),
                    _Detail(Icons.verified_user_outlined, status),
                  ],
                  menu: [
                    ...['app_admin', 'hospital_admin', 'auditor'].map(
                      (r) => PopupMenuItem(
                        value: r,
                        child: Text('Set ${r.replaceAll('_', ' ')}'),
                        onTap: () => Future.microtask(
                          () => _runAction(
                              () => _repo.updateUser(id, {'role': r})),
                        ),
                      ),
                    ),
                    PopupMenuItem(
                      value: 'status',
                      child: Text(status == 'active' ? 'Suspend' : 'Activate'),
                      onTap: () => Future.microtask(
                        () => _runAction(
                          () => _repo.updateUser(
                            id,
                            {
                              'status':
                                  status == 'active' ? 'inactive' : 'active'
                            },
                          ),
                        ),
                      ),
                    ),
                    if (role == 'app_admin' ||
                        role == 'hospital_admin' ||
                        role == 'auditor')
                      PopupMenuItem(
                        value: 'reset_mfa',
                        child: const Text('Reset authenticator'),
                        onTap: () => Future.microtask(
                          () => _resetAuthenticator(id,
                              '${u['name'] ?? u['email'] ?? 'this administrator'}'),
                        ),
                      ),
                  ],
                );
              },
            ),
          ),
        );
        return _pageScaffold(context, 'Users', content);
      },
    );
  }

  Future<void> _resetAuthenticator(String userId, String userName) async {
    final shouldReset = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Reset authenticator?'),
        content: Text(
          'This replaces $userName\'s existing authenticator setup and signs them out on every device. '
          'You must give the new QR code only to that administrator.',
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Reset authenticator'),
          ),
        ],
      ),
    );
    if (shouldReset != true || !mounted) return;

    try {
      final result = await _repo.resetUserAuthenticator(userId);
      if (!mounted) return;
      _refresh();
      await _showReplacementQr(
        userName,
        (result['setup'] as Map?)?.cast<String, dynamic>() ?? const {},
      );
    } catch (e) {
      if (mounted) _showError(context, e);
    }
  }

  Future<void> _showReplacementQr(String userName, Map<String, dynamic> setup) {
    final otpauthUrl = '${setup['otpauth_url'] ?? ''}';
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
                  'Have $userName scan this code on their new phone before they sign in.'),
              const SizedBox(height: 16),
              Center(
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    border: Border.all(
                        color: Theme.of(context).colorScheme.outlineVariant),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: QrImageView(
                    data: otpauthUrl,
                    version: QrVersions.auto,
                    size: 208,
                    backgroundColor: Colors.white,
                    semanticsLabel: 'Replacement authenticator setup QR code',
                  ),
                ),
              ),
              const SizedBox(height: 16),
              SelectableText('Manual setup key: $secret'),
              const SizedBox(height: 12),
              Text(
                'This QR code is shown only now. Do not take a screenshot or send it through email or chat.',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
              ),
            ],
          ),
        ),
        actions: [
          FilledButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Done')),
        ],
      ),
    );
  }

  Future<void> _runAction(Future<dynamic> Function() action) async {
    try {
      await action();
      _refresh();
    } catch (e) {
      if (mounted) _showError(context, e);
    }
  }

  Future<void> _showInviteDialog(BuildContext context) async {
    final name = TextEditingController();
    final email = TextEditingController();
    final hospital = TextEditingController();
    var role = 'hospital_admin';
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Invite User'),
        content: SizedBox(
          width: 420,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                  controller: name,
                  decoration: const InputDecoration(labelText: 'Full name')),
              const SizedBox(height: 12),
              TextField(
                  controller: email,
                  decoration:
                      const InputDecoration(labelText: 'Email / login ID')),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: role,
                decoration: const InputDecoration(labelText: 'Role'),
                items: const [
                  DropdownMenuItem(
                      value: 'hospital_admin', child: Text('Hospital Admin')),
                  DropdownMenuItem(
                      value: 'auditor', child: Text('System Auditor')),
                  DropdownMenuItem(
                      value: 'app_admin', child: Text('App Admin')),
                ],
                onChanged: (value) => role = value ?? role,
              ),
              const SizedBox(height: 12),
              TextField(
                  controller: hospital,
                  decoration:
                      const InputDecoration(labelText: 'Hospital code or ID')),
            ],
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Cancel')),
          FilledButton(
            onPressed: () async {
              try {
                final result = await _repo.inviteUser({
                  'name': name.text.trim(),
                  'email': email.text.trim(),
                  'role': role,
                  if (hospital.text.trim().isNotEmpty)
                    'hospital_id': hospital.text.trim(),
                });
                if (dialogContext.mounted) Navigator.pop(dialogContext);
                _refresh();
                if (context.mounted) {
                  final temporaryPassword =
                      result['temporary_password'] as String?;
                  await showDialog<void>(
                    context: context,
                    builder: (context) => AlertDialog(
                      title: const Text('Admin invited'),
                      content: Text(
                        temporaryPassword == null
                            ? 'The invited admin must change their password on first sign-in.'
                            : 'Share this temporary password securely. The invited admin must change it on first sign-in:\n\n$temporaryPassword',
                      ),
                      actions: [
                        TextButton(
                          onPressed: () => Navigator.pop(context),
                          child: const Text('Done'),
                        ),
                      ],
                    ),
                  );
                }
              } catch (e) {
                if (dialogContext.mounted) _showError(dialogContext, e);
              }
            },
            child: const Text('Invite'),
          ),
        ],
      ),
    );
  }
}

class RolesRbacPage extends StatefulWidget {
  const RolesRbacPage({super.key});

  @override
  State<RolesRbacPage> createState() => _RolesRbacPageState();
}

class _RolesRbacPageState extends State<RolesRbacPage> {
  final _repo = AppDependencies.adminRepository;
  int _refreshKey = 0;
  final _draft = <String, Map<String, dynamic>>{};

  void _refresh() => setState(() {
        _refreshKey++;
        _draft.clear();
      });

  @override
  Widget build(BuildContext context) {
    return UseQuery<Map<String, dynamic>>(
      options: QueryOptions<Map<String, dynamic>>(
        queryKey: AdminQueryKeys.roles(refreshKey: _refreshKey),
        queryFn: _repo.getRoles,
      ),
      builder: (context, query) {
        final roles =
            (query.data?['roles'] as Map?)?.cast<String, dynamic>() ?? {};
        final roleKeys = roles.keys.toList();
        final perms = <String>{
          for (final role in roles.values)
            ...(((role as Map)['permissions'] as Map?)?.keys.cast<String>() ??
                const <String>[]),
        }.toList()
          ..sort();
        final content = _AdminListShell(
          title: 'Roles & RBAC',
          subtitle:
              'Role permissions are enforced across administrative routes.',
          actions: [
            FilledButton.icon(
              onPressed: _draft.isEmpty ? null : () => _saveRoles(roleKeys),
              icon: const Icon(Icons.save_rounded),
              label: const Text('Save changes'),
            ),
          ],
          child: _QueryBody(
            query: query,
            emptyIcon: Icons.admin_panel_settings_outlined,
            emptyText: 'No role definitions found',
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                for (final roleKey in roleKeys)
                  _RoleCard(
                    roleKey: roleKey,
                    role: roles[roleKey] as Map<String, dynamic>,
                    permissions: perms,
                    draft: _draft[roleKey],
                    onChanged: (permission, value) => setState(() {
                      final current = Map<String, dynamic>.from(
                        ((roles[roleKey] as Map)['permissions'] as Map)
                            .cast<String, dynamic>(),
                      );
                      _draft[roleKey] = {
                        ...current,
                        ...?_draft[roleKey],
                        permission: value
                      };
                    }),
                  ),
              ],
            ),
          ),
        );
        return _pageScaffold(context, 'Roles & RBAC', content);
      },
    );
  }

  Future<void> _saveRoles(List<String> roleKeys) async {
    try {
      for (final roleKey in roleKeys) {
        final permissions = _draft[roleKey];
        if (permissions != null) await _repo.updateRole(roleKey, permissions);
      }
      _refresh();
    } catch (e) {
      if (mounted) _showError(context, e);
    }
  }
}

class BillingInvoicesPage extends StatefulWidget {
  const BillingInvoicesPage({super.key});

  @override
  State<BillingInvoicesPage> createState() => _BillingInvoicesPageState();
}

class _BillingInvoicesPageState extends State<BillingInvoicesPage> {
  final _repo = AppDependencies.adminRepository;
  final _search = TextEditingController();
  int _refreshKey = 0;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _refresh() => setState(() => _refreshKey++);

  @override
  Widget build(BuildContext context) {
    return UseQuery<Map<String, dynamic>>(
      options: QueryOptions<Map<String, dynamic>>(
        queryKey: AdminQueryKeys.invoices(refreshKey: _refreshKey),
        queryFn: _repo.getInvoices,
      ),
      builder: (context, query) {
        final all = query.data?['invoices'] as List? ?? const [];
        final q = _search.text.toLowerCase();
        final invoices = all.where((item) {
          final invoice = item as Map<String, dynamic>;
          return '${invoice['id']} ${invoice['hospitalName']} ${invoice['plan']}'
              .toLowerCase()
              .contains(q);
        }).toList();
        final content = _AdminListShell(
          title: 'Billing & Invoices',
          subtitle: 'Manage B2B platform invoices and payment sessions.',
          searchController: _search,
          searchHint: 'Search invoices',
          onSearch: () => setState(() {}),
          actions: [
            FilledButton.icon(
              onPressed: _confirmInvoiceGeneration,
              icon: const Icon(Icons.receipt_long_rounded),
              label: const Text('Generate'),
            ),
          ],
          child: _QueryBody(
            query: query,
            emptyIcon: Icons.receipt_long_outlined,
            emptyText: 'No invoices found',
            child: ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: invoices.length,
              itemBuilder: (context, index) {
                final invoice = invoices[index] as Map<String, dynamic>;
                final id = '${invoice['id']}';
                final status = '${invoice['status'] ?? 'Pending'}';
                return _AdminRecordCard(
                  icon: Icons.receipt_rounded,
                  title: id,
                  badge: status,
                  details: [
                    _Detail(Icons.local_hospital_outlined,
                        '${invoice['hospitalName'] ?? invoice['hospital'] ?? '--'}'),
                    _Detail(Icons.workspace_premium_outlined,
                        '${invoice['plan'] ?? '--'}'),
                    _Detail(Icons.currency_rupee_rounded,
                        '${invoice['amount'] ?? 0}'),
                    _Detail(
                        Icons.event_outlined, 'Due ${_date(invoice['due'])}'),
                  ],
                  menu: [
                    PopupMenuItem(
                      enabled: status != 'Paid',
                      value: 'checkout',
                      child: const Text('Create checkout'),
                      onTap: () => Future.microtask(
                        () => _runAction(() => _repo.createInvoiceCheckout(id)),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        );
        return _pageScaffold(context, 'Billing', content);
      },
    );
  }

  Future<void> _confirmInvoiceGeneration() async {
    final confirmed = await showAdminActionConfirmation(
      context,
      title: 'Generate invoices?',
      message: 'Invoices will be created for every active hospital using the current plan and amount.',
      confirmLabel: 'Generate',
    );
    if (!confirmed || !mounted) return;

    try {
      final result = await _repo.generateInvoices();
      if (!mounted) return;
      _refresh();
      final generated = result['generated'] as num? ?? 0;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            generated == 0
                ? 'No active hospitals required invoices.'
                : '$generated invoice${generated == 1 ? '' : 's'} generated successfully.',
          ),
        ),
      );
    } catch (e) {
      if (mounted) _showError(context, e);
    }
  }

  Future<void> _runAction(Future<dynamic> Function() action) async {
    try {
      await action();
      _refresh();
    } catch (e) {
      if (mounted) _showError(context, e);
    }
  }
}

class _AdminListShell extends StatelessWidget {
  const _AdminListShell({
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

class _QueryBody extends StatelessWidget {
  const _QueryBody({
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
      return ApiErrorState(
        error: query.error,
        onRetry: () => query.refetch(),
      );
    }
    return child;
  }
}

class _AdminRecordCard extends StatelessWidget {
  const _AdminRecordCard({
    required this.icon,
    required this.title,
    required this.badge,
    required this.details,
    this.menu = const [],
  });

  final IconData icon;
  final String title;
  final String badge;
  final List<_Detail> details;
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
                      _StatusPill(label: badge),
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
                            Icon(d.icon,
                                size: 15, color: theme.colorScheme.outline),
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

class _RoleCard extends StatelessWidget {
  const _RoleCard({
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
            Text('${role['label'] ?? roleKey}',
                style: Theme.of(context).textTheme.titleMedium),
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
                    onSelected: roleKey == 'app_admin' && permission == 'manage_roles'
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

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label});
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

class _Detail {
  const _Detail(this.icon, this.text);
  final IconData icon;
  final String text;
}

Widget _pageScaffold(BuildContext context, String title, Widget body) {
  if (!AdminScaffold.usesShellAppBar(context)) return body;
  return Scaffold(appBar: AppBar(title: Text(title)), body: body);
}

void _showError(BuildContext context, Object error) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(error.toString())),
  );
}

String _date(Object? raw) {
  if (raw == null) return '--';
  final parsed = DateTime.tryParse(raw.toString());
  if (parsed == null) return raw.toString();
  return '${parsed.year}-${parsed.month.toString().padLeft(2, '0')}-${parsed.day.toString().padLeft(2, '0')}';
}
