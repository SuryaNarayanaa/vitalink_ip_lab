import 'package:frontend/core/constants/strings.dart';

class LoginRequest {
  LoginRequest({required this.loginId, required this.password});

  final String loginId;
  final String password;

  String get path => AppStrings.loginPath;

  Map<String, dynamic> toJson() => {'login_id': loginId, 'password': password};
}

class VerifyLoginOtpRequest {
  VerifyLoginOtpRequest({
    required this.challengeId,
    required this.firebaseIdToken,
  });

  final String challengeId;
  final String firebaseIdToken;

  String get path => AppStrings.loginOtpVerifyPath;

  Map<String, dynamic> toJson() => {
        'challenge_id': challengeId,
        'firebase_id_token': firebaseIdToken,
      };
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

class UserModel {
  UserModel({
    required this.id,
    required this.loginId,
    required this.userType,
    required this.isActive,
    this.profileId,
    this.userTypeModel,
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
    );
  }

  final String id;
  final String loginId;
  final String userType;
  final bool isActive;
  final String? profileId;
  final String? userTypeModel;

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
  LoginOtpPhone({required this.masked, required this.number, this.last4});

  factory LoginOtpPhone.fromJson(Map<String, dynamic> json) {
    return LoginOtpPhone(
      masked: _readString(json['masked']),
      number: _readString(json['number']),
      last4: _readNullableString(json['last4']),
    );
  }

  final String masked;
  final String number;
  final String? last4;
}

class LoginOtpChallenge {
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
  final DateTime? expiresAt;
  final DateTime? resendAvailableAt;
  final int? attemptsRemaining;
  final int? maxAttempts;
  final int? resendCount;
  final int? maxResends;

  bool get canResendNow {
    final availableAt = resendAvailableAt;
    if (availableAt == null) return true;
    return !availableAt.isAfter(DateTime.now());
  }

  String get maskedPhone =>
      phone.masked.isNotEmpty ? phone.masked : 'your registered phone';
}

class LoginTotpChallenge {
  LoginTotpChallenge({
    required this.challengeId,
    required this.factorType,
    this.expiresAt,
    this.attemptsRemaining,
    this.maxAttempts,
  });

  factory LoginTotpChallenge.fromJson(Map<String, dynamic> json) {
    return LoginTotpChallenge(
      challengeId: _readString(json['challenge_id']),
      factorType: _readString(json['factor_type']),
      expiresAt: _readDateTime(json['expires_at']),
      attemptsRemaining: _readInt(json['attempts_remaining']),
      maxAttempts: _readInt(json['max_attempts']),
    );
  }

  final String challengeId;
  final String factorType;
  final DateTime? expiresAt;
  final int? attemptsRemaining;
  final int? maxAttempts;
}

class LoginResult {
  LoginResult.authenticated(this.response)
      : otpChallenge = null,
        totpChallenge = null;

  LoginResult.otpRequired(this.otpChallenge)
      : response = null,
        totpChallenge = null;

  LoginResult.totpRequired(this.totpChallenge)
      : response = null,
        otpChallenge = null;

  final LoginResponse? response;
  final LoginOtpChallenge? otpChallenge;
  final LoginTotpChallenge? totpChallenge;

  bool get isOtpRequired => otpChallenge != null;
  bool get isTotpRequired => totpChallenge != null;
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

DateTime? _readDateTime(dynamic value) {
  if (value is DateTime) return value;
  if (value is String && value.trim().isNotEmpty) {
    return DateTime.tryParse(value);
  }
  return null;
}
