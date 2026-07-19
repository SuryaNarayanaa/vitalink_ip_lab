import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/features/patient/data/patient_repository.dart';

/// Minimal stub ApiClient that records GET paths and returns canned bodies.
class _RecordingApiClient extends ApiClient {
  _RecordingApiClient(this.responses) : super();

  final Map<String, Map<String, dynamic>> responses;
  final List<String> getPaths = <String>[];

  @override
  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    bool authenticated = true,
  }) async {
    getPaths.add(path);
    final body = responses[path];
    if (body == null) {
      throw StateError('No stub response for GET $path');
    }
    return body;
  }
}

void main() {
  group('PatientRepository report bundle', () {
    late _RecordingApiClient api;
    late PatientRepository repo;

    setUp(() {
      api = _RecordingApiClient({
        '/api/v1/patient/reports': {
          'report': {
            'medical_config': {
              'therapy_drug': 'Warfarin',
              'therapy_start_date': '2024-01-15T00:00:00.000Z',
              'instructions': ['Take with water'],
              'target_inr': {'min': 2.0, 'max': 3.0},
            },
            'weekly_dosage': {'monday': 4},
            'inr_history': [
              {
                '_id': 'r1',
                'test_date': '2024-02-01T00:00:00.000Z',
                'inr_value': 2.5,
                'notes': 'ok',
                'is_critical': false,
                'file_url': 'https://example.com/a.pdf',
                'uploaded_at': '2024-02-01T00:00:00.000Z',
              },
              {
                '_id': 'r2',
                'test_date': '2024-03-01T00:00:00.000Z',
                'inr_value': 4.1,
                'notes': 'high',
                'is_critical': true,
                'file_url': '',
                'uploaded_at': '2024-03-01T00:00:00.000Z',
              },
            ],
          },
        },
      });
      repo = PatientRepository(apiClient: api);
    });

    test('getReportBundle issues a single reports GET', () async {
      final bundle = await repo.getReportBundle();

      expect(api.getPaths.where((p) => p.contains('/reports')).length, 1);
      expect(bundle['history'], isA<List>());
      expect((bundle['history'] as List).length, 2);
      expect(bundle['prescriptions'], isA<List>());
      expect((bundle['prescriptions'] as List).length, 1);
      expect(
        (bundle['prescriptions'] as List).first['drug'],
        'Warfarin',
      );
      final latest = bundle['latestINR'] as Map<String, dynamic>;
      expect(latest['hasData'], isTrue);
      expect(latest['isCritical'], isTrue);
      expect((latest['value'] as num).toDouble(), 4.1);
    });

    test('concurrent history/prescriptions/latest coalesce to one GET',
        () async {
      final results = await Future.wait([
        repo.getINRHistory(),
        repo.getPrescriptions(),
        repo.getLatestINRData(),
      ]);

      expect(api.getPaths.where((p) => p.contains('/reports')).length, 1);
      expect(results[0], isA<List>());
      expect(results[1], isA<List>());
      expect(results[2], isA<Map>());
    });

    test('prescriptions do not invent a hardcoded Aspirin entry', () async {
      final prescriptions = await repo.getPrescriptions();
      expect(
        prescriptions.any((p) => p['drug']?.toString() == 'Aspirin'),
        isFalse,
      );
    });

    test('failed in-flight report clears slot so a later call retries',
        () async {
      var calls = 0;
      final flaky = _FlakyReportsApiClient(
        onGet: () {
          calls++;
          if (calls == 1) {
            throw StateError('network down');
          }
          return {
            'report': {
              'medical_config': {
                'therapy_drug': 'Warfarin',
                'target_inr': {'min': 2.0, 'max': 3.0},
              },
              'weekly_dosage': const <String, dynamic>{},
              'inr_history': const <dynamic>[],
            },
          };
        },
      );
      final flakyRepo = PatientRepository(apiClient: flaky);

      await expectLater(flakyRepo.getReportBundle(), throwsStateError);
      final bundle = await flakyRepo.getReportBundle();
      expect(calls, 2);
      expect(bundle['history'], isA<List>());
    });

    test('invalidate after mutation forces a second GET', () async {
      final delayed = _DelayedReportsApiClient(
        firstPayload: {
          'report': {
            'medical_config': {
              'therapy_drug': 'Warfarin',
              'target_inr': {'min': 2.0, 'max': 3.0},
            },
            'weekly_dosage': const <String, dynamic>{},
            'inr_history': [
              {
                '_id': 'old',
                'test_date': '2024-01-01T00:00:00.000Z',
                'inr_value': 2.0,
                'is_critical': false,
              },
            ],
          },
        },
        secondPayload: {
          'report': {
            'medical_config': {
              'therapy_drug': 'Warfarin',
              'target_inr': {'min': 2.0, 'max': 3.0},
            },
            'weekly_dosage': const <String, dynamic>{},
            'inr_history': [
              {
                '_id': 'new',
                'test_date': '2024-04-01T00:00:00.000Z',
                'inr_value': 3.5,
                'is_critical': true,
              },
            ],
          },
        },
      );
      final delayedRepo = PatientRepository(apiClient: delayed);

      // Start a slow first fetch without awaiting.
      final first = delayedRepo.getINRHistory();
      // Allow the first load to register as in-flight.
      await Future<void>.delayed(Duration.zero);
      // Simulate successful INR submit invalidation via public mutation path:
      // bump generation by posting without file (intercepted).
      delayed.allowPost = true;
      await delayedRepo.submitINRReport(
        inrValue: '3.5',
        testDate: '01-04-2024',
      );

      final second = delayedRepo.getLatestINRData();
      delayed.releaseFirst();
      await first;
      final latest = await second;

      expect(delayed.getCount, greaterThanOrEqualTo(2));
      expect(latest['hasData'], isTrue);
      expect((latest['value'] as num).toDouble(), 3.5);
    });
  });
}

class _FlakyReportsApiClient extends ApiClient {
  _FlakyReportsApiClient({required this.onGet}) : super();

  final Map<String, dynamic> Function() onGet;
  int getCount = 0;

  @override
  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    bool authenticated = true,
  }) async {
    getCount++;
    return onGet();
  }
}

class _DelayedReportsApiClient extends ApiClient {
  _DelayedReportsApiClient({
    required this.firstPayload,
    required this.secondPayload,
  }) : super();

  final Map<String, dynamic> firstPayload;
  final Map<String, dynamic> secondPayload;
  int getCount = 0;
  bool allowPost = false;
  bool _firstReleased = false;

  void releaseFirst() {
    _firstReleased = true;
  }

  @override
  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    bool authenticated = true,
  }) async {
    getCount++;
    if (getCount == 1) {
      // Wait until the test signals mutation finished (or timeout gate).
      while (!_firstReleased) {
        await Future<void>.delayed(const Duration(milliseconds: 5));
      }
      return firstPayload;
    }
    return secondPayload;
  }

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Map<String, dynamic>? data,
    bool authenticated = true,
  }) async {
    if (!allowPost) {
      throw StateError('POST not expected');
    }
    return <String, dynamic>{};
  }
}
