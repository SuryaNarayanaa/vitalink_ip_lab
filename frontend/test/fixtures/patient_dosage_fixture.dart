import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/features/patient/data/patient_repository.dart';

final fixtureHistory = <String, dynamic>{
  'today': '2026-11-13',
  'timezone': 'Asia/Kolkata',
  'current_schedule_only': true,
  'days': List.generate(303, (i) {
    final day = DateTime(2026, 2, i + 1);
    final date = day.toIso8601String().substring(0, 10);
    return {
      'date': date,
      'amount': 2.5,
      'state': date == '2026-11-13'
          ? 'pending'
          : date.compareTo('2026-11-13') > 0
          ? 'upcoming'
          : day.day % 3 == 0
          ? 'taken'
          : 'not_recorded',
    };
  }),
};

class FixturePatientRepository extends PatientRepository {
  FixturePatientRepository() : super(apiClient: ApiClient());
  @override
  Future<Map<String, dynamic>> getMissedDoses() async => {
    'recent_missed_doses': ['12-11-2026'],
    'missed_doses': ['02-02-2026', '03-02-2026'],
  };
  @override
  Future<Map<String, dynamic>> getDosageCalendar({
    int months = 3,
    String? startDate,
  }) async => {'dose_history': fixtureHistory};
}
