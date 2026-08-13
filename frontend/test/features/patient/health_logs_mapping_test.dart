import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/features/doctor/models/patient_detail_model.dart';
import 'package:frontend/features/patient/data/patient_repository.dart';

class _ProfileApiClient extends ApiClient {
  _ProfileApiClient(this.profileBody) : super();

  final Map<String, dynamic> profileBody;

  @override
  Future<Map<String, dynamic>> getRaw(
    String path, {
    Map<String, dynamic>? queryParameters,
    bool authenticated = true,
  }) async {
    return profileBody;
  }
}

void main() {
  group('PatientRepository.healthLogDescription', () {
    test('extracts each monitoring type from health_logs', () {
      final logs = [
        {
          'type': 'SIDE_EFFECT',
          'description': 'Severe Headache, Bruising without Injury',
        },
        {'type': 'ILLNESS', 'description': 'Flu for 3 days'},
        {'type': 'LIFESTYLE', 'description': 'Started gym'},
        {'type': 'OTHER_MEDS', 'description': 'Aspirin 75mg'},
      ];

      expect(
        PatientRepository.healthLogDescription(logs, 'SIDE_EFFECT'),
        'Severe Headache, Bruising without Injury',
      );
      expect(
        PatientRepository.healthLogDescription(logs, 'ILLNESS'),
        'Flu for 3 days',
      );
      expect(
        PatientRepository.healthLogDescription(logs, 'LIFESTYLE'),
        'Started gym',
      );
      expect(
        PatientRepository.healthLogDescription(logs, 'OTHER_MEDS'),
        'Aspirin 75mg',
      );
      expect(PatientRepository.healthLogDescription(logs, 'UNKNOWN'), isNull);
    });

    test('normalizes loosely-typed log maps from JSON/Dio shapes', () {
      // Map without String-key typing (common after dynamic decode).
      final raw = <dynamic>[
        <dynamic, dynamic>{
          'type': 'SIDE_EFFECT',
          'description': '  Dizziness or Weakness  ',
        },
      ];
      final logs = PatientRepository.normalizeHealthLogs(raw);
      expect(logs.length, 1);
      expect(
        PatientRepository.healthLogDescription(logs, 'SIDE_EFFECT'),
        'Dizziness or Weakness',
      );
    });
  });

  group('PatientRepository.getProfile monitoring fields', () {
    test('maps health_logs into sideEffects / lifestyle / meds / illness',
        () async {
      final api = _ProfileApiClient({
        'success': true,
        'data': {
          'patient': {
            'login_id': 'OP1001',
            'profile_id': {
              'demographics': {
                'name': 'Ada',
                'age': 42,
                'gender': 'Female',
                'phone': '999',
                'next_of_kin': {'name': 'Bob', 'relation': 'Spouse', 'phone': '111'},
              },
              'medical_config': {
                'target_inr': {'min': 2.0, 'max': 3.0},
                'therapy_drug': 'Warfarin',
                'instructions': <String>[],
              },
              'weekly_dosage': {'monday': 5},
              'health_logs': [
                {
                  'type': 'SIDE_EFFECT',
                  'description': 'Severe Headache',
                  'date': '2026-07-20T00:00:00.000Z',
                },
                {
                  'type': 'ILLNESS',
                  'description': 'Cold symptoms',
                  'date': '2026-07-21T00:00:00.000Z',
                },
                {
                  'type': 'LIFESTYLE',
                  'description': 'Diet change',
                  'date': '2026-07-22T00:00:00.000Z',
                },
                {
                  'type': 'OTHER_MEDS',
                  'description': 'Vitamin K supplement',
                  'date': '2026-07-23T00:00:00.000Z',
                },
              ],
              'medical_history': <dynamic>[],
            },
          },
          'doctor_updates': {'unread_count': 0, 'latest': null},
        },
      });

      final repo = PatientRepository(apiClient: api);
      final profile = await repo.getProfile();

      expect(profile['sideEffects'], 'Severe Headache');
      expect(profile['prolongedIllness'], 'Cold symptoms');
      expect(profile['lifestyleChanges'], 'Diet change');
      expect(profile['otherMedication'], 'Vitamin K supplement');
      expect((profile['healthLogs'] as List).length, 4);
      expect(profile['profilePictureUrl'], isNull);
    });

    test('maps resolved profile_picture_url onto profilePictureUrl', () async {
      final api = _ProfileApiClient({
        'success': true,
        'data': {
          'patient': {
            'login_id': 'OP1003',
            'profile_id': {
              'demographics': {
                'name': 'Ada',
                'age': 42,
                'gender': 'Female',
                'phone': '999',
              },
              'medical_config': {
                'target_inr': {'min': 2.0, 'max': 3.0},
              },
              'profile_picture_url':
                  'https://storage.example/patient.jpg?X-Amz-Signature=abc',
            },
          },
        },
      });

      final repo = PatientRepository(apiClient: api);
      final profile = await repo.getProfile();

      expect(
        profile['profilePictureUrl'],
        'https://storage.example/patient.jpg?X-Amz-Signature=abc',
      );
    });

    test('blank profile_picture_url values map to null', () async {
      Future<void> expectNullPicture(String? raw) async {
        final api = _ProfileApiClient({
          'success': true,
          'data': {
            'patient': {
              'login_id': 'OP1004',
              'profile_id': {
                'demographics': {
                  'name': 'Ada',
                  'age': 42,
                  'gender': 'Female',
                  'phone': '999',
                },
                'medical_config': {
                  'target_inr': {'min': 2.0, 'max': 3.0},
                },
                'profile_picture_url': raw,
              },
            },
          },
        });
        final profile = await PatientRepository(apiClient: api).getProfile();
        expect(profile['profilePictureUrl'], isNull);
      }

      await expectNullPicture('');
      await expectNullPicture('   ');
    });

    test('trims surrounding whitespace on profile_picture_url', () async {
      final api = _ProfileApiClient({
        'success': true,
        'data': {
          'patient': {
            'login_id': 'OP1005',
            'profile_id': {
              'demographics': {
                'name': 'Ada',
                'age': 42,
                'gender': 'Female',
                'phone': '999',
              },
              'medical_config': {
                'target_inr': {'min': 2.0, 'max': 3.0},
              },
              'profile_picture_url':
                  '  https://storage.example/patient.jpg?X-Amz-Signature=abc  ',
            },
          },
        },
      });

      final profile = await PatientRepository(apiClient: api).getProfile();
      expect(
        profile['profilePictureUrl'],
        'https://storage.example/patient.jpg?X-Amz-Signature=abc',
      );
    });

    test('uses defaults when no health logs exist', () async {
      final api = _ProfileApiClient({
        'success': true,
        'data': {
          'patient': {
            'login_id': 'OP1002',
            'profile_id': {
              'demographics': {
                'name': 'Ada',
                'age': 42,
                'gender': 'Female',
                'phone': '999',
              },
              'medical_config': {
                'target_inr': {'min': 2.0, 'max': 3.0},
              },
              'health_logs': <dynamic>[],
            },
          },
        },
      });

      final repo = PatientRepository(apiClient: api);
      final profile = await repo.getProfile();

      expect(profile['sideEffects'], 'None Reported');
      expect(profile['lifestyleChanges'], 'Stable');
      expect(profile['otherMedication'], 'None');
      expect(profile['prolongedIllness'], 'None');
    });
  });

  group('PatientDetailModel health logs (doctor portal)', () {
    test('parses health_logs and exposes descriptions by type', () {
      final patient = PatientDetailModel.fromJson({
        '_id': 'pid1',
        'login_id': 'OP2001',
        'demographics': {
          'name': 'Casey',
          'age': 55,
          'gender': 'Male',
          'phone': '555',
        },
        'health_logs': [
          {
            'type': 'SIDE_EFFECT',
            'description': 'Black or Bloody Stool',
            'date': '2026-07-10T12:00:00.000Z',
          },
          {
            'type': 'OTHER_MEDS',
            'description': 'Ibuprofen PRN',
            'date': '2026-07-11T12:00:00.000Z',
          },
        ],
      });

      expect(patient.healthLogs, isNotNull);
      expect(patient.healthLogs!.length, 2);
      expect(
        patient.healthLogDescription('SIDE_EFFECT'),
        'Black or Bloody Stool',
      );
      expect(
        patient.healthLogDescription('OTHER_MEDS'),
        'Ibuprofen PRN',
      );
      expect(
        patient.healthLogDescription('ILLNESS'),
        'None reported',
      );
      expect(
        patient.healthLogDate('SIDE_EFFECT'),
        '2026-07-10T12:00:00.000Z',
      );
    });

    test('accepts loosely typed nested maps for health_logs', () {
      final patient = PatientDetailModel.fromJson({
        '_id': 'pid2',
        'demographics': <dynamic, dynamic>{
          'name': 'Dana',
          'age': 30,
        },
        'health_logs': <dynamic>[
          <dynamic, dynamic>{
            'type': 'LIFESTYLE',
            'description': 'Reduced alcohol',
          },
        ],
      });

      expect(patient.name, 'Dana');
      expect(patient.healthLogDescription('LIFESTYLE'), 'Reduced alcohol');
    });
  });
}
