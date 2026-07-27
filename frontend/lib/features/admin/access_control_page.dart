import 'package:flutter/material.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/core/widgets/admin/admin_access_gate.dart';
import 'package:frontend/core/widgets/admin/admin_access_scope.dart';
import 'package:frontend/features/admin/admin_capabilities.dart';
import 'package:frontend/features/admin/admin_console_components.dart';
import 'package:frontend/features/admin/data/admin_repository.dart';
import 'package:frontend/features/admin/models/admin_access_model.dart';
import 'package:frontend/features/admin/models/admin_policy_ui_models.dart';
import 'package:frontend/features/admin/models/admin_role_policy_model.dart';

class AccessControlPage extends StatefulWidget {
  const AccessControlPage({super.key, this.repository});

  final AdminRepository? repository;

  @override
  State<AccessControlPage> createState() => _AccessControlPageState();
}

class _AccessControlPageState extends State<AccessControlPage> {
  late final AdminRepository _repository =
      widget.repository ?? AppDependencies.adminRepository;
  final _drafts = <AdminRole, Map<String, bool>>{};
  final _serverConflicts = <AdminRole, AdminRolePolicyModel>{};
  final _history = <AdminRole, List<AdminRolePolicyRevisionModel>>{};
  List<AdminRolePolicyModel> _policies = const [];
  Object? _error;
  bool _isLoading = false;
  bool _hasLoaded = false;
  AdminRole? _busyRole;

  Future<void> _load({bool preserveDrafts = true}) async {
    if (_isLoading) return;
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final policies = await _repository.getRolePolicies();
      final historyEntries = await Future.wait(
        policies.map((policy) async {
          try {
            final history = await _repository.getRolePolicyHistory(policy.role);
            return MapEntry(policy.role, history);
          } catch (_) {
            return MapEntry(policy.role, const <AdminRolePolicyRevisionModel>[]);
          }
        }),
      );
      final histories = Map<AdminRole, List<AdminRolePolicyRevisionModel>>.fromEntries(
        historyEntries,
      );
      if (!mounted) return;
      setState(() {
        _policies = policies;
        _history
          ..clear()
          ..addAll(histories);
        if (!preserveDrafts) _drafts.clear();
        _error = null;
        _hasLoaded = true;
      });
    } catch (error) {
      if (!mounted) return;
      final hadPolicies = _policies.isNotEmpty;
      setState(() {
        _error = error;
        // Mark loaded so first-load failures render the error panel instead of
        // scheduling infinite auto-retries from build().
        _hasLoaded = true;
      });
      if (hadPolicies && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              error is ApiException
                  ? error.message
                  : 'Could not refresh access policies.',
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
      anyCapabilities: const [AdminCapabilities.platformRolePolicyRead],
      roles: const {AdminRole.appAdmin, AdminRole.auditor},
      scope: AdminScope.global,
      deniedMessage:
          'Access policies are available to Application Admins and configured System Auditors. Hospital Admins cannot view or change global role policy.',
      builder: (context) {
        if (!_hasLoaded && !_isLoading) {
          WidgetsBinding.instance.addPostFrameCallback((_) => _load());
        }
        final access = AdminAccessScope.accessOf(context)!;
        final canManage =
            access.role == AdminRole.appAdmin &&
            !access.readOnly &&
            access.can(AdminCapabilities.platformRolePolicyManage);
        final content = AdminListShell(
          title: 'Access Control',
          subtitle:
              'Review fixed administrator policy. Doctor and Patient clinical access is not editable here.',
          actions: [
            IconButton(
              onPressed: _isLoading ? null : () => _load(),
              tooltip: 'Refresh access policies',
              icon: const Icon(Icons.refresh_rounded),
            ),
          ],
          child: _buildBody(canManage),
        );
        return adminPageScaffold(context, 'Access Control', content);
      },
    );
  }

  Widget _buildBody(bool canManage) {
    if (_isLoading && !_hasLoaded) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _policies.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Could not load access policies.'),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: _load,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Try again'),
            ),
          ],
        ),
      );
    }

    final ordered = [..._policies]
      ..sort((a, b) => a.role.index.compareTo(b.role.index));
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const _RoleHierarchyCard(),
          const SizedBox(height: 16),
          if (!canManage) const _PolicyReadOnlyNotice(),
          if (!canManage) const SizedBox(height: 16),
          for (final policy in ordered) ...[
            _PolicyCard(
              policy: policy,
              draft: _drafts[policy.role],
              conflict: _serverConflicts[policy.role],
              canEdit:
                  canManage &&
                  (policy.role == AdminRole.hospitalAdmin ||
                      policy.role == AdminRole.auditor),
              isBusy: _busyRole == policy.role,
              revisions: _history[policy.role] ?? const [],
              onCapabilityChanged: (capability, enabled) {
                final current = Map<String, bool>.from(
                  _drafts[policy.role] ?? policy.capabilities,
                );
                setState(() {
                  current[capability] = enabled;
                  _drafts[policy.role] = current;
                });
              },
              onDiscardDraft: () => setState(() {
                _drafts.remove(policy.role);
                _serverConflicts.remove(policy.role);
              }),
              onPreview: () => _previewAndSave(policy),
              onRestore: (revision) => _previewAndRestore(policy, revision),
            ),
            const SizedBox(height: 16),
          ],
          const _FixedClinicalRolesCard(),
          const SizedBox(height: 48),
        ],
      ),
    );
  }

  Future<void> _previewAndSave(AdminRolePolicyModel policy) async {
    final draft = _drafts[policy.role];
    if (draft == null || _mapsEqual(draft, policy.capabilities)) return;
    setState(() => _busyRole = policy.role);
    try {
      final preview = await _repository.previewRolePolicy(
        role: policy.role,
        capabilities: draft,
        expectedVersion: policy.policyVersion,
      );
      if (!mounted) return;
      final reason = await _showPreviewDialog(
        title: 'Review ${policy.label} changes',
        preview: preview,
        confirmLabel: 'Apply policy',
      );
      if (reason == null || !mounted) return;
      try {
        await _repository.updateRolePolicyV2(
          role: policy.role,
          capabilities: draft,
          expectedVersion: policy.policyVersion,
          changeReason: reason,
        );
        if (!mounted) return;
        setState(() {
          _drafts.remove(policy.role);
          _serverConflicts.remove(policy.role);
        });
        await AdminAccessScope.of(
          context,
          listen: false,
        ).refreshAfterPolicyUpdate();
        await _load(preserveDrafts: true);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Access policy updated.')),
          );
        }
      } catch (error) {
        await _handleMutationError(policy, error);
      }
    } on ApiException catch (error) {
      if (error.isConflict) {
        await _recordConflict(policy);
      } else if (mounted) {
        _showSafeError(error);
      }
    } catch (_) {
      if (mounted) {
        _showSafeErrorMessage(
          'The preview could not be loaded. Your draft was kept.',
        );
      }
    } finally {
      if (mounted) setState(() => _busyRole = null);
    }
  }

  Future<void> _previewAndRestore(
    AdminRolePolicyModel policy,
    AdminRolePolicyRevisionModel revision,
  ) async {
    setState(() => _busyRole = policy.role);
    try {
      final preview = await _repository.previewRolePolicyRestore(
        role: policy.role,
        revisionId: revision.id,
        expectedVersion: policy.policyVersion,
      );
      if (!mounted) return;
      final reason = await _showPreviewDialog(
        title:
            'Restore ${policy.label} to version ${revision.newPolicyVersion}?',
        preview: preview,
        confirmLabel: 'Restore as new version',
      );
      if (reason == null || !mounted) return;
      try {
        await _repository.restoreRolePolicy(
          role: policy.role,
          revisionId: revision.id,
          expectedVersion: policy.policyVersion,
          changeReason: reason,
        );
        if (!mounted) return;
        await AdminAccessScope.of(
          context,
          listen: false,
        ).refreshAfterPolicyUpdate();
        await _load(preserveDrafts: true);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Policy restored as a new policy version.'),
            ),
          );
        }
      } catch (error) {
        await _handleMutationError(policy, error);
      }
    } on ApiException catch (error) {
      if (error.isConflict) {
        await _recordConflict(policy);
      } else if (mounted) {
        _showSafeError(error);
      }
    } catch (_) {
      if (mounted) {
        _showSafeErrorMessage(
          'The restore preview could not be loaded. No changes were made.',
        );
      }
    } finally {
      if (mounted) setState(() => _busyRole = null);
    }
  }

  Future<String?> _showPreviewDialog({
    required String title,
    required AdminRolePolicyPreviewModel preview,
    required String confirmLabel,
  }) async {
    final reasonController = TextEditingController();
    final formKey = GlobalKey<FormState>();
    final result = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: SizedBox(
          width: 520,
          child: Form(
            key: formKey,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${preview.affectedActiveAccounts} active administrator account(s) will use this policy.',
                  ),
                  const SizedBox(height: 16),
                  _PreviewChanges(
                    label: 'Added',
                    capabilities: preview.added,
                    icon: Icons.add_circle_outline,
                  ),
                  const SizedBox(height: 12),
                  _PreviewChanges(
                    label: 'Removed',
                    capabilities: preview.removed,
                    icon: Icons.remove_circle_outline,
                  ),
                  if (preview.warnings.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    for (final warning in preview.warnings)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Icon(Icons.warning_amber_rounded, size: 20),
                            const SizedBox(width: 8),
                            Expanded(child: Text(warning)),
                          ],
                        ),
                      ),
                  ],
                  const SizedBox(height: 16),
                  TextFormField(
                    key: const Key('policy-change-reason'),
                    controller: reasonController,
                    decoration: const InputDecoration(
                      labelText: 'Reason for this change',
                      helperText:
                          'The reason is stored in permanent policy history.',
                    ),
                    minLines: 2,
                    maxLines: 4,
                    maxLength: 500,
                    validator: (value) =>
                        value == null || value.trim().length < 3
                        ? 'Enter at least 3 characters.'
                        : null,
                  ),
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
            key: const Key('confirm-policy-change'),
            onPressed: () {
              if (formKey.currentState!.validate()) {
                Navigator.pop(dialogContext, reasonController.text.trim());
              }
            },
            child: Text(confirmLabel),
          ),
        ],
      ),
    );
    reasonController.dispose();
    return result;
  }

  Future<void> _handleMutationError(
    AdminRolePolicyModel policy,
    Object error,
  ) async {
    if (error is ApiException && error.isConflict) {
      await _recordConflict(policy);
      return;
    }
    if (mounted) {
      _showSafeErrorMessage(
        error is ApiException
            ? '${error.message} Your draft was kept.'
            : 'The policy could not be updated. Your draft was kept.',
      );
    }
  }

  Future<void> _recordConflict(AdminRolePolicyModel policy) async {
    try {
      final current = await _repository.getRolePolicy(policy.role);
      if (!mounted) return;
      setState(() {
        _serverConflicts[policy.role] = current;
        _policies = _policies
            .map((item) => item.role == policy.role ? current : item)
            .toList(growable: false);
      });
    } catch (_) {
      if (!mounted) return;
    }
    if (mounted) {
      _showSafeErrorMessage(
        'This policy changed on the server. Your local draft was kept so you can compare it with the current policy.',
      );
    }
  }

  void _showSafeError(ApiException error) {
    _showSafeErrorMessage(error.message);
  }

  void _showSafeErrorMessage(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }
}

class _PolicyCard extends StatelessWidget {
  const _PolicyCard({
    required this.policy,
    required this.draft,
    required this.conflict,
    required this.canEdit,
    required this.isBusy,
    required this.revisions,
    required this.onCapabilityChanged,
    required this.onDiscardDraft,
    required this.onPreview,
    required this.onRestore,
  });

  final AdminRolePolicyModel policy;
  final Map<String, bool>? draft;
  final AdminRolePolicyModel? conflict;
  final bool canEdit;
  final bool isBusy;
  final List<AdminRolePolicyRevisionModel> revisions;
  final void Function(String capability, bool enabled) onCapabilityChanged;
  final VoidCallback onDiscardDraft;
  final VoidCallback onPreview;
  final ValueChanged<AdminRolePolicyRevisionModel> onRestore;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final values = draft ?? policy.capabilities;
    final hasDraft = draft != null && !_mapsEqual(draft!, policy.capabilities);
    final groups = <String, List<String>>{};
    for (final capability in values.keys) {
      final area = adminCapabilityInfo[capability]?.area ?? 'Other';
      groups.putIfAbsent(area, () => []).add(capability);
    }
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                CircleAvatar(
                  child: Icon(
                    policy.role == AdminRole.auditor
                        ? Icons.visibility_outlined
                        : Icons.admin_panel_settings_outlined,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        policy.label,
                        style: theme.textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Text(
                        policy.description.isEmpty
                            ? _roleDescription(policy.role)
                            : policy.description,
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                Chip(label: Text('Version ${policy.policyVersion}')),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 12,
              runSpacing: 8,
              children: [
                Text('${policy.activeAccountCount} active account(s)'),
                Text(
                  policy.updatedAt == null
                      ? 'Last change unavailable'
                      : 'Changed ${_formatDate(policy.updatedAt!)}',
                ),
                if (policy.changeReason != null)
                  Text('Reason: ${policy.changeReason}'),
              ],
            ),
            if (conflict != null) ...[
              const SizedBox(height: 14),
              Material(
                color: theme.colorScheme.errorContainer,
                borderRadius: BorderRadius.circular(8),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    children: [
                      Icon(
                        Icons.sync_problem_outlined,
                        color: theme.colorScheme.onErrorContainer,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Server version ${conflict!.policyVersion} is newer. Your local draft is still shown; compare it before previewing again.',
                          style: TextStyle(
                            color: theme.colorScheme.onErrorContainer,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
            const Divider(height: 28),
            for (final group in groups.entries) ...[
              Text(
                group.key,
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 6),
              for (final capability in group.value)
                _CapabilityRow(
                  capability: capability,
                  enabled: values[capability] == true,
                  editable: canEdit,
                  onChanged: (value) => onCapabilityChanged(capability, value),
                ),
              const SizedBox(height: 12),
            ],
            if (canEdit && hasDraft) ...[
              const Divider(),
              Wrap(
                spacing: 10,
                runSpacing: 8,
                children: [
                  FilledButton.icon(
                    key: Key('preview-${policy.role.wireValue}'),
                    onPressed: isBusy ? null : onPreview,
                    icon: isBusy
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.preview_outlined),
                    label: const Text('Preview changes'),
                  ),
                  TextButton(
                    onPressed: isBusy ? null : onDiscardDraft,
                    child: const Text('Discard draft'),
                  ),
                ],
              ),
            ],
            if (revisions.isNotEmpty) ...[
              const Divider(height: 28),
              ExpansionTile(
                tilePadding: EdgeInsets.zero,
                title: const Text('Policy history'),
                subtitle: Text('${revisions.length} recorded change(s)'),
                children: [
                  for (final revision in revisions)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.history_rounded),
                      title: Text(
                        'Version ${revision.newPolicyVersion}: ${revision.changeReason}',
                      ),
                      subtitle: Text(
                        '${revision.affectedActiveAccountCount} active account(s) affected${revision.createdAt == null ? '' : ' • ${_formatDate(revision.createdAt!)}'}',
                      ),
                      trailing:
                          canEdit &&
                              revision.newPolicyVersion < policy.policyVersion
                          ? TextButton(
                              onPressed: isBusy
                                  ? null
                                  : () => onRestore(revision),
                              child: const Text('Restore'),
                            )
                          : null,
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _CapabilityRow extends StatelessWidget {
  const _CapabilityRow({
    required this.capability,
    required this.enabled,
    required this.editable,
    required this.onChanged,
  });

  final String capability;
  final bool enabled;
  final bool editable;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final info = adminCapabilityInfo[capability];
    final title = info?.label ?? capability;
    final description = info?.description ?? capability;
    if (editable) {
      return Semantics(
        label: '$title permission. ${enabled ? 'Enabled' : 'Disabled'}',
        child: SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(title),
          subtitle: Text(description),
          value: enabled,
          onChanged: onChanged,
        ),
      );
    }
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(
        enabled ? Icons.check_circle_outline : Icons.remove_circle_outline,
      ),
      title: Text(title),
      subtitle: Text(description),
      trailing: Text(enabled ? 'Included' : 'Not included'),
    );
  }
}

class _PreviewChanges extends StatelessWidget {
  const _PreviewChanges({
    required this.label,
    required this.capabilities,
    required this.icon,
  });

  final String label;
  final List<String> capabilities;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.titleSmall),
        const SizedBox(height: 4),
        if (capabilities.isEmpty)
          const Text('None')
        else
          for (final capability in capabilities)
            ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              leading: Icon(icon, size: 20),
              title: Text(adminCapabilityInfo[capability]?.label ?? capability),
            ),
      ],
    );
  }
}

class _RoleHierarchyCard extends StatelessWidget {
  const _RoleHierarchyCard();

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Fixed administrator hierarchy',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 12),
            const Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                _HierarchyRole(
                  icon: Icons.shield_outlined,
                  title: 'Application Admin',
                  subtitle: 'Global platform authority; policy is locked',
                ),
                _HierarchyRole(
                  icon: Icons.local_hospital_outlined,
                  title: 'Hospital Admin',
                  subtitle: 'One-hospital operational authority',
                ),
                _HierarchyRole(
                  icon: Icons.visibility_outlined,
                  title: 'System Auditor',
                  subtitle: 'Global and always read-only',
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _HierarchyRole extends StatelessWidget {
  const _HierarchyRole({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 240,
      child: ListTile(
        contentPadding: EdgeInsets.zero,
        leading: Icon(icon),
        title: Text(title),
        subtitle: Text(subtitle),
      ),
    );
  }
}

class _PolicyReadOnlyNotice extends StatelessWidget {
  const _PolicyReadOnlyNotice();

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Theme.of(context).colorScheme.secondaryContainer,
      borderRadius: BorderRadius.circular(12),
      child: const Padding(
        padding: EdgeInsets.all(14),
        child: Row(
          children: [
            Icon(Icons.visibility_outlined),
            SizedBox(width: 10),
            Expanded(
              child: Text(
                'Read-only policy review. System Auditors can inspect policy and history but cannot edit, preview, save, or restore.',
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FixedClinicalRolesCard extends StatelessWidget {
  const _FixedClinicalRolesCard();

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Fixed clinical roles',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 8),
            const Text(
              'Doctor and Patient authorization is fixed by clinical relationships and ownership rules. It is intentionally not editable in administrator RBAC.',
            ),
            const SizedBox(height: 8),
            const ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(Icons.medical_services_outlined),
              title: Text('Doctor'),
              subtitle: Text('Fixed clinical permissions'),
            ),
            const ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(Icons.person_outline),
              title: Text('Patient'),
              subtitle: Text('Fixed self-service permissions'),
            ),
          ],
        ),
      ),
    );
  }
}

bool _mapsEqual(Map<String, bool> a, Map<String, bool> b) {
  if (a.length != b.length) return false;
  for (final entry in a.entries) {
    if (b[entry.key] != entry.value) return false;
  }
  return true;
}

String _roleDescription(AdminRole role) => switch (role) {
  AdminRole.appAdmin =>
    'Protected global platform authority. This policy cannot be edited in the portal.',
  AdminRole.hospitalAdmin =>
    'Tenant-scoped operational authority for one assigned hospital.',
  AdminRole.auditor =>
    'Configurable global read access. System Auditors remain hard read-only.',
};

String _formatDate(DateTime date) {
  final local = date.toLocal();
  return '${local.year}-${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')}';
}
