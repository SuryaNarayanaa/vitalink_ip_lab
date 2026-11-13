import 'package:frontend/core/config/app_properties.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:frontend/core/di/theme.dart';
import 'package:frontend/core/constants/layout.dart';

/// Read-only recording history, calculated using the server's clinical date.
class DoseHistoryCard extends StatefulWidget {
  final Map<String, dynamic>? history;
  const DoseHistoryCard({super.key, required this.history});

  @override
  State<DoseHistoryCard> createState() => _DoseHistoryCardState();
}

class _DoseHistoryCardState extends State<DoseHistoryCard> {
  DateTime? _month;
  int? _window;
  String? _selected;
  static const labels = {
    'taken': 'Taken',
    'not_recorded': 'Not recorded',
    'not_scheduled': 'Not scheduled',
    'pending': 'Today pending',
    'upcoming': 'Upcoming',
    'unknown': 'Schedule unknown',
  };

  Color _color(String state) => switch (state) {
    'taken' => AppColors.success,
    'not_recorded' => const Color(0xFF925000),
    'pending' => const Color(0xFF4F46A5),
    'upcoming' => const Color(0xFF526271),
    _ => const Color(0xFF646775),
  };

  IconData _icon(String state) => switch (state) {
    'taken' => Icons.check,
    'not_recorded' => Icons.remove,
    'pending' => Icons.schedule,
    'upcoming' => Icons.more_horiz,
    'unknown' => Icons.help_outline,
    _ => Icons.do_not_disturb_on_outlined,
  };

  @override
  Widget build(BuildContext context) {
    AppProperties.watch(context);
    final data = widget.history;
    final today = DateTime.tryParse(data?['today']?.toString() ?? '');
    if (today == null) {
      return Card(
        child: Padding(
          padding: EdgeInsets.all(20),
          child: Text(
            AppCopy.text(
              'text.dose_history_unavailable_refresh_the_patient_rec_b011c6fc',
            ),
          ),
        ),
      );
    }
    final days = (data?['days'] as List? ?? [])
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();
    final month = _month ?? DateTime(today.year, today.month);
    final start = _window == null
        ? month
        : today.subtract(Duration(days: _window! - 1));
    final end = _window == null
        ? DateTime(month.year, month.month + 1, 0)
        : today;
    final key = DateFormat('yyyy-MM-dd');
    final shown = days
        .where(
          (d) =>
              d['date'].toString().compareTo(key.format(start)) >= 0 &&
              d['date'].toString().compareTo(key.format(end)) <= 0,
        )
        .toList();
    final taken = shown
        .where(
          (d) =>
              d['state'] == 'taken' &&
              d['date'].toString().compareTo(key.format(today)) < 0,
        )
        .length;
    final gaps = shown.where((d) => d['state'] == 'not_recorded').length;
    final elapsed = taken + gaps;
    final minDay = days.isEmpty ? today : DateTime.parse(days.first['date']);
    final maxMonth = DateTime(today.year, today.month);
    final minMonth = DateTime(minDay.year, minDay.month);
    return Container(
      width: double.infinity,
      padding: PortalLayout.cardInsetsComfortable,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(PortalLayout.cardRadius),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: .05),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.calendar_month_outlined, color: AppColors.secondary),
              const SizedBox(width: 10),
              Text(
                AppCopy.text('text.dose_history_3df58db8'),
                style: Theme.of(
                  context,
                ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            AppCopy.text(
              'text.dose_recording_by_day_value1_2963fc16',
              arguments: {'value1': (data?['timezone']).toString()},
            ),
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final period in <int?>[null, 7, 14])
                ChoiceChip(
                  label: Text(
                    period == null
                        ? AppCopy.text('text.month_a8761ba5')
                        : AppCopy.text(
                            'text.last_value1_days_d2fb672a',
                            arguments: {'value1': (period).toString()},
                          ),
                  ),
                  selected: _window == period,
                  onSelected: (_) => setState(() {
                    _window = period;
                    _selected = null;
                  }),
                ),
            ],
          ),
          if (_window == null)
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                IconButton(
                  tooltip: AppCopy.text('text.previous_month_d6437b6'),
                  onPressed: month.isAfter(minMonth)
                      ? () => setState(() {
                          _month = DateTime(month.year, month.month - 1);
                          _selected = null;
                        })
                      : null,
                  icon: const Icon(Icons.chevron_left),
                ),
                Text(
                  DateFormat('MMMM yyyy').format(month),
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                IconButton(
                  tooltip: AppCopy.text('text.next_month_711101f6'),
                  onPressed: month.isBefore(maxMonth)
                      ? () => setState(() {
                          _month = DateTime(month.year, month.month + 1);
                          _selected = null;
                        })
                      : null,
                  icon: const Icon(Icons.chevron_right),
                ),
              ],
            ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 24,
            runSpacing: 12,
            children: [
              _count(context, '$taken', 'Taken', AppColors.success),
              _count(context, '$gaps', 'Not recorded', const Color(0xFF925000)),
              _count(
                context,
                '$elapsed',
                'Past scheduled days',
                const Color(0xFF374151),
              ),
            ],
          ),
          const SizedBox(height: 16),
          if (elapsed > 0)
            Semantics(
              label: AppCopy.text(
                'text.value1_taken_and_value2_not_recorded_2a342581',
                arguments: {
                  'value1': (taken).toString(),
                  'value2': (gaps).toString(),
                },
              ),
              child: Row(
                children: [
                  if (taken > 0)
                    Expanded(
                      flex: taken,
                      child: Container(height: 6, color: AppColors.success),
                    ),
                  if (gaps > 0)
                    Expanded(
                      flex: gaps,
                      child: Container(
                        height: 6,
                        color: const Color(0xFFE7AE55),
                      ),
                    ),
                ],
              ),
            ),
          const SizedBox(height: 20),
          LayoutBuilder(
            builder: (context, constraints) {
              final width = (constraints.maxWidth - 6 * 6) / 7;
              return Column(
                children: [
                  Row(
                    children: [
                      for (final day in ['M', 'T', 'W', 'T', 'F', 'S', 'S'])
                        Expanded(
                          child: Center(
                            child: Text(
                              day,
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      for (var i = 0; i < start.weekday - 1; i++)
                        SizedBox(width: width, height: 56),
                      for (final entry in shown)
                        SizedBox(
                          width: width,
                          height: 56,
                          child: Semantics(
                            selected: _selected == entry['date'],
                            button: true,
                            label:
                                "${(entry['date']).toString()}: ${(labels[entry['state']]).toString()}",
                            child: Tooltip(
                              message:
                                  "${(entry['date']).toString()} • ${(labels[entry['state']]).toString()}",
                              child: Material(
                                color: _color(
                                  entry['state'],
                                ).withValues(alpha: .09),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(8),
                                  side: _selected == entry['date']
                                      ? BorderSide(
                                          color: AppColors.secondary,
                                          width: 2,
                                        )
                                      : BorderSide.none,
                                ),
                                child: InkWell(
                                  borderRadius: BorderRadius.circular(8),
                                  onTap: () =>
                                      setState(() => _selected = entry['date']),
                                  child: Column(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      Text(
                                        '${DateTime.parse(entry['date']).day}',
                                        style: TextStyle(
                                          color: _color(entry['state']),
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                      Icon(
                                        _icon(entry['state']),
                                        size: 16,
                                        color: _color(entry['state']),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ],
              );
            },
          ),
          const SizedBox(height: 16),
          Wrap(
            spacing: 12,
            runSpacing: 8,
            children: [
              for (final state in labels.keys)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(_icon(state), size: 15, color: _color(state)),
                    const SizedBox(width: 4),
                    Text(
                      labels[state]!,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _count(
    BuildContext context,
    String value,
    String label,
    Color color,
  ) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        value,
        style: TextStyle(
          fontSize: 24,
          fontWeight: FontWeight.w700,
          color: color,
        ),
      ),
      Text(label, style: Theme.of(context).textTheme.bodySmall),
    ],
  );
}
