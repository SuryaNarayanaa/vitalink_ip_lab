import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/features/patient/patient_dashboard_shell_page.dart';

/// Pure helper mirroring shell tab activation (kept free of Flutter widgets).
Set<int> activatedTabsAfterSelection({
  required Set<int> activated,
  required int selectedIndex,
  int tabCount = 5,
}) {
  final next = Set<int>.from(activated);
  next.add(selectedIndex.clamp(0, tabCount - 1));
  return next;
}

void main() {
  group('lazy patient shell tabs', () {
    test('only initial tab is activated on open', () {
      final activated = activatedTabsAfterSelection(
        activated: <int>{},
        selectedIndex: 0,
      );
      expect(activated, {0});
    });

    test('selecting another tab activates it without dropping prior tabs', () {
      var activated = activatedTabsAfterSelection(
        activated: <int>{0},
        selectedIndex: 0,
      );
      activated = activatedTabsAfterSelection(
        activated: activated,
        selectedIndex: 4,
      );
      expect(activated, {0, 4});
    });

    test('clamps out-of-range tab indexes', () {
      final activated = activatedTabsAfterSelection(
        activated: <int>{},
        selectedIndex: 99,
      );
      expect(activated, {4});
    });
  });

  group('shouldShowUnreadUpdatesPopup', () {
    test('returns true when first unread updates are observed', () {
      final result = shouldShowUnreadUpdatesPopup(
        unreadCount: 2,
        previousUnreadCount: null,
        popupScheduled: false,
      );

      expect(result, isTrue);
    });

    test('returns false when unread count is zero', () {
      final result = shouldShowUnreadUpdatesPopup(
        unreadCount: 0,
        previousUnreadCount: null,
        popupScheduled: false,
      );

      expect(result, isFalse);
    });

    test('returns false when popup is already scheduled', () {
      final result = shouldShowUnreadUpdatesPopup(
        unreadCount: 3,
        previousUnreadCount: 1,
        popupScheduled: true,
      );

      expect(result, isFalse);
    });

    test('returns false when unread count does not increase', () {
      final result = shouldShowUnreadUpdatesPopup(
        unreadCount: 2,
        previousUnreadCount: 2,
        popupScheduled: false,
      );

      expect(result, isFalse);
    });

    test('returns true when unread count increases', () {
      final result = shouldShowUnreadUpdatesPopup(
        unreadCount: 4,
        previousUnreadCount: 2,
        popupScheduled: false,
      );

      expect(result, isTrue);
    });
  });

  group('shouldShowSystemAnnouncementPopup', () {
    test('returns false when popup is already scheduled', () {
      final result = shouldShowSystemAnnouncementPopup(
        notificationId: 'n1',
        notificationType: 'SYSTEM_ANNOUNCEMENT',
        popupScheduled: true,
        seenNotificationIds: <String>{},
      );

      expect(result, isFalse);
    });

    test('returns false for non-system announcement notification types', () {
      final result = shouldShowSystemAnnouncementPopup(
        notificationId: 'n1',
        notificationType: 'DOCTOR_UPDATE',
        popupScheduled: false,
        seenNotificationIds: <String>{},
      );

      expect(result, isFalse);
    });

    test('returns false for already-seen notification ids', () {
      final result = shouldShowSystemAnnouncementPopup(
        notificationId: 'n1',
        notificationType: 'SYSTEM_ANNOUNCEMENT',
        popupScheduled: false,
        seenNotificationIds: <String>{'n1'},
      );

      expect(result, isFalse);
    });

    test('returns true for unseen system announcement', () {
      final result = shouldShowSystemAnnouncementPopup(
        notificationId: 'n2',
        notificationType: 'SYSTEM_ANNOUNCEMENT',
        popupScheduled: false,
        seenNotificationIds: <String>{'n1'},
      );

      expect(result, isTrue);
    });
  });
}
