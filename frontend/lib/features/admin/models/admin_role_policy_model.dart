import 'dart:collection';

import 'package:frontend/features/admin/models/admin_access_model.dart';

class AdminRolePolicyModel {
  AdminRolePolicyModel({
    required this.schemaVersion,
    required this.role,
    required this.label,
    required this.description,
    required this.isProtected,
    required Map<String, bool> capabilities,
    required this.policyVersion,
    required this.activeAccountCount,
    this.updatedAt,
    this.updatedBy,
    this.changeReason,
  }) : capabilities = UnmodifiableMapView<String, bool>(
         Map<String, bool>.unmodifiable(capabilities),
       );

  factory AdminRolePolicyModel.fromJson(Map<String, dynamic> json) {
    final rawCapabilities = json['capabilities'];
    if (rawCapabilities is! Map) {
      throw const FormatException('capabilities must be an object');
    }

    final capabilities = <String, bool>{};
    for (final entry in rawCapabilities.entries) {
      final key = entry.key.toString().trim();
      final value = entry.value;
      if (key.isEmpty || value is! bool) {
        throw const FormatException(
          'capabilities must map non-empty names to booleans',
        );
      }
      capabilities[key] = value;
    }

    return AdminRolePolicyModel(
      schemaVersion: _requiredInt(json, 'schema_version'),
      role: AdminRole.parse(json['role_key']),
      label: _requiredString(json, 'label'),
      description: _optionalString(json['description']) ?? '',
      isProtected: _requiredBool(json, 'protected'),
      capabilities: capabilities,
      policyVersion: _requiredInt(json, 'policy_version'),
      activeAccountCount: _optionalInt(json['active_account_count']) ?? 0,
      updatedAt: _optionalDateTime(json['updated_at']),
      updatedBy: _optionalString(json['updated_by']),
      changeReason: _optionalString(json['change_reason']),
    );
  }

  final int schemaVersion;
  final AdminRole role;
  final String label;
  final String description;
  final bool isProtected;
  final Map<String, bool> capabilities;
  final int policyVersion;
  final int activeAccountCount;
  final DateTime? updatedAt;
  final String? updatedBy;
  final String? changeReason;

  Set<String> get enabledCapabilities => Set<String>.unmodifiable(
    capabilities.entries
        .where((entry) => entry.value)
        .map((entry) => entry.key),
  );

  bool can(String capability) => capabilities[capability.trim()] == true;

  Map<String, dynamic> toUpdateJson({
    required int expectedVersion,
    required String changeReason,
  }) {
    final reason = changeReason.trim();
    if (reason.isEmpty) {
      throw ArgumentError.value(
        changeReason,
        'changeReason',
        'A policy change reason is required',
      );
    }
    return {
      'capabilities': Map<String, bool>.from(capabilities),
      'expected_version': expectedVersion,
      'change_reason': reason,
    };
  }
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

int _requiredInt(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is int) return value;
  throw FormatException('$key must be an integer');
}

int? _optionalInt(Object? value) {
  if (value == null) return null;
  if (value is int) return value;
  throw const FormatException('Expected an integer or null');
}

bool _requiredBool(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is bool) return value;
  throw FormatException('$key must be a boolean');
}

DateTime? _optionalDateTime(Object? value) {
  if (value == null) return null;
  if (value is String) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) return null;
    return DateTime.tryParse(trimmed);
  }
  return null;
}
