class AdminTotpEnrollment {
  AdminTotpEnrollment({
    required this.factorType,
    required this.secret,
    required this.otpauthUrl,
  });

  factory AdminTotpEnrollment.fromJson(Map<String, dynamic> json) {
    return AdminTotpEnrollment(
      factorType: _readString(json['factor_type']),
      secret: _readString(json['secret']),
      otpauthUrl: _readString(json['otpauth_url']),
    );
  }

  final String factorType;
  final String secret;
  final String otpauthUrl;
}

class AdminTotpActivation {
  AdminTotpActivation({required this.factorType, required this.status});

  factory AdminTotpActivation.fromJson(Map<String, dynamic> json) {
    return AdminTotpActivation(
      factorType: _readString(json['factor_type']),
      status: _readString(json['status']),
    );
  }

  final String factorType;
  final String status;

  bool get isEnabled => status.trim().toUpperCase() == 'ENABLED';
}

class AdminTotpStatus {
  AdminTotpStatus({
    required this.factorType,
    required this.status,
    required this.enabled,
    this.enrolledAt,
    this.activatedAt,
    this.lastVerifiedAt,
  });

  factory AdminTotpStatus.fromJson(Map<String, dynamic> json) {
    return AdminTotpStatus(
      factorType: _readString(json['factor_type']),
      status: _readString(json['status']),
      enabled: _readBool(json['enabled'], fallback: false),
      enrolledAt: _readDateTime(json['enrolled_at']),
      activatedAt: _readDateTime(json['activated_at']),
      lastVerifiedAt: _readDateTime(json['last_verified_at']),
    );
  }

  final String factorType;
  final String status;
  final bool enabled;
  final DateTime? enrolledAt;
  final DateTime? activatedAt;
  final DateTime? lastVerifiedAt;

  bool get isEnabled => enabled || status.trim().toUpperCase() == 'ENABLED';
  bool get isPending => status.trim().toUpperCase() == 'PENDING';
}

String _readString(dynamic value) {
  if (value is String) return value;
  if (value == null) return '';
  return value.toString();
}

bool _readBool(dynamic value, {required bool fallback}) {
  if (value is bool) return value;
  return fallback;
}

DateTime? _readDateTime(dynamic value) {
  if (value is DateTime) return value;
  if (value is String && value.trim().isNotEmpty) {
    return DateTime.tryParse(value);
  }
  return null;
}
