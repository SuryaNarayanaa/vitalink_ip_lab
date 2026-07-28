import 'package:flutter/material.dart';
import 'package:frontend/core/utils/inr_target_range.dart';
import 'package:frontend/core/widgets/doctor/report_action_modal.dart';
import 'package:intl/intl.dart';

/// Widget to display a single report with action buttons
class ReportCardWithActions extends StatelessWidget {
  final String opNumber;
  final Map<String, dynamic> report;
  final VoidCallback onRefresh;
  final bool isLoading;

  const ReportCardWithActions({
    super.key,
    required this.opNumber,
    required this.report,
    required this.onRefresh,
    this.isLoading = false,
  });

  String get _reportId => report['_id'] ?? report['id'] ?? '';
  double get _inrValue => (report['inr_value'] as num?)?.toDouble() ?? 0.0;
  bool get _isCritical => report['is_critical'] as bool? ?? false;

  /// Patient therapeutic band when provided by the caller; otherwise clinical default.
  InrTargetRange get _targets => InrTargetRange.resolve(report);
  double get _targetMin => _targets.min;
  double get _targetMax => _targets.max;

  DateTime? get _testDate {
    final date = report['test_date'];
    if (date is DateTime) return date;
    if (date is String) return DateTime.tryParse(date);
    return null;
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Colors.white,
            Colors.grey[50]!,
          ],
        ),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.grey[200]!),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        children: [
          // Header with INR value and date
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: _getGradientColors(_inrValue),
              ),
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(12),
                topRight: Radius.circular(12),
              ),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'INR Value',
                        style: Theme.of(context).textTheme.labelMedium?.copyWith(
                              color: Colors.white70,
                              fontWeight: FontWeight.w500,
                            ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _inrValue.toStringAsFixed(2),
                        style: const TextStyle(
                          fontSize: 36,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      _testDate != null
                          ? DateFormat('MMM dd').format(_testDate!)
                          : 'Date n/a',
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _testDate != null
                          ? DateFormat('yyyy').format(_testDate!)
                          : '—',
                      style: TextStyle(
                        fontSize: 12,
                        color: Colors.white.withValues(alpha: 0.8),
                      ),
                    ),
                    if (_isCritical) ...[
                      const SizedBox(height: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.red[400],
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: const Text(
                          'CRITICAL',
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                            color: Colors.white,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
          // Body with status and notes preview
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Status
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: _getStatusColor(_inrValue).withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Icon(
                        _getStatusIcon(_inrValue),
                        color: _getStatusColor(_inrValue),
                        size: 18,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      _getStatusText(_inrValue),
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            fontWeight: FontWeight.w600,
                            color: _getStatusColor(_inrValue),
                          ),
                    ),
                  ],
                ),
                // Notes preview if available
                if ((report['notes'] as String?)?.isNotEmpty ?? false) ...[
                  const SizedBox(height: 12),
                  Text(
                    'Notes',
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: Colors.grey[600],
                          fontWeight: FontWeight.w600,
                        ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    report['notes'],
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ],
            ),
          ),
          // Action buttons footer
          Container(
            decoration: BoxDecoration(
              border: Border(
                top: BorderSide(color: Colors.grey[200]!),
              ),
            ),
            child: Row(
              children: [
                Expanded(
                  child: _buildActionButton(
                    context,
                    label: 'View',
                    icon: Icons.visibility,
                    onPressed: isLoading
                        ? null
                        : () => _showViewModal(context),
                    color: const Color(0xFF6366F1),
                  ),
                ),
                Container(
                  width: 1,
                  height: 48,
                  color: Colors.grey[200],
                ),
                Expanded(
                  child: _buildActionButton(
                    context,
                    label: 'Update',
                    icon: Icons.edit,
                    onPressed: isLoading
                        ? null
                        : () => _showUpdateModal(context),
                    color: Colors.amber[600]!,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActionButton(
    BuildContext context, {
    required String label,
    required IconData icon,
    required VoidCallback? onPressed,
    required Color color,
  }) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onPressed,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                icon,
                color: onPressed == null ? Colors.grey[400] : color,
                size: 20,
              ),
              const SizedBox(height: 4),
              Text(
                label,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: onPressed == null ? Colors.grey[400] : color,
                      fontWeight: FontWeight.w600,
                    ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showViewModal(BuildContext context) {
    ReportActionModal.showAsBottomSheet(
      context,
      opNumber: opNumber,
      reportId: _reportId,
      initialAction: ReportAction.view,
      onClose: onRefresh,
    );
  }

  void _showUpdateModal(BuildContext context) {
    ReportActionModal.showAsBottomSheet(
      context,
      opNumber: opNumber,
      reportId: _reportId,
      initialAction: ReportAction.update,
      onClose: onRefresh,
    );
  }

  Color _getStatusColor(double inrValue) {
    if (_isCritical) return Colors.red;
    if (inrValue < _targetMin) return Colors.blue;
    if (inrValue > _targetMax) return Colors.red;
    return Colors.green;
  }

  IconData _getStatusIcon(double inrValue) {
    if (_isCritical) return Icons.warning_amber_rounded;
    if (inrValue < _targetMin) return Icons.arrow_downward;
    if (inrValue > _targetMax) return Icons.arrow_upward;
    return Icons.check_circle;
  }

  String _getStatusText(double inrValue) {
    if (_isCritical) return 'CRITICAL';
    if (inrValue < _targetMin) return 'LOW';
    if (inrValue > _targetMax) return 'HIGH';
    return 'NORMAL';
  }

  List<Color> _getGradientColors(double inrValue) {
    if (_isCritical || inrValue > _targetMax) {
      return [Colors.red[400]!, Colors.red[600]!];
    }
    if (inrValue < _targetMin) {
      return [Colors.blue[400]!, Colors.blue[600]!];
    }
    return [Colors.green[400]!, Colors.green[600]!];
  }
}

/// Widget to display a list of reports
class DoctorReportsListWidget extends StatelessWidget {
  final List<Map<String, dynamic>> reports;
  final String opNumber;
  final bool isLoading;
  final String? error;
  final VoidCallback onRefresh;
  final VoidCallback? onEmpty;

  const DoctorReportsListWidget({
    super.key,
    required this.reports,
    required this.opNumber,
    this.isLoading = false,
    this.error,
    required this.onRefresh,
    this.onEmpty,
  });

  @override
  Widget build(BuildContext context) {
    if (isLoading) {
      return const Center(
        child: CircularProgressIndicator(),
      );
    }

    if (error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.error_outline,
              size: 48,
              color: Colors.red[400],
            ),
            const SizedBox(height: 16),
            Text(
              'Error loading reports',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              error!,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Colors.grey[600],
                  ),
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: onRefresh,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      );
    }

    if (reports.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.inbox_outlined,
              size: 48,
              color: Colors.grey[400],
            ),
            const SizedBox(height: 16),
            Text(
              'No reports yet',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              'Reports will appear here once uploaded',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Colors.grey[600],
                  ),
            ),
            if (onEmpty != null) ...[
              const SizedBox(height: 24),
              ElevatedButton.icon(
                onPressed: onEmpty,
                icon: const Icon(Icons.add),
                label: const Text('Upload Report'),
              ),
            ],
          ],
        ),
      );
    }

    return ListView.separated(
      itemCount: reports.length,
      separatorBuilder: (_, _) => const SizedBox(height: 12),
      itemBuilder: (context, index) {
        final report = reports[index];
        return ReportCardWithActions(
          opNumber: opNumber,
          report: report,
          onRefresh: onRefresh,
          isLoading: isLoading,
        );
      },
    );
  }
}
