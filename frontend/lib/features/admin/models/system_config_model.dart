class SystemConfigModel {
  final String? id;
  final InrThresholds inrThresholds;
  final int sessionTimeoutMinutes;
  final RateLimitConfig rateLimit;
  final Map<String, bool> featureFlags;
  final bool isActive;

  SystemConfigModel({
    this.id,
    required this.inrThresholds,
    this.sessionTimeoutMinutes = 30,
    required this.rateLimit,
    this.featureFlags = const {},
    this.isActive = true,
  });

  factory SystemConfigModel.fromJson(Map<String, dynamic> json) {
    return SystemConfigModel(
      id: json['_id'] as String?,
      inrThresholds: InrThresholds.fromJson(
        json['inr_thresholds'] as Map<String, dynamic>? ?? {},
      ),
      sessionTimeoutMinutes: json['session_timeout_minutes'] as int? ?? 30,
      rateLimit: RateLimitConfig.fromJson(
        json['rate_limit'] as Map<String, dynamic>? ?? {},
      ),
      featureFlags:
          (json['feature_flags'] as Map<String, dynamic>?)?.map(
            (k, v) => MapEntry(k, v == true),
          ) ??
          {},
      isActive: json['is_active'] as bool? ?? true,
    );
  }

  Map<String, dynamic> toJson() => {
    'inr_thresholds': inrThresholds.toJson(),
    'session_timeout_minutes': sessionTimeoutMinutes,
    'rate_limit': rateLimit.toJson(),
    'feature_flags': featureFlags,
  };
}

class InrThresholds {
  final double criticalLow;
  final double criticalHigh;

  InrThresholds({this.criticalLow = 1.5, this.criticalHigh = 4.5});

  factory InrThresholds.fromJson(Map<String, dynamic> json) {
    return InrThresholds(
      criticalLow: (json['critical_low'] as num?)?.toDouble() ?? 1.5,
      criticalHigh: (json['critical_high'] as num?)?.toDouble() ?? 4.5,
    );
  }

  Map<String, dynamic> toJson() => {
    'critical_low': criticalLow,
    'critical_high': criticalHigh,
  };
}

class RateLimitConfig {
  final int maxRequests;
  final int windowMinutes;

  RateLimitConfig({this.maxRequests = 100, this.windowMinutes = 15});

  factory RateLimitConfig.fromJson(Map<String, dynamic> json) {
    return RateLimitConfig(
      maxRequests: json['max_requests'] as int? ?? 100,
      windowMinutes: json['window_minutes'] as int? ?? 15,
    );
  }

  Map<String, dynamic> toJson() => {
    'max_requests': maxRequests,
    'window_minutes': windowMinutes,
  };
}
