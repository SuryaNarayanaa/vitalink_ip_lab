import 'package:frontend/core/constants/strings.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/features/admin/models/admin_access_model.dart';

class AdminAccessRepository {
  AdminAccessRepository({required ApiClient apiClient})
    : _apiClient = apiClient;

  final ApiClient _apiClient;

  Future<AdminAccessModel> getCurrentAccess() async {
    final response = await _apiClient.get(AppStrings.adminAccessMePath);
    return AdminAccessModel.fromJson(response);
  }

  Future<AdminAccessModel> fetchCurrentAccess() => getCurrentAccess();
}
