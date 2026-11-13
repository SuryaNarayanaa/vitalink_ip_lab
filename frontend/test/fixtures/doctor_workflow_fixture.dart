import 'package:flutter/material.dart';
import 'package:frontend/services/realtime/doctor_update_realtime_service.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/features/doctor/data/doctor_repository.dart';
import 'package:frontend/features/doctor/models/patient_model.dart';
import '../attention_table_preview.dart';

class FixtureDoctorRepository extends DoctorRepository {
  FixtureDoctorRepository() : super(apiClient: ApiClient());
  String? requestedOp;
  @override
  Future<int> getNotificationsUnreadCount() async => 0;
  @override
  Future<List<PatientModel>> getPatients() async => attentionPatients;
  @override
  Future<List<dynamic>> getPatientReports(
    String opNumber, {
    bool includeUrls = false,
  }) async {
    requestedOp = opNumber;
    return [
      {
        '_id': 'fixture-report',
        'inr_value': 2.7,
        'test_date': '2026-11-12',
        'uploaded_at': '2026-11-12',
        'review_status': 'pending',
      },
    ];
  }
}

class FixtureRealtime extends DoctorUpdateRealtimeService {
  @override
  Future<void> start({
    required VoidCallback onDoctorUpdate,
    void Function(Map<String, dynamic>)? onNotification,
  }) async {}
  @override
  Future<void> stop() async {}
}
