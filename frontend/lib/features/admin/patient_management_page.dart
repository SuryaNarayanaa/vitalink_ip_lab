import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/query/admin_query_keys.dart';
import 'package:frontend/core/widgets/admin/admin_dialogs.dart';
import 'package:frontend/core/widgets/admin/admin_scaffold.dart';
import 'package:frontend/features/admin/data/admin_repository.dart';

class PatientManagementPage extends StatefulWidget {
  const PatientManagementPage({super.key});

  @override
  State<PatientManagementPage> createState() => _PatientManagementPageState();
}

class _PatientManagementPageState extends State<PatientManagementPage> {
  final AdminRepository _repo = AppDependencies.adminRepository;
  final TextEditingController _searchController = TextEditingController();
  int _page = 1;
  String? _statusFilter;
  String? _doctorFilter;
  int _refreshKey = 0;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _refresh() => setState(() => _refreshKey++);

  @override
  Widget build(BuildContext context) {
    final search = _searchController.text.trim();

    return UseQuery<Map<String, dynamic>>(
      options: QueryOptions<Map<String, dynamic>>(
        queryKey: AdminQueryKeys.patients(
          page: _page,
          search: search,
          statusFilter: _statusFilter ?? '',
          doctorFilter: _doctorFilter ?? '',
          refreshKey: _refreshKey,
        ),
        queryFn: () => _repo.getAllPatients(
          page: _page,
          search: search.isNotEmpty ? search : null,
          accountStatus: _statusFilter,
          assignedDoctorId: _doctorFilter,
        ),
      ),
      builder: (context, query) {
        final dataMap = query.data ?? {};
        final patientsList = dataMap['patients'] as List? ?? [];
        final pagination = dataMap['pagination'] as Map<String, dynamic>? ?? {};
        final total = pagination['total'] as int? ?? patientsList.length;
        final pageSize = pagination['limit'] as int? ?? 20;
        final totalPages =
            pagination['pages'] as int? ?? (total / pageSize).ceil();
        final showPageScaffold = !AdminScaffold.usesShellAppBar(context);

        final addPatientFab = FloatingActionButton.extended(
          onPressed: () => showAddPatientDialog(context, onSuccess: _refresh),
          icon: const Icon(Icons.person_add_alt_1_rounded),
          label: const Text('Add Patient'),
        );

        final content = Column(
          children: [
            if (!showPageScaffold)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Patient Management',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 12),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        FilledButton.tonalIcon(
                          onPressed: () => _showFilterSheet(context),
                          icon: const Icon(Icons.filter_list_rounded),
                          label: const Text('Filter'),
                        ),
                        const SizedBox(width: 8),
                        FilledButton.tonalIcon(
                          onPressed: _refresh,
                          icon: const Icon(Icons.refresh_rounded),
                          label: const Text('Refresh'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            // Search
            Padding(
              padding: const EdgeInsets.all(16),
              child: TextField(
                controller: _searchController,
                decoration: InputDecoration(
                  hintText: 'Search patients by name or ID...',
                  prefixIcon: const Icon(Icons.search_rounded),
                  filled: true,
                  fillColor:
                      Theme.of(context).colorScheme.surfaceContainerHighest,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(28),
                    borderSide: BorderSide.none,
                  ),
                  suffixIcon: _searchController.text.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear),
                          onPressed: () {
                            _searchController.clear();
                            setState(() => _page = 1);
                          },
                        )
                      : null,
                ),
                onChanged: (_) => setState(() => _page = 1),
              ),
            ),

            // Filter chips
            if (_statusFilter != null || _doctorFilter != null)
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  children: [
                    if (_statusFilter != null)
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: InputChip(
                          label: Text(_statusFilter!),
                          onDeleted: () => setState(() {
                            _statusFilter = null;
                            _page = 1;
                          }),
                        ),
                      ),
                    if (_doctorFilter != null)
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: InputChip(
                          label: Text('Doctor: $_doctorFilter'),
                          onDeleted: () => setState(() {
                            _doctorFilter = null;
                            _page = 1;
                          }),
                        ),
                      ),
                    TextButton(
                      onPressed: () => setState(() {
                        _statusFilter = null;
                        _doctorFilter = null;
                        _page = 1;
                      }),
                      child: const Text('Clear All'),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 8),

            // List
            Expanded(
              child: query.isLoading
                  ? const Center(child: CircularProgressIndicator())
                  : query.isError
                      ? Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Text('Error: ${query.error}'),
                              const SizedBox(height: 16),
                              FilledButton(
                                onPressed: _refresh,
                                child: const Text('Retry'),
                              ),
                            ],
                          ),
                        )
                      : patientsList.isEmpty
                          ? const Center(
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(
                                    Icons.people_outline_rounded,
                                    size: 48,
                                    color: Colors.grey,
                                  ),
                                  SizedBox(height: 16),
                                  Text('No patients found'),
                                ],
                              ),
                            )
                          : ListView.builder(
                              padding: const EdgeInsets.only(bottom: 80),
                              itemCount: patientsList.length,
                              itemBuilder: (context, index) {
                                final patient =
                                    patientsList[index] as Map<String, dynamic>;
                                return _PatientListTile(
                                  patient: patient,
                                  onRefresh: _refresh,
                                );
                              },
                            ),
            ),

            // Pagination
            if (totalPages > 1)
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  border: Border(
                    top: BorderSide(color: Theme.of(context).dividerColor),
                  ),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.chevron_left_rounded),
                      onPressed:
                          _page > 1 ? () => setState(() => _page--) : null,
                    ),
                    Text('Page $_page of $totalPages'),
                    IconButton(
                      icon: const Icon(Icons.chevron_right_rounded),
                      onPressed: _page < totalPages
                          ? () => setState(() => _page++)
                          : null,
                    ),
                  ],
                ),
              ),
          ],
        );

        if (showPageScaffold) {
          return Scaffold(
            appBar: AppBar(
              title: const Text('Patient Management'),
              actions: [
                IconButton(
                  icon: const Icon(Icons.filter_list_rounded),
                  onPressed: () => _showFilterSheet(context),
                ),
                IconButton(
                  icon: const Icon(Icons.refresh_rounded),
                  onPressed: _refresh,
                ),
              ],
            ),
            floatingActionButton: addPatientFab,
            body: content,
          );
        }

        return Stack(
          children: [
            Positioned.fill(child: content),
            Positioned(
              right: 16,
              bottom: 16,
              child: SafeArea(
                top: false,
                left: false,
                child: addPatientFab,
              ),
            ),
          ],
        );
      },
    );
  }

  void _showFilterSheet(BuildContext context) {
    String? status = _statusFilter;
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.of(ctx).viewInsets.bottom,
            left: 24,
            right: 24,
            top: 24,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Filter Patients',
                style: Theme.of(ctx).textTheme.headlineSmall,
              ),
              const SizedBox(height: 24),
              Text('Account Status', style: Theme.of(ctx).textTheme.titleSmall),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: [
                  FilterChip(
                    label: const Text('All'),
                    selected: status == null,
                    onSelected: (_) => setSheetState(() => status = null),
                  ),
                  FilterChip(
                    label: const Text('Active'),
                    selected: status == 'Active',
                    onSelected: (_) => setSheetState(() => status = 'Active'),
                  ),
                  FilterChip(
                    label: const Text('Discharged'),
                    selected: status == 'Discharged',
                    onSelected: (_) =>
                        setSheetState(() => status = 'Discharged'),
                  ),
                ],
              ),
              const SizedBox(height: 32),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () {
                        setState(() {
                          _statusFilter = null;
                          _doctorFilter = null;
                          _page = 1;
                        });
                        Navigator.pop(ctx);
                      },
                      child: const Text('Reset'),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: FilledButton(
                      onPressed: () {
                        setState(() {
                          _statusFilter = status;
                          _page = 1;
                        });
                        Navigator.pop(ctx);
                      },
                      child: const Text('Apply'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }
}

class _PatientListTile extends StatelessWidget {
  final Map<String, dynamic> patient;
  final VoidCallback onRefresh;

  const _PatientListTile({required this.patient, required this.onRefresh});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final profile = patient['profile_id'] as Map<String, dynamic>? ??
        patient['patient_profile'] as Map<String, dynamic>? ??
        {};
    final demographics = profile['demographics'] as Map<String, dynamic>? ?? {};
    final name = demographics['name'] as String? ??
        patient['login_id'] as String? ??
        'Unknown';
    final age = demographics['age'];
    final gender = demographics['gender'] as String? ?? '';
    final isActive = patient['is_active'] as bool? ?? true;
    final id = patient['_id'] as String? ??
        patient['id'] as String? ??
        patient['user_id'] as String? ??
        '';
    final opNum = patient['login_id'] as String? ?? '';
    final details = [
      if (age != null) 'Age: $age',
      if (gender.isNotEmpty) gender,
    ].join(' | ');

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 8, 14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CircleAvatar(
              backgroundColor: theme.colorScheme.primaryContainer,
              child: Text(
                name.isNotEmpty ? name[0].toUpperCase() : '?',
                style: TextStyle(color: theme.colorScheme.onPrimaryContainer),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Text(
                          name,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.titleMedium,
                        ),
                      ),
                      PopupMenuButton<String>(
                        padding: EdgeInsets.zero,
                        icon: const Icon(Icons.more_vert_rounded),
                        onSelected: (action) => _handleAction(
                          context,
                          action,
                          id,
                          name,
                          opNum,
                          demographics,
                          isActive,
                        ),
                        itemBuilder: (_) => [
                          const PopupMenuItem(
                            value: 'edit',
                            child: ListTile(
                              leading: Icon(Icons.edit_rounded, size: 20),
                              title: Text('Edit'),
                              contentPadding: EdgeInsets.zero,
                              visualDensity: VisualDensity.compact,
                            ),
                          ),
                          const PopupMenuItem(
                            value: 'reassign',
                            child: ListTile(
                              leading: Icon(Icons.swap_horiz_rounded, size: 20),
                              title: Text('Reassign Doctor'),
                              contentPadding: EdgeInsets.zero,
                              visualDensity: VisualDensity.compact,
                            ),
                          ),
                          const PopupMenuItem(
                            value: 'password',
                            child: ListTile(
                              leading: Icon(Icons.lock_reset_rounded, size: 20),
                              title: Text('Reset Password'),
                              contentPadding: EdgeInsets.zero,
                              visualDensity: VisualDensity.compact,
                            ),
                          ),
                          PopupMenuItem(
                            value: 'status',
                            child: ListTile(
                              leading: Icon(
                                isActive
                                    ? Icons.block_rounded
                                    : Icons.check_circle_outline_rounded,
                                size: 20,
                                color: isActive ? Colors.red : Colors.green,
                              ),
                              title: Text(
                                isActive ? 'Deactivate' : 'Activate',
                                style: TextStyle(
                                  color: isActive ? Colors.red : Colors.green,
                                ),
                              ),
                              contentPadding: EdgeInsets.zero,
                              visualDensity: VisualDensity.compact,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      if (opNum.isNotEmpty)
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: theme.colorScheme.surfaceContainerHighest,
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            'OP #$opNum',
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: isActive
                              ? theme.colorScheme.primaryContainer
                              : theme.colorScheme.errorContainer,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          isActive ? 'Active' : 'Inactive',
                          style: theme.textTheme.labelSmall?.copyWith(
                            color: isActive
                                ? theme.colorScheme.onPrimaryContainer
                                : theme.colorScheme.onErrorContainer,
                          ),
                        ),
                      ),
                    ],
                  ),
                  if (details.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Text(
                      details,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.outline,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _handleAction(
    BuildContext context,
    String action,
    String id,
    String name,
    String opNum,
    Map<String, dynamic> demographics,
    bool isActive,
  ) {
    switch (action) {
      case 'edit':
        showEditPatientDialog(
          context,
          patientId: id,
          currentData: demographics,
          onSuccess: onRefresh,
        );
        break;
      case 'password':
        showResetPasswordDialog(
          context,
          userId: id,
          userName: name,
          onSuccess: onRefresh,
        );
        break;
      case 'reassign':
        showReassignPatientDialog(
          context,
          patientOpNum: opNum,
          currentDoctorId: '',
          onSuccess: onRefresh,
        );
        break;
      case 'status':
        showStatusToggleDialog(
          context,
          isActive: isActive,
          userName: name,
          userType: 'Patient',
          onConfirm: () async {
            await AppDependencies.adminRepository.updatePatient(id, {
              'is_active': !isActive,
              'account_status': !isActive ? 'Active' : 'Discharged',
            });
          },
          onSuccess: onRefresh,
        );
        break;
    }
  }
}
