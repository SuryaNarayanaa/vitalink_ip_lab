class ReportModel {
  final String id;
  final DateTime testDate;
  final double inrValue;
  final String? notes;
  final bool isCritical;
  final String fileUrl;

  ReportModel({
    required this.id,
    required this.testDate,
    required this.inrValue,
    this.notes,
    required this.isCritical,
    required this.fileUrl,
  });

  factory ReportModel.fromJson(Map<String, dynamic> json) {
    final rawDate = json['test_date'];
    final DateTime testDate;
    if (rawDate is DateTime) {
      testDate = rawDate;
    } else if (rawDate is String) {
      final parsed = DateTime.tryParse(rawDate);
      if (parsed == null) {
        throw FormatException('Invalid test_date: $rawDate');
      }
      testDate = parsed;
    } else {
      throw FormatException('Missing or unsupported test_date');
    }

    return ReportModel(
      id: json['_id'] as String? ?? '',
      testDate: testDate,
      inrValue: (json['inr_value'] as num?)?.toDouble() ?? 0.0,
      notes: json['notes'] as String?,
      isCritical: json['is_critical'] as bool? ?? false,
      fileUrl: json['file_url'] as String? ?? '',
    );
  }

  Map<String, dynamic> toJson() {
    return {
      '_id': id,
      'test_date': testDate.toIso8601String(),
      'inr_value': inrValue,
      'notes': notes,
      'is_critical': isCritical,
      'file_url': fileUrl,
    };
  }
}
