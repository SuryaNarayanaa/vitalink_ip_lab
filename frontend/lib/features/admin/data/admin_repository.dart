import 'package:frontend/core/constants/strings.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/features/admin/models/admin_mfa_model.dart';
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
  ) async {
    return _apiClient.put(
      '${AppStrings.adminRolesPath}/$roleKey',
      data: {'permissions': permissions},
    );
  }

  Future<Map<String, dynamic>> getInvoices() async {
    final response = await _apiClient.getRaw(AppStrings.adminInvoicesPath);
    return _extractData(response);
  }

  Future<Map<String, dynamic>> generateInvoices({
    String? plan,
    num? amount,
  }) async {
    return _apiClient.post(
      AppStrings.adminInvoicesPath,
      data: {
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
}
