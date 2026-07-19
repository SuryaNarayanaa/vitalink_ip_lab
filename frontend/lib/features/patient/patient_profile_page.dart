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
    return UseQuery<Map<String, dynamic>>(
      options: QueryOptions<Map<String, dynamic>>(
        queryKey: PatientQueryKeys.profileFull(),
        queryFn: () async {
          // Profile UI only needs profile + recent doctor updates.
          // History/latest INR were previously fetched but never rendered.
          final repo = AppDependencies.patientRepository;
          final results = await Future.wait([
            repo.getProfile(),
            repo.getDoctorUpdates(limit: 5),
          ]);
          return {
            'profile': results[0] as Map<String, dynamic>,
            'doctorUpdates': results[1] as List<Map<String, dynamic>>,
          };
        },
      ),
      builder: (context, query) {
        final Widget body;
        if (query.isError) {
          body = KeyedSubtree(
            key: const ValueKey('patient-profile-error'),
            child: ApiErrorState(
              error: query.error,
              onRetry: () => query.refetch(),
            ),
          );
        } else if (query.isLoading || !query.hasData) {
          body = const KeyedSubtree(
            key: ValueKey('patient-profile-loading'),
            child: PageSkeleton(cardCount: 3),
          );
        } else {
          final data = query.data!;
          final profile = data['profile'] as Map<String, dynamic>;
          final doctorUpdates =
              (data['doctorUpdates'] as List?)?.cast<Map<String, dynamic>>() ??
                  [];
          final unreadCount =
              (profile['doctorUpdatesUnreadCount'] as num?)?.toInt() ?? 0;

          body = KeyedSubtree(
            key: const ValueKey('patient-profile-ready'),
            child: RefreshIndicator(
              onRefresh: () async => query.refetch(),
              child: SingleChildScrollView(
                padding: PortalLayout.pagePadding(
                  embedInShell: widget.embedInShell,
                  top: PortalLayout.pageTopComfortable,
                ),
                physics: const AlwaysScrollableScrollPhysics(),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    PatientProfileContent(
                      profile: profile,
                      onProfileUpdated: () => query.refetch(),
                    ),
                    PortalLayout.sectionSpacer,
                    _DoctorUpdatesCard(
                      updates: doctorUpdates,
                      unreadCount: unreadCount,
                    ),
                  ],
                ),
              ),
            ),
          );
        }

        return _buildPageContainer(
          bodyDecoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color(0xFFC0C9FA), Color(0xFFFDC5DF)],
            ),
          ),
          body: body,
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
      padding: PortalLayout.cardInsets,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(PortalLayout.cardRadius),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: AppSpacing.xs,
            runSpacing: AppSpacing.xs,
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
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.xs,
                    vertical: AppSpacing.xxs,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEF4444),
                    borderRadius: BorderRadius.circular(PortalLayout.pillRadius),
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
          PortalLayout.itemSpacer,
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
                  separatorBuilder: (_, __) =>
                      const SizedBox(height: AppSpacing.sm - 2),
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
      padding: const EdgeInsets.all(PortalLayout.itemGap),
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
