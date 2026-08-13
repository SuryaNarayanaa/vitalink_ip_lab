class AdminStatsModel {
  final DoctorStats doctors;
  final PatientStats patients;
  final int auditLogs;

  AdminStatsModel({
    required this.doctors,
    required this.patients,
    this.auditLogs = 0,
  });

  // Convenience aliases used by dashboard/analytics pages
  DoctorStats get doctorStats => doctors;
  PatientStats get patientStats => patients;

  factory AdminStatsModel.fromJson(Map<String, dynamic> json) {
    return AdminStatsModel(
      doctors: DoctorStats.fromJson(
        json['doctors'] as Map<String, dynamic>? ?? {},
      ),
      patients: PatientStats.fromJson(
        json['patients'] as Map<String, dynamic>? ?? {},
      ),
      auditLogs: json['audit_logs'] as int? ?? 0,
    );
  }
}

class DoctorStats {
  final int total;
  final int active;
  final int inactive;
  final int recent;

  DoctorStats({
    this.total = 0,
    this.active = 0,
    this.inactive = 0,
    this.recent = 0,
  });

  factory DoctorStats.fromJson(Map<String, dynamic> json) {
    return DoctorStats(
      total: json['total'] as int? ?? 0,
      active: json['active'] as int? ?? 0,
      inactive: json['inactive'] as int? ?? 0,
      recent: json['recent'] as int? ?? 0,
    );
  }
}

class PatientStats {
  final int total;
  final int active;
  final int inactive;
  final int recent;
  final int? criticalInr;

  PatientStats({
    this.total = 0,
    this.active = 0,
    this.inactive = 0,
    this.recent = 0,
    this.criticalInr,
  });

  factory PatientStats.fromJson(Map<String, dynamic> json) {
    return PatientStats(
      total: json['total'] as int? ?? 0,
      active: json['active'] as int? ?? 0,
      inactive: json['inactive'] as int? ?? 0,
      recent: json['recent'] as int? ?? 0,
      criticalInr: _readOptionalInt(json['critical_inr']),
    );
  }
}

class TrendDataPoint {
  final String date;
  final int count;

  TrendDataPoint({required this.date, required this.count});

  factory TrendDataPoint.fromJson(Map<String, dynamic> json) {
    return TrendDataPoint(
      date: json['date'] as String? ?? '',
      count: json['count'] as int? ?? 0,
    );
  }
}

class CombinedTrendDataPoint {
  final String date;
  final int doctors;
  final int patients;

  CombinedTrendDataPoint({
    required this.date,
    required this.doctors,
    required this.patients,
  });
}

class RegistrationTrends {
  final String period;
  final List<TrendDataPoint> doctors;
  final List<TrendDataPoint> patients;

  RegistrationTrends({
    required this.period,
    required this.doctors,
    required this.patients,
  });

  /// Combined view of doctor and patient trends by date.
  List<CombinedTrendDataPoint> get dataPoints {
    final dateMap = <String, Map<String, int>>{};
    for (final d in doctors) {
      dateMap.putIfAbsent(d.date, () => {'doctors': 0, 'patients': 0});
      dateMap[d.date]!['doctors'] = d.count;
    }
    for (final p in patients) {
      dateMap.putIfAbsent(p.date, () => {'doctors': 0, 'patients': 0});
      dateMap[p.date]!['patients'] = p.count;
    }
    final sorted = dateMap.keys.toList()..sort();
    return sorted
        .map((date) => CombinedTrendDataPoint(
              date: date,
              doctors: dateMap[date]!['doctors']!,
              patients: dateMap[date]!['patients']!,
            ))
        .toList();
  }

  factory RegistrationTrends.fromJson(Map<String, dynamic> json) {
    return RegistrationTrends(
      period: json['period'] as String? ?? '30d',
      doctors: (json['doctors'] as List? ?? [])
          .map((e) => TrendDataPoint.fromJson(e as Map<String, dynamic>))
          .toList(),
      patients: (json['patients'] as List? ?? [])
          .map((e) => TrendDataPoint.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}

class InrComplianceStats {
  final int totalPatients;
  final int inRange;
  final int belowRange;
  final int aboveRange;
  final int noData;

  InrComplianceStats({
    this.totalPatients = 0,
    this.inRange = 0,
    this.belowRange = 0,
    this.aboveRange = 0,
    this.noData = 0,
  });

  /// Alias for totalPatients used by analytics charts.
  int get total => totalPatients;

  double get inRangePercentage =>
      totalPatients > 0 ? (inRange / totalPatients) * 100 : 0;

  double get outOfRangePercentage =>
      totalPatients > 0 ? ((belowRange + aboveRange) / totalPatients) * 100 : 0;

  double get noDataPercentage =>
      totalPatients > 0 ? (noData / totalPatients) * 100 : 0;

  factory InrComplianceStats.fromJson(Map<String, dynamic> json) {
    return InrComplianceStats(
      totalPatients: json['total_patients'] as int? ?? 0,
      inRange: json['in_range'] as int? ?? 0,
      belowRange: json['below_range'] as int? ?? 0,
      aboveRange: json['above_range'] as int? ?? 0,
      noData: json['no_data'] as int? ?? 0,
    );
  }
}

class DoctorWorkload {
  final String? doctorId;
  final String? doctorName;
  final String? department;
  final int patientCount;

  DoctorWorkload({
    this.doctorId,
    this.doctorName,
    this.department,
    this.patientCount = 0,
  });

  factory DoctorWorkload.fromJson(Map<String, dynamic> json) {
    return DoctorWorkload(
      doctorId: json['doctor_id']?.toString(),
      doctorName: json['doctor_name'] as String?,
      department: json['department'] as String?,
      patientCount: _readOptionalInt(json['patient_count']) ?? 0,
    );
  }
}

class DoctorWorkloadStats {
  DoctorWorkloadStats.global({
    required this.doctorsWithActivePatients,
    required this.activePatientAssignments,
    this.maximumAssignmentsPerDoctor,
    this.averageAssignmentsPerDoctor,
  })  : isGlobal = true,
        items = const [];

  DoctorWorkloadStats.tenant(this.items)
      : isGlobal = false,
        doctorsWithActivePatients = null,
        activePatientAssignments = null,
        maximumAssignmentsPerDoctor = null,
        averageAssignmentsPerDoctor = null;

  final bool isGlobal;
  final List<DoctorWorkload> items;
  final int? doctorsWithActivePatients;
  final int? activePatientAssignments;
  final int? maximumAssignmentsPerDoctor;
  final double? averageAssignmentsPerDoctor;

  bool get hasRenderableData =>
      isGlobal || items.isNotEmpty;

  factory DoctorWorkloadStats.fromResponse(Map<String, dynamic> json) {
    final items = json['items'];
    if (items is List) {
      return DoctorWorkloadStats.tenant(
        items
            .whereType<Map>()
            .map((item) => DoctorWorkload.fromJson(
                  Map<String, dynamic>.from(item),
                ))
            .toList(),
      );
    }

    if (json['scope'] == 'global' ||
        json.containsKey('doctors_with_active_patients') ||
        json.containsKey('active_patient_assignments')) {
      return DoctorWorkloadStats.global(
        doctorsWithActivePatients:
            _readOptionalInt(json['doctors_with_active_patients']) ?? 0,
        activePatientAssignments:
            _readOptionalInt(json['active_patient_assignments']) ?? 0,
        maximumAssignmentsPerDoctor:
            _readOptionalInt(json['maximum_assignments_per_doctor']),
        averageAssignmentsPerDoctor:
            (json['average_assignments_per_doctor'] as num?)?.toDouble(),
      );
    }

    return DoctorWorkloadStats.tenant(const []);
  }
}

class SystemHealthModel {
  final String status;
  final double uptime;
  final DatabaseHealth database;
  final String timestamp;

  SystemHealthModel({
    required this.status,
    required this.uptime,
    required this.database,
    required this.timestamp,
  });

  factory SystemHealthModel.fromJson(Map<String, dynamic> json) {
    final dependencies = json['dependencies'] is Map
        ? Map<String, dynamic>.from(json['dependencies'] as Map)
        : const <String, dynamic>{};
    final databaseJson = json['database'] is Map
        ? Map<String, dynamic>.from(json['database'] as Map)
        : dependencies['database'] is Map
            ? Map<String, dynamic>.from(dependencies['database'] as Map)
            : const <String, dynamic>{};
    return SystemHealthModel(
      status: json['status'] as String? ?? 'unknown',
      uptime: (json['uptime_seconds'] as num?)?.toDouble() ??
          (json['uptime'] as num?)?.toDouble() ??
          0,
      database: DatabaseHealth.fromJson(databaseJson),
      timestamp: json['timestamp'] as String? ?? '',
    );
  }
}

class DatabaseHealth {
  final String state;

  DatabaseHealth({required this.state});

  /// Alias used by system_config_page.
  String get status => state;

  factory DatabaseHealth.fromJson(Map<String, dynamic> json) {
    return DatabaseHealth(
      state: json['status'] as String? ??
          json['state'] as String? ??
          'unknown',
    );
  }
}

int? _readOptionalInt(dynamic value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value);
  return null;
}
