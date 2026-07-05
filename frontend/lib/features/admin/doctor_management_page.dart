import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/query/admin_query_keys.dart';
import 'package:frontend/core/widgets/admin/admin_dialogs.dart';
import 'package:frontend/core/widgets/admin/admin_scaffold.dart';
import 'package:frontend/core/widgets/common/api_error_state.dart';
import 'package:frontend/features/admin/data/admin_repository.dart';

class DoctorManagementPage extends StatefulWidget {
  const DoctorManagementPage({super.key});

  @override
  State<DoctorManagementPage> createState() => _DoctorManagementPageState();
}

class _DoctorManagementPageState extends State<DoctorManagementPage> {
  final AdminRepository _repo = AppDependencies.adminRepository;
  final TextEditingController _searchController = TextEditingController();
  int _page = 1;
  String? _statusFilter;
  String? _departmentFilter;
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
        queryKey: AdminQueryKeys.doctors(
          page: _page,
          search: search,
          statusFilter: _statusFilter ?? '',
          departmentFilter: _departmentFilter ?? '',
          refreshKey: _refreshKey,
        ),
        queryFn: () => _repo.getAllDoctors(
          page: _page,
          search: search.isNotEmpty ? search : null,
          isActive: _statusFilter,
          department: _departmentFilter,
        ),
      ),
      builder: (context, query) {
        final dataMap = query.data ?? {};
        final doctorsList = dataMap['doctors'] as List? ?? [];
        final pagination = dataMap['pagination'] as Map<String, dynamic>? ?? {};
        final total = pagination['total'] as int? ?? doctorsList.length;
        final pageSize = pagination['limit'] as int? ?? 20;
        final totalPages =
            pagination['pages'] as int? ?? (total / pageSize).ceil();
        final showPageScaffold = !AdminScaffold.usesShellAppBar(context);

        final addDoctorFab = FloatingActionButton.extended(
          onPressed: () => showAddDoctorDialog(context, onSuccess: _refresh),
          icon: const Icon(Icons.add),
          label: const Text('Add Doctor'),
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
                      'Manage Doctors',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 12),
                    Align(
                      alignment: Alignment.centerRight,
                      child: FilledButton.tonalIcon(
                        onPressed: _refresh,
                        icon: const Icon(Icons.refresh_rounded),
                        label: const Text('Refresh'),
                      ),
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
                  hintText: 'Search doctors by name or ID...',
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
            if (_statusFilter != null || _departmentFilter != null)
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  children: [
                    if (_statusFilter != null)
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: InputChip(
                          label: Text(
                            _statusFilter == 'true' ? 'Active' : 'Inactive',
                          ),
                          onDeleted: () => setState(() {
                            _statusFilter = null;
                            _page = 1;
                          }),
                        ),
                      ),
                    if (_departmentFilter != null)
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: InputChip(
                          label: Text(_departmentFilter!),
                          onDeleted: () => setState(() {
                            _departmentFilter = null;
                            _page = 1;
                          }),
                        ),
                      ),
                    TextButton(
                      onPressed: () => setState(() {
                        _statusFilter = null;
                        _departmentFilter = null;
                        _page = 1;
                      }),
                      child: const Text('Clear All'),
                    ),
                  ],
                ),
              ),

            // Filter bar
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  FilterChip(
                    label: const Text('All'),
                    selected: _statusFilter == null,
                    onSelected: (_) => setState(() {
                      _statusFilter = null;
                      _page = 1;
                    }),
                  ),
                  const SizedBox(width: 8),
                  FilterChip(
                    label: const Text('Active'),
                    selected: _statusFilter == 'true',
                    onSelected: (_) => setState(() {
                      _statusFilter = 'true';
                      _page = 1;
                    }),
                  ),
                  const SizedBox(width: 8),
                  FilterChip(
                    label: const Text('Inactive'),
                    selected: _statusFilter == 'false',
                    onSelected: (_) => setState(() {
                      _statusFilter = 'false';
                      _page = 1;
                    }),
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
                      ? ApiErrorState(
                          error: query.error,
                          onRetry: _refresh,
                        )
                      : doctorsList.isEmpty
                          ? const Center(
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(
                                    Icons.medical_services_outlined,
                                    size: 48,
                                    color: Colors.grey,
                                  ),
                                  SizedBox(height: 16),
                                  Text('No doctors found'),
                                ],
                              ),
                            )
                          : ListView.builder(
                              padding: const EdgeInsets.only(bottom: 80),
                              itemCount: doctorsList.length,
                              itemBuilder: (context, index) {
                                final doc =
                                    doctorsList[index] as Map<String, dynamic>;
                                return _DoctorListTile(
                                  doctor: doc,
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
              title: const Text('Manage Doctors'),
              actions: [
                IconButton(
                  icon: const Icon(Icons.refresh_rounded),
                  onPressed: _refresh,
                ),
              ],
            ),
            floatingActionButton: addDoctorFab,
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
                child: addDoctorFab,
              ),
            ),
          ],
        );
      },
    );
  }
}

class _DoctorListTile extends StatelessWidget {
  final Map<String, dynamic> doctor;
  final VoidCallback onRefresh;

  const _DoctorListTile({required this.doctor, required this.onRefresh});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final profile = doctor['profile_id'] as Map<String, dynamic>? ??
        doctor['doctor_profile'] as Map<String, dynamic>? ??
        {};
    final name = profile['name'] as String? ??
        doctor['login_id'] as String? ??
        'Unknown';
    final department = profile['department'] as String? ?? 'General';
    final isActive = doctor['is_active'] as bool? ?? true;
    final id = doctor['_id'] as String? ??
        doctor['id'] as String? ??
        doctor['user_id'] as String? ??
        '';

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: theme.colorScheme.primaryContainer,
          child: Text(
            name.isNotEmpty ? name[0].toUpperCase() : '?',
            style: TextStyle(color: theme.colorScheme.onPrimaryContainer),
          ),
        ),
        title: Text(name, style: theme.textTheme.titleMedium),
        subtitle: Text(
          department,
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.outline,
          ),
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
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
            PopupMenuButton<String>(
              icon: const Icon(Icons.more_vert_rounded),
              onSelected: (action) =>
                  _handleAction(context, action, id, name, profile, isActive),
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
                          color: isActive ? Colors.red : Colors.green),
                    ),
                    contentPadding: EdgeInsets.zero,
                    visualDensity: VisualDensity.compact,
                  ),
                ),
              ],
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
    Map<String, dynamic> profile,
    bool isActive,
  ) {
    switch (action) {
      case 'edit':
        showEditDoctorDialog(
          context,
          doctorId: id,
          currentData: profile,
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
      case 'status':
        showStatusToggleDialog(
          context,
          isActive: isActive,
          userName: name,
          userType: 'Doctor',
          onConfirm: () async {
            await AppDependencies.adminRepository.updateDoctor(id, {
              'is_active': !isActive,
            });
          },
          onSuccess: onRefresh,
        );
        break;
    }
  }
}
