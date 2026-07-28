import 'package:frontend/features/admin/models/admin_access_model.dart';

class AdminAccountModel {
  const AdminAccountModel({
    required this.id,
    required this.loginId,
    required this.name,
    required this.role,
    required this.isActive,
    required this.mfaEnabled,
    this.email,
    this.hospital,
    this.createdAt,
    this.updatedAt,
    this.assignmentError,
    this.assignmentStatus = 'ok',
  });

  factory AdminAccountModel.fromJson(Map<String, dynamic> json) {
    final role = AdminRole.parse(json['role']);
    final hospitalValue = json['hospital'];
    final hospital = switch (hospitalValue) {
      null => null,
      Map<String, dynamic>() => AdminHospitalIdentity.fromJson(hospitalValue),
      Map() => AdminHospitalIdentity.fromJson(
        Map<String, dynamic>.from(hospitalValue),
      ),
      _ => throw const FormatException('hospital must be an object or null'),
    };

    // Backend list intentionally returns hospital_admin rows with hospital: null
    // when the assignment is broken (degraded). Surface them instead of rejecting
    // the whole directory parse.
    if (role != AdminRole.hospitalAdmin && hospital != null) {
      throw const FormatException(
        'Global administrator accounts cannot have a hospital',
      );
    }

    final assignmentStatus = _optionalString(json['assignment_status']) ?? 'ok';
    final assignmentError = _optionalString(json['assignment_error']);

    return AdminAccountModel(
      id: _requiredString(json, 'id'),
      loginId: _requiredString(json, 'login_id'),
      name: _requiredString(json, 'name'),
      email: _optionalString(json['email']),
      role: role,
      hospital: hospital,
      isActive: _requiredBool(json, 'is_active'),
      mfaEnabled: _requiredBool(json, 'mfa_enabled'),
      createdAt: _optionalDateTime(json['created_at']),
      updatedAt: _optionalDateTime(json['updated_at']),
      assignmentError: assignmentError,
      assignmentStatus: assignmentStatus,
    );
  }

  final String id;
  final String loginId;
  final String name;
  final String? email;
  final AdminRole role;
  final AdminHospitalIdentity? hospital;
  final bool isActive;
  final bool mfaEnabled;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final String? assignmentError;
  final String assignmentStatus;

  bool get isReadOnlyRole => role == AdminRole.auditor;

  /// True when hospital assignment is missing/invalid for a Hospital Admin.
  bool get hasBrokenHospitalAssignment =>
      role == AdminRole.hospitalAdmin &&
      (hospital == null ||
          assignmentStatus == 'invalid' ||
          (assignmentError != null && assignmentError!.isNotEmpty));

  String get hospitalDisplayLabel {
    if (hospital != null) {
      return hospital!.name?.trim().isNotEmpty == true
          ? hospital!.name!
          : hospital!.code;
    }
    if (role == AdminRole.hospitalAdmin) {
      return assignmentError ?? 'Hospital assignment missing';
    }
    return 'Global';
  }
}

String _requiredString(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is String && value.trim().isNotEmpty) return value.trim();
  // Some backends send ObjectId-like values; accept non-empty toString.
  if (value != null) {
    final asString = value.toString().trim();
    if (asString.isNotEmpty && asString != 'null') return asString;
  }
  throw FormatException('$key must be a non-empty string');
}

String? _optionalString(Object? value) {
  if (value == null) return null;
  if (value is String && value.trim().isNotEmpty) return value.trim();
  if (value is String && value.trim().isEmpty) return null;
  throw const FormatException('Expected a string or null');
}

bool _requiredBool(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is bool) return value;
  if (value is num) return value != 0;
  if (value is String) {
    final lower = value.trim().toLowerCase();
    if (lower == 'true' || lower == '1') return true;
    if (lower == 'false' || lower == '0') return false;
  }
  throw FormatException('$key must be a boolean');
}

DateTime? _optionalDateTime(Object? value) {
  if (value == null) return null;
  if (value is DateTime) return value;
  if (value is String && value.trim().isNotEmpty) {
    final parsed = DateTime.tryParse(value);
    if (parsed != null) return parsed;
  }
  // Ignore unparseable timestamps rather than failing the whole row.
  return null;
}
