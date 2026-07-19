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
  /// Whether [_cachedToken] reflects a completed secure-storage read/write.
  static bool _tokenHydrated = false;
  /// Whether [_cachedUser] reflects a completed secure-storage read/write.
  static bool _userHydrated = false;
  /// Bumped when token cache is written/cleared so in-flight token disk reads
  /// cannot rehydrate a cleared or replaced token.
  static int _tokenCacheGeneration = 0;
  /// Bumped when user cache is written/cleared (independent of token).
  static int _userCacheGeneration = 0;
  /// Serializes all auth mutations (saveToken, clearToken, saveUser, clearUser,
  /// clearAuthData) so disk writes and deletes cannot overlap.
  static Future<void>? _authMutationQueue;

  /// Clears process-local caches so tests can simulate an app restart.
  @visibleForTesting
  static void debugResetCaches() {
    _cachedToken = null;
    _cachedUser = null;
    _cachedOnboardingCompleted = null;
    _tokenHydrated = false;
    _userHydrated = false;
    _tokenCacheGeneration++;
    _userCacheGeneration++;
    _authMutationQueue = null;
  }

  Future<SharedPreferences> _prefs() async {
    return _preferences ??= await SharedPreferences.getInstance();
  }

  Future<void> saveToken(String token) async {
    _authMutationQueue = _authMutationQueue?.then((_) async {
      _tokenCacheGeneration++;
      _cachedToken = token;
      _tokenHydrated = true;
      await _storage.write(key: AppStrings.tokenKey, value: token);
    }) ?? (() async {
      _tokenCacheGeneration++;
      _cachedToken = token;
      _tokenHydrated = true;
      await _storage.write(key: AppStrings.tokenKey, value: token);
    })();
    return _authMutationQueue!;
  }

  Future<String?> readToken() async {
    if (_tokenHydrated) return _cachedToken;
    final generation = _tokenCacheGeneration;
    final token = await _storage.read(key: AppStrings.tokenKey);
    if (generation != _tokenCacheGeneration) {
      // Token was cleared/written while we awaited disk — use current cache.
      return _tokenHydrated ? _cachedToken : null;
    }
    _cachedToken = token;
    _tokenHydrated = true;
    return token;
  }

  Future<void> clearToken() async {
    _authMutationQueue = _authMutationQueue?.then((_) async {
      _tokenCacheGeneration++;
      _cachedToken = null;
      _tokenHydrated = true;
      await _storage.delete(key: AppStrings.tokenKey);
    }) ?? (() async {
      _tokenCacheGeneration++;
      _cachedToken = null;
      _tokenHydrated = true;
      await _storage.delete(key: AppStrings.tokenKey);
    })();
    return _authMutationQueue!;
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
    _authMutationQueue = _authMutationQueue?.then((_) async {
      _userCacheGeneration++;
      _cachedUser = Map<String, dynamic>.from(user);
      _userHydrated = true;
      await _storage.write(key: AppStrings.userKey, value: jsonEncode(user));
    }) ?? (() async {
      _userCacheGeneration++;
      _cachedUser = Map<String, dynamic>.from(user);
      _userHydrated = true;
      await _storage.write(key: AppStrings.userKey, value: jsonEncode(user));
    })();
    return _authMutationQueue!;
  }

  Future<Map<String, dynamic>?> readUser() async {
    if (_userHydrated) {
      final cached = _cachedUser;
      if (cached == null) return null;
      return Map<String, dynamic>.from(cached);
    }
    final generation = _userCacheGeneration;
    final raw = await _storage.read(key: AppStrings.userKey);
    if (generation != _userCacheGeneration) {
      final cached = _cachedUser;
      if (!_userHydrated || cached == null) return null;
      return Map<String, dynamic>.from(cached);
    }
    if (raw == null || raw.isEmpty) {
      _cachedUser = null;
      _userHydrated = true;
      return null;
    }
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic>) {
        _cachedUser = Map<String, dynamic>.from(decoded);
        _userHydrated = true;
        return Map<String, dynamic>.from(decoded);
      }
      if (decoded is Map) {
        final map = Map<String, dynamic>.from(decoded);
        _cachedUser = map;
        _userHydrated = true;
        return Map<String, dynamic>.from(map);
      }
      await clearUser();
      return null;
    } catch (_) {
      await clearUser();
      return null;
    }
  }

  Future<void> clearUser() async {
    _authMutationQueue = _authMutationQueue?.then((_) async {
      _userCacheGeneration++;
      _cachedUser = null;
      _userHydrated = true;
      await _storage.delete(key: AppStrings.userKey);
    }) ?? (() async {
      _userCacheGeneration++;
      _cachedUser = null;
      _userHydrated = true;
      await _storage.delete(key: AppStrings.userKey);
    })();
    return _authMutationQueue!;
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
    _authMutationQueue = _authMutationQueue?.then((_) async {
      _tokenCacheGeneration++;
      _userCacheGeneration++;
      _cachedToken = null;
      _cachedUser = null;
      _tokenHydrated = true;
      _userHydrated = true;
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
    }) ?? (() async {
      _tokenCacheGeneration++;
      _userCacheGeneration++;
      _cachedToken = null;
      _cachedUser = null;
      _tokenHydrated = true;
      _userHydrated = true;
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
    })();
    return _authMutationQueue!;
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
