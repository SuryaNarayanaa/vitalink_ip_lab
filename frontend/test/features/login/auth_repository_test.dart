import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/core/constants/strings.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/core/storage/secure_storage.dart';
import 'package:frontend/features/login/data/auth_repository.dart';
import 'package:frontend/features/login/models/login_models.dart';

class _FakeApiClient extends ApiClient {
  _FakeApiClient(this.responses) : super(secureStorage: SecureStorage());

  final Map<String, Map<String, dynamic>> responses;
  final calls = <_ApiCall>[];

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Map<String, dynamic>? data,
    bool authenticated = true,
  }) async {
    calls.add(_ApiCall(path, data, authenticated));
    return responses[path] ?? <String, dynamic>{};
  }
}

class _ApiCall {
  _ApiCall(this.path, this.data, this.authenticated);

  final String path;
  final Map<String, dynamic>? data;
  final bool authenticated;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late SecureStorage storage;

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    storage = SecureStorage();
    await storage.clearAuthData();
  });

  Map<String, dynamic> sessionPayload({
    required String token,
    required String refreshToken,
  }) {
    return {
      'token': token,
      'refresh_token': refreshToken,
      'session': {
        'session_id': 'session-123',
        'refresh_expires_at': '2026-08-06T12:00:00.000Z',
      },
      'user': {
        '_id': 'user-123',
        'login_id': 'doctor@example.test',
        'user_type': 'DOCTOR',
        'is_active': true,
      },
    };
  }

  group('AuthRepository session handling', () {
    test(
      'normal login stores access token, refresh token, user, and session',
      () async {
        final apiClient = _FakeApiClient({
          AppStrings.loginPath: sessionPayload(
            token: 'access-token',
            refreshToken: 'refresh-token',
          ),
        });
        final repository = AuthRepository(
          apiClient: apiClient,
          secureStorage: storage,
        );

        final result = await repository.login(
          LoginRequest(loginId: 'doctor@example.test', password: 'secret'),
        );

        expect(result.response?.token, 'access-token');
        expect(result.response?.refreshToken, 'refresh-token');
        expect(result.response?.session?.sessionId, 'session-123');
        expect(await storage.readToken(), 'access-token');
        expect(await storage.readRefreshToken(), 'refresh-token');
        expect((await storage.readAuthSession())?['session_id'], 'session-123');
        expect((await storage.readUser())?['login_id'], 'doctor@example.test');
      },
    );

    test('OTP verification stores the same session payload', () async {
      final apiClient = _FakeApiClient({
        AppStrings.loginOtpVerifyPath: sessionPayload(
          token: 'otp-access',
          refreshToken: 'otp-refresh',
        ),
      });
      final repository = AuthRepository(
        apiClient: apiClient,
        secureStorage: storage,
      );

      final response = await repository.verifyLoginOtp(
        VerifyLoginOtpRequest(
          challengeId: 'otp-challenge',
          firebaseIdToken: 'firebase-id-token',
        ),
      );

      expect(response.token, 'otp-access');
      expect(response.refreshToken, 'otp-refresh');
      expect(await storage.readToken(), 'otp-access');
      expect(await storage.readRefreshToken(), 'otp-refresh');
    });

    test('TOTP verification stores the same session payload', () async {
      final apiClient = _FakeApiClient({
        AppStrings.loginTotpVerifyPath: sessionPayload(
          token: 'totp-access',
          refreshToken: 'totp-refresh',
        ),
      });
      final repository = AuthRepository(
        apiClient: apiClient,
        secureStorage: storage,
      );

      final response = await repository.verifyLoginTotp(
        VerifyLoginTotpRequest(challengeId: 'totp-challenge', code: '123456'),
      );

      expect(response.token, 'totp-access');
      expect(response.refreshToken, 'totp-refresh');
      expect(await storage.readToken(), 'totp-access');
      expect(await storage.readRefreshToken(), 'totp-refresh');
    });

    test(
      'logout calls backend logout, revokes refresh token, and clears local data',
      () async {
        await storage.saveToken('access-token');
        await storage.saveRefreshToken('refresh-token');
        await storage.saveUser({'login_id': 'doctor@example.test'});
        await storage.saveAuthSession({'session_id': 'session-123'});

        final apiClient = _FakeApiClient({
          AppStrings.logoutPath: <String, dynamic>{},
          AppStrings.authRevokePath: <String, dynamic>{},
        });
        final repository = AuthRepository(
          apiClient: apiClient,
          secureStorage: storage,
        );

        await repository.logout();

        expect(apiClient.calls.map((call) => call.path), [
          AppStrings.logoutPath,
          AppStrings.authRevokePath,
        ]);
        expect(apiClient.calls.last.data, {'refresh_token': 'refresh-token'});
        expect(apiClient.calls.last.authenticated, isFalse);
        expect(await storage.readToken(), isNull);
        expect(await storage.readRefreshToken(), isNull);
        expect(await storage.readUser(), isNull);
        expect(await storage.readAuthSession(), isNull);
      },
    );
  });
}
