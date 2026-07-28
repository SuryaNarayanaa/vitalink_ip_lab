import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/query/admin_query_keys.dart';
import 'package:frontend/core/widgets/admin/admin_access_gate.dart';
import 'package:frontend/core/widgets/admin/admin_access_scope.dart';
import 'package:frontend/core/widgets/admin/admin_action_confirmation.dart';
import 'package:frontend/features/admin/admin_capabilities.dart';
import 'package:frontend/features/admin/admin_console_components.dart';
import 'package:frontend/features/admin/models/admin_access_model.dart';

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
    return AdminAccessGate(
      anyCapabilities: const [AdminCapabilities.platformHospitalsRead],
      roles: const {AdminRole.appAdmin, AdminRole.auditor},
      scope: AdminScope.global,
      builder: (context) {
        final canManage = AdminAccessScope.can(
          context,
          AdminCapabilities.platformHospitalsManage,
        );
        return UseQuery<Map<String, dynamic>>(
          options: QueryOptions<Map<String, dynamic>>(
            queryKey: AdminQueryKeys.hospitals(
              refreshKey: _refreshKey,
              status: _status,
              search: _search.text.trim(),
            ),
            queryFn: () => _repo.getHospitals(
              search: _search.text.trim(),
              status: _status,
            ),
          ),
          builder: (context, query) {
            final hospitals = query.data?['hospitals'] as List? ?? const [];
            final content = AdminListShell(
              title: 'Hospitals',
              subtitle: canManage
                  ? 'Manage hospital tenants, status, and platform access.'
                  : 'Read-only hospital directory and operational metadata.',
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
                    DropdownMenuItem(
                      value: 'suspended',
                      child: Text('Suspended'),
                    ),
                    DropdownMenuItem(
                      value: 'inactive',
                      child: Text('Inactive'),
                    ),
                  ],
                  onChanged: (value) => setState(() {
                    _status = value;
                    _refreshKey++;
                  }),
                ),
                if (canManage)
                  FilledButton.icon(
                    onPressed: () => _showHospitalDialog(context),
                    icon: const Icon(Icons.add_business_rounded),
                    label: const Text('Add'),
                  ),
              ],
              child: AdminQueryBody<Map<String, dynamic>>(
                query: query,
                emptyIcon: Icons.local_hospital_outlined,
                emptyText: 'No hospitals found',
                isEmpty: hospitals.isEmpty,
                child: ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: hospitals.length,
                  itemBuilder: (context, index) {
                    final h = hospitals[index] as Map<String, dynamic>;
                    final id = (h['id'] ?? h['_id']).toString();
                    final name = (h['name'] ?? 'Hospital').toString();
                    final status = (h['status'] ?? 'inactive').toString();
                    return AdminRecordCard(
                      icon: Icons.local_hospital_rounded,
                      title: name,
                      badge: status,
                      details: [
                        AdminDetail(Icons.tag_rounded, id),
                        AdminDetail(
                          Icons.place_rounded,
                          '${h['location'] ?? '--'}',
                        ),
                        AdminDetail(
                          Icons.mail_outline_rounded,
                          '${h['admin'] ?? '--'}',
                        ),
                        AdminDetail(
                          Icons.medical_services_outlined,
                          '${h['doctors'] ?? 0} doctors',
                        ),
                        AdminDetail(
                          Icons.people_outline,
                          '${h['patients'] ?? 0} patients',
                        ),
                      ],
                      menu: canManage
                          ? [
                              PopupMenuItem(
                                value: 'edit',
                                child: const Text('Edit hospital'),
                                onTap: () => Future.microtask(() {
                                  if (mounted) {
                                    _showHospitalDialog(
                                      this.context,
                                      hospital: h,
                                    );
                                  }
                                }),
                              ),
                              PopupMenuItem(
                                value: 'status',
                                child: Text(
                                  status == 'active' ? 'Suspend' : 'Activate',
                                ),
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
                            ]
                          : const [],
                    );
                  },
                ),
              ),
            );
            return adminPageScaffold(context, 'Hospitals', content);
          },
        );
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

  Future<void> _confirmHospitalDeactivation(
    String hospitalName,
    String id,
  ) async {
    final confirmed = await showAdminActionConfirmation(
      context,
      title: 'Deactivate $hospitalName?',
      message:
          'This removes platform access for the hospital. You can reactivate it later.',
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
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(successMessage)));
    } catch (e) {
      if (mounted) showAdminError(context, e);
    }
  }

  Future<void> _showHospitalDialog(
    BuildContext context, {
    Map<String, dynamic>? hospital,
  }) async {
    final name = TextEditingController(text: '${hospital?['name'] ?? ''}');
    final location = TextEditingController(
      text: '${hospital?['location'] ?? ''}',
    );
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
                decoration: const InputDecoration(labelText: 'Hospital name'),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: location,
                decoration: const InputDecoration(labelText: 'Location'),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: admin,
                decoration: const InputDecoration(labelText: 'Admin email'),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: status,
                decoration: const InputDecoration(labelText: 'Status'),
                items: const [
                  DropdownMenuItem(value: 'active', child: Text('Active')),
                  DropdownMenuItem(
                    value: 'suspended',
                    child: Text('Suspended'),
                  ),
                ],
                onChanged: (value) => status = value ?? status,
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancel'),
          ),
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
                if (mounted) _refresh();
              } catch (e) {
                if (dialogContext.mounted) showAdminError(dialogContext, e);
              }
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
    name.dispose();
    location.dispose();
    admin.dispose();
  }
}
