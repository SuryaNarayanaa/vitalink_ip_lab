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

String _readString(dynamic value) {
  if (value is String) return value;
  if (value == null) return '';
  return value.toString();
}
