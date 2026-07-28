import 'package:frontend/core/constants/strings.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/features/admin/models/admin_access_model.dart';
import 'package:frontend/features/admin/models/admin_account_model.dart';
import 'package:frontend/features/admin/models/admin_mfa_model.dart';
import 'package:frontend/features/admin/models/admin_policy_ui_models.dart';
import 'package:frontend/features/admin/models/admin_role_policy_model.dart';
import 'package:frontend/features/admin/models/admin_stats_model.dart';

class AdminRepository {
  AdminRepository({required ApiClient apiClient}) : _apiClient = apiClient;

  final ApiClient _apiClient;

  Map<String, dynamic> _extractData(Map<String, dynamic> response) {
    final data = response['data'];
    if (data is Map<String, dynamic>) {
      return data;
    }
    return response;
  }

  // ─── Doctor CRUD ───

  Future<Map<String, dynamic>> createDoctor(Map<String, dynamic> data) async {
    return await _apiClient.post(AppStrings.adminDoctorsPath, data: data);
  }

  Future<Map<String, dynamic>> getAllDoctors({
    int page = 1,
    int limit = 20,
    String? department,
    String? isActive,
    String? search,
  }) async {
    final params = <String, dynamic>{'page': page, 'limit': limit};
    if (department != null) params['department'] = department;
    if (isActive != null) params['is_active'] = isActive;
    if (search != null && search.isNotEmpty) params['search'] = search;

    final response = await _apiClient.getRaw(
      AppStrings.adminDoctorsPath,
      queryParameters: params,
    );
    return _extractData(response);
  }

  Future<Map<String, dynamic>> updateDoctor(
    String id,
    Map<String, dynamic> data,
  ) async {
    return await _apiClient.put(
      '${AppStrings.adminDoctorsPath}/$id',
      data: data,
    );
  }

  /// V2 status surface (`PATCH /admin/doctors/:id/status`).
  Future<Map<String, dynamic>> updateDoctorStatus(
    String id, {
    required bool isActive,
  }) async {
    return await _apiClient.patch(
      '${AppStrings.adminDoctorsPath}/$id/status',
      data: {'is_active': isActive},
    );
  }

  /// V2 credentials surface (`POST /admin/doctors/:id/credentials/reset`).
  Future<Map<String, dynamic>> resetDoctorCredentials(
    String id, {
    String? newPassword,
  }) async {
    return await _apiClient.post(
      '${AppStrings.adminDoctorsPath}/$id/credentials/reset',
      data: {if (newPassword != null) 'new_password': newPassword},
    );
  }

  Future<void> deactivateDoctor(String id) async {
    await _apiClient.delete('${AppStrings.adminDoctorsPath}/$id');
  }

  // ─── Patient CRUD ───

  Future<Map<String, dynamic>> createPatient(Map<String, dynamic> data) async {
    return await _apiClient.post(AppStrings.adminPatientsPath, data: data);
  }

  Future<Map<String, dynamic>> getAllPatients({
    int page = 1,
    int limit = 20,
    String? assignedDoctorId,
    String? accountStatus,
    String? search,
  }) async {
    final params = <String, dynamic>{'page': page, 'limit': limit};
    if (assignedDoctorId != null) {
      params['assigned_doctor_id'] = assignedDoctorId;
    }
    if (accountStatus != null) params['account_status'] = accountStatus;
    if (search != null && search.isNotEmpty) params['search'] = search;

    final response = await _apiClient.getRaw(
      AppStrings.adminPatientsPath,
      queryParameters: params,
    );
    return _extractData(response);
  }

  Future<Map<String, dynamic>> updatePatient(
    String id,
    Map<String, dynamic> data,
  ) async {
    return await _apiClient.put(
      '${AppStrings.adminPatientsPath}/$id',
      data: data,
    );
  }

  /// V2 status surface (`PATCH /admin/patients/:id/status`).
  Future<Map<String, dynamic>> updatePatientStatus(
    String id, {
    bool? isActive,
    String? accountStatus,
  }) async {
    return await _apiClient.patch(
      '${AppStrings.adminPatientsPath}/$id/status',
      data: {
        if (isActive != null) 'is_active': isActive,
        if (accountStatus != null) 'account_status': accountStatus,
      },
    );
  }

  /// V2 credentials surface (`POST /admin/patients/:id/credentials/reset`).
  Future<Map<String, dynamic>> resetPatientCredentials(
    String id, {
    String? newPassword,
  }) async {
    return await _apiClient.post(
      '${AppStrings.adminPatientsPath}/$id/credentials/reset',
      data: {if (newPassword != null) 'new_password': newPassword},
    );
  }

  Future<void> deactivatePatient(String id) async {
    await _apiClient.delete('${AppStrings.adminPatientsPath}/$id');
  }

  // ─── Patient Reassignment ───

  Future<Map<String, dynamic>> getHospitals({
    String? status,
    String? search,
  }) async {
    final params = <String, dynamic>{};
    if (status != null && status.isNotEmpty) params['status'] = status;
    if (search != null && search.isNotEmpty) params['search'] = search;
    final response = await _apiClient.getRaw(
      AppStrings.adminHospitalsPath,
      queryParameters: params,
    );
    return _extractData(response);
  }

  Future<Map<String, dynamic>> createHospital(Map<String, dynamic> data) async {
    return _apiClient.post(AppStrings.adminHospitalsPath, data: data);
  }

  Future<Map<String, dynamic>> updateHospital(
    String id,
    Map<String, dynamic> data,
  ) async {
    return _apiClient.put('${AppStrings.adminHospitalsPath}/$id', data: data);
  }

  Future<Map<String, dynamic>> updateHospitalStatus(
    String id,
    String status,
  ) async {
    return _apiClient.patch(
      '${AppStrings.adminHospitalsPath}/$id/status',
      data: {'status': status},
    );
  }

  Future<void> deleteHospital(String id) async {
    await _apiClient.delete('${AppStrings.adminHospitalsPath}/$id');
  }

  Future<Map<String, dynamic>> getUsers() async {
    final response = await _apiClient.getRaw(AppStrings.adminUsersPath);
    return _extractData(response);
  }

  Future<Map<String, dynamic>> inviteUser(Map<String, dynamic> data) async {
    return _apiClient.post(AppStrings.adminUsersPath, data: data);
  }

  Future<Map<String, dynamic>> updateUser(
    String id,
    Map<String, dynamic> data,
  ) async {
    return _apiClient.put('${AppStrings.adminUsersPath}/$id', data: data);
  }

  Future<Map<String, dynamic>> resetUserAuthenticator(String id) async {
    return _apiClient.post('${AppStrings.adminUsersPath}/$id/mfa/reset');
  }

  Future<Map<String, dynamic>> getRoles() async {
    final response = await _apiClient.getRaw(AppStrings.adminRolesPath);
    return _extractData(response);
  }

  Future<Map<String, dynamic>> updateRole(
    String roleKey,
    Map<String, dynamic> permissions,
  ) => _apiClient.put(
    '${AppStrings.adminRolesPath}/$roleKey',
    data: {'permissions': permissions},
  );

  // ─── V2 Administrator Accounts ───

  Future<List<AdminAccountModel>> getAdminAccounts() async {
    final response = await _apiClient.get(AppStrings.adminAccountsPath);
    return _extractItems(response, const [
          'admin_accounts',
          'accounts',
          'items',
        ])
        .map(_normalizeAdminAccount)
        .map(AdminAccountModel.fromJson)
        .toList(growable: false);
  }

  Future<AdminAccountMutationResult> createAdminAccount(
    Map<String, dynamic> data,
  ) async {
    final response = await _apiClient.post(
      AppStrings.adminAccountsPath,
      data: data,
    );
    return AdminAccountMutationResult.fromJson(response);
  }

  Future<AdminAccountMutationResult> updateAdminAccount(
    String id,
    Map<String, dynamic> data,
  ) async {
    final response = await _apiClient.put(
      '${AppStrings.adminAccountsPath}/$id',
      data: data,
    );
    return AdminAccountMutationResult.fromJson(response);
  }

  Future<Map<String, dynamic>> resetAdminAccountMfa(String id) {
    return _apiClient.post('${AppStrings.adminAccountsPath}/$id/mfa/reset');
  }

  // ─── V2 Administrator Role Policies ───

  Future<List<AdminRolePolicyModel>> getRolePolicies() async {
    final response = await _apiClient.get(AppStrings.adminRolePoliciesPath);
    return _extractItems(response, const ['policies', 'items'])
        .map(_normalizePolicy)
        .map(AdminRolePolicyModel.fromJson)
        .toList(growable: false);
  }

  Future<AdminRolePolicyModel> getRolePolicy(AdminRole role) async {
    final response = await _apiClient.get(
      '${AppStrings.adminRolePoliciesPath}/${role.wireValue}',
    );
    return AdminRolePolicyModel.fromJson(_normalizePolicy(response));
  }

  Future<AdminRolePolicyPreviewModel> previewRolePolicy({
    required AdminRole role,
    required Map<String, bool> capabilities,
    required int expectedVersion,
  }) async {
    final response = await _apiClient.post(
      '${AppStrings.adminRolePoliciesPath}/${role.wireValue}/preview',
      data: {'capabilities': capabilities, 'expected_version': expectedVersion},
    );
    return AdminRolePolicyPreviewModel.fromJson(response);
  }

  Future<AdminRolePolicyModel> updateRolePolicyV2({
    required AdminRole role,
    required Map<String, bool> capabilities,
    required int expectedVersion,
    required String changeReason,
  }) async {
    final response = await _apiClient.put(
      '${AppStrings.adminRolePoliciesPath}/${role.wireValue}',
      data: {
        'capabilities': capabilities,
        'expected_version': expectedVersion,
        'change_reason': changeReason,
      },
    );
    return AdminRolePolicyModel.fromJson(_normalizePolicy(response));
  }

  Future<List<AdminRolePolicyRevisionModel>> getRolePolicyHistory(
    AdminRole role, {
    int limit = 50,
    int? beforeVersion,
  }) async {
    final response = await _apiClient.get(
      '${AppStrings.adminRolePoliciesPath}/${role.wireValue}/history',
      queryParameters: {
        'limit': limit,
        if (beforeVersion != null) 'before_version': beforeVersion,
      },
    );
    return _extractItems(response, const [
      'history',
      'revisions',
      'items',
    ]).map(AdminRolePolicyRevisionModel.fromJson).toList(growable: false);
  }

  Future<AdminRolePolicyPreviewModel> previewRolePolicyRestore({
    required AdminRole role,
    required String revisionId,
    required int expectedVersion,
  }) async {
    final response = await _apiClient.post(
      '${AppStrings.adminRolePoliciesPath}/${role.wireValue}/restore-preview',
      data: {'revision_id': revisionId, 'expected_version': expectedVersion},
    );
    return AdminRolePolicyPreviewModel.fromJson(response);
  }

  Future<AdminRolePolicyModel> restoreRolePolicy({
    required AdminRole role,
    required String revisionId,
    required int expectedVersion,
    required String changeReason,
  }) async {
    final response = await _apiClient.post(
      '${AppStrings.adminRolePoliciesPath}/${role.wireValue}/restore',
      data: {
        'revision_id': revisionId,
        'expected_version': expectedVersion,
        'change_reason': changeReason,
      },
    );
    return AdminRolePolicyModel.fromJson(_normalizePolicy(response));
  }

  Future<Map<String, dynamic>> getInvoices() async {
    final response = await _apiClient.getRaw(AppStrings.adminInvoicesPath);
    return _extractData(response);
  }

  Future<Map<String, dynamic>> generateInvoices({
    required String billingPeriod,
    String? plan,
    num? amount,
  }) async {
    return _apiClient.post(
      AppStrings.adminInvoicesPath,
      data: {
        'billing_period': billingPeriod,
        if (plan != null) 'plan': plan,
        if (amount != null) 'amount': amount,
      },
    );
  }

  Future<Map<String, dynamic>> createInvoiceCheckout(String invoiceId) async {
    return _apiClient.post('${AppStrings.adminCheckoutPath}/$invoiceId');
  }

  Future<Map<String, dynamic>> reassignPatient(
    String opNum,
    String newDoctorId,
  ) async {
    return await _apiClient.put(
      '${AppStrings.adminReassignPath}/$opNum',
      data: {'new_doctor_id': newDoctorId},
    );
  }

  // ─── Audit Logs ───

  Future<Map<String, dynamic>> getAuditLogs({
    int page = 1,
    int limit = 50,
    String? userId,
    String? action,
    String? startDate,
    String? endDate,
    String? success,
  }) async {
    final params = <String, dynamic>{'page': page, 'limit': limit};
    if (userId != null) params['user_id'] = userId;
    if (action != null) params['action'] = action;
    if (startDate != null) params['start_date'] = startDate;
    if (endDate != null) params['end_date'] = endDate;
    if (success != null) params['success'] = success;

    final response = await _apiClient.getRaw(
      AppStrings.adminAuditLogsPath,
      queryParameters: params,
    );
    return _extractData(response);
  }

  // ─── System Config ───

  Future<Map<String, dynamic>> getSystemConfig() async {
    return await _apiClient.get(AppStrings.adminConfigPath);
  }

  Future<Map<String, dynamic>> updateSystemConfig(
    Map<String, dynamic> data,
  ) async {
    return await _apiClient.put(AppStrings.adminConfigPath, data: data);
  }

  // ─── Notifications ───

  Future<Map<String, dynamic>> broadcastNotification({
    required String title,
    required String message,
    required String target,
    List<String>? userIds,
    String priority = 'MEDIUM',
  }) async {
    return await _apiClient.post(
      AppStrings.adminNotificationsPath,
      data: {
        'title': title,
        'message': message,
        'target': target,
        if (userIds != null) 'user_ids': userIds,
        'priority': priority,
      },
    );
  }

  // ─── Batch Operations ───

  Future<Map<String, dynamic>> performBatchOperation({
    required String operation,
    required List<String> userIds,
  }) async {
    return await _apiClient.post(
      AppStrings.adminBatchPath,
      data: {'operation': operation, 'user_ids': userIds},
    );
  }

  // ─── Password Reset ───

  Future<Map<String, dynamic>> resetUserPassword(
    String targetUserId, {
    String? newPassword,
  }) async {
    return await _apiClient.post(
      '${AppStrings.adminBasePath}/users/reset-password',
      data: {
        'target_user_id': targetUserId,
        if (newPassword != null) 'new_password': newPassword,
      },
    );
  }

  // ─── System Health ───

  Future<AdminTotpEnrollment> setupAdminTotp() async {
    final response = await _apiClient.post(AppStrings.adminTotpSetupPath);
    return AdminTotpEnrollment.fromJson(response);
  }

  Future<AdminTotpStatus> getAdminTotpStatus() async {
    final response = await _apiClient.get(AppStrings.adminTotpStatusPath);
    return AdminTotpStatus.fromJson(response);
  }

  Future<AdminTotpActivation> activateAdminTotp(String code) async {
    final response = await _apiClient.post(
      AppStrings.adminTotpActivatePath,
      data: {'code': code},
    );
    return AdminTotpActivation.fromJson(response);
  }

  Future<SystemHealthModel> getSystemHealth() async {
    final response = await _apiClient.get(AppStrings.adminHealthPath);
    return SystemHealthModel.fromJson(response);
  }

  Future<Map<String, dynamic>> getReminderDeliveryHealth() async {
    return _apiClient.get(AppStrings.adminReminderDeliveryHealthPath);
  }

  // ─── Statistics ───

  Future<AdminStatsModel> getAdminStats() async {
    final response = await _apiClient.get(AppStrings.statisticsAdminPath);
    return AdminStatsModel.fromJson(response);
  }

  Future<RegistrationTrends> getTrends({String period = '30d'}) async {
    final response = await _apiClient.get(
      AppStrings.statisticsTrendsPath,
      queryParameters: {'period': period},
    );
    return RegistrationTrends.fromJson(response);
  }

  Future<InrComplianceStats> getCompliance() async {
    final response = await _apiClient.get(AppStrings.statisticsCompliancePath);
    return InrComplianceStats.fromJson(response);
  }

  Future<List<DoctorWorkload>> getWorkload() async {
    final response = await _apiClient.get(AppStrings.statisticsWorkloadPath);
    final items = response['items'] as List? ?? [];
    return items
        .map((e) => DoctorWorkload.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Iterable<Map<String, dynamic>> _extractItems(
    Map<String, dynamic> response,
    List<String> keys,
  ) sync* {
    Object? raw;
    for (final key in keys) {
      if (response[key] is List) {
        raw = response[key];
        break;
      }
    }
    raw ??= response['data'];
    if (raw is Map) {
      final rawMap = raw;
      for (final key in keys) {
        if (rawMap[key] is List) {
          raw = rawMap[key];
          break;
        }
      }
    }
    if (raw is! List) return;
    for (final item in raw) {
      if (item is Map<String, dynamic>) {
        yield item;
      } else if (item is Map) {
        yield Map<String, dynamic>.from(item);
      }
    }
  }

  Map<String, dynamic> _normalizeAdminAccount(Map<String, dynamic> source) {
    final hospitalValue = source['hospital'];
    final hospitalId = source['hospital_id'] ?? source['hospitalId'];
    final normalizedHospital = hospitalValue is Map
        ? Map<String, dynamic>.from(hospitalValue)
        : hospitalId == null
        ? null
        : {
            'id': hospitalId.toString(),
            'code':
                (source['hospital_code'] ??
                        source['hospitalCode'] ??
                        hospitalId)
                    .toString(),
            'name': source['hospital_name'] ?? source['hospitalName'],
          };
    final active = source['is_active'] ?? source['isActive'];
    final rawId = source['id'] ?? source['_id'];
    final id = rawId == null ? '' : rawId.toString();
    if (id.isEmpty || id == 'null') {
      throw const FormatException('Administrator account id is required');
    }
    return {
      'id': id,
      'login_id': source['login_id'] ?? source['loginId'] ?? source['email'],
      'name': source['name'] ?? source['full_name'] ?? source['email'],
      'email': source['email'],
      'role': source['role'] ?? source['admin_role'] ?? source['adminRole'],
      'hospital': normalizedHospital,
      'is_active': active ?? source['status'] == 'active',
      'mfa_enabled': source['mfa_enabled'] ?? source['mfaEnabled'] ?? false,
      'created_at': source['created_at'] ?? source['createdAt'],
      'updated_at': source['updated_at'] ?? source['updatedAt'],
    };
  }

  Map<String, dynamic> _normalizePolicy(Map<String, dynamic> source) {
    final nested = source['policy'];
    final json = nested is Map
        ? Map<String, dynamic>.from(nested)
        : Map<String, dynamic>.from(source);
    final roleValue = json['role_key'] ?? json['roleKey'];
    final role = AdminRole.parse(roleValue);
    return {
      'schema_version': json['schema_version'] ?? json['schemaVersion'] ?? 2,
      'role_key': role.wireValue,
      'label':
          json['label'] ??
          switch (role) {
            AdminRole.appAdmin => 'Application Admin',
            AdminRole.hospitalAdmin => 'Hospital Admin',
            AdminRole.auditor => 'System Auditor',
          },
      'description': json['description'] ?? '',
      'protected': json['protected'] ?? json['is_protected'] ?? false,
      'capabilities': json['capabilities'] ?? const <String, bool>{},
      'policy_version': json['policy_version'] ?? json['policyVersion'],
      'active_account_count':
          json['active_account_count'] ?? json['activeAccountCount'] ?? 0,
      'updated_at': json['updated_at'] ?? json['updatedAt'],
      'updated_by': json['updated_by'] ?? json['updatedBy'],
      'change_reason': json['change_reason'] ?? json['changeReason'],
    };
  }
}
