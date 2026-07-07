import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:frontend/core/constants/strings.dart';
import 'package:frontend/core/auth/session_expiry_handler.dart';
import 'package:frontend/core/storage/secure_storage.dart';

enum ApiErrorKind {
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  locked,
  rateLimited,
  requestTooLarge,
  server,
  network,
  timeout,
  malformedResponse,
  deprecatedApi,
  unknown,
}

class ApiException implements Exception {
  ApiException(
    this.message, {
    this.statusCode,
    this.kind = ApiErrorKind.unknown,
    String? title,
    this.retryAfter,
    this.isDeprecatedApi = false,
    this.sunset,
    this.apiVersion,
    this.supportedVersions,
  }) : title = title ?? _defaultTitle(kind);

  final String message;
  final int? statusCode;
  final ApiErrorKind kind;
  final String title;
  final Duration? retryAfter;
  final bool isDeprecatedApi;
  final String? sunset;
  final String? apiVersion;
  final String? supportedVersions;

  bool get canRetry =>
      kind == ApiErrorKind.network ||
      kind == ApiErrorKind.timeout ||
      kind == ApiErrorKind.rateLimited ||
      kind == ApiErrorKind.server;

  bool get shouldReturnToLogin =>
      kind == ApiErrorKind.unauthorized || kind == ApiErrorKind.locked;

  String get actionLabel {
    if (shouldReturnToLogin) return 'Back to login';
    if (canRetry) return 'Retry';
    return 'Dismiss';
  }

  static String _defaultTitle(ApiErrorKind kind) {
    switch (kind) {
      case ApiErrorKind.badRequest:
        return 'Check the details';
      case ApiErrorKind.unauthorized:
        return 'Session expired';
      case ApiErrorKind.forbidden:
        return 'Access not allowed';
      case ApiErrorKind.notFound:
        return 'This service is unavailable';
      case ApiErrorKind.locked:
        return 'Account temporarily locked';
      case ApiErrorKind.rateLimited:
        return 'Please slow down';
      case ApiErrorKind.requestTooLarge:
        return 'File or request too large';
      case ApiErrorKind.server:
        return 'Server problem';
      case ApiErrorKind.network:
        return 'Cannot reach VitaLink';
      case ApiErrorKind.timeout:
        return 'Request timed out';
      case ApiErrorKind.malformedResponse:
        return 'Unexpected server response';
      case ApiErrorKind.deprecatedApi:
        return 'App update needed';
      case ApiErrorKind.unknown:
        return 'Something went wrong';
    }
  }

  @override
  String toString() => message;
}

/// Lightweight API client that attaches bearer tokens when available and
/// normalizes the backend's ApiResponse shape.
class ApiClient {
  ApiClient({Dio? dio, SecureStorage? secureStorage, String? baseUrl})
    : _dio =
          dio ??
          Dio(
            BaseOptions(
              baseUrl: baseUrl ?? AppStrings.apiBaseUrl,
              connectTimeout: const Duration(seconds: 15),
              sendTimeout: const Duration(seconds: 20),
              receiveTimeout: const Duration(seconds: 20),
            ),
          ),
      _secureStorage = secureStorage ?? SecureStorage() {
    _configureInterceptors();
  }

  final Dio _dio;
  final SecureStorage _secureStorage;
  static const int _maxGetRetries = 2;
  static const Duration _retryBaseDelay = Duration(milliseconds: 300);
  static const String _requiresAuthExtra = 'requiresAuth';
  static const String _skipAuthRefreshExtra = 'skipAuthRefresh';
  static const String _hasRetriedAfterRefreshExtra = 'hasRetriedAfterRefresh';
  Future<String?>? _pendingRefresh;

  void _logDebug(String message) {
    if (kDebugMode) debugPrint(message);
  }

  void _configureInterceptors() {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onError: (error, handler) async {
          if (_shouldHandleUnauthorized(error)) {
            final token = await _refreshAccessToken();
            if (token != null && token.isNotEmpty) {
              try {
                final retryResponse = await _retryWithAccessToken(error, token);
                handler.resolve(retryResponse);
                return;
              } on DioException catch (retryError) {
                if (retryError.response?.statusCode == 401) {
                  await SessionExpiryHandler.clearSessionAndRedirectToLogin();
                }
                handler.next(retryError);
                return;
              }
            }
            await SessionExpiryHandler.clearSessionAndRedirectToLogin();
          }
          handler.next(error);
        },
      ),
    );
  }

  bool _shouldHandleUnauthorized(DioException error) {
    if (error.response?.statusCode != 401) return false;
    if (error.requestOptions.extra[_skipAuthRefreshExtra] == true) {
      return false;
    }
    if (error.requestOptions.extra[_hasRetriedAfterRefreshExtra] == true) {
      return false;
    }

    final requiresAuth = error.requestOptions.extra[_requiresAuthExtra] == true;
    final authHeader = error.requestOptions.headers['Authorization'];
    final hasAuthHeader = authHeader is String && authHeader.trim().isNotEmpty;
    return requiresAuth || hasAuthHeader;
  }

  Future<String?> _refreshAccessToken() {
    return _pendingRefresh ??= _runRefreshAccessToken().whenComplete(
      () => _pendingRefresh = null,
    );
  }

  Future<String?> _runRefreshAccessToken() async {
    final refreshToken = await _secureStorage.readRefreshToken();
    if (refreshToken == null || refreshToken.isEmpty) return null;

    try {
      final response = await _dio.post<Map<String, dynamic>>(
        AppStrings.authRefreshPath,
        data: {'refresh_token': refreshToken},
        options: Options(
          headers: const {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          extra: const {_requiresAuthExtra: false, _skipAuthRefreshExtra: true},
        ),
      );
      final body = _normalizeResponse(response);
      final token = _firstString([
        body['token'],
        body['access_token'],
        body['accessToken'],
      ]);
      final rotatedRefreshToken = _firstString([
        body['refresh_token'],
        body['refreshToken'],
      ]);

      if (token == null || rotatedRefreshToken == null) return null;

      await _secureStorage.saveToken(token);
      await _secureStorage.saveRefreshToken(rotatedRefreshToken);
      final session = body['session'];
      if (session is Map<String, dynamic>) {
        await _secureStorage.saveAuthSession(session);
      }
      return token;
    } on DioException catch (e) {
      _logDebug('Session refresh failed: ${e.response?.statusCode ?? e.type}');
      return null;
    } catch (_) {
      return null;
    }
  }

  Future<Response<dynamic>> _retryWithAccessToken(
    DioException error,
    String token,
  ) {
    final request = error.requestOptions;
    final headers = Map<String, dynamic>.from(request.headers);
    headers['Authorization'] = 'Bearer $token';
    final extra = Map<String, dynamic>.from(request.extra);
    extra[_hasRetriedAfterRefreshExtra] = true;

    return _dio.fetch<dynamic>(
      request.copyWith(headers: headers, extra: extra),
    );
  }

  Options _buildRequestOptions({
    required Map<String, String> headers,
    required bool requiresAuth,
  }) {
    return Options(headers: headers, extra: {_requiresAuthExtra: requiresAuth});
  }

  Future<Response<Map<String, dynamic>>> _sendWithRetry(
    Future<Response<Map<String, dynamic>>> Function() send, {
    bool retryOnFailure = false,
  }) async {
    var attempt = 0;
    while (true) {
      try {
        return await send();
      } on DioException catch (e) {
        final shouldRetry =
            retryOnFailure &&
            attempt < _maxGetRetries &&
            _isTransientFailure(e);
        if (!shouldRetry) rethrow;

        attempt++;
        final wait = Duration(
          milliseconds: _retryBaseDelay.inMilliseconds * (1 << (attempt - 1)),
        );
        _logDebug(
          'Transient API failure. Retrying in ${wait.inMilliseconds}ms (attempt $attempt/$_maxGetRetries)',
        );
        await Future.delayed(wait);
      }
    }
  }

  bool _isTransientFailure(DioException e) {
    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.connectionError:
        return true;
      case DioExceptionType.badResponse:
        final code = e.response?.statusCode ?? 0;
        return code == 429 || code >= 500;
      case DioExceptionType.badCertificate:
      case DioExceptionType.cancel:
      case DioExceptionType.unknown:
        return false;
    }
  }

  Future<Map<String, dynamic>> post(
    String path, {
    Map<String, dynamic>? data,
    bool authenticated = true,
  }) async {
    try {
      final headers = await _buildHeaders(includeAuth: authenticated);
      final response = await _sendWithRetry(
        () => _dio.post<Map<String, dynamic>>(
          path,
          data: data,
          options: _buildRequestOptions(
            headers: headers,
            requiresAuth: authenticated,
          ),
        ),
      );
      return _normalizeResponse(response);
    } on DioException catch (e) {
      throw _apiExceptionFromDio(e);
    }
  }

  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    bool authenticated = true,
  }) async {
    final hasQueryParams =
        queryParameters != null && queryParameters.isNotEmpty;
    try {
      final headers = await _buildHeaders(includeAuth: authenticated);
      _logDebug('GET Request to: $path');
      final response = await _sendWithRetry(
        () => _dio.get<Map<String, dynamic>>(
          path,
          queryParameters: queryParameters,
          options: _buildRequestOptions(
            headers: headers,
            requiresAuth: authenticated,
          ),
        ),
        retryOnFailure: true,
      );
      _logDebug('GET Response status: ${response.statusCode}');
      return _normalizeResponse(response);
    } on DioException catch (e) {
      final message = _extractMessage(e);
      if (hasQueryParams && _isIncomingMessageQuerySetterError(message)) {
        _logDebug(
          'Backend query-parser incompatibility detected. Retrying GET without query parameters: $path',
        );
        final headers = await _buildHeaders(includeAuth: authenticated);
        final retryResponse = await _sendWithRetry(
          () => _dio.get<Map<String, dynamic>>(
            path,
            options: _buildRequestOptions(
              headers: headers,
              requiresAuth: authenticated,
            ),
          ),
          retryOnFailure: true,
        );
        return _normalizeResponse(retryResponse);
      }
      throw _apiExceptionFromDio(e, fallbackMessage: message);
    }
  }

  Future<Map<String, dynamic>> put(
    String path, {
    Map<String, dynamic>? data,
    bool authenticated = true,
  }) async {
    try {
      final headers = await _buildHeaders(includeAuth: authenticated);
      _logDebug('PUT Request to: $path');
      final response = await _sendWithRetry(
        () => _dio.put<Map<String, dynamic>>(
          path,
          data: data,
          options: _buildRequestOptions(
            headers: headers,
            requiresAuth: authenticated,
          ),
        ),
      );
      _logDebug('PUT Response status: ${response.statusCode}');
      return _normalizeResponse(response);
    } on DioException catch (e) {
      throw _apiExceptionFromDio(e);
    }
  }

  Future<Map<String, dynamic>> patch(
    String path, {
    Map<String, dynamic>? data,
    bool authenticated = true,
  }) async {
    try {
      final headers = await _buildHeaders(includeAuth: authenticated);
      final response = await _sendWithRetry(
        () => _dio.patch<Map<String, dynamic>>(
          path,
          data: data,
          options: _buildRequestOptions(
            headers: headers,
            requiresAuth: authenticated,
          ),
        ),
      );
      return _normalizeResponse(response);
    } on DioException catch (e) {
      throw _apiExceptionFromDio(e);
    }
  }

  Future<Map<String, dynamic>> delete(
    String path, {
    Map<String, dynamic>? data,
    bool authenticated = true,
  }) async {
    try {
      final headers = await _buildHeaders(includeAuth: authenticated);
      _logDebug('DELETE Request to: $path');
      final response = await _sendWithRetry(
        () => _dio.delete<Map<String, dynamic>>(
          path,
          data: data,
          options: _buildRequestOptions(
            headers: headers,
            requiresAuth: authenticated,
          ),
        ),
      );
      _logDebug('DELETE Response status: ${response.statusCode}');
      return _normalizeResponse(response);
    } on DioException catch (e) {
      throw _apiExceptionFromDio(e);
    }
  }

  /// Returns the full response body without stripping the `data` wrapper.
  /// Useful for paginated responses that include `pagination` alongside `data`.
  Future<Map<String, dynamic>> getRaw(
    String path, {
    Map<String, dynamic>? queryParameters,
    bool authenticated = true,
  }) async {
    final hasQueryParams =
        queryParameters != null && queryParameters.isNotEmpty;
    try {
      final headers = await _buildHeaders(includeAuth: authenticated);
      final response = await _sendWithRetry(
        () => _dio.get<Map<String, dynamic>>(
          path,
          queryParameters: queryParameters,
          options: _buildRequestOptions(
            headers: headers,
            requiresAuth: authenticated,
          ),
        ),
        retryOnFailure: true,
      );
      final statusCode = response.statusCode ?? 500;
      final body = response.data ?? <String, dynamic>{};
      if (statusCode >= 400 || body['success'] == false) {
        throw _apiExceptionFromResponse(response, body);
      }
      return body;
    } on DioException catch (e) {
      final message = _extractMessage(e);
      if (hasQueryParams && _isIncomingMessageQuerySetterError(message)) {
        _logDebug(
          'Backend query-parser incompatibility detected. Retrying raw GET without query parameters: $path',
        );
        final headers = await _buildHeaders(includeAuth: authenticated);
        final retryResponse = await _sendWithRetry(
          () => _dio.get<Map<String, dynamic>>(
            path,
            options: _buildRequestOptions(
              headers: headers,
              requiresAuth: authenticated,
            ),
          ),
          retryOnFailure: true,
        );
        final statusCode = retryResponse.statusCode ?? 500;
        final body = retryResponse.data ?? <String, dynamic>{};
        if (statusCode >= 400 || body['success'] == false) {
          throw _apiExceptionFromResponse(retryResponse, body);
        }
        return body;
      }
      throw _apiExceptionFromDio(e, fallbackMessage: message);
    }
  }

  Future<Map<String, String>> _buildHeaders({required bool includeAuth}) async {
    final headers = <String, String>{
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (includeAuth) {
      final token = await _secureStorage.readToken();
      if (token != null && token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
        _logDebug('Authorization header attached');
      }
    }
    return headers;
  }

  Map<String, dynamic> _normalizeResponse(
    Response<Map<String, dynamic>> response,
  ) {
    final statusCode = response.statusCode ?? 500;
    final body = response.data ?? <String, dynamic>{};

    if (statusCode >= 400 || body['success'] == false) {
      throw _apiExceptionFromResponse(response, body);
    }

    // Handle the backend's ApiResponse format with 'data' wrapper
    if (body.containsKey('data')) {
      final data = body['data'];
      if (data is Map<String, dynamic>) {
        return data;
      }
      if (data is List) {
        return {'items': data};
      }
      // If data is null or empty, return it as is
      return data ?? <String, dynamic>{};
    }

    if (body.isNotEmpty) return body;
    return <String, dynamic>{};
  }

  ApiException _apiExceptionFromDio(DioException e, {String? fallbackMessage}) {
    final response = e.response;
    if (response != null) {
      final body = response.data is Map<String, dynamic>
          ? response.data as Map<String, dynamic>
          : <String, dynamic>{
              if (response.data != null) 'message': response.data.toString(),
            };
      return _apiExceptionFromResponse(response, body);
    }

    final message = fallbackMessage ?? _extractMessage(e);
    final isTimeout =
        e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.sendTimeout ||
        e.type == DioExceptionType.receiveTimeout;

    return ApiException(
      _sanitizeServerMessage(message),
      kind: isTimeout ? ApiErrorKind.timeout : ApiErrorKind.network,
      title: isTimeout ? 'Request timed out' : 'Cannot reach VitaLink',
    );
  }

  ApiException _apiExceptionFromResponse(
    Response<dynamic> response,
    Map<String, dynamic> body,
  ) {
    final statusCode = response.statusCode ?? 500;
    final serverMessage = _firstString([
      body['message'],
      body['error'],
      body['detail'],
    ]);
    final isDeprecated = response.headers.value('deprecation') == 'true';
    final sunset = response.headers.value('sunset');
    final apiVersion = response.headers.value('x-api-version');
    final supportedVersions = response.headers.value(
      'x-api-supported-versions',
    );
    final retryAfter = _parseRetryAfter(response.headers.value('retry-after'));
    final hasApiRouteHint =
        body['data'] is Map &&
        ((body['data'] as Map).containsKey('current_base_path') ||
            (body['data'] as Map).containsKey('current_api_version'));

    if (isDeprecated && statusCode < 400) {
      return ApiException(
        'This app is using an older API path. Please update the app or contact support.',
        statusCode: statusCode,
        kind: ApiErrorKind.deprecatedApi,
        isDeprecatedApi: true,
        sunset: sunset,
        apiVersion: apiVersion,
        supportedVersions: supportedVersions,
      );
    }

    switch (statusCode) {
      case 400:
        return ApiException(
          _sanitizeServerMessage(
            serverMessage ?? 'The request has invalid or missing details.',
          ),
          statusCode: statusCode,
          kind: ApiErrorKind.badRequest,
          apiVersion: apiVersion,
          supportedVersions: supportedVersions,
        );
      case 401:
        return ApiException(
          _sanitizeServerMessage(
            serverMessage ?? 'Your session has expired. Please sign in again.',
          ),
          statusCode: statusCode,
          kind: ApiErrorKind.unauthorized,
          apiVersion: apiVersion,
          supportedVersions: supportedVersions,
        );
      case 403:
        return ApiException(
          _sanitizeServerMessage(
            serverMessage ?? 'You do not have access to this action.',
          ),
          statusCode: statusCode,
          kind: ApiErrorKind.forbidden,
          apiVersion: apiVersion,
          supportedVersions: supportedVersions,
        );
      case 404:
        return ApiException(
          hasApiRouteHint
              ? 'This screen is calling an API route that is not available. Please update the app or contact support.'
              : _sanitizeServerMessage(
                  serverMessage ??
                      'The requested record or service was not found.',
                ),
          statusCode: statusCode,
          kind: ApiErrorKind.notFound,
          title: hasApiRouteHint ? 'API route not found' : null,
          apiVersion: apiVersion,
          supportedVersions: supportedVersions,
        );
      case 413:
        return ApiException(
          _sanitizeServerMessage(
            serverMessage ??
                'The selected file or request is larger than allowed.',
          ),
          statusCode: statusCode,
          kind: ApiErrorKind.requestTooLarge,
          apiVersion: apiVersion,
          supportedVersions: supportedVersions,
        );
      case 423:
        return ApiException(
          _sanitizeServerMessage(
            serverMessage ??
                'This account is temporarily locked because of repeated failed login attempts. Try again later or contact an administrator.',
          ),
          statusCode: statusCode,
          kind: ApiErrorKind.locked,
          retryAfter: retryAfter,
          apiVersion: apiVersion,
          supportedVersions: supportedVersions,
        );
      case 429:
        return ApiException(
          _sanitizeServerMessage(
            serverMessage ??
                'Too many attempts. Please wait before trying again.',
          ),
          statusCode: statusCode,
          kind: ApiErrorKind.rateLimited,
          retryAfter: retryAfter,
          apiVersion: apiVersion,
          supportedVersions: supportedVersions,
        );
      default:
        if (statusCode >= 500) {
          return ApiException(
            _sanitizeServerMessage(
              serverMessage ??
                  'The server could not complete the request. Please try again in a moment.',
            ),
            statusCode: statusCode,
            kind: ApiErrorKind.server,
            apiVersion: apiVersion,
            supportedVersions: supportedVersions,
          );
        }
        return ApiException(
          _sanitizeServerMessage(serverMessage ?? 'Request failed'),
          statusCode: statusCode,
          kind: ApiErrorKind.unknown,
          apiVersion: apiVersion,
          supportedVersions: supportedVersions,
        );
    }
  }

  String _extractMessage(DioException e) {
    final res = e.response;
    _logDebug('API Error - Status Code: ${res?.statusCode}');
    _logDebug('API Error - Response: ${res?.data}');
    _logDebug('API Error - Dio Type: ${e.type}');
    _logDebug('API Error - Dio Message: ${e.message}');

    if (res?.statusCode == 401) {
      _logDebug('Authentication failed - token may be invalid or expired');
    }

    if (res?.data is Map<String, dynamic>) {
      final map = res?.data as Map<String, dynamic>;
      if (map['message'] is String) {
        return _sanitizeServerMessage(map['message'] as String);
      }
      if (map['error'] is String) {
        return _sanitizeServerMessage(map['error'] as String);
      }
    }

    if (_isConnectionFailure(e)) {
      return _sanitizeServerMessage(
        'Unable to reach the server. Check your internet connection and try again.',
      );
    }

    return _sanitizeServerMessage(e.message);
  }

  String? _firstString(List<dynamic> values) {
    for (final value in values) {
      if (value is String && value.trim().isNotEmpty) {
        return value.trim();
      }
    }
    return null;
  }

  Duration? _parseRetryAfter(String? raw) {
    if (raw == null || raw.trim().isEmpty) return null;
    final seconds = int.tryParse(raw.trim());
    if (seconds != null && seconds >= 0) {
      return Duration(seconds: seconds);
    }
    final date = DateTime.tryParse(raw);
    if (date == null) return null;
    final diff = date.difference(DateTime.now());
    return diff.isNegative ? Duration.zero : diff;
  }

  bool _isIncomingMessageQuerySetterError(String message) {
    final lower = message.toLowerCase();
    return lower.contains('cannot set property query') &&
        (lower.contains('incomingmessage') ||
            lower.contains('incommingmessage'));
  }

  String _sanitizeServerMessage(String? raw) {
    final message = (raw == null || raw.trim().isEmpty)
        ? 'Request failed'
        : raw;

    // Flutter Web often wraps CORS/TLS/DNS failures in this XHR onError text.
    if (_isBrowserXhrNetworkError(message)) {
      return 'Unable to reach the server. Please try again in a moment.';
    }

    if (_isIncomingMessageQuerySetterError(message)) {
      return 'Server configuration error. Please contact support.';
    }
    return message;
  }

  bool _isConnectionFailure(DioException e) {
    final noResponse = e.response == null;
    final isConnectionType =
        e.type == DioExceptionType.connectionError ||
        e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout ||
        e.type == DioExceptionType.sendTimeout;
    if (isConnectionType && noResponse) return true;

    // Dio on web may surface these failures as unknown with an XHR onError message.
    final message = (e.message ?? '').toLowerCase();
    if (kIsWeb &&
        e.type == DioExceptionType.unknown &&
        (message.contains('xmlhttprequest onerror callback was called') ||
            message.contains('network layer'))) {
      return true;
    }
    return false;
  }

  bool _isBrowserXhrNetworkError(String message) {
    final lower = message.toLowerCase();
    return lower.contains('xmlhttprequest onerror callback was called') ||
        lower.contains('error on the network layer');
  }
}
