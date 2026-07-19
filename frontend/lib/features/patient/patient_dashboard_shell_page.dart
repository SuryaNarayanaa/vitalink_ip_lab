import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/app/routers.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/query/patient_query_keys.dart';
import 'package:frontend/core/widgets/index.dart';
import 'package:frontend/features/patient/patient_health_reports_page.dart';
import 'package:frontend/features/patient/patient_page.dart';
import 'package:frontend/features/patient/patient_profile_page.dart';
import 'package:frontend/features/patient/patient_take_dosage_page.dart';
import 'package:frontend/features/patient/patient_update_inr_page.dart';
import 'package:frontend/services/realtime/doctor_update_realtime_service.dart';

bool shouldShowUnreadUpdatesPopup({
  required int unreadCount,
  required int? previousUnreadCount,
  required bool popupScheduled,
}) {
  if (popupScheduled || unreadCount <= 0) return false;
  if (previousUnreadCount != null && unreadCount <= previousUnreadCount) {
    return false;
  }
  return true;
}

bool shouldShowSystemAnnouncementPopup({
  required String? notificationId,
  required String? notificationType,
  required bool popupScheduled,
  required Set<String> seenNotificationIds,
}) {
  if (popupScheduled) return false;
  if (notificationType != 'SYSTEM_ANNOUNCEMENT') return false;
  if (notificationId == null || notificationId.isEmpty) return false;
  return !seenNotificationIds.contains(notificationId);
}

class PatientDashboardShellPage extends StatefulWidget {
  final int initialTabIndex;

  const PatientDashboardShellPage({
    super.key,
    this.initialTabIndex = 0,
  });

  @override
  State<PatientDashboardShellPage> createState() =>
      _PatientDashboardShellPageState();
}

class _PatientDashboardShellPageState extends State<PatientDashboardShellPage>
    with WidgetsBindingObserver {
  static const int _tabCount = 5;

  late int _currentNavIndex;
  /// Tabs that have been opened at least once. Unvisited tabs stay unmounted
  /// so their UseQuery data loaders do not fire on shell open.
  final Set<int> _activatedTabs = <int>{};
  /// Keep built tab widgets so revisiting a tab preserves local UI state.
  final List<Widget?> _tabCache = List<Widget?>.filled(_tabCount, null);
  int? _lastObservedUnreadCount;
  int? _lastPromptedUnreadCount;
  Timer? _unreadRefreshTimer;
  bool _popupScheduled = false;
  bool _announcementPopupScheduled = false;
  final Set<String> _seenAnnouncementIds = <String>{};
  final DoctorUpdateRealtimeService _realtimeService =
      DoctorUpdateRealtimeService();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _currentNavIndex = widget.initialTabIndex.clamp(0, _tabCount - 1);
    _activateTab(_currentNavIndex);
    _unreadRefreshTimer = Timer.periodic(
      const Duration(seconds: 30),
      (_) => _refreshUnreadUpdates(),
    );
    unawaited(
      _realtimeService.start(
        onDoctorUpdate: _handleRealtimeDoctorUpdate,
        onNotification: _handleRealtimeNotification,
      ),
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _unreadRefreshTimer?.cancel();
    unawaited(_realtimeService.stop());
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _refreshUnreadUpdates();
      _refreshNotificationsUnread();
    }
  }

  @override
  void didUpdateWidget(covariant PatientDashboardShellPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    final newIndex = widget.initialTabIndex.clamp(0, _tabCount - 1);
    if (newIndex != _currentNavIndex) {
      setState(() {
        _currentNavIndex = newIndex;
        _activateTab(newIndex);
      });
    }
  }

  void _activateTab(int index) {
    final clamped = index.clamp(0, _tabCount - 1);
    _activatedTabs.add(clamped);
  }

  Widget _tabForIndex(int index) {
    if (!_activatedTabs.contains(index)) {
      // Placeholder keeps IndexedStack child count stable without mounting
      // heavy tab trees (and their network queries).
      return const SizedBox.shrink();
    }
    return _tabCache[index] ??= KeyedSubtree(
      key: ValueKey<String>('patient-shell-tab-$index'),
      child: _createTab(index),
    );
  }

  Widget _createTab(int index) {
    switch (index) {
      case 1:
        return PatientUpdateINRPage(
          embedInShell: true,
          onTabChanged: _onNavChanged,
        );
      case 2:
        return PatientTakeDosagePage(
          embedInShell: true,
          onTabChanged: _onNavChanged,
        );
      case 3:
        return PatientHealthReportsPage(
          embedInShell: true,
          onTabChanged: _onNavChanged,
        );
      case 4:
        return PatientProfilePage(
          embedInShell: true,
          onTabChanged: _onNavChanged,
        );
      case 0:
      default:
        return PatientPage(
          embedInShell: true,
          onTabChanged: _onNavChanged,
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    return UseQuery<int>(
      options: QueryOptions<int>(
        queryKey: PatientQueryKeys.doctorUpdatesUnread(),
        queryFn: () async {
          final summary =
              await AppDependencies.patientRepository.getDoctorUpdatesSummary();
          return (summary['unread_count'] as num?)?.toInt() ?? 0;
        },
      ),
      builder: (context, updatesQuery) {
        final unreadDoctorUpdates =
            updatesQuery.data ?? _lastObservedUnreadCount ?? 0;
        if (updatesQuery.data != null) {
          _maybeShowUnreadPopup(updatesQuery.data!);
        }

        return UseQuery<int>(
          options: QueryOptions<int>(
            queryKey: PatientQueryKeys.notificationsUnread(),
            queryFn: () async {
              return AppDependencies.patientRepository
                  .getNotificationsUnreadCount();
            },
          ),
          builder: (context, notificationsQuery) {
            final unreadNotifications = notificationsQuery.data ?? 0;

            return PatientScaffold(
              pageTitle: _titleForIndex(_currentNavIndex),
              currentNavIndex: _currentNavIndex,
              onNavChanged: _onNavChanged,
              unreadDoctorUpdatesCount: unreadDoctorUpdates,
              notificationBadgeCount: unreadNotifications,
              onNotificationPressed: () async {
                await Navigator.of(context).pushNamed(
                  AppRoutes.patientNotifications,
                );
                _refreshUnreadUpdates();
                _refreshNotificationsUnread();
              },
              bodyDecoration: _decorationForIndex(_currentNavIndex),
              body: IndexedStack(
                index: _currentNavIndex,
                children: List<Widget>.generate(
                  _tabCount,
                  _tabForIndex,
                  growable: false,
                ),
              ),
            );
          },
        );
      },
    );
  }

  void _onNavChanged(int index) {
    final clamped = index.clamp(0, _tabCount - 1);
    if (clamped == _currentNavIndex && _activatedTabs.contains(clamped)) {
      return;
    }
    setState(() {
      _currentNavIndex = clamped;
      _activateTab(clamped);
    });
  }

  void _maybeShowUnreadPopup(int unreadCount) {
    if (unreadCount <= 0) {
      _lastObservedUnreadCount = unreadCount;
      _lastPromptedUnreadCount = null;
      return;
    }

    final previousUnread = _lastObservedUnreadCount;
    _lastObservedUnreadCount = unreadCount;
    if (_lastPromptedUnreadCount == unreadCount) {
      return;
    }

    if (!shouldShowUnreadUpdatesPopup(
      unreadCount: unreadCount,
      previousUnreadCount: previousUnread,
      popupScheduled: _popupScheduled || _announcementPopupScheduled,
    )) {
      return;
    }

    _popupScheduled = true;
    _lastPromptedUnreadCount = unreadCount;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;

      showDialog<void>(
        context: context,
        builder: (dialogContext) {
          return AlertDialog(
            title: const Text('New Doctor Updates'),
            content: Text(
              unreadCount == 1
                  ? 'You have 1 unread doctor update.'
                  : 'You have $unreadCount unread doctor updates.',
            ),
            actions: [
              TextButton(
                onPressed: () {
                  Navigator.of(dialogContext).pop();
                  _popupScheduled = false;
                },
                child: const Text('Later'),
              ),
              FilledButton(
                onPressed: () {
                  Navigator.of(dialogContext).pop();
                  _popupScheduled = false;
                  unawaited(
                    Navigator.of(context)
                        .pushNamed(AppRoutes.patientNotifications)
                        .then((_) {
                      _refreshUnreadUpdates();
                      _refreshNotificationsUnread();
                    }),
                  );
                },
                child: const Text('View Updates'),
              ),
            ],
          );
        },
      ).whenComplete(() {
        _popupScheduled = false;
      });
    });
  }

  void _refreshUnreadUpdates() {
    if (!mounted) return;
    final queryClient = QueryClientProvider.of(context);
    queryClient.invalidateQueries(
      PatientQueryKeys.doctorUpdatesUnread(),
    );
  }

  void _refreshNotificationsUnread() {
    if (!mounted) return;
    final queryClient = QueryClientProvider.of(context);
    queryClient.invalidateQueries(
      PatientQueryKeys.notificationsUnread(),
    );
    queryClient.invalidateQueries(
      PatientQueryKeys.notifications(),
    );
  }

  void _handleRealtimeDoctorUpdate() {
    if (!mounted) return;
    final queryClient = QueryClientProvider.of(context);
    queryClient.invalidateQueries(
      PatientQueryKeys.doctorUpdatesUnread(),
    );
    queryClient.invalidateQueries(
      PatientQueryKeys.profileFull(),
    );
    _refreshNotificationsUnread();
  }

  void _handleRealtimeNotification(Map<String, dynamic> notification) {
    if (!mounted) return;
    _refreshNotificationsUnread();

    final id = notification['id']?.toString();
    final type = notification['type']?.toString();

    if (!shouldShowSystemAnnouncementPopup(
      notificationId: id,
      notificationType: type,
      popupScheduled: _popupScheduled || _announcementPopupScheduled,
      seenNotificationIds: _seenAnnouncementIds,
    )) {
      return;
    }

    _announcementPopupScheduled = true;
    _seenAnnouncementIds.add(id!);

    final title = notification['title']?.toString().trim().isNotEmpty == true
        ? notification['title']!.toString()
        : 'System announcement';
    final message =
        notification['message']?.toString().trim().isNotEmpty == true
            ? notification['message']!.toString()
            : 'You have a new system notification.';

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;

      showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(title),
          content: Text(message),
          actions: [
            FilledButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('OK'),
            ),
          ],
        ),
      ).whenComplete(() {
        _announcementPopupScheduled = false;
      });
    });
  }

  String _titleForIndex(int index) {
    switch (index) {
      case 1:
        return 'Update INR';
      case 2:
        return 'Dosage Management';
      case 3:
        return 'Health Reports';
      case 4:
        return 'My Profile';
      case 0:
      default:
        return 'Dashboard';
    }
  }

  Decoration _decorationForIndex(int index) {
    if (index == 4) {
      return const BoxDecoration(color: Color(0xFFF9FAFB));
    }

    return const BoxDecoration(
      gradient: LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [Color(0xFFC8B5E1), Color(0xFFF8C7D7)],
      ),
    );
  }
}
