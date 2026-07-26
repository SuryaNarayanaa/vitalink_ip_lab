import 'dart:collection';

enum AdminRole {
  appAdmin('app_admin'),
  hospitalAdmin('hospital_admin'),
  auditor('auditor');

  const AdminRole(this.wireValue);

  final String wireValue;

  static AdminRole parse(Object? value) {
    return switch (value) {
      'app_admin' => AdminRole.appAdmin,
      'hospital_admin' => AdminRole.hospitalAdmin,
      'auditor' => AdminRole.auditor,
      _ => throw FormatException('Unsupported administrator role: $value'),
    };
  }
}

enum AdminScope {
  global('global'),
  tenant('tenant');

  const AdminScope(this.wireValue);

  final String wireValue;

  static AdminScope parse(Object? value) {
    return switch (value) {
      'global' => AdminScope.global,
      'tenant' => AdminScope.tenant,
      _ => throw FormatException('Unsupported administrator scope: $value'),
    };
  }
}

class AdminHospitalIdentity {
  const AdminHospitalIdentity({
    required this.id,
    required this.code,
    this.name,
  });

  factory AdminHospitalIdentity.fromJson(Map<String, dynamic> json) {
    return AdminHospitalIdentity(
      id: _requiredString(json, 'id'),
      code: _requiredString(json, 'code'),
      name: _optionalString(json['name']),
    );
  }

  final String id;
  final String code;
  final String? name;
}

/// The session-memory representation of `GET /admin/access/me`.
///
/// This model is intentionally not serializable to local storage. The backend
/// remains authoritative and every protected request is still authorized by
/// the server.
class AdminAccessModel {
  AdminAccessModel({
    required this.schemaVersion,
    required this.userId,
    required this.role,
    required this.scope,
    required this.hospital,
    required Iterable<String> effectiveCapabilities,
    required this.policyVersion,
    required this.readOnly,
  }) : effectiveCapabilities = UnmodifiableSetView<String>(
         Set<String>.unmodifiable(effectiveCapabilities),
       ) {
    if (scope == AdminScope.tenant && hospital == null) {
      throw const FormatException(
        'Tenant administrator access needs a hospital',
      );
    }
    if (scope == AdminScope.global && hospital != null) {
      throw const FormatException(
        'Global administrator access cannot have a hospital',
      );
    }
    if (role == AdminRole.hospitalAdmin && scope != AdminScope.tenant) {
      throw const FormatException(
        'Hospital administrators must be tenant scoped',
      );
    }
    if (role != AdminRole.hospitalAdmin && scope != AdminScope.global) {
      throw const FormatException(
        'Global administrator roles must be globally scoped',
      );
    }
  }

  factory AdminAccessModel.fromJson(Map<String, dynamic> json) {
    final hospitalValue = json['hospital'];
    final hospital = switch (hospitalValue) {
      null => null,
      Map<String, dynamic>() => AdminHospitalIdentity.fromJson(hospitalValue),
      Map() => AdminHospitalIdentity.fromJson(
        Map<String, dynamic>.from(hospitalValue),
      ),
      _ => throw const FormatException('hospital must be an object or null'),
    };

    final capabilitiesValue = json['effective_capabilities'];
    if (capabilitiesValue is! List) {
      throw const FormatException('effective_capabilities must be a list');
    }
    final capabilities = <String>[];
    for (final capability in capabilitiesValue) {
      if (capability is! String || capability.trim().isEmpty) {
        throw const FormatException(
          'effective_capabilities must contain non-empty strings',
        );
      }
      capabilities.add(capability.trim());
    }

    return AdminAccessModel(
      schemaVersion: _requiredInt(json, 'schema_version'),
      userId: _requiredString(json, 'user_id'),
      role: AdminRole.parse(json['role']),
      scope: AdminScope.parse(json['scope']),
      hospital: hospital,
      effectiveCapabilities: capabilities,
      policyVersion: _requiredInt(json, 'policy_version'),
      readOnly: _requiredBool(json, 'read_only'),
    );
  }

  final int schemaVersion;
  final String userId;
  final AdminRole role;
  final AdminScope scope;
  final AdminHospitalIdentity? hospital;
  final Set<String> effectiveCapabilities;
  final int policyVersion;
  final bool readOnly;

  bool can(String capability) {
    final normalized = capability.trim();
    return normalized.isNotEmpty && effectiveCapabilities.contains(normalized);
  }

  bool canAny(Iterable<String> capabilities) => capabilities.any(can);
}

String _requiredString(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is String && value.trim().isNotEmpty) return value.trim();
  throw FormatException('$key must be a non-empty string');
}

String? _optionalString(Object? value) {
  if (value == null) return null;
  if (value is String && value.trim().isNotEmpty) return value.trim();
  throw const FormatException('Expected a non-empty string or null');
}

int _requiredInt(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is int) return value;
  throw FormatException('$key must be an integer');
}

bool _requiredBool(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is bool) return value;
  throw FormatException('$key must be a boolean');
}
