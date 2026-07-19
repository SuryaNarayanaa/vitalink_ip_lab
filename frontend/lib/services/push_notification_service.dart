import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:frontend/core/constants/strings.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/app/routers.dart';

const _androidChannel = AndroidNotificationChannel(
  'vitalink_updates',
  'VitaLink updates',
  description: 'Updates from your care team.',
  importance: Importance.high,
);

@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
}

/// Handles Android notification permission, FCM registration, and foreground banners.
class PushNotificationService {
  PushNotificationService({required ApiClient apiClient})
      : _apiClient = apiClient;

  final ApiClient _apiClient;
  final FlutterLocalNotificationsPlugin _localNotifications =
      FlutterLocalNotificationsPlugin();
  StreamSubscription<String>? _tokenRefreshSubscription;
  bool _initialized = false;

  bool get _isAndroid =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  Future<void> initialize() async {
    if (!_isAndroid || _initialized) return;
    await Firebase.initializeApp();
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);

    const settings = InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/launcher_icon'),
    );
    await _localNotifications.initialize(
      settings,
      onDidReceiveNotificationResponse: (response) {
        if (response.payload == 'dosage') _openDosageScreen();
      },
    );
    await _localNotifications
        .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(_androidChannel);

    FirebaseMessaging.onMessage.listen(_showForegroundNotification);
    FirebaseMessaging.onMessageOpenedApp.listen(_handleRemoteMessage);
    final initialMessage = await FirebaseMessaging.instance.getInitialMessage();
    if (initialMessage != null) _handleRemoteMessage(initialMessage);
    _tokenRefreshSubscription =
        FirebaseMessaging.instance.onTokenRefresh.listen(
      (token) => unawaited(_registerToken(token)),
      onError: (Object error, StackTrace stackTrace) =>
          debugPrint('FCM token refresh failed: $error'),
    );
    _initialized = true;
  }

  /// Call after login, once requests can be authenticated as the current user.
  Future<void> registerCurrentDevice() async {
    if (!_isAndroid) return;
    try {
      await initialize();
      final settings = await FirebaseMessaging.instance.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );
      if (settings.authorizationStatus != AuthorizationStatus.authorized &&
          settings.authorizationStatus != AuthorizationStatus.provisional) {
        debugPrint('Push notification permission was not granted.');
        return;
      }
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null && token.isNotEmpty) await _registerToken(token);
    } catch (error, stackTrace) {
      // Push registration must never block a successful sign-in.
      debugPrint('Push notification setup failed: $error\n$stackTrace');
    }
  }

  Future<void> _registerToken(String token) async {
    try {
      await _apiClient.post(
        AppStrings.deviceRegisterPath,
        data: {'fcm_token': token, 'platform': 'android'},
      );
    } catch (error) {
      // Login retries this after an offline or pre-auth token refresh.
      debugPrint('FCM token registration failed: $error');
    }
  }

  Future<void> _showForegroundNotification(RemoteMessage message) async {
    final notification = message.notification;
    if (notification == null) return;
    await _localNotifications.show(
      notification.hashCode,
      notification.title ?? 'VitaLink update',
      notification.body ?? '',
      const NotificationDetails(
        android: AndroidNotificationDetails(
          'vitalink_updates',
          'VitaLink updates',
          channelDescription: 'Updates from your care team.',
          importance: Importance.high,
          priority: Priority.high,
        ),
      ),
      payload: _isDosageReminder(message) ? 'dosage' : null,
    );
  }

  void _handleRemoteMessage(RemoteMessage message) {
    if (_isDosageReminder(message)) {
      _openDosageScreen();
    } else if (message.data['route'] == 'patient-update-inr') {
      _openInrScreen();
    }
  }

  bool _isDosageReminder(RemoteMessage message) =>
      message.data['route'] == 'patient-take-dosage' ||
      message.data['reminderType'] == 'dosage';

  void _openDosageScreen() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      AppRouter.navigatorKey.currentState?.pushNamed(
        AppRoutes.patientTakeDosage,
      );
    });
  }

  void _openInrScreen() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      AppRouter.navigatorKey.currentState
          ?.pushNamed(AppRoutes.patientUpdateINR);
    });
  }

  void dispose() => _tokenRefreshSubscription?.cancel();
}
