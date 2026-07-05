import 'package:dio/dio.dart';
import 'package:frontend/core/constants/strings.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/core/storage/secure_storage.dart';

class PatientRepository {
  PatientRepository(
      {required ApiClient apiClient, SecureStorage? secureStorage})
      : _apiClient = apiClient,
        _secureStorage = secureStorage ?? SecureStorage();

  final ApiClient _apiClient;
  final SecureStorage _secureStorage;

  static const String _patientBasePath = '${AppStrings.apiPathPrefix}/patient';

  Future<Map<String, dynamic>> getProfile() async {
    final response = await _apiClient.getRaw('$_patientBasePath/profile');
    final data = response['data'] is Map<String, dynamic>
        ? response['data'] as Map<String, dynamic>
        : response;

    final patient = data['patient'];
    if (patient is! Map<String, dynamic> || patient['profile_id'] == null) {
      throw Exception('Profile data is incomplete');
    }

    final profile = patient['profile_id'] is Map<String, dynamic>
        ? patient['profile_id'] as Map<String, dynamic>
        : <String, dynamic>{};
    final demographics = profile['demographics'] is Map<String, dynamic>
        ? profile['demographics'] as Map<String, dynamic>
        : <String, dynamic>{};
    final medicalConfig = profile['medical_config'] is Map<String, dynamic>
        ? profile['medical_config'] as Map<String, dynamic>
        : <String, dynamic>{};
    final targetInr = medicalConfig['target_inr'] is Map<String, dynamic>
        ? medicalConfig['target_inr'] as Map<String, dynamic>
        : <String, dynamic>{};

    String doctorName = 'Unassigned';
    String doctorPhone = 'N/A';
    final doctorUser = profile['assigned_doctor_id'];
    if (doctorUser is Map<String, dynamic>) {
      final doctorProfile = doctorUser['profile_id'];
      if (doctorProfile is Map<String, dynamic>) {
        doctorName = doctorProfile['name']?.toString() ?? 'Unassigned';
        doctorPhone = doctorProfile['contact_number']?.toString() ?? 'N/A';
      }
    }

    final nextOfKin = demographics['next_of_kin'] is Map<String, dynamic>
        ? demographics['next_of_kin'] as Map<String, dynamic>
        : <String, dynamic>{};

    final doctorUpdates = data['doctor_updates'] is Map<String, dynamic>
        ? data['doctor_updates'] as Map<String, dynamic>
        : null;

    return {
      'name': demographics['name'] ?? 'Patient',
      'opNumber': patient['login_id'] ?? patient['_id'] ?? 'N/A',
      'age': demographics['age'] ?? 0,
      'gender': demographics['gender'] ?? 'N/A',
      'phone': demographics['phone'] ?? 'N/A',
      'targetINR': '${targetInr['min'] ?? 2.0} - ${targetInr['max'] ?? 3.0}',
      'nextReviewDate': formatDate(medicalConfig['next_review_date']),
      'therapyDrug': medicalConfig['therapy_drug'] ?? 'N/A',
      'therapyStartDate': formatDate(medicalConfig['therapy_start_date']),
      'doctorName': doctorName,
      'doctorPhone': doctorPhone,
      'caregiver': nextOfKin['name'] ?? 'N/A',
      'kinName': nextOfKin['name'] ?? 'N/A',
      'kinRelation': nextOfKin['relation'] ?? 'N/A',
      'kinPhone': nextOfKin['phone'] ?? 'N/A',
      'instructions': medicalConfig['instructions'] ?? [],
      'weeklyDosage': profile['weekly_dosage'] ?? {},
      'healthLogs': profile['health_logs'] ?? [],
      'medicalHistory': profile['medical_history'] ?? [],
      'doctorUpdatesUnreadCount': doctorUpdates?['unread_count'] ?? 0,
      'latestDoctorUpdate': doctorUpdates?['latest'],
    };
  }

  Future<Map<String, dynamic>> getMissedDoses() async {
    final response = await _apiClient.get('$_patientBasePath/missed-doses');
    final recent = response['recent_missed_doses'];
    final missed = response['missed_doses'];
    return {
      'recent_missed_doses':
          recent is List ? recent.cast<String>() : <String>[],
      'missed_doses': missed is List ? missed.cast<String>() : <String>[],
    };
  }

  Future<void> submitINRReport({
    required String inrValue,
    required String testDate,
    List<int>? fileBytes,
    String? fileName,
  }) async {
    if (fileBytes == null || fileName == null) {
      await _apiClient.post(
        '$_patientBasePath/reports',
        data: {
          'inr_value': inrValue,
          'test_date': testDate,
        },
      );
      return;
    }

    final token = await _secureStorage.readToken();
    final dio = Dio(
      BaseOptions(
        baseUrl: AppStrings.apiBaseUrl,
        validateStatus: (status) => status != null && status < 500,
      ),
    );

    final formData = FormData.fromMap({
      'inr_value': inrValue,
      'test_date': testDate,
      'file': MultipartFile.fromBytes(fileBytes, filename: fileName),
    });

    try {
      final response = await dio.post<Map<String, dynamic>>(
        '$_patientBasePath/reports',
        data: formData,
        options: Options(
          headers: {
            'Accept': 'application/json',
            if (token != null && token.isNotEmpty)
              'Authorization': 'Bearer $token',
          },
        ),
      );

      final body = response.data ?? <String, dynamic>{};
      if ((response.statusCode ?? 500) >= 400 || body['success'] == false) {
        throw _uploadException(
          response.statusCode ?? 500,
          body['message']?.toString(),
        );
      }
    } on DioException catch (e) {
      final statusCode = e.response?.statusCode;
      final responseData = e.response?.data;
      final message = responseData is Map<String, dynamic>
          ? responseData['message']?.toString()
          : null;
      throw _uploadException(statusCode, message);
    }
  }

  Future<void> submitHealthLog({
    required String type,
    required String description,
  }) async {
    await _apiClient.post(
      '$_patientBasePath/health-logs',
      data: {
        'type': type,
        'description': description,
      },
    );
  }

  Future<void> markDoseAsTaken({
    required String date,
    required double dose,
  }) async {
    await _apiClient.post(
      '$_patientBasePath/dosage',
      data: {
        'date': date,
        'dose': dose,
      },
    );
  }

  Future<Map<String, dynamic>> getDosageCalendar({
    int months = 3,
    String? startDate,
  }) async {
    final queryParams = <String, dynamic>{'months': months};
    if (startDate != null) {
      queryParams['start_date'] = startDate;
    }

    final data = await _apiClient.get(
      '$_patientBasePath/dosage-calendar',
      queryParameters: queryParams,
    );

    return {
      'calendar_data': (data['calendar_data'] as List? ?? const []).map((item) {
        final row = item as Map<String, dynamic>;
        return {
          'date': row['date'] as String,
          'status': row['status'] as String,
          'dosage': (row['dosage'] as num).toDouble(),
          'day_of_week': row['day_of_week'] as String,
        };
      }).toList(),
      'date_range': {
        'start': data['date_range']?['start'] as String,
        'end': data['date_range']?['end'] as String,
      },
      'therapy_start': data['therapy_start'] as String,
    };
  }

  Future<List<Map<String, dynamic>>> getINRHistory() async {
    final response = await _apiClient.get('$_patientBasePath/reports');
    final report = response['report'];
    if (report is! Map<String, dynamic>) {
      return [];
    }

    final inrHistory = report['inr_history'];
    if (inrHistory is! List) {
      return [];
    }

    return inrHistory.map((item) {
      final entry = item as Map<String, dynamic>;
      final isCritical = entry['is_critical'] == true;
      return {
        'id': entry['_id'],
        'date': formatDate(entry['test_date']),
        'inr': (entry['inr_value'] as num).toDouble(),
        'notes': entry['notes'] ?? '',
        'isCritical': isCritical,
        'fileUrl': entry['file_url'] ?? '',
        'uploadedAt': formatDate(entry['uploaded_at']),
        'status': isCritical
            ? 'Critical'
            : _getINRStatus(entry['inr_value'], 2.0, 3.0),
      };
    }).toList();
  }

  Future<List<Map<String, dynamic>>> getPrescriptions() async {
    final response = await _apiClient.get('$_patientBasePath/reports');
    final report = response['report'];
    if (report is! Map<String, dynamic>) {
      return [];
    }

    final prescriptions = <Map<String, dynamic>>[];
    final medicalConfig =
        report['medical_config'] as Map<String, dynamic>? ?? {};
    final weeklyDosage = report['weekly_dosage'] as Map<String, dynamic>? ?? {};

    final therapyDrug = medicalConfig['therapy_drug'];
    if (therapyDrug != null) {
      prescriptions.add({
        'drug': therapyDrug,
        'dosage': '${weeklyDosage['monday'] ?? 5}mg',
        'frequency': 'As per schedule',
        'startDate': formatDate(medicalConfig['therapy_start_date']),
        'instructions': (medicalConfig['instructions'] as List?)?.join(', ') ??
            'Follow doctor instructions',
      });
    }

    prescriptions.add({
      'drug': 'Aspirin',
      'dosage': '75mg',
      'frequency': 'Once daily',
      'startDate': formatDate(medicalConfig['therapy_start_date']),
      'instructions': 'Take in the morning with food',
    });

    return prescriptions;
  }

  Future<Map<String, dynamic>> getLatestINRData() async {
    final response = await _apiClient.get('$_patientBasePath/reports');
    final report = response['report'];
    if (report is! Map<String, dynamic>) {
      return {'value': 0.0, 'date': 'N/A', 'isCritical': false, 'hasData': false};
    }

    final inrHistory = report['inr_history'];
    if (inrHistory is! List || inrHistory.isEmpty) {
      return {'value': 0.0, 'date': 'N/A', 'isCritical': false, 'hasData': false};
    }

    Map<String, dynamic>? latestEntry;
    DateTime? latestDate;

    for (final item in inrHistory) {
      if (item is! Map<String, dynamic>) continue;
      final entryDate = _parseDate(item['test_date']);

      if (latestEntry == null) {
        latestEntry = item;
        latestDate = entryDate;
        continue;
      }

      if (entryDate != null &&
          (latestDate == null || entryDate.isAfter(latestDate))) {
        latestEntry = item;
        latestDate = entryDate;
      }
    }

    if (latestEntry == null) {
      return {'value': 0.0, 'date': 'N/A', 'isCritical': false, 'hasData': false};
    }

    return {
      'value': _toDouble(latestEntry['inr_value']),
      'date': formatDate(latestEntry['test_date']),
      'isCritical': latestEntry['is_critical'] == true,
      'hasData': true,
    };
  }

  Future<double> getLatestINR() async {
    final latest = await getLatestINRData();
    final value = latest['value'];
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value) ?? 0.0;
    return 0.0;
  }

  Future<List<Map<String, dynamic>>> getDoctorUpdates({
    bool unreadOnly = false,
    int limit = 20,
  }) async {
    final response = await _apiClient.get(
      '$_patientBasePath/doctor-updates',
      queryParameters: {
        'unread_only': unreadOnly.toString(),
        'limit': limit,
      },
    );

    final updates = response['updates'] as List? ?? const [];
    return updates.map((event) {
      final item = Map<String, dynamic>.from(event as Map);
      return {
        'id': item['_id']?.toString() ?? '',
        'title': item['title']?.toString() ?? 'Doctor update',
        'message': item['message']?.toString() ?? '',
        'changeType': item['change_type']?.toString() ?? '',
        'createdAt': formatDate(item['created_at']),
        'isRead': item['is_read'] == true,
      };
    }).toList();
  }

  Future<Map<String, dynamic>> getDoctorUpdatesSummary() async {
    final response = await _apiClient.get('$_patientBasePath/doctor-updates/summary');
    return {
      'unread_count': (response['unread_count'] as num?)?.toInt() ?? 0,
      'latest': response['latest'],
    };
  }

  Future<Map<String, dynamic>> getNotifications({
    int page = 1,
    int limit = 20,
    bool? isRead,
  }) async {
    final raw = await _apiClient.getRaw(
      AppStrings.patientNotificationsPath,
      queryParameters: {
        'page': page,
        'limit': limit,
        if (isRead != null) 'is_read': isRead.toString(),
      },
    );

    final data = raw['data'] is Map<String, dynamic>
        ? raw['data'] as Map<String, dynamic>
        : <String, dynamic>{};
    final notifications =
        (data['notifications'] as List? ?? const []).map((item) {
      final row = item as Map<String, dynamic>;
      return {
        'id': row['_id']?.toString() ?? '',
        'title': row['title']?.toString() ?? 'Notification',
        'message': row['message']?.toString() ?? '',
        'type': row['type']?.toString() ?? 'GENERAL',
        'priority': row['priority']?.toString() ?? 'MEDIUM',
        'isRead': row['is_read'] == true,
        'createdAt': formatDate(row['created_at']),
      };
    }).toList();

    return {
      'notifications': notifications,
      'unreadCount': (data['unread_count'] as num?)?.toInt() ?? 0,
      'pagination': data['pagination'] ?? <String, dynamic>{},
    };
  }

  Future<int> getNotificationsUnreadCount() async {
    final data = await getNotifications(page: 1, limit: 1);
    return (data['unreadCount'] as num?)?.toInt() ?? 0;
  }

  Future<void> markNotificationAsRead(String notificationId) async {
    await _apiClient.patch(
      '${AppStrings.patientNotificationsPath}/$notificationId/read',
    );
  }

  Future<void> markAllNotificationsAsRead() async {
    await _apiClient.patch('${AppStrings.patientNotificationsPath}/read-all');
  }

  Future<void> markDoctorUpdateAsRead(String eventId) async {
    await _apiClient.patch('$_patientBasePath/doctor-updates/$eventId/read');
  }

  Future<void> markAllDoctorUpdatesAsRead() async {
    await _apiClient.patch('$_patientBasePath/doctor-updates/read-all');
  }

  String formatDate(dynamic date) {
    if (date == null) return 'N/A';
    if (date is String) {
      try {
        final dt = DateTime.parse(date);
        return '${dt.day.toString().padLeft(2, '0')}-${dt.month.toString().padLeft(2, '0')}-${dt.year}';
      } catch (_) {
        return date;
      }
    }
    return date.toString();
  }

  String _getINRStatus(dynamic value, double min, double max) {
    if (value == null) return 'Unknown';
    final inr = (value as num).toDouble();
    if (inr >= min && inr <= max) {
      return 'Normal';
    }
    if (inr < min) {
      return 'Low';
    }
    return 'High';
  }

  double _toDouble(dynamic value) {
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value) ?? 0.0;
    return 0.0;
  }

  DateTime? _parseDate(dynamic value) {
    if (value is DateTime) return value;
    if (value is String) {
      final parsed = DateTime.tryParse(value);
      if (parsed != null) return parsed;

      final parts = value.split('-');
      if (parts.length == 3) {
        final day = int.tryParse(parts[0]);
        final month = int.tryParse(parts[1]);
        final year = int.tryParse(parts[2]);
        if (day != null && month != null && year != null) {
          return DateTime(year, month, day);
        }
      }
    }
    return null;
  }

  ApiException _uploadException(int? statusCode, String? serverMessage) {
    final message = serverMessage?.trim();
    switch (statusCode) {
      case 400:
        return ApiException(
          message?.isNotEmpty == true
              ? message!
              : 'Please check the INR value, date, and selected file.',
          statusCode: statusCode,
          kind: ApiErrorKind.badRequest,
        );
      case 401:
        return ApiException(
          message?.isNotEmpty == true
              ? message!
              : 'Your session has expired. Please sign in again.',
          statusCode: statusCode,
          kind: ApiErrorKind.unauthorized,
        );
      case 413:
        return ApiException(
          message?.isNotEmpty == true
              ? message!
              : 'The selected report is larger than the allowed upload size.',
          statusCode: statusCode,
          kind: ApiErrorKind.requestTooLarge,
        );
      case 423:
        return ApiException(
          message?.isNotEmpty == true
              ? message!
              : 'This account is temporarily locked. Try again later.',
          statusCode: statusCode,
          kind: ApiErrorKind.locked,
        );
      case 429:
        return ApiException(
          message?.isNotEmpty == true
              ? message!
              : 'Too many upload attempts. Please wait before trying again.',
          statusCode: statusCode,
          kind: ApiErrorKind.rateLimited,
        );
      default:
        if (statusCode != null && statusCode >= 500) {
          return ApiException(
            message?.isNotEmpty == true
                ? message!
                : 'The server could not upload the report. Please try again.',
            statusCode: statusCode,
            kind: ApiErrorKind.server,
          );
        }
        return ApiException(
          message?.isNotEmpty == true
              ? message!
              : 'Unable to upload the report. Check your connection and try again.',
          statusCode: statusCode,
          kind: ApiErrorKind.network,
        );
    }
  }
}
