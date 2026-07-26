class PatientDetailModel {
  final String id;
  final String name;
  final int? age;
  final String? gender;
  final String? opNumber;
  final String? phone;
  final Map<String, dynamic>? nextOfKin;
  final Map<String, dynamic>? medicalConfig;
  final List<dynamic>? medicalHistory;
  final Map<String, dynamic>? weeklyDosage;
  final List<dynamic>? inrHistory;
  final List<dynamic>? healthLogs;

  const PatientDetailModel({
    required this.id,
    required this.name,
    this.age,
    this.gender,
    this.opNumber,
    this.phone,
    this.nextOfKin,
    this.medicalConfig,
    this.medicalHistory,
    this.weeklyDosage,
    this.inrHistory,
    this.healthLogs,
  });

  factory PatientDetailModel.fromJson(Map<String, dynamic> json) {
    final demographics = _asStringKeyMap(json['demographics']);
    final medicalConfig = _asStringKeyMap(json['medical_config']);
    final weeklyDosage = _asStringKeyMap(json['weekly_dosage']);
    final dynamic ageVal = demographics?['age'];
    final age = ageVal is int
        ? ageVal
        : ageVal is num
            ? ageVal.toInt()
            : int.tryParse(ageVal?.toString() ?? '');

    return PatientDetailModel(
      id: json['_id']?.toString() ?? '',
      name: demographics?['name']?.toString() ?? 'Unknown',
      age: age,
      gender: demographics?['gender']?.toString(),
      opNumber: json['login_id']?.toString(),
      phone: demographics?['phone']?.toString(),
      nextOfKin: _asStringKeyMap(demographics?['next_of_kin']),
      medicalConfig: medicalConfig,
      medicalHistory: json['medical_history'] is List
          ? List<dynamic>.from(json['medical_history'] as List)
          : null,
      weeklyDosage: weeklyDosage,
      inrHistory: json['inr_history'] is List
          ? List<dynamic>.from(json['inr_history'] as List)
          : null,
      // Health reports: side effects / illness / lifestyle / other meds.
      healthLogs: _normalizeHealthLogs(json['health_logs']),
    );
  }

  static Map<String, dynamic>? _asStringKeyMap(dynamic value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return Map<String, dynamic>.from(value);
    return null;
  }

  static List<Map<String, dynamic>>? _normalizeHealthLogs(dynamic raw) {
    if (raw == null) return null;
    if (raw is! List) return const [];
    final logs = <Map<String, dynamic>>[];
    for (final item in raw) {
      final map = _asStringKeyMap(item);
      if (map != null) logs.add(map);
    }
    return logs;
  }

  /// Description for a given health-log type (one entry kept per type).
  String healthLogDescription(
    String type, {
    String fallback = 'None reported',
  }) {
    final logs = healthLogs;
    if (logs == null || logs.isEmpty) return fallback;
    for (final log in logs) {
      final map = _asStringKeyMap(log);
      if (map == null) continue;
      if (map['type']?.toString() != type) continue;
      final description = map['description']?.toString().trim();
      if (description != null && description.isNotEmpty) {
        return description;
      }
    }
    return fallback;
  }

  String? healthLogDate(String type) {
    final logs = healthLogs;
    if (logs == null) return null;
    for (final log in logs) {
      final map = _asStringKeyMap(log);
      if (map == null) continue;
      if (map['type']?.toString() != type) continue;
      return map['date']?.toString();
    }
    return null;
  }
}
