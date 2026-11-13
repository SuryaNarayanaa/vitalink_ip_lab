import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:intl/intl.dart';
import 'package:frontend/core/config/app_properties.dart';

/// Calendar-month windows; plots individual results without averaging them.
class InrHistoryTrend extends StatefulWidget {
  const InrHistoryTrend({super.key, required this.history, this.today});
  final List<Map<String, dynamic>> history;
  final DateTime? today;
  @override
  State<InrHistoryTrend> createState() => _InrHistoryTrendState();
}

class _InrHistoryTrendState extends State<InrHistoryTrend> {
  int _months = 1;

  DateTime? _date(dynamic value) {
    final text = value?.toString() ?? '';
    final iso = RegExp(r'^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$').firstMatch(text);
    final display = RegExp(r'^(\d{2})-(\d{2})-(\d{4})$').firstMatch(text);
    if (iso == null && display == null) return null;
    final year = int.parse(iso?[1] ?? display![3]!);
    final month = int.parse(iso?[2] ?? display![2]!);
    final day = int.parse(iso?[3] ?? display![1]!);
    final date = DateTime.utc(year, month, day);
    return date.year == year && date.month == month && date.day == day
        ? date
        : null;
  }

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    final now = widget.today ?? DateTime.now();
    final end = DateTime.utc(now.year, now.month, now.day);
    final start = DateTime.utc(end.year, end.month - _months + 1);
    final points = <({DateTime date, double value})>[];
    for (final entry in widget.history) {
      final date = _date(entry['test_date'] ?? entry['date']);
      final value = double.tryParse('${entry['inr']}');
      if (date == null ||
          value == null ||
          !value.isFinite ||
          value < 0 ||
          date.isBefore(start) ||
          date.isAfter(end)) {
        continue;
      }
      points.add((date: date, value: value));
    }
    points.sort((a, b) => a.date.compareTo(b.date));
    final span = math.max(1, end.difference(start).inDays).toDouble();
    final spots = [
      for (final p in points)
        FlSpot(p.date.difference(start).inDays.toDouble(), p.value),
    ];
    final color = Theme.of(context).colorScheme.primary;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          AppCopy.text('text.inr_history_trend_463154f3'),
          style: Theme.of(
            context,
          ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 16),
        DropdownButtonFormField<int>(
          initialValue: _months,
          isExpanded: true,
          decoration: InputDecoration(
            labelText: AppCopy.text('text.inr_trend_period'),
            border: const OutlineInputBorder(),
          ),
          items: [
            DropdownMenuItem(
              value: 1,
              child: Text(AppCopy.text('text.inr_trend_this_month')),
            ),
            DropdownMenuItem(
              value: 6,
              child: Text(AppCopy.text('text.inr_trend_six_months')),
            ),
            DropdownMenuItem(
              value: 12,
              child: Text(AppCopy.text('text.inr_trend_year')),
            ),
          ],
          onChanged: (value) {
            if (value != null) setState(() => _months = value);
          },
        ),
        const SizedBox(height: 12),
        Text(
          AppCopy.text(
            'text.inr_trend_range',
            arguments: {
              'start': DateFormat('d MMM yyyy').format(start),
              'end': DateFormat('d MMM yyyy').format(end),
              'count': '${points.length}',
            },
          ),
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 20),
        if (points.isEmpty)
          SizedBox(
            height: 180,
            child: Center(child: Text(AppCopy.text('text.inr_trend_empty'))),
          )
        else
          LayoutBuilder(
            builder: (context, constraints) {
              final interval = math
                  .max(1, (span / (constraints.maxWidth < 500 ? 3 : 5)).ceil())
                  .toDouble();
              return SizedBox(
                height: 240,
                child: LineChart(
                  LineChartData(
                    minX: 0,
                    maxX: span,
                    minY: 0,
                    maxY: math
                        .max(5, points.map((p) => p.value).reduce(math.max) + 1)
                        .toDouble(),
                    gridData: FlGridData(show: true, drawVerticalLine: false),
                    borderData: FlBorderData(show: false),
                    titlesData: FlTitlesData(
                      topTitles: const AxisTitles(
                        sideTitles: SideTitles(showTitles: false),
                      ),
                      rightTitles: const AxisTitles(
                        sideTitles: SideTitles(showTitles: false),
                      ),
                      leftTitles: AxisTitles(
                        sideTitles: SideTitles(
                          showTitles: true,
                          reservedSize: 34,
                          getTitlesWidget: (value, meta) => Text(
                            value.toStringAsFixed(1),
                            style: const TextStyle(fontSize: 10),
                          ),
                        ),
                      ),
                      bottomTitles: AxisTitles(
                        sideTitles: SideTitles(
                          showTitles: true,
                          interval: interval,
                          reservedSize: 44,
                          getTitlesWidget: (value, meta) => Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Text(
                              DateFormat(
                                _months == 1 ? 'd MMM' : 'd MMM\nyy',
                              ).format(
                                start.add(Duration(days: value.round())),
                              ),
                              textAlign: TextAlign.center,
                              style: const TextStyle(fontSize: 10),
                            ),
                          ),
                        ),
                      ),
                    ),
                    lineTouchData: LineTouchData(
                      touchTooltipData: LineTouchTooltipData(
                        getTooltipItems: (touched) => touched
                            .map(
                              (spot) => LineTooltipItem(
                                '${DateFormat('d MMM yyyy').format(points[spot.spotIndex].date)}\nINR ${spot.y}',
                                const TextStyle(color: Colors.white),
                              ),
                            )
                            .toList(),
                      ),
                    ),
                    lineBarsData: [
                      LineChartBarData(
                        spots: spots,
                        isCurved: false,
                        color: color,
                        barWidth: 3,
                        dotData: const FlDotData(show: true),
                        belowBarData: BarAreaData(
                          show: true,
                          color: color.withValues(alpha: 0.1),
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
      ],
    );
  }
}
