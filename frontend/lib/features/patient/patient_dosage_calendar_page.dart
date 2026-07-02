import 'package:flutter/material.dart';
import 'package:frontend/core/widgets/index.dart';
import 'package:frontend/app/routers.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/query/patient_query_keys.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:intl/intl.dart';

class PatientDosageCalendarPage extends StatefulWidget {
  const PatientDosageCalendarPage({super.key});

  @override
  State<PatientDosageCalendarPage> createState() =>
      _PatientDosageCalendarPageState();
}

class _PatientDosageCalendarPageState extends State<PatientDosageCalendarPage> {
  static final Color _takenColor = Colors.green.shade500;
  static final Color _missedColor = Colors.red.shade400;
  static final Color _scheduledColor = Colors.blue.shade400;

  final int _currentNavIndex = 2;
  DateTime _currentMonth = DateTime.now();
  int _loadedMonths = 3;

  void _previousMonth() {
    setState(() {
      _currentMonth = DateTime(_currentMonth.year, _currentMonth.month - 1);
    });
  }

  void _nextMonth() {
    setState(() {
      _currentMonth = DateTime(_currentMonth.year, _currentMonth.month + 1);
    });
  }

  void _loadMoreData() {
    if (_loadedMonths < 12) {
      setState(() {
        _loadedMonths = (_loadedMonths + 3).clamp(1, 12);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return UseQuery<Map<String, dynamic>>(
      options: QueryOptions<Map<String, dynamic>>(
        queryKey: PatientQueryKeys.dosageCalendar(_loadedMonths),
        queryFn: () async {
          return await AppDependencies.patientRepository
              .getDosageCalendar(months: _loadedMonths);
        },
      ),
      builder: (context, query) {
        if (query.isLoading) {
          return PatientScaffold(
            pageTitle: 'Dosage Calendar',
            currentNavIndex: _currentNavIndex,
            onNavChanged: (index) => _handleNav(index),
            body: const Center(child: CircularProgressIndicator()),
          );
        }

        if (query.isError) {
          return PatientScaffold(
            pageTitle: 'Dosage Calendar',
            currentNavIndex: _currentNavIndex,
            onNavChanged: (index) => _handleNav(index),
            body: Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.error_outline,
                      size: 64, color: Colors.red.shade300),
                  const SizedBox(height: 16),
                  Text('Error: ${query.error}'),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: () => query.refetch(),
                    child: const Text('Retry'),
                  ),
                ],
              ),
            ),
          );
        }

        if (!query.hasData) {
          return PatientScaffold(
            pageTitle: 'Dosage Calendar',
            currentNavIndex: _currentNavIndex,
            onNavChanged: (index) => _handleNav(index),
            body: const Center(child: CircularProgressIndicator()),
          );
        }

        final data = query.data!;
        final calendarData = data['calendar_data'] as List<dynamic>;

        // Convert to map for quick lookup
        final dataMap = <String, Map<String, dynamic>>{};
        for (var entry in calendarData) {
          dataMap[entry['date'] as String] = entry as Map<String, dynamic>;
        }

        return PatientScaffold(
          pageTitle: 'Dosage Calendar',
          currentNavIndex: _currentNavIndex,
          onNavChanged: (index) => _handleNav(index),
          body: Column(
            children: [
              // Calendar view
              Expanded(
                child: _buildCalendarView(dataMap),
              ),
              // Legend at bottom
              _buildLegend(),
              const SizedBox(height: 8),
            ],
          ),
        );
      },
    );
  }

  Widget _buildCalendarView(Map<String, Map<String, dynamic>> dataMap) {
    return Container(
      margin: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 20,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        children: [
          // Month header with navigation
          _buildMonthHeader(),
          const Divider(height: 1),
          // Day labels
          _buildDayLabels(),
          // Calendar grid
          Expanded(
            child: _buildCalendarGrid(dataMap),
          ),
          // Load more button
          if (_loadedMonths < 12)
            Padding(
              padding: const EdgeInsets.all(12),
              child: TextButton.icon(
                onPressed: () {
                  _loadMoreData();
                },
                icon: const Icon(Icons.refresh, size: 18),
                label: Text('Load ${_loadedMonths < 9 ? '3' : 'more'} months'),
                style: TextButton.styleFrom(
                  foregroundColor: Colors.blue.shade700,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildMonthHeader() {
    final monthYear = DateFormat('MMMM yyyy').format(_currentMonth);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final isCompact = constraints.maxWidth < 360;

          return Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              IconButton(
                onPressed: _previousMonth,
                icon: const Icon(Icons.chevron_left),
                color: Colors.grey.shade700,
              ),
              Expanded(
                child: Text(
                  monthYear.toUpperCase(),
                  textAlign: TextAlign.center,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: isCompact ? 13 : 15,
                    fontWeight: FontWeight.w700,
                    color: Colors.grey.shade800,
                    letterSpacing: 0.5,
                  ),
                ),
              ),
              IconButton(
                onPressed: _nextMonth,
                icon: const Icon(Icons.chevron_right),
                color: Colors.grey.shade700,
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildDayLabels() {
    const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Row(
        children: days.map((day) {
          return Expanded(
            child: Center(
              child: Text(
                day,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: Colors.grey.shade600,
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildCalendarGrid(Map<String, Map<String, dynamic>> dataMap) {
    final daysInMonth =
        DateTime(_currentMonth.year, _currentMonth.month + 1, 0).day;
    final firstDayOfMonth =
        DateTime(_currentMonth.year, _currentMonth.month, 1);
    final startingWeekday = firstDayOfMonth.weekday % 7; // 0 = Sunday

    final totalCells = ((daysInMonth + startingWeekday) / 7).ceil() * 7;

    return GridView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 7,
        childAspectRatio: 1.0,
        crossAxisSpacing: 4,
        mainAxisSpacing: 4,
      ),
      itemCount: totalCells,
      itemBuilder: (context, index) {
        final dayNumber = index - startingWeekday + 1;

        if (dayNumber < 1 || dayNumber > daysInMonth) {
          return const SizedBox.shrink();
        }

        final date =
            DateTime(_currentMonth.year, _currentMonth.month, dayNumber);
        final dateStr = _formatDate(date);
        final dayData = dataMap[dateStr];

        return _buildDayCell(dayNumber, date, dayData);
      },
    );
  }

  String _formatDate(DateTime date) {
    final day = date.day.toString().padLeft(2, '0');
    final month = date.month.toString().padLeft(2, '0');
    final year = date.year.toString();
    return '$day-$month-$year';
  }

  Widget _buildDayCell(int day, DateTime date, Map<String, dynamic>? dayData) {
    final isToday = date.year == DateTime.now().year &&
        date.month == DateTime.now().month &&
        date.day == DateTime.now().day;

    Color? backgroundColor;
    Color? textColor;
    Color? borderColor;

    if (dayData != null) {
      final status = dayData['status'] as String;

      switch (status) {
        case 'taken':
          backgroundColor = _takenColor;
          textColor = Colors.white;
          borderColor = backgroundColor;
          break;
        case 'missed':
          backgroundColor = _missedColor;
          textColor = Colors.white;
          borderColor = backgroundColor;
          break;
        case 'scheduled':
          backgroundColor = _scheduledColor;
          textColor = Colors.white;
          borderColor = backgroundColor;
          break;
      }
    } else if (isToday) {
      borderColor = Colors.blue.shade600;
      textColor = Colors.blue.shade600;
    } else {
      textColor = Colors.grey.shade700;
    }

    return InkWell(
      onTap: dayData != null
          ? () => _showDateDetails(dayData, _formatDate(date))
          : null,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        decoration: BoxDecoration(
          color: backgroundColor,
          borderRadius: BorderRadius.circular(8),
          border: borderColor != null
              ? Border.all(color: borderColor, width: 2)
              : null,
        ),
        child: Center(
          child: Text(
            day.toString(),
            style: TextStyle(
              fontSize: 16,
              fontWeight: isToday ? FontWeight.w700 : FontWeight.w500,
              color: textColor,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildLegend() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.grey.shade50,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Wrap(
        alignment: WrapAlignment.center,
        spacing: 16,
        runSpacing: 10,
        children: [
          _buildLegendItem('Taken', _takenColor),
          _buildLegendItem('Missed', _missedColor),
          _buildLegendItem('Scheduled', _scheduledColor),
        ],
      ),
    );
  }

  Widget _buildLegendItem(String label, Color color) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 16,
          height: 16,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(4),
          ),
        ),
        const SizedBox(width: 6),
        Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w500,
            color: Colors.grey.shade700,
          ),
        ),
      ],
    );
  }

  void _showDateDetails(Map<String, dynamic> entry, String dateStr) {
    final status = entry['status'] as String;
    final dosage = entry['dosage'] as double;
    final dayOfWeek = entry['day_of_week'] as String;

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
        ),
        contentPadding: const EdgeInsets.all(24),
        title: Row(
          children: [
            Icon(
              Icons.medication_rounded,
              color: Colors.blue.shade700,
              size: 28,
            ),
            const SizedBox(width: 12),
            const Text(
              'Dose Details',
              style: TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildDetailRow('Date', dateStr, Icons.calendar_today),
            const SizedBox(height: 12),
            _buildDetailRow('Day', dayOfWeek.toUpperCase(), Icons.event),
            const SizedBox(height: 12),
            _buildDetailRow('Dosage', '${dosage.toStringAsFixed(1)} mg',
                Icons.local_pharmacy),
            const SizedBox(height: 12),
            _buildDetailRow(
                'Status', status.toUpperCase(), _getStatusIcon(status)),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: _getStatusColor(status).withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: _getStatusColor(status),
                  width: 2,
                ),
              ),
              child: Row(
                children: [
                  Icon(_getStatusIcon(status),
                      color: _getStatusColor(status), size: 20),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _getStatusMessage(status),
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: _getStatusColor(status),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text(
              'Close',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDetailRow(String label, String value, IconData icon) {
    return Row(
      children: [
        Icon(icon, size: 20, color: Colors.grey.shade600),
        const SizedBox(width: 12),
        Text(
          '$label: ',
          style: TextStyle(
            fontSize: 15,
            color: Colors.grey.shade700,
            fontWeight: FontWeight.w500,
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(
              fontSize: 15,
              color: Color(0xFF1A1A1A),
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    );
  }

  IconData _getStatusIcon(String status) {
    switch (status) {
      case 'taken':
        return Icons.check_circle;
      case 'missed':
        return Icons.cancel;
      case 'scheduled':
        return Icons.schedule;
      default:
        return Icons.help_outline;
    }
  }

  Color _getStatusColor(String status) {
    switch (status) {
      case 'taken':
        return _takenColor;
      case 'missed':
        return _missedColor;
      case 'scheduled':
        return _scheduledColor;
      default:
        return Colors.grey.shade600;
    }
  }

  String _getStatusMessage(String status) {
    switch (status) {
      case 'taken':
        return 'This dose was successfully taken';
      case 'missed':
        return 'This dose was not taken';
      case 'scheduled':
        return 'This dose is scheduled for the future';
      default:
        return 'Status unknown';
    }
  }

  void _handleNav(int index) {
    if (index == _currentNavIndex) return;
    switch (index) {
      case 0:
        Navigator.of(context).pushReplacementNamed(AppRoutes.patient);
        break;
      case 1:
        Navigator.of(context).pushReplacementNamed(AppRoutes.patientUpdateINR);
        break;
      case 2:
        Navigator.of(context).pushReplacementNamed(AppRoutes.patientTakeDosage);
        break;
      case 3:
        Navigator.of(context)
            .pushReplacementNamed(AppRoutes.patientHealthReports);
        break;
      case 4:
        Navigator.of(context).pushReplacementNamed(AppRoutes.patientProfile);
        break;
    }
  }
}
