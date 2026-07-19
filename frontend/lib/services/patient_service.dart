import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:frontend/core/constants/strings.dart';
import 'package:frontend/core/auth/session_expiry_handler.dart';

class PatientService {
  static const String baseUrl =
      '${AppStrings.apiBaseUrl}${AppStrings.apiPathPrefix}/patient';
  static const storage = FlutterSecureStorage();

  static String _endpoint(String path) => path;

  static void _rejectNonSuccessfulResponse(Response<dynamic> response) {
    final statusCode = response.statusCode;
    if (statusCode != null && statusCode >= 200 && statusCode < 300) return;
    throw DioException(
      requestOptions: response.requestOptions,
      response: response,
      type: DioExceptionType.badResponse,
      message: 'Request failed with status code $statusCode',
    );
  }

  static final Dio _dio = Dio(
    BaseOptions(
      baseUrl: baseUrl,
      contentType: Headers.jsonContentType,
      validateStatus: (status) => status != null && status < 500,
    ),
  );

  // Interceptor to add auth token
  static void _setupInterceptors() {
    _dio.interceptors.clear();
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await storage.read(key: 'auth_token');
          if (token != null) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          return handler.next(options);
        },
        onResponse: (response, handler) async {
          if (response.statusCode == 401) {
            await SessionExpiryHandler.clearSessionAndRedirectToLogin();
            return handler.reject(
              DioException(
                requestOptions: response.requestOptions,
                response: response,
                type: DioExceptionType.badResponse,
                message: 'Authentication failed - token may be invalid or expired',
              ),
            );
          }
          return handler.next(response);
        },
      ),
    );
  }

  // Get patient profile
  static Future<Map<String, dynamic>> getProfile() async {
    _setupInterceptors();
    try {
      final response = await _dio.get(_endpoint('/profile'));
      if (response.statusCode == 200) {
        final root = response.data;
        final dataSection = root is Map ? root['data'] : null;
        final data = dataSection is Map ? dataSection['patient'] : null;
        if (data is! Map || data['profile_id'] == null) {
          throw Exception('Profile data is incomplete');
        }

        final profile = data['profile_id'] is Map
            ? Map<String, dynamic>.from(data['profile_id'] as Map)
            : <String, dynamic>{};
        if (profile.isEmpty) {
          throw Exception('Profile data is incomplete');
        }
        final demographics =
            profile['demographics'] is Map ? profile['demographics'] : {};
        final medicalConfig =
            profile['medical_config'] is Map ? profile['medical_config'] : {};
        final targetInr = medicalConfig['target_inr'] is Map
            ? medicalConfig['target_inr']
            : {};

        // Handle doctor information safely
        String doctorName = 'Unassigned';
        String doctorPhone = 'N/A';
        final doctorUser = profile['assigned_doctor_id'];
        if (doctorUser is Map) {
          final doctorProfile = doctorUser['profile_id'];
          if (doctorProfile is Map) {
            doctorName = doctorProfile['name'] ?? 'Unassigned';
            doctorPhone = doctorProfile['contact_number'] ?? 'N/A';
          }
        }

        final nextOfKin = demographics['next_of_kin'] is Map
            ? demographics['next_of_kin']
            : {};

        final doctorUpdates = dataSection is Map &&
                dataSection['doctor_updates'] is Map
            ? Map<String, dynamic>.from(dataSection['doctor_updates'] as Map)
            : null;

        return {
          'name': demographics['name'] ?? 'Patient',
          'opNumber': data['login_id'] ?? data['_id'] ?? 'N/A',
          'age': demographics['age'] ?? 0,
          'gender': demographics['gender'] ?? 'N/A',
          'phone': demographics['phone'] ?? 'N/A',
          'targetINR':
              '${targetInr['min'] ?? 2.0} - ${targetInr['max'] ?? 3.0}',
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
      throw Exception('Failed to load profile');
    } on DioException catch (e) {
      throw Exception('Error: ${e.message}');
    } catch (e) {
      throw Exception('Error: $e');
    }
  }

  // Get missed doses
  static Future<Map<String, dynamic>> getMissedDoses() async {
    _setupInterceptors();
    try {
      final response = await _dio.get(_endpoint('/missed-doses'));
      if (response.statusCode == 200) {
        final dataSection =
            response.data is Map ? response.data['data'] : null;
        final recent = dataSection is Map
            ? (dataSection['recent_missed_doses'] as List?) ?? const []
            : const [];
        final missed = dataSection is Map
            ? (dataSection['missed_doses'] as List?) ?? const []
            : const [];
        return {
          'recent_missed_doses': recent.map((e) => e.toString()).toList(),
          'missed_doses': missed.map((e) => e.toString()).toList(),
        };
      }
      return {'recent_missed_doses': [], 'missed_doses': []};
    } on DioException catch (e) {
      throw Exception('Error: ${e.message}');
    } catch (e) {
      throw Exception('Error: $e');
    }
  }

  // Get INR history
  static Future<void> submitINRReport({
    required String inrValue,
    required String testDate, // Expected in dd-mm-yyyy
    List<int>? fileBytes,
    String? fileName,
  }) async {
    _setupInterceptors();
    try {
      final formData = FormData.fromMap({
        'inr_value': inrValue,
        'test_date': testDate,
      });

      if (fileBytes != null && fileName != null) {
        formData.files.add(MapEntry(
          'file',
          MultipartFile.fromBytes(fileBytes, filename: fileName),
        ));
      }

      final response = await _dio.post(_endpoint('/reports'), data: formData);
      _rejectNonSuccessfulResponse(response);
    } on DioException catch (e) {
      throw Exception('Failed to submit report: ${e.message}');
    }
  }

  static Future<void> submitHealthLog({
    required String type,
    required String description,
  }) async {
    _setupInterceptors();
    try {
      final response = await _dio.post(
        _endpoint('/health-logs'),
        data: {
          'type': type,
          'description': description,
        },
      );

      _rejectNonSuccessfulResponse(response);
    } on DioException catch (e) {
      throw Exception('Failed to submit health log: ${e.message}');
    }
  }

  static Future<void> markDoseAsTaken({
    required String date,
    required double dose,
  }) async {
    _setupInterceptors();
    try {
      final response = await _dio.post(_endpoint('/dosage'), data: {
        'date': date,
        'dose': dose,
      });
      _rejectNonSuccessfulResponse(response);
    } on DioException catch (e) {
      throw Exception('Failed to mark dose as taken: ${e.message}');
    }
  }

  // Get dosage calendar with optional months and start_date parameters
  static Future<Map<String, dynamic>> getDosageCalendar({
    int months = 3,
    String? startDate,
  }) async {
    _setupInterceptors();
    try {
      final queryParams = <String, dynamic>{
        'months': months,
      };
      if (startDate != null) {
        queryParams['start_date'] = startDate;
      }

      final response =
          await _dio.get(_endpoint('/dosage-calendar'), queryParameters: queryParams);

      if (response.statusCode == 200) {
        final data = response.data is Map ? response.data['data'] : null;
        if (data is! Map) {
          throw Exception('Failed to fetch calendar data');
        }
        final calendarData = (data['calendar_data'] as List?) ?? const [];
        final dateRange =
            data['date_range'] is Map ? data['date_range'] as Map : const {};
        return {
          'calendar_data': calendarData.map((item) {
            final row = item is Map ? item : const {};
            return {
              'date': row['date']?.toString() ?? '',
              'status': row['status']?.toString() ?? '',
              'dosage': (row['dosage'] as num?)?.toDouble() ?? 0.0,
              'day_of_week': row['day_of_week']?.toString() ?? '',
            };
          }).toList(),
          'date_range': {
            'start': dateRange['start']?.toString() ?? '',
            'end': dateRange['end']?.toString() ?? '',
          },
          'therapy_start': data['therapy_start']?.toString() ?? '',
        };
      }
      throw Exception('Failed to fetch calendar data');
    } on DioException catch (e) {
      throw Exception('Error fetching dosage calendar: ${e.message}');
    } catch (e) {
      throw Exception('Error fetching dosage calendar: $e');
    }
  }

  static Future<List<Map<String, dynamic>>> getINRHistory() async {
    _setupInterceptors();
    try {
      final response = await _dio.get(_endpoint('/reports'));
      if (response.statusCode == 200) {
        final dataSection =
            response.data is Map ? response.data['data'] : null;
        final report = dataSection is Map ? dataSection['report'] : null;
        if (report is! Map) return [];
        final medicalConfig =
            report['medical_config'] is Map ? report['medical_config'] as Map : {};
        final targetInr = medicalConfig['target_inr'] is Map
            ? medicalConfig['target_inr'] as Map
            : const {};
        final targetMin = (targetInr['min'] as num?)?.toDouble() ?? 2.0;
        final targetMax = (targetInr['max'] as num?)?.toDouble() ?? 3.0;
        final inrHistory = (report['inr_history'] as List?) ?? const [];
        return inrHistory.map((item) {
          final row = item is Map ? item : const {};
          final isCritical = row['is_critical'] == true;
          return {
            'id': row['_id'],
            'date': formatDate(row['test_date']),
            'inr': _toDouble(row['inr_value']),
            'notes': row['notes'] ?? '',
            'isCritical': isCritical,
            'fileUrl': row['file_url'] ?? '',
            'uploadedAt': formatDate(row['uploaded_at']),
            'status': isCritical
                ? 'Critical'
                : _getINRStatus(row['inr_value'], targetMin, targetMax),
          };
        }).toList();
      }
      return [];
    } on DioException catch (e) {
      throw Exception('Error: ${e.message}');
    } catch (e) {
      throw Exception('Error: $e');
    }
  }

  // Get prescriptions (medical config + dosage)
  static Future<List<Map<String, dynamic>>> getPrescriptions() async {
    _setupInterceptors();
    try {
      final response = await _dio.get(_endpoint('/reports'));
      if (response.statusCode == 200) {
        final report = response.data['data']['report'];
        final prescriptions = <Map<String, dynamic>>[];

        // Get therapy drug from medical config
        final therapyDrug = report['medical_config']['therapy_drug'];
        if (therapyDrug != null) {
          prescriptions.add({
            'drug': therapyDrug,
            'dosage': '${report['weekly_dosage']?['monday'] ?? 5}mg',
            'frequency': 'As per schedule',
            'startDate':
                formatDate(report['medical_config']['therapy_start_date']),
            'instructions': (report['medical_config']['instructions'] as List?)
                    ?.join(', ') ??
                'Follow doctor instructions',
          });
        }

        return prescriptions;
      }
      return [];
    } on DioException catch (e) {
      throw Exception('Error: ${e.message}');
    }
  }

  static Future<Map<String, dynamic>> getLatestINRData() async {
    _setupInterceptors();
    try {
      final response = await _dio.get(_endpoint('/reports'));
      if (response.statusCode == 200) {
        final dataSection =
            response.data is Map ? response.data['data'] : null;
        final report = dataSection is Map ? dataSection['report'] : null;
        final inrHistory = report is Map
            ? (report['inr_history'] as List?) ?? const []
            : const [];
        if (inrHistory.isEmpty) {
          return {
            'value': 0.0,
            'date': 'N/A',
          };
        }

        Map<String, dynamic>? latestEntry;
        DateTime? latestDate;

        for (final item in inrHistory) {
          if (item is! Map) continue;

          final entry = Map<String, dynamic>.from(item);
          final entryDate = _parseDate(entry['test_date']);

          if (latestEntry == null) {
            latestEntry = entry;
            latestDate = entryDate;
            continue;
          }

          if (entryDate != null &&
              (latestDate == null || entryDate.isAfter(latestDate))) {
            latestEntry = entry;
            latestDate = entryDate;
          }
        }

        if (latestEntry == null) {
          return {
            'value': 0.0,
            'date': 'N/A',
          };
        }

        return {
          'value': _toDouble(latestEntry['inr_value']),
          'date': formatDate(latestEntry['test_date']),
        };
      }
      return {
        'value': 0.0,
        'date': 'N/A',
      };
    } on DioException catch (e) {
      throw Exception('Error: ${e.message}');
    } catch (e) {
      throw Exception('Error: $e');
    }
  }

  // Get latest INR value
  static Future<double> getLatestINR() async {
    final latest = await getLatestINRData();
    final value = latest['value'];
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value) ?? 0.0;
    return 0.0;
  }

  // Helper function to format dates
  static String formatDate(dynamic date) {
    if (date == null) return 'N/A';
    if (date is String) {
      try {
        final dt = DateTime.parse(date);
        return '${dt.day.toString().padLeft(2, '0')}-${dt.month.toString().padLeft(2, '0')}-${dt.year}';
      } catch (e) {
        return date;
      }
    }
    return date.toString();
  }

  // Helper function to determine INR status
  static String _getINRStatus(dynamic value, double min, double max) {
    if (value == null) return 'Unknown';
    final inr = (value as num).toDouble();
    if (inr >= min && inr <= max) {
      return 'Normal';
    } else if (inr < min) {
      return 'Low';
    } else {
      return 'High';
    }
  }

  static double _toDouble(dynamic value) {
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value) ?? 0.0;
    return 0.0;
  }

  static DateTime? _parseDate(dynamic value) {
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

  // Update patient profile
  static Future<void> updateProfile({
    Map<String, dynamic>? demographics,
    List<Map<String, dynamic>>? medicalHistory,
    Map<String, dynamic>? medicalConfig,
  }) async {
    _setupInterceptors();
    try {
      final Map<String, dynamic> data = {};

      if (demographics != null) {
        data['demographics'] = demographics;
      }

      if (medicalHistory != null) {
        data['medical_history'] = medicalHistory;
      }

      if (medicalConfig != null) {
        data['medical_config'] = medicalConfig;
      }

      final response = await _dio.put(_endpoint('/profile'), data: data);

      if (response.statusCode != 200) {
        throw Exception('Failed to update profile');
      }
    } on DioException catch (e) {
      throw Exception('Error: ${e.message}');
    }
  }

  static Future<List<Map<String, dynamic>>> getDoctorUpdates({
    bool unreadOnly = false,
    int limit = 20,
  }) async {
    _setupInterceptors();
    try {
      final response = await _dio.get(_endpoint('/doctor-updates'), queryParameters: {
        'unread_only': unreadOnly.toString(),
        'limit': limit,
      });

      if (response.statusCode == 200) {
        final updates = response.data['data']['updates'] as List? ?? const [];
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
      return [];
    } on DioException catch (e) {
      throw Exception('Error loading doctor updates: ${e.message}');
    }
  }

  static Future<void> markDoctorUpdateAsRead(String eventId) async {
    _setupInterceptors();
    try {
      final response = await _dio.patch(_endpoint('/doctor-updates/$eventId/read'));
      if (response.statusCode != 200) {
        throw Exception('Failed to mark doctor update as read');
      }
    } on DioException catch (e) {
      throw Exception('Error updating doctor update status: ${e.message}');
    }
  }
}
