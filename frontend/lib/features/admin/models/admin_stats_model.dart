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
  final int criticalInr;

  PatientStats({
    this.total = 0,
    this.active = 0,
    this.inactive = 0,
    this.recent = 0,
    this.criticalInr = 0,
  });

  factory PatientStats.fromJson(Map<String, dynamic> json) {
    return PatientStats(
      total: json['total'] as int? ?? 0,
      active: json['active'] as int? ?? 0,
      inactive: json['inactive'] as int? ?? 0,
      recent: json['recent'] as int? ?? 0,
      criticalInr: json['critical_inr'] as int? ?? 0,
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

  double get criticalPercentage =>
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
      doctorId: json['doctor_id'] as String?,
      doctorName: json['doctor_name'] as String?,
      department: json['department'] as String?,
      patientCount: json['patient_count'] as int? ?? 0,
    );
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
    return SystemHealthModel(
      status: json['status'] as String? ?? 'unknown',
      uptime: (json['uptime'] as num?)?.toDouble() ?? 0,
      database: DatabaseHealth.fromJson(
        json['database'] as Map<String, dynamic>? ?? {},
      ),
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
      state: json['state'] as String? ?? 'unknown',
    );
  }
}
