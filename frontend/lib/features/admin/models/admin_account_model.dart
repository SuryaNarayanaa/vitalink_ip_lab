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

    if (role == AdminRole.hospitalAdmin && hospital == null) {
      throw const FormatException(
        'Hospital administrator accounts need a hospital',
      );
    }
    if (role != AdminRole.hospitalAdmin && hospital != null) {
      throw const FormatException(
        'Global administrator accounts cannot have a hospital',
      );
    }

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

  bool get isReadOnlyRole => role == AdminRole.auditor;
}

String _requiredString(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is String && value.trim().isNotEmpty) return value.trim();
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
  throw FormatException('$key must be a boolean');
}

DateTime? _optionalDateTime(Object? value) {
  if (value == null) return null;
  if (value is String && value.trim().isNotEmpty) {
    final parsed = DateTime.tryParse(value);
    if (parsed != null) return parsed;
  }
  throw const FormatException('Expected an ISO-8601 date-time or null');
}
