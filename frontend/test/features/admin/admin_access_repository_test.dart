import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/core/constants/strings.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/features/admin/data/admin_access_repository.dart';
import 'package:frontend/features/admin/models/admin_access_model.dart';

class _RecordingApiClient extends ApiClient {
  _RecordingApiClient(this.response) : super();

  final Map<String, dynamic> response;
  final List<String> paths = <String>[];

  @override
  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    bool authenticated = true,
  }) async {
    paths.add(path);
    return response;
  }
}

void main() {
  test('loads and parses GET /admin/access/me', () async {
    final apiClient = _RecordingApiClient({
      'schema_version': 2,
      'user_id': 'auditor-1',
      'role': 'auditor',
      'scope': 'global',
      'hospital': null,
      'effective_capabilities': ['platform.audit.read'],
      'policy_version': 5,
      'read_only': true,
    });
    final repository = AdminAccessRepository(apiClient: apiClient);

    final access = await repository.getCurrentAccess();

    expect(apiClient.paths, [AppStrings.adminAccessMePath]);
    expect(access.role, AdminRole.auditor);
    expect(access.readOnly, isTrue);
    expect(access.can('platform.audit.read'), isTrue);
  });
}
