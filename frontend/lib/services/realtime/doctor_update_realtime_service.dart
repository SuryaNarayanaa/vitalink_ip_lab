import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:frontend/core/constants/strings.dart';
import 'package:frontend/core/storage/secure_storage.dart';
import 'package:frontend/features/login/models/login_models.dart';
import 'package:frontend/services/realtime/notification_stream_client.dart';
import 'package:frontend/services/realtime/notification_stream_client_interface.dart';

class DoctorUpdateRealtimeService {
  DoctorUpdateRealtimeService({
    SecureStorage? secureStorage,
    NotificationStreamClient? streamClient,
  })  : _secureStorage = secureStorage ?? SecureStorage(),
        _streamClient = streamClient ?? createNotificationStreamClient();

  final SecureStorage _secureStorage;
  final NotificationStreamClient _streamClient;

  VoidCallback? _onDoctorUpdate;
  void Function(Map<String, dynamic> notification)? _onNotification;
  Timer? _reconnectTimer;
  bool _started = false;
  int _reconnectAttempt = 0;
  /// Bumped by [stop] so in-flight [_connect] awaits cannot open a stream after stop.
  int _connectionGeneration = 0;

  Future<void> start({
    required VoidCallback onDoctorUpdate,
    void Function(Map<String, dynamic> notification)? onNotification,
  }) async {
    _onDoctorUpdate = onDoctorUpdate;
    _onNotification = onNotification;
    _started = true;
    await _connect();
  }

  Future<void> stop() async {
    _started = false;
    _connectionGeneration++;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _onDoctorUpdate = null;
    _onNotification = null;
    await _streamClient.disconnect();
  }

  Future<void> _connect() async {
    if (!_started) return;
    final generation = _connectionGeneration;

    final token = await _secureStorage.readToken();
    final userJson = await _secureStorage.readUser();

    if (!_started || generation != _connectionGeneration) return;
    if (token == null || token.isEmpty || userJson == null) {
      return;
    }

    final user = UserModel.fromJson(userJson);
    if (!user.isPatient && !user.isDoctor) {
      return;
    }

    final streamPath = user.isPatient
        ? AppStrings.patientNotificationStreamPath
        : AppStrings.doctorNotificationStreamPath;
    final uri = Uri.parse(
      '${AppStrings.apiBaseUrl}$streamPath',
    );

    if (!_started || generation != _connectionGeneration) return;

    try {
      await _streamClient.connect(
        uri: uri,
        token: token,
        onEvent: _handleEvent,
        onError: _handleStreamError,
        onDone: _scheduleReconnect,
      );
      if (!_started || generation != _connectionGeneration) {
        await _streamClient.disconnect();
        return;
      }
      _reconnectAttempt = 0;
    } catch (error) {
      if (!_started || generation != _connectionGeneration) return;
      if (error is UnsupportedError) {
        _started = false;
        return;
      }
      if (_isAuthError(error)) {
        _started = false;
        return;
      }
      _scheduleReconnect();
    }
  }

  void _handleEvent(String eventName, String rawData) {
    if (!_started) return;
    if (eventName == 'doctor_update') {
      _onDoctorUpdate?.call();
      return;
    }

    if (eventName == 'notification') {
      try {
        final decoded = jsonDecode(rawData);
        if (decoded is Map<String, dynamic>) {
          if (decoded['type'] == 'DOCTOR_UPDATE') {
            _onDoctorUpdate?.call();
            return;
          }
          _onNotification?.call(decoded);
        }
      } catch (_) {
        // Ignore malformed stream payloads; reconnect logic will recover.
      }
    }
  }

  void _scheduleReconnect() {
    if (!_started) return;
    _reconnectTimer?.cancel();

    _reconnectAttempt += 1;
    final seconds = (_reconnectAttempt * 2).clamp(2, 30);
    _reconnectTimer = Timer(Duration(seconds: seconds), () {
      if (!_started) return;
      unawaited(_connect());
    });
  }

  bool _isAuthError(Object error) {
    final text = error.toString().toLowerCase();
    return text.contains('401') ||
        text.contains('403') ||
        text.contains('unauthorized') ||
        text.contains('forbidden');
  }

  void _handleStreamError(Object error) {
    if (error is UnsupportedError) {
      _started = false;
      return;
    }
    if (_isAuthError(error)) {
      _started = false;
      return;
    }
    _scheduleReconnect();
  }
}
