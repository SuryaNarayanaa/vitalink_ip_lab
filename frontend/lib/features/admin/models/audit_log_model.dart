class AuditLogModel {
  final String id;
  final String? userId;
  final String? userLoginId;
  final String? userType;
  final String action;
  final String description;
  final String? resourceType;
  final String? resourceId;
  final Map<String, dynamic>? previousData;
  final Map<String, dynamic>? newData;
  final String? ipAddress;
  final String? userAgent;
  final bool success;
  final String? errorMessage;
  final Map<String, dynamic>? metadata;
  final DateTime? createdAt;

  AuditLogModel({
    required this.id,
    this.userId,
    this.userLoginId,
    this.userType,
    required this.action,
    required this.description,
    this.resourceType,
    this.resourceId,
    this.previousData,
    this.newData,
    this.ipAddress,
    this.userAgent,
    this.success = true,
    this.errorMessage,
    this.metadata,
    this.createdAt,
  });

  factory AuditLogModel.fromJson(Map<String, dynamic> json) {
    final userIdData = json['user_id'];
    String? userId;
    String? userLoginId;
    String? userType;

    if (userIdData is Map<String, dynamic>) {
      userId = userIdData['_id'] as String?;
      userLoginId = userIdData['login_id'] as String?;
      userType = userIdData['user_type'] as String?;
    } else if (userIdData is String) {
      userId = userIdData;
    }

    return AuditLogModel(
      id: json['_id'] as String? ?? '',
      userId: userId,
      userLoginId: userLoginId,
      userType: userType ?? json['user_type'] as String?,
      action: json['action'] as String? ?? '',
      description: json['description'] as String? ?? '',
      resourceType: json['resource_type'] as String?,
      resourceId: json['resource_id'] as String?,
      previousData: json['previous_data'] as Map<String, dynamic>?,
      newData: json['new_data'] as Map<String, dynamic>?,
      ipAddress: json['ip_address'] as String?,
      userAgent: json['user_agent'] as String?,
      success: json['success'] as bool? ?? true,
      errorMessage: json['error_message'] as String?,
      metadata: json['metadata'] as Map<String, dynamic>?,
      createdAt: json['createdAt'] is String
          ? DateTime.tryParse(json['createdAt'] as String)
          : null,
    );
  }
}

enum AuditAction {
  login,
  logout,
  loginFailed,
  userCreate,
  userUpdate,
  userDeactivate,
  userActivate,
  userDelete,
  passwordReset,
  passwordChange,
  patientReassign,
  patientDischarge,
  inrSubmit,
  inrUpdate,
  dosageUpdate,
  healthLogCreate,
  configUpdate,
  notificationBroadcast,
  batchOperation,
  profileUpdate,
  reportUpdate;

  String get value {
    switch (this) {
      case AuditAction.login:
        return 'LOGIN';
      case AuditAction.logout:
        return 'LOGOUT';
      case AuditAction.loginFailed:
        return 'LOGIN_FAILED';
      case AuditAction.userCreate:
        return 'USER_CREATE';
      case AuditAction.userUpdate:
        return 'USER_UPDATE';
      case AuditAction.userDeactivate:
        return 'USER_DEACTIVATE';
      case AuditAction.userActivate:
        return 'USER_ACTIVATE';
      case AuditAction.userDelete:
        return 'USER_DELETE';
      case AuditAction.passwordReset:
        return 'PASSWORD_RESET';
      case AuditAction.passwordChange:
        return 'PASSWORD_CHANGE';
      case AuditAction.patientReassign:
        return 'PATIENT_REASSIGN';
      case AuditAction.patientDischarge:
        return 'PATIENT_DISCHARGE';
      case AuditAction.inrSubmit:
        return 'INR_SUBMIT';
      case AuditAction.inrUpdate:
        return 'INR_UPDATE';
      case AuditAction.dosageUpdate:
        return 'DOSAGE_UPDATE';
      case AuditAction.healthLogCreate:
        return 'HEALTH_LOG_CREATE';
      case AuditAction.configUpdate:
        return 'CONFIG_UPDATE';
      case AuditAction.notificationBroadcast:
        return 'NOTIFICATION_BROADCAST';
      case AuditAction.batchOperation:
        return 'BATCH_OPERATION';
      case AuditAction.profileUpdate:
        return 'PROFILE_UPDATE';
      case AuditAction.reportUpdate:
        return 'REPORT_UPDATE';
    }
  }

  String get label {
    switch (this) {
      case AuditAction.login:
        return 'Login';
      case AuditAction.logout:
        return 'Logout';
      case AuditAction.loginFailed:
        return 'Login Failed';
      case AuditAction.userCreate:
        return 'User Created';
      case AuditAction.userUpdate:
        return 'User Updated';
      case AuditAction.userDeactivate:
        return 'User Deactivated';
      case AuditAction.userActivate:
        return 'User Activated';
      case AuditAction.userDelete:
        return 'User Deleted';
      case AuditAction.passwordReset:
        return 'Password Reset';
      case AuditAction.passwordChange:
        return 'Password Changed';
      case AuditAction.patientReassign:
        return 'Patient Reassigned';
      case AuditAction.patientDischarge:
        return 'Patient Discharged';
      case AuditAction.inrSubmit:
        return 'INR Submitted';
      case AuditAction.inrUpdate:
        return 'INR Updated';
      case AuditAction.dosageUpdate:
        return 'Dosage Updated';
      case AuditAction.healthLogCreate:
        return 'Health Log Created';
      case AuditAction.configUpdate:
        return 'Config Updated';
      case AuditAction.notificationBroadcast:
        return 'Notification Broadcast';
      case AuditAction.batchOperation:
        return 'Batch Operation';
      case AuditAction.profileUpdate:
        return 'Profile Updated';
      case AuditAction.reportUpdate:
        return 'Report Updated';
    }
  }
}
