import 'dart:async';

import 'package:frontend/core/constants/strings.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/core/storage/secure_storage.dart';
import 'package:frontend/features/login/models/login_models.dart';
import 'package:frontend/services/push_notification_service.dart';

class AuthRepository {
  AuthRepository({
    required ApiClient apiClient,
    required SecureStorage secureStorage,
    PushNotificationService? pushNotifications,
  })  : _apiClient = apiClient,
        _secureStorage = secureStorage,
        _pushNotifications = pushNotifications;

  final ApiClient _apiClient;
  final SecureStorage _secureStorage;
  final PushNotificationService? _pushNotifications;

  String? _firstNonEmptyString(List<dynamic> values) {
    for (final value in values) {
      if (value is String && value.trim().isNotEmpty) {
        return value;
      }
    }
    return null;
  }

  Future<LoginResult> login(LoginRequest request) async {
    final body = await _apiClient.post(
      request.path,
      data: request.toJson(),
      authenticated: false,
    );

    if (body['auth_status'] == 'OTP_REQUIRED') {
      final challenge = body['challenge'] is Map<String, dynamic>
          ? body['challenge'] as Map<String, dynamic>
          : null;
      if (challenge == null) {
        throw ApiException(
          'Malformed OTP challenge response',
          kind: ApiErrorKind.malformedResponse,
        );
      }

      final otpChallenge = LoginOtpChallenge.fromJson(challenge);
      if (otpChallenge.challengeId.isEmpty) {
        throw ApiException(
          'Malformed OTP challenge response',
          kind: ApiErrorKind.malformedResponse,
        );
      }

      return LoginResult.otpRequired(otpChallenge);
    }

    if (body['auth_status'] == 'TOTP_REQUIRED') {
      final challenge = body['challenge'] is Map<String, dynamic>
          ? body['challenge'] as Map<String, dynamic>
          : null;
      if (challenge == null) {
        throw ApiException(
          'Malformed authenticator challenge response',
          kind: ApiErrorKind.malformedResponse,
        );
      }

      final totpChallenge = LoginTotpChallenge.fromJson(challenge);
      if (totpChallenge.challengeId.isEmpty) {
        throw ApiException(
          'Malformed authenticator challenge response',
          kind: ApiErrorKind.malformedResponse,
        );
      }

      return LoginResult.totpRequired(totpChallenge);
    }

    return LoginResult.authenticated(await _saveSessionFromBody(body));
  }

  Future<LoginResponse> verifyLoginOtp(VerifyLoginOtpRequest request) async {
    final body = await _apiClient.post(
      request.path,
      data: request.toJson(),
      authenticated: false,
    );

    return _saveSessionFromBody(body);
  }

  Future<LoginResponse> verifyLoginTotp(VerifyLoginTotpRequest request) async {
    final body = await _apiClient.post(
      request.path,
      data: request.toJson(),
      authenticated: false,
    );

    return _saveSessionFromBody(body);
  }

  Future<LoginOtpChallenge> resendLoginOtp(
    ResendLoginOtpRequest request,
  ) async {
    final body = await _apiClient.post(
      request.path,
      data: request.toJson(),
      authenticated: false,
    );

    final challenge = body['challenge'] is Map<String, dynamic>
        ? body['challenge'] as Map<String, dynamic>
        : null;
    if (body['auth_status'] != 'OTP_REQUIRED' || challenge == null) {
      throw ApiException(
        'Malformed OTP resend response',
        kind: ApiErrorKind.malformedResponse,
      );
    }

    final otpChallenge = LoginOtpChallenge.fromJson(challenge);
    if (otpChallenge.challengeId.isEmpty) {
      throw ApiException(
        'Malformed OTP resend response',
        kind: ApiErrorKind.malformedResponse,
      );
    }

    return otpChallenge;
  }

  Future<void> logout() async {
    final refreshToken = await _secureStorage.readRefreshToken();

    try {
      await _apiClient.post(AppStrings.logoutPath);
    } catch (_) {
      // Local session cleanup must still happen if the server session is
      // already expired or unreachable.
    }

    if (refreshToken != null && refreshToken.isNotEmpty) {
      try {
        await _apiClient.post(
          RevokeSessionRequest(refreshToken: refreshToken).path,
          data: RevokeSessionRequest(refreshToken: refreshToken).toJson(),
          authenticated: false,
        );
      } catch (_) {
        // Revoke is best-effort on logout because local credentials are cleared
        // immediately below.
      }
    }

    await _secureStorage.clearAuthData();
  }

  Future<LoginResponse> _saveSessionFromBody(Map<String, dynamic> body) async {
    final payload = body['data'] is Map<String, dynamic>
        ? body['data'] as Map<String, dynamic>
        : body;
    final token = _firstNonEmptyString([
      payload['token'],
      payload['access_token'],
      payload['accessToken'],
      body['token'],
      body['access_token'],
      body['accessToken'],
    ]);
    final refreshToken = _firstNonEmptyString([
      payload['refresh_token'],
      payload['refreshToken'],
      body['refresh_token'],
      body['refreshToken'],
    ]);
    final user = payload['user'] ?? payload['account'] ?? body['user'];
    final userJson = user is Map<String, dynamic> ? user : null;
    final session = payload['session'] is Map<String, dynamic>
        ? payload['session'] as Map<String, dynamic>
        : body['session'] is Map<String, dynamic>
            ? body['session'] as Map<String, dynamic>
            : null;

    if (token == null || refreshToken == null || userJson == null) {
      throw ApiException('Malformed login response');
    }

    await _secureStorage.saveToken(token);
    await _secureStorage.saveRefreshToken(refreshToken);
    if (session != null) {
      await _secureStorage.saveAuthSession(session);
    } else {
      await _secureStorage.clearAuthSession();
    }
    await _secureStorage.saveUser(userJson);
    final pushNotifications = _pushNotifications;
    if (pushNotifications != null) {
      unawaited(pushNotifications.registerCurrentDevice());
    }

    return LoginResponse(
      token: token,
      refreshToken: refreshToken,
      user: UserModel.fromJson(userJson),
      session: session == null ? null : AuthSessionModel.fromJson(session),
    );
  }
}
