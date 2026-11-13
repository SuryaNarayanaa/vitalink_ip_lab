import 'package:frontend/core/config/app_properties.dart';
import 'package:flutter/material.dart';
import 'package:frontend/core/di/theme.dart';
import 'package:frontend/features/doctor/models/patient_model.dart';

class PatientAttentionSummary extends StatelessWidget {
  final PatientModel patient;
  final bool stacked;
  const PatientAttentionSummary({
    super.key,
    required this.patient,
    this.stacked = false,
  });

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    final reasons = patient.attentionReasons;
    final chips = <Widget>[
      if (reasons.isEmpty)
        Chip(
          label: Text(
            AppCopy.text('text.no_attention_needed_9e16aee9'),
            style: TextStyle(fontSize: 12),
          ),
        ),
      for (final reason in reasons)
        Chip(
          visualDensity: VisualDensity.compact,
          avatar: Icon(
            Icons.assignment_outlined,
            size: 16,
            color: AppColors.secondary,
          ),
          label: Text(
            PatientModel.reasonLabels[reason] ?? reason,
            style: const TextStyle(fontSize: 12),
          ),
        ),
    ];
    if (stacked) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (var i = 0; i < chips.length; i++) ...[
              if (i > 0) const SizedBox(height: 6),
              chips[i],
            ],
          ],
        ),
      );
    }
    return Wrap(spacing: 6, runSpacing: 6, children: chips);
  }
}
