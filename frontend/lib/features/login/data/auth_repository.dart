import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/core/storage/secure_storage.dart';
import 'package:frontend/features/login/models/login_models.dart';

class AuthRepository {
  AuthRepository({
    required ApiClient apiClient,
    required SecureStorage secureStorage,
  })  : _apiClient = apiClient,
        _secureStorage = secureStorage;

  final ApiClient _apiClient;
  final SecureStorage _secureStorage;

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
    final user = payload['user'] ?? payload['account'] ?? body['user'];
    final userJson = user is Map<String, dynamic> ? user : null;

    if (token == null || userJson == null) {
      throw ApiException('Malformed login response');
    }

    await _secureStorage.saveToken(token);
    await _secureStorage.saveUser(userJson);

    return LoginResponse(token: token, user: UserModel.fromJson(userJson));
  }
}
