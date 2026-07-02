import 'package:flutter/material.dart';
import 'package:frontend/core/widgets/index.dart';
import 'package:frontend/app/routers.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/query/patient_query_keys.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';

class PatientProfilePage extends StatefulWidget {
  final bool embedInShell;
  final ValueChanged<int>? onTabChanged;

  const PatientProfilePage({
    super.key,
    this.embedInShell = false,
    this.onTabChanged,
  });

  @override
  State<PatientProfilePage> createState() => _PatientProfilePageState();
}

class _PatientProfilePageState extends State<PatientProfilePage> {
  final int _currentNavIndex = 4;

  @override
  Widget build(BuildContext context) {
    final bottomPadding = widget.embedInShell ? 24.0 : 32.0;

    return UseQuery<Map<String, dynamic>>(
      options: QueryOptions<Map<String, dynamic>>(
        queryKey: PatientQueryKeys.profileFull(),
        queryFn: () async {
          final profile = await AppDependencies.patientRepository.getProfile();
          final history =
              await AppDependencies.patientRepository.getINRHistory();
          final latest = await AppDependencies.patientRepository.getLatestINR();
          final doctorUpdates = await AppDependencies.patientRepository
              .getDoctorUpdates(limit: 5);
          return {
            'profile': profile,
            'history': history,
            'latest': latest,
            'doctorUpdates': doctorUpdates,
          };
        },
      ),
      builder: (context, query) {
        if (query.isLoading) {
          return _buildPageContainer(
            body: const Center(child: CircularProgressIndicator()),
          );
        }

        if (query.isError) {
          return _buildPageContainer(
            body: Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text('Error: ${query.error}'),
                  const SizedBox(height: 16),
                  ElevatedButton(
                      onPressed: () => query.refetch(),
                      child: const Text('Retry')),
                ],
              ),
            ),
          );
        }

        if (!query.hasData) {
          return _buildPageContainer(
            body: const Center(child: CircularProgressIndicator()),
          );
        }

        final data = query.data!;
        final profile = data['profile'] as Map<String, dynamic>;
        final doctorUpdates =
            (data['doctorUpdates'] as List?)?.cast<Map<String, dynamic>>() ??
                [];
        final unreadCount =
            (profile['doctorUpdatesUnreadCount'] as num?)?.toInt() ?? 0;

        return _buildPageContainer(
          bodyDecoration: const BoxDecoration(
            color: Color(0xFFF9FAFB),
          ),
          body: RefreshIndicator(
            onRefresh: () async => query.refetch(),
            child: SingleChildScrollView(
              padding: EdgeInsets.fromLTRB(20, 32, 20, bottomPadding),
              physics: const AlwaysScrollableScrollPhysics(),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Top Section (Avatar, Name, Info Cards, Details, Actions)
                  PatientProfileContent(
                    profile: profile,
                    onProfileUpdated: () => query.refetch(),
                  ),
                  const SizedBox(height: 20),
                  _DoctorUpdatesCard(
                    updates: doctorUpdates,
                    unreadCount: unreadCount,
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildPageContainer({
    required Widget body,
    Decoration? bodyDecoration,
  }) {
    if (widget.embedInShell) {
      return body;
    }

    return PatientScaffold(
      pageTitle: 'My Profile',
      currentNavIndex: _currentNavIndex,
      onNavChanged: _handleNav,
      bodyDecoration: bodyDecoration,
      body: body,
    );
  }

  void _handleNav(int index) {
    if (index == _currentNavIndex) return;
    if (widget.embedInShell) {
      widget.onTabChanged?.call(index);
      return;
    }
    switch (index) {
      case 0:
        Navigator.of(context).pushReplacementNamed(AppRoutes.patient);
        break;
      case 1:
        Navigator.of(context).pushReplacementNamed(AppRoutes.patientUpdateINR);
        break;
      case 2:
        Navigator.of(context).pushReplacementNamed(AppRoutes.patientTakeDosage);
        break;
      case 3:
        Navigator.of(context)
            .pushReplacementNamed(AppRoutes.patientHealthReports);
        break;
      case 4:
        break;
    }
  }
}

class _DoctorUpdatesCard extends StatelessWidget {
  const _DoctorUpdatesCard({
    required this.updates,
    required this.unreadCount,
  });

  final List<Map<String, dynamic>> updates;
  final int unreadCount;
  static const int _maxVisibleUpdates = 3;
  static const double _updateTileHeight = 112;

  @override
  Widget build(BuildContext context) {
    final visibleCount = updates.length.clamp(1, _maxVisibleUpdates);
    final listHeight =
        (visibleCount * _updateTileHeight) + ((visibleCount - 1) * 10);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 8,
            runSpacing: 8,
            children: [
              const Icon(
                Icons.notifications_active_outlined,
                size: 20,
                color: Color(0xFF2563EB),
              ),
              const Text(
                'Doctor Updates',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
              ),
              if (unreadCount > 0)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEF4444),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    '$unreadCount new',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 12),
          if (updates.isEmpty)
            const Text(
              'No recent doctor changes.',
              style: TextStyle(color: Color(0xFF6B7280)),
            )
          else
            SizedBox(
              height: listHeight,
              child: Scrollbar(
                thumbVisibility: updates.length > _maxVisibleUpdates,
                child: ListView.separated(
                  primary: false,
                  itemCount: updates.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (context, index) => _DoctorUpdateTile(
                    event: updates[index],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _DoctorUpdateTile extends StatelessWidget {
  const _DoctorUpdateTile({required this.event});

  final Map<String, dynamic> event;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      constraints: const BoxConstraints(minHeight: 112),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: event['isRead'] == true
            ? const Color(0xFFF9FAFB)
            : const Color(0xFFEEF2FF),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            event['title']?.toString() ?? 'Doctor update',
            style: const TextStyle(fontWeight: FontWeight.w600),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 4),
          Text(
            event['message']?.toString() ?? '',
            style: const TextStyle(color: Color(0xFF374151), fontSize: 13),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 4),
          Text(
            event['createdAt']?.toString() ?? '',
            style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }
}
