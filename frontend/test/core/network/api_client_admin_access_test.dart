import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/core/network/api_client.dart';

class _StaticResponseAdapter implements HttpClientAdapter {
  _StaticResponseAdapter({required this.statusCode, required this.body});

  final int statusCode;
  final Map<String, dynamic> body;
  int calls = 0;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    calls++;
    return ResponseBody.fromString(
      jsonEncode(body),
      statusCode,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('structured 409 is exposed as a conflict with safe details', () async {
    final adapter = _StaticResponseAdapter(
      statusCode: 409,
      body: {
        'success': false,
        'message': 'Policy version conflict',
        'data': {
          'expected_version': 3,
          'current_policy': {
            'policy_version': 4,
            'capabilities': {'platform.audit.read': true},
          },
          'refresh_token': 'must-not-be-exposed',
          'debug': {'stack_trace': 'internal stack'},
        },
      },
    );
    final dio = Dio(BaseOptions(baseUrl: 'https://example.test'))
      ..httpClientAdapter = adapter;
    final client = ApiClient(dio: dio);

    ApiException? captured;
    try {
      await client.put(
        '/admin/role-policies/auditor',
        data: const {'expected_version': 3},
        authenticated: false,
      );
    } on ApiException catch (error) {
      captured = error;
    }

    expect(captured, isA<ApiConflictException>());
    expect(captured?.isConflict, isTrue);
    expect(captured?.statusCode, 409);
    expect(captured?.canRetry, isFalse);
    expect(captured?.conflictDetails?['expected_version'], 3);
    expect(
      (captured?.conflictDetails?['current_policy'] as Map?)?['policy_version'],
      4,
    );
    expect(captured?.conflictDetails?.containsKey('refresh_token'), isFalse);
    expect(
      (captured?.conflictDetails?['debug'] as Map?)?.containsKey('stack_trace'),
      isFalse,
    );
  });

  test('403 notifies once and never replays a denied mutation', () async {
    final adapter = _StaticResponseAdapter(
      statusCode: 403,
      body: {'success': false, 'message': 'Capability denied'},
    );
    final dio = Dio(BaseOptions(baseUrl: 'https://example.test'))
      ..httpClientAdapter = adapter;
    final client = ApiClient(dio: dio);
    var notifications = 0;
    client.setAuthorizationDeniedHandler(() => notifications++);

    ApiException? captured;
    try {
      await client.post(
        '/admin/notifications/broadcast',
        data: const {'message': 'No retry'},
        authenticated: false,
      );
    } on ApiException catch (error) {
      captured = error;
    }

    expect(captured?.kind, ApiErrorKind.forbidden);
    expect(notifications, 1);
    expect(adapter.calls, 1);
  });
}
