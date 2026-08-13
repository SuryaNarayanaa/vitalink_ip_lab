import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/features/admin/models/admin_stats_model.dart';

void main() {
  test('system health reads the live GET /admin/system/health shape', () {
    final health = SystemHealthModel.fromJson({
      'status': 'healthy',
      'uptime_seconds': 3661,
      'dependencies': {
        'database': {'status': 'available'},
      },
      'timestamp': '2026-08-13T00:00:00.000Z',
    });

    expect(health.status, 'healthy');
    expect(health.uptime, 3661);
    expect(health.database.status, 'available');
    expect(health.timestamp, '2026-08-13T00:00:00.000Z');
  });

  test('system health still accepts legacy uptime and database.state keys', () {
    final health = SystemHealthModel.fromJson({
      'status': 'degraded',
      'uptime': 10,
      'database': {'state': 'unknown'},
    });

    expect(health.uptime, 10);
    expect(health.database.status, 'unknown');
  });

  test('missing patients.critical_inr stays unset instead of defaulting to 0', () {
    final stats = AdminStatsModel.fromJson({
      'doctors': {'total': 1, 'active': 1, 'inactive': 0, 'recent': 0},
      'patients': {'total': 4, 'active': 3, 'inactive': 1, 'recent': 0},
      'audit_logs': 2,
    });

    expect(stats.patientStats.criticalInr, isNull);
    expect(stats.patientStats.total, 4);
  });

  test('compliance no-data percentage is not labeled as critical', () {
    final compliance = InrComplianceStats.fromJson({
      'total_patients': 10,
      'in_range': 5,
      'below_range': 2,
      'above_range': 1,
      'no_data': 2,
    });

    expect(compliance.noDataPercentage, 20);
    expect(compliance.outOfRangePercentage, 30);
  });

  test('workload parser accepts the global aggregate object', () {
    final stats = DoctorWorkloadStats.fromResponse({
      'scope': 'global',
      'doctors_with_active_patients': 4,
      'active_patient_assignments': 12,
      'maximum_assignments_per_doctor': 5,
      'average_assignments_per_doctor': 3,
    });

    expect(stats.isGlobal, isTrue);
    expect(stats.hasRenderableData, isTrue);
    expect(stats.doctorsWithActivePatients, 4);
    expect(stats.activePatientAssignments, 12);
    expect(stats.items, isEmpty);
  });

  test('workload parser accepts tenant items wrapped by ApiClient', () {
    final stats = DoctorWorkloadStats.fromResponse({
      'items': [
        {
          'doctor_id': 'd1',
          'doctor_name': 'Dr. A',
          'department': 'Cards',
          'patient_count': 7,
        },
      ],
    });

    expect(stats.isGlobal, isFalse);
    expect(stats.items.single.doctorName, 'Dr. A');
    expect(stats.items.single.patientCount, 7);
  });
}
