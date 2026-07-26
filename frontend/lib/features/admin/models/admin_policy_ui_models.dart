import 'dart:collection';

import 'package:frontend/features/admin/models/admin_access_model.dart';

class AdminRolePolicyPreviewModel {
  AdminRolePolicyPreviewModel({
    required this.role,
    required this.currentVersion,
    required this.affectedActiveAccounts,
    required Iterable<String> added,
    required Iterable<String> removed,
    required Iterable<String> warnings,
    this.sourceRevisionId,
    this.sourcePolicyVersion,
  }) : added = List<String>.unmodifiable(added),
       removed = List<String>.unmodifiable(removed),
       warnings = List<String>.unmodifiable(warnings);

  factory AdminRolePolicyPreviewModel.fromJson(Map<String, dynamic> json) {
    return AdminRolePolicyPreviewModel(
      role: AdminRole.parse(json['role_key'] ?? json['roleKey']),
      currentVersion: _requiredInt(
        json['current_version'] ?? json['currentVersion'],
        'current_version',
      ),
      affectedActiveAccounts: _intOrZero(
        json['affected_active_accounts'] ?? json['affectedActiveAccounts'],
      ),
      added: _stringList(json['added'] ?? json['added_capabilities']),
      removed: _stringList(json['removed'] ?? json['removed_capabilities']),
      warnings: _stringList(json['warnings']),
      sourceRevisionId: _optionalString(
        json['source_revision_id'] ?? json['sourceRevisionId'],
      ),
      sourcePolicyVersion: _optionalInt(
        json['source_policy_version'] ?? json['sourcePolicyVersion'],
      ),
    );
  }

  final AdminRole role;
  final int currentVersion;
  final int affectedActiveAccounts;
  final List<String> added;
  final List<String> removed;
  final List<String> warnings;
  final String? sourceRevisionId;
  final int? sourcePolicyVersion;

  bool get hasChanges => added.isNotEmpty || removed.isNotEmpty;
}

class AdminRolePolicyRevisionModel {
  AdminRolePolicyRevisionModel({
    required this.id,
    required this.role,
    required this.previousPolicyVersion,
    required this.newPolicyVersion,
    required Map<String, bool> previousCapabilities,
    required Map<String, bool> newCapabilities,
    required this.actorRole,
    required this.changeReason,
    required this.affectedActiveAccountCount,
    this.actorUserId,
    this.createdAt,
    this.restoredFromRevisionId,
  }) : previousCapabilities = UnmodifiableMapView(
         Map<String, bool>.unmodifiable(previousCapabilities),
       ),
       newCapabilities = UnmodifiableMapView(
         Map<String, bool>.unmodifiable(newCapabilities),
       );

  factory AdminRolePolicyRevisionModel.fromJson(Map<String, dynamic> json) {
    return AdminRolePolicyRevisionModel(
      id: _requiredString(json['_id'] ?? json['id'], 'id'),
      role: AdminRole.parse(json['role_key'] ?? json['roleKey']),
      previousPolicyVersion: _requiredInt(
        json['previous_policy_version'] ?? json['previousPolicyVersion'],
        'previous_policy_version',
      ),
      newPolicyVersion: _requiredInt(
        json['new_policy_version'] ?? json['newPolicyVersion'],
        'new_policy_version',
      ),
      previousCapabilities: _boolMap(
        json['previous_capabilities'] ?? json['previousCapabilities'],
      ),
      newCapabilities: _boolMap(
        json['new_capabilities'] ?? json['newCapabilities'],
      ),
      actorUserId: _optionalString(
        json['actor_user_id'] ?? json['actorUserId'],
      ),
      actorRole: AdminRole.parse(json['actor_role'] ?? json['actorRole']),
      changeReason: _requiredString(
        json['change_reason'] ?? json['changeReason'],
        'change_reason',
      ),
      affectedActiveAccountCount: _intOrZero(
        json['affected_active_account_count'] ??
            json['affectedActiveAccountCount'],
      ),
      createdAt: _optionalDateTime(json['created_at'] ?? json['createdAt']),
      restoredFromRevisionId: _optionalString(
        json['restored_from_revision_id'] ?? json['restoredFromRevisionId'],
      ),
    );
  }

  final String id;
  final AdminRole role;
  final int previousPolicyVersion;
  final int newPolicyVersion;
  final Map<String, bool> previousCapabilities;
  final Map<String, bool> newCapabilities;
  final String? actorUserId;
  final AdminRole actorRole;
  final String changeReason;
  final int affectedActiveAccountCount;
  final DateTime? createdAt;
  final String? restoredFromRevisionId;
}

class AdminAccountMutationResult {
  const AdminAccountMutationResult({
    required this.payload,
    this.temporaryPassword,
  });

  factory AdminAccountMutationResult.fromJson(Map<String, dynamic> json) {
    final nested = json['account'] ?? json['admin_account'];
    return AdminAccountMutationResult(
      payload: nested is Map
          ? Map<String, dynamic>.from(nested)
          : Map<String, dynamic>.from(json),
      temporaryPassword: _optionalString(
        json['temporary_password'] ?? json['temporaryPassword'],
      ),
    );
  }

  final Map<String, dynamic> payload;
  final String? temporaryPassword;
}

Map<String, bool> _boolMap(Object? raw) {
  if (raw is! Map) {
    throw const FormatException('capabilities must be an object');
  }
  final result = <String, bool>{};
  for (final entry in raw.entries) {
    final key = entry.key.toString().trim();
    if (key.isEmpty || entry.value is! bool) {
      throw const FormatException('capabilities must map names to booleans');
    }
    result[key] = entry.value as bool;
  }
  return result;
}

List<String> _stringList(Object? raw) {
  if (raw == null) return const [];
  if (raw is! List) throw const FormatException('Expected a list');
  return raw.map((value) => value.toString()).toList(growable: false);
}

String _requiredString(Object? value, String key) {
  if (value is String && value.trim().isNotEmpty) return value.trim();
  throw FormatException('$key must be a non-empty string');
}

String? _optionalString(Object? value) {
  if (value == null) return null;
  if (value is String && value.trim().isNotEmpty) return value.trim();
  return null;
}

int _requiredInt(Object? value, String key) {
  if (value is int) return value;
  throw FormatException('$key must be an integer');
}

int _intOrZero(Object? value) => value is int ? value : 0;

int? _optionalInt(Object? value) => value is int ? value : null;

DateTime? _optionalDateTime(Object? value) {
  if (value == null) return null;
  if (value is DateTime) return value;
  if (value is String) return DateTime.tryParse(value);
  return null;
}
