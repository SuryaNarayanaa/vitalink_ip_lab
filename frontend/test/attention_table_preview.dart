import 'package:flutter/material.dart';
import 'package:frontend/features/doctor/doctor_dashboard_page.dart';
import 'package:frontend/features/doctor/models/patient_model.dart';

// Synthetic patients only. Renders the production table without a backend.
const attentionPatients = [
  PatientModel(
    id: 'fixture-1',
    name: 'Test patient, four reasons',
    opNumber: 'DEMO01',
    attention: {
      'reasons': [
        'review_overdue',
        'inr_monitoring_gap',
        'dose_recording_gap',
        'review_unknown',
      ],
    },
  ),
  PatientModel(
    id: 'fixture-2',
    name: 'Next patient',
    opNumber: 'DEMO02',
    attention: {
      'reasons': ['dose_recording_gap'],
    },
  ),
  PatientModel(
    id: 'fixture-3',
    name: 'No outstanding work',
    opNumber: 'DEMO03',
  ),
];

void main() => runApp(const AttentionTablePreview());

class AttentionTablePreview extends StatelessWidget {
  const AttentionTablePreview({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    theme: ThemeData(useMaterial3: true),
    home: Scaffold(
      appBar: AppBar(
        title: const Text('Doctor patient table - synthetic verification data'),
      ),
      body: const SingleChildScrollView(
        padding: EdgeInsets.all(24),
        child: DoctorPatientTable(attentionPatients),
      ),
    ),
  );
}
