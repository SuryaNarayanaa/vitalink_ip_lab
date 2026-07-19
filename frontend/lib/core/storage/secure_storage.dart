import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:frontend/core/constants/strings.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Thin wrapper around [FlutterSecureStorage] to centralize key names and
/// serialization.
class SecureStorage {
  SecureStorage({
    FlutterSecureStorage? storage,
    SharedPreferences? preferences,
  })  : _storage = storage ?? const FlutterSecureStorage(),
        _preferences = preferences;

  final FlutterSecureStorage _storage;
  SharedPreferences? _preferences;
  static String? _cachedToken;
  static Map<String, dynamic>? _cachedUser;
  static bool? _cachedOnboardingCompleted;

  /// Clears process-local caches so tests can simulate an app restart.
  @visibleForTesting
  static void debugResetCaches() {
    _cachedToken = null;
    _cachedUser = null;
    _cachedOnboardingCompleted = null;
  }

  Future<SharedPreferences> _prefs() async {
    return _preferences ??= await SharedPreferences.getInstance();
  }

  Future<void> saveToken(String token) async {
    _cachedToken = token;
    await _storage.write(key: AppStrings.tokenKey, value: token);
  }

  Future<String?> readToken() async {
    final token = await _storage.read(key: AppStrings.tokenKey);
    _cachedToken = token;
    return token;
  }

  Future<void> clearToken() async {
    _cachedToken = null;
    await _storage.delete(key: AppStrings.tokenKey);
  }

  Future<void> saveRefreshToken(String refreshToken) async {
    await _storage.write(key: AppStrings.refreshTokenKey, value: refreshToken);
  }

  Future<String?> readRefreshToken() async {
    return _storage.read(key: AppStrings.refreshTokenKey);
  }

  Future<void> clearRefreshToken() async {
    await _storage.delete(key: AppStrings.refreshTokenKey);
  }

  Future<void> saveAuthSession(Map<String, dynamic> session) async {
    await _storage.write(
      key: AppStrings.authSessionKey,
      value: jsonEncode(session),
    );
  }

  Future<Map<String, dynamic>?> readAuthSession() async {
    final raw = await _storage.read(key: AppStrings.authSessionKey);
    if (raw == null || raw.isEmpty) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic>) {
        return decoded;
      }
      if (decoded is Map) {
        final map = Map<String, dynamic>.from(decoded);
        return map;
      }
      await clearAuthSession();
      return null;
    } catch (_) {
      await clearAuthSession();
      return null;
    }
  }

  Future<void> clearAuthSession() async {
    await _storage.delete(key: AppStrings.authSessionKey);
  }

  Future<void> saveUser(Map<String, dynamic> user) async {
    _cachedUser = Map<String, dynamic>.from(user);
    await _storage.write(key: AppStrings.userKey, value: jsonEncode(user));
  }

  Future<Map<String, dynamic>?> readUser() async {
    final raw = await _storage.read(key: AppStrings.userKey);
    if (raw == null || raw.isEmpty) {
      _cachedUser = null;
      return null;
    }
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic>) {
        _cachedUser = Map<String, dynamic>.from(decoded);
        return decoded;
      }
      if (decoded is Map) {
        final map = Map<String, dynamic>.from(decoded);
        _cachedUser = map;
        return map;
      }
      await clearUser();
      return null;
    } catch (_) {
      await clearUser();
      return null;
    }
  }

  Future<void> clearUser() async {
    _cachedUser = null;
    await _storage.delete(key: AppStrings.userKey);
  }

  /// Onboarding completion flag ──────────────────────────────────────────────
  ///
  /// Stored in both secure storage (legacy) and [SharedPreferences] because
  /// this is a non-sensitive first-run preference that must survive logout,
  /// session expiry, and platforms where secure storage is flaky.

  Future<void> markOnboardingCompleted() async {
    _cachedOnboardingCompleted = true;
    try {
      await _storage.write(
        key: AppStrings.onboardingCompletedKey,
        value: 'true',
      );
    } catch (_) {
      // Prefer SharedPreferences if secure storage is unavailable.
    }
    final prefs = await _prefs();
    await prefs.setBool(AppStrings.onboardingCompletedKey, true);
  }

  Future<bool> isOnboardingCompleted() async {
    if (_cachedOnboardingCompleted == true) return true;

    var completed = false;
    try {
      final secureValue =
          await _storage.read(key: AppStrings.onboardingCompletedKey);
      completed = secureValue == 'true';
    } catch (_) {
      completed = false;
    }

    if (!completed) {
      try {
        final prefs = await _prefs();
        completed = prefs.getBool(AppStrings.onboardingCompletedKey) ?? false;
      } catch (_) {
        completed = false;
      }
    }

    // Repair either store so future reads stay consistent.
    if (completed) {
      _cachedOnboardingCompleted = true;
      try {
        await _storage.write(
          key: AppStrings.onboardingCompletedKey,
          value: 'true',
        );
      } catch (_) {}
      try {
        final prefs = await _prefs();
        await prefs.setBool(AppStrings.onboardingCompletedKey, true);
      } catch (_) {}
    }

    return completed;
  }

  Future<void> clearAuthData({bool preserveOnboarding = true}) async {
    _cachedToken = null;
    _cachedUser = null;
    await _storage.delete(key: AppStrings.tokenKey);
    await _storage.delete(key: AppStrings.refreshTokenKey);
    await _storage.delete(key: AppStrings.authSessionKey);
    await _storage.delete(key: AppStrings.userKey);
    if (!preserveOnboarding) {
      _cachedOnboardingCompleted = false;
      await _storage.delete(key: AppStrings.onboardingCompletedKey);
      try {
        final prefs = await _prefs();
        await prefs.remove(AppStrings.onboardingCompletedKey);
      } catch (_) {}
    }
  }

  Future<void> clearAll() async {
    await clearAuthData(preserveOnboarding: false);
  }

  String get sessionScope => _buildSessionScope(_cachedToken, _cachedUser);

  Future<String> readSessionScope() async {
    final token = await readToken();
    final user = await readUser();
    return _buildSessionScope(token, user);
  }

  String _buildSessionScope(String? token, Map<String, dynamic>? user) {
    String readString(dynamic value) {
      if (value is String && value.trim().isNotEmpty) {
        return value.trim();
      }
      return '';
    }

    final role = readString(
      user?['user_type_model'] ?? user?['user_type'] ?? user?['role'],
    );
    final identifier = readString(
      user?['login_id'] ?? user?['_id'] ?? user?['id'],
    );

    if (role.isNotEmpty && identifier.isNotEmpty) {
      return '${role.toUpperCase()}:$identifier';
    }
    if (identifier.isNotEmpty) {
      return 'USER:$identifier';
    }
    if (token != null && token.isNotEmpty) {
      final shortToken = token.length > 12 ? token.substring(0, 12) : token;
      return 'TOKEN:$shortToken';
    }
    return 'ANON';
  }
}
