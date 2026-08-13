import 'package:frontend/core/constants/strings.dart';

class LoginRequest {
  LoginRequest({required this.loginId, required this.password});

  final String loginId;
  final String password;

  String get path => AppStrings.loginPath;

  Map<String, dynamic> toJson() => {'login_id': loginId, 'password': password};
}

class VerifyLoginOtpRequest {
  VerifyLoginOtpRequest({required this.challengeId, required this.code});

  final String challengeId;
  final String code;

  String get path => AppStrings.loginOtpVerifyPath;

  Map<String, dynamic> toJson() => {'challenge_id': challengeId, 'code': code};
}

class ResendLoginOtpRequest {
  ResendLoginOtpRequest({required this.challengeId});

  final String challengeId;

  String get path => AppStrings.loginOtpResendPath;

  Map<String, dynamic> toJson() => {'challenge_id': challengeId};
}

class VerifyLoginTotpRequest {
  VerifyLoginTotpRequest({required this.challengeId, required this.code});

  final String challengeId;
  final String code;

  String get path => AppStrings.loginTotpVerifyPath;

  Map<String, dynamic> toJson() => {'challenge_id': challengeId, 'code': code};
}

class EnrollAdminTotpSetupRequest {
  EnrollAdminTotpSetupRequest({required this.challengeId});

  final String challengeId;

  String get path => AppStrings.loginTotpEnrollSetupPath;

  Map<String, dynamic> toJson() => {'challenge_id': challengeId};
}

class EnrollAdminTotpActivateRequest {
  EnrollAdminTotpActivateRequest({
    required this.challengeId,
    required this.code,
  });

  final String challengeId;
  final String code;

  String get path => AppStrings.loginTotpEnrollActivatePath;

  Map<String, dynamic> toJson() => {
        'challenge_id': challengeId,
        'code': code,
      };
}

class RefreshSessionRequest {
  RefreshSessionRequest({required this.refreshToken});

  final String refreshToken;

  String get path => AppStrings.authRefreshPath;

  Map<String, dynamic> toJson() => {'refresh_token': refreshToken};
}

class RevokeSessionRequest {
  RevokeSessionRequest({required this.refreshToken});

  final String refreshToken;

  String get path => AppStrings.authRevokePath;

  Map<String, dynamic> toJson() => {'refresh_token': refreshToken};
}

class ChangePasswordRequest {
  ChangePasswordRequest({
    required this.currentPassword,
    required this.newPassword,
  });

  final String currentPassword;
  final String newPassword;

  String get path => AppStrings.changePasswordPath;

  Map<String, dynamic> toJson() => {
        'current_password': currentPassword,
        'new_password': newPassword,
      };
}

class ChangePasswordResult {
  ChangePasswordResult({
    required this.mustChangePassword,
    required this.passwordExpired,
    this.invalidatedSessions,
  });

  factory ChangePasswordResult.fromJson(Map<String, dynamic> json) {
    return ChangePasswordResult(
      mustChangePassword: _readBool(json['must_change_password'], fallback: false),
      passwordExpired: _readBool(json['password_expired'], fallback: false),
      invalidatedSessions: _readInt(json['invalidated_sessions']),
    );
  }

  final bool mustChangePassword;
  final bool passwordExpired;
  final int? invalidatedSessions;
}

class UserModel {
  UserModel({
    required this.id,
    required this.loginId,
    required this.userType,
    required this.isActive,
    this.profileId,
    this.userTypeModel,
    this.mustChangePassword = false,
    this.passwordExpired = false,
  });

  static String _readString(dynamic value) {
    if (value is String) return value;
    if (value is Map) {
      const nestedKeys = [
        '_id',
        'id',
        'name',
        'value',
        'type',
        'role',
        'user_type',
        'userType',
        'label',
      ];
      for (final key in nestedKeys) {
        final nested = _readString(value[key]);
        if (nested.isNotEmpty) return nested;
      }
    }
    return '';
  }

  static bool _readBool(dynamic value, {required bool fallback}) {
    if (value is bool) return value;
    return fallback;
  }

  factory UserModel.fromJson(Map<String, dynamic> json) {
    final profile = json['profile_id'];
    final profileMap = profile is Map<String, dynamic> ? profile : null;
    final roleFromUser = _readString(json['user_type']);
    final roleFromModel = _readString(json['user_type_model']);
    final roleFromRole = _readString(json['role']);
    final roleFromProfile = _readString(profileMap?['user_type']);
    final roleModelFromProfile = _readString(profileMap?['user_type_model']);
    final passwordExpired = _readBool(json['password_expired'], fallback: false);
    final mustChange = _readBool(json['must_change_password'], fallback: false) ||
        passwordExpired;

    return UserModel(
      id: _readString(json['_id']).isNotEmpty
          ? _readString(json['_id'])
          : _readString(json['id']),
      loginId: _readString(json['login_id']),
      userType: roleFromUser.isNotEmpty
          ? roleFromUser
          : roleFromRole.isNotEmpty
          ? roleFromRole
          : roleFromProfile,
      isActive: _readBool(json['is_active'], fallback: true),
      profileId: _readString(profile).isNotEmpty ? _readString(profile) : null,
      userTypeModel: roleFromModel.isNotEmpty
          ? roleFromModel
          : roleModelFromProfile.isNotEmpty
          ? roleModelFromProfile
          : null,
      mustChangePassword: mustChange,
      passwordExpired: passwordExpired,
    );
  }

  final String id;
  final String loginId;
  final String userType;
  final bool isActive;
  final String? profileId;
  final String? userTypeModel;
  final bool mustChangePassword;
  final bool passwordExpired;

  String _normalize(String? raw) =>
      raw?.trim().toUpperCase().replaceAll(' ', '_').replaceAll('-', '_') ?? '';

  String get _roleSource {
    if (userTypeModel != null && userTypeModel!.trim().isNotEmpty) {
      return _normalize(userTypeModel);
    }
    return _normalize(userType);
  }

  bool _matchesRole(String target) {
    final role = _roleSource;
    return role == target || role.endsWith('_$target') || role.contains(target);
  }

  bool get isDoctor => _matchesRole('DOCTOR');
  bool get isPatient => _matchesRole('PATIENT');
  bool get isAdmin => _matchesRole('ADMIN');
}

class LoginResponse {
  LoginResponse({
    required this.token,
    required this.refreshToken,
    required this.user,
    this.session,
  });

  final String token;
  final String refreshToken;
  final UserModel user;
  final AuthSessionModel? session;
}

class AuthSessionModel {
  AuthSessionModel({required this.sessionId, this.refreshExpiresAt});

  factory AuthSessionModel.fromJson(Map<String, dynamic> json) {
    return AuthSessionModel(
      sessionId: _readString(json['session_id']),
      refreshExpiresAt: _readDateTime(json['refresh_expires_at']),
    );
  }

  final String sessionId;
  final DateTime? refreshExpiresAt;
}

class LoginOtpPhone {
  LoginOtpPhone({required this.masked, this.last4});

  factory LoginOtpPhone.fromJson(Map<String, dynamic> json) {
    return LoginOtpPhone(
      masked: _readString(json['masked']),
      last4: _readNullableString(json['last4']),
    );
  }

  final String masked;
  final String? last4;
}

mixin LoginChallengeState {
  DateTime? get expiresAt;
  int? get attemptsRemaining;

  bool get isExpired {
    final expires = expiresAt;
    if (expires == null) return false;
    return !expires.isAfter(DateTime.now());
  }

  bool get hasAttemptsRemaining =>
      attemptsRemaining == null || attemptsRemaining! > 0;

  bool get canVerifyNow => !isExpired && hasAttemptsRemaining;
}

class LoginOtpChallenge with LoginChallengeState {
  LoginOtpChallenge({
    required this.challengeId,
    required this.purpose,
    required this.deliveryChannel,
    required this.phone,
    this.expiresAt,
    this.resendAvailableAt,
    this.attemptsRemaining,
    this.maxAttempts,
    this.resendCount,
    this.maxResends,
  });

  factory LoginOtpChallenge.fromJson(Map<String, dynamic> json) {
    final phoneJson = json['phone'] is Map<String, dynamic>
        ? json['phone'] as Map<String, dynamic>
        : <String, dynamic>{};

    return LoginOtpChallenge(
      challengeId: _readString(json['challenge_id']),
      purpose: _readString(json['purpose']),
      deliveryChannel: _readString(json['delivery_channel']),
      phone: LoginOtpPhone.fromJson(phoneJson),
      expiresAt: _readDateTime(json['expires_at']),
      resendAvailableAt: _readDateTime(json['resend_available_at']),
      attemptsRemaining: _readInt(json['attempts_remaining']),
      maxAttempts: _readInt(json['max_attempts']),
      resendCount: _readInt(json['resend_count']),
      maxResends: _readInt(json['max_resends']),
    );
  }

  final String challengeId;
  final String purpose;
  final String deliveryChannel;
  final LoginOtpPhone phone;
  @override
  final DateTime? expiresAt;
  final DateTime? resendAvailableAt;
  @override
  final int? attemptsRemaining;
  final int? maxAttempts;
  final int? resendCount;
  final int? maxResends;

  bool get hasResendsRemaining {
    final used = resendCount;
    final max = maxResends;
    if (used == null || max == null) return true;
    return used < max;
  }

  int? get resendCooldownSecondsRemaining {
    final availableAt = resendAvailableAt;
    if (availableAt == null) return null;
    final remaining = availableAt.difference(DateTime.now()).inSeconds;
    return remaining > 0 ? remaining : 0;
  }

  bool get canResendNow {
    if (isExpired || !hasResendsRemaining) return false;
    final availableAt = resendAvailableAt;
    if (availableAt == null) return true;
    return !availableAt.isAfter(DateTime.now());
  }

  String get maskedPhone =>
      phone.masked.isNotEmpty ? phone.masked : 'your registered phone';
}

class LoginTotpChallenge with LoginChallengeState {
  LoginTotpChallenge({
    required this.challengeId,
    required this.factorType,
    this.purpose,
    this.expiresAt,
    this.attemptsRemaining,
    this.maxAttempts,
  });

  factory LoginTotpChallenge.fromJson(Map<String, dynamic> json) {
    return LoginTotpChallenge(
      challengeId: _readString(json['challenge_id']),
      factorType: _readString(json['factor_type']),
      purpose: _readNullableString(json['purpose']),
      expiresAt: _readDateTime(json['expires_at']),
      attemptsRemaining: _readInt(json['attempts_remaining']),
      maxAttempts: _readInt(json['max_attempts']),
    );
  }

  final String challengeId;
  final String factorType;
  final String? purpose;
  @override
  final DateTime? expiresAt;
  @override
  final int? attemptsRemaining;
  final int? maxAttempts;

  bool get isEnrollment =>
      (purpose ?? '').trim().toUpperCase() == 'ENROLLMENT';
}

class LoginTotpEnrollmentMaterial {
  LoginTotpEnrollmentMaterial({
    required this.factorType,
    required this.secret,
    required this.otpauthUrl,
    required this.challengeId,
    this.reused = false,
  });

  factory LoginTotpEnrollmentMaterial.fromJson(Map<String, dynamic> json) {
    return LoginTotpEnrollmentMaterial(
      factorType: _readString(json['factor_type']),
      secret: _readString(json['secret']),
      otpauthUrl: _readString(json['otpauth_url']),
      challengeId: _readString(json['challenge_id']),
      reused: _readBool(json['reused'], fallback: false),
    );
  }

  final String factorType;
  final String secret;
  final String otpauthUrl;
  final String challengeId;
  final bool reused;
}

class LoginResult {
  LoginResult.authenticated(this.response)
    : otpChallenge = null,
      totpChallenge = null,
      enrollmentChallenge = null;

  LoginResult.otpRequired(this.otpChallenge)
    : response = null,
      totpChallenge = null,
      enrollmentChallenge = null;

  LoginResult.totpRequired(this.totpChallenge)
    : response = null,
      otpChallenge = null,
      enrollmentChallenge = null;

  LoginResult.enrollmentRequired(this.enrollmentChallenge)
    : response = null,
      otpChallenge = null,
      totpChallenge = null;

  final LoginResponse? response;
  final LoginOtpChallenge? otpChallenge;
  final LoginTotpChallenge? totpChallenge;
  final LoginTotpChallenge? enrollmentChallenge;

  bool get isOtpRequired => otpChallenge != null;
  bool get isTotpRequired => totpChallenge != null;
  bool get isEnrollmentRequired => enrollmentChallenge != null;
}

String _readString(dynamic value) {
  if (value is String) return value;
  if (value == null) return '';
  return value.toString();
}

String? _readNullableString(dynamic value) {
  final text = _readString(value).trim();
  return text.isEmpty ? null : text;
}

int? _readInt(dynamic value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value);
  return null;
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
