import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/core/constants/strings.dart';
import 'package:frontend/core/storage/secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late SecureStorage storage;
  const secure = FlutterSecureStorage();

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    SharedPreferences.setMockInitialValues({});
    SecureStorage.debugResetCaches();
    storage = SecureStorage();
    await storage.clearAll();
    SecureStorage.debugResetCaches();
  });

  Future<void> expectOnboardingBackends({required bool completed}) async {
    final prefs = await SharedPreferences.getInstance();
    expect(
      prefs.getBool(AppStrings.onboardingCompletedKey) ?? false,
      completed,
    );
    expect(
      await secure.read(key: AppStrings.onboardingCompletedKey),
      completed ? 'true' : isNull,
    );
  }

  group('SecureStorage onboarding flag', () {
    test('defaults to not completed', () async {
      expect(await storage.isOnboardingCompleted(), isFalse);
      await expectOnboardingBackends(completed: false);
    });

    test('markOnboardingCompleted writes both backends and survives cache reset',
        () async {
      await storage.markOnboardingCompleted();
      await expectOnboardingBackends(completed: true);

      // Simulate process restart: no in-memory cache, new wrapper instance.
      SecureStorage.debugResetCaches();
      final other = SecureStorage();
      expect(await other.isOnboardingCompleted(), isTrue);
      await expectOnboardingBackends(completed: true);
    });

    test('clearAuthData preserves onboarding in both backends after cache reset',
        () async {
      await storage.markOnboardingCompleted();
      await storage.saveToken('token');
      await storage.saveUser({
        '_id': 'u1',
        'login_id': 'patient@test',
        'user_type': 'PATIENT',
        'is_active': true,
      });

      await storage.clearAuthData();

      expect(await storage.readToken(), isNull);
      expect(await storage.readUser(), isNull);
      await expectOnboardingBackends(completed: true);

      SecureStorage.debugResetCaches();
      expect(await storage.isOnboardingCompleted(), isTrue);
      await expectOnboardingBackends(completed: true);
    });

    test('clearAll removes onboarding flag from both backends', () async {
      await storage.markOnboardingCompleted();
      await storage.clearAll();
      SecureStorage.debugResetCaches();

      expect(await storage.isOnboardingCompleted(), isFalse);
      await expectOnboardingBackends(completed: false);
    });

    test('reads onboarding flag from SharedPreferences when secure value is missing',
        () async {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(AppStrings.onboardingCompletedKey, true);

      // Empty secure storage + cleared process cache.
      FlutterSecureStorage.setMockInitialValues({});
      SecureStorage.debugResetCaches();
      final reader = SecureStorage();
      expect(await reader.isOnboardingCompleted(), isTrue);

      // Repair should restore secure storage for consistency.
      expect(
        await secure.read(key: AppStrings.onboardingCompletedKey),
        'true',
      );
    });
  });

  group('SecureStorage token/user memory cache', () {
    test('readToken returns memory value without re-reading after hydrate',
        () async {
      await storage.saveToken('token-a');
      expect(await storage.readToken(), 'token-a');

      // Overwrite the mock backend out-of-band; cached read must stay stable.
      await secure.write(key: AppStrings.tokenKey, value: 'token-b');
      expect(await storage.readToken(), 'token-a');
    });

    test('clearAuthData hydrates null so subsequent reads skip disk', () async {
      await storage.saveToken('token-a');
      await storage.saveUser({'login_id': 'P1'});
      await storage.clearAuthData();

      await secure.write(key: AppStrings.tokenKey, value: 'stale');
      await secure.write(
        key: AppStrings.userKey,
        value: '{"login_id":"STALE"}',
      );

      expect(await storage.readToken(), isNull);
      expect(await storage.readUser(), isNull);
    });

    test('debugResetCaches forces a fresh disk read', () async {
      await storage.saveToken('token-a');
      await secure.write(key: AppStrings.tokenKey, value: 'token-b');
      SecureStorage.debugResetCaches();
      final other = SecureStorage();
      expect(await other.readToken(), 'token-b');
    });

    test('clearAuthData wins over an in-flight readToken', () async {
      await storage.saveToken('token-a');
      SecureStorage.debugResetCaches();
      final reader = SecureStorage();
      // Start a disk hydrate, then clear before it settles into cache.
      final pending = reader.readToken();
      await reader.clearAuthData();
      expect(await pending, isNull);
      expect(await reader.readToken(), isNull);
    });
  });
}
