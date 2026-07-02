import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:frontend/core/widgets/index.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/query/patient_query_keys.dart';
import 'package:frontend/app/routers.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';

class PatientPage extends StatefulWidget {
  final bool embedInShell;
  final ValueChanged<int>? onTabChanged;

  const PatientPage({
    super.key,
    this.embedInShell = false,
    this.onTabChanged,
  });

  @override
  State<PatientPage> createState() => _PatientPageState();
}

class _PatientPageState extends State<PatientPage> {
  final int _currentNavIndex = 0;

  @override
  Widget build(BuildContext context) {
    final bottomPadding = widget.embedInShell ? 20.0 : 28.0;

    return UseQuery<Map<String, dynamic>>(
      options: QueryOptions<Map<String, dynamic>>(
        queryKey: PatientQueryKeys.homeData(),
        queryFn: () async {
          final profile = await AppDependencies.patientRepository.getProfile();
          final history =
              await AppDependencies.patientRepository.getINRHistory();
          final prescriptions =
              await AppDependencies.patientRepository.getPrescriptions();
          final latestINRData =
              await AppDependencies.patientRepository.getLatestINRData();
          final missedDoses =
              await AppDependencies.patientRepository.getMissedDoses();

          return {
            'profile': profile,
            'history': history,
            'prescriptions': prescriptions,
            'latestINR': latestINRData['value'],
            'latestINRDate': latestINRData['date'],
            'latestINRIsCritical': latestINRData['isCritical'],
            'latestINRHasData': latestINRData['hasData'],
            'missedDoses': missedDoses,
          };
        },
      ),
      builder: (context, query) {
        if (query.isLoading) {
          return _buildPageContainer(
            body: const Center(child: CircularProgressIndicator()),
          );
        }

        if (query.isError) {
          return _buildPageContainer(
            body: Center(child: Text('Error: ${query.error}')),
          );
        }

        final data = query.data!;
        final profile = data['profile'] as Map<String, dynamic>;
        final latestINR = (data['latestINR'] as num?)?.toDouble() ?? 0.0;
        final latestINRDate = data['latestINRDate']?.toString() ?? 'N/A';
        final history = data['history'] as List;
        final latestInrHasData = data['latestINRHasData'] == true;
        final patientCondition = latestInrHasData
            ? ((data['latestINRIsCritical'] == true)
                ? 'Critical'
                : 'Not Critical')
            : 'Not Available';
        final patientConditionColor = patientCondition == 'Critical'
            ? const Color(0xFFB91C1C)
            : patientCondition == 'Not Critical'
                ? const Color(0xFF166534)
                : const Color(0xFF374151);
        final patientConditionBg = patientCondition == 'Critical'
            ? const Color(0xFFFEE2E2)
            : patientCondition == 'Not Critical'
                ? const Color(0xFFDCFCE7)
                : const Color(0xFFF3F4F6);

        return _buildPageContainer(
          bodyDecoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color(0xFFC0C9FA), Color(0xFFFDC5DF)],
            ),
          ),
          body: RefreshIndicator(
            onRefresh: () async => query.refetch(),
            child: SingleChildScrollView(
              padding: EdgeInsets.fromLTRB(16, 20, 16, bottomPadding),
              physics: const AlwaysScrollableScrollPhysics(),
              child: Column(
                children: [
                  // 1. Unified Profile Info Card
                  _buildSectionCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          (profile['name'] ?? 'Guest Patient').toUpperCase(),
                          style: const TextStyle(
                            fontSize: 28,
                            fontWeight: FontWeight.w900,
                            color: Color(0xFF2D3748),
                            letterSpacing: 2.0,
                          ),
                        ),
                        const SizedBox(height: 4),
                        if ((profile['opNumber']
                                ?.toString()
                                .trim()
                                .isNotEmpty ??
                            false))
                          Container(
                            margin: const EdgeInsets.only(bottom: 8),
                            padding: const EdgeInsets.symmetric(
                                horizontal: 12, vertical: 5),
                            decoration: BoxDecoration(
                              color: const Color(0xFFEEF2FF),
                              borderRadius: BorderRadius.circular(999),
                              border: Border.all(
                                  color: const Color(0xFFC7D2FE), width: 1),
                            ),
                            child: Text(
                              'OP #${profile['opNumber']}',
                              style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                color: Color(0xFF4338CA),
                                letterSpacing: 0.2,
                              ),
                            ),
                          ),
                        Text(
                          '(Age: ${profile['age']}, Gender: ${profile['gender']})',
                          style: TextStyle(
                            fontSize: 16,
                            color: Colors.grey[700],
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 12, vertical: 6),
                          decoration: BoxDecoration(
                            color: patientConditionBg,
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            'Condition: $patientCondition',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: patientConditionColor,
                              letterSpacing: 0.2,
                            ),
                          ),
                        ),
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 20),
                          child: Divider(height: 1, color: Color(0xFFE2E8F0)),
                        ),
                        _buildRowItem(
                          label: 'Target INR',
                          value: profile['targetINR'] ?? '2.0 - 3.0',
                          valueStyle: const TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.w900,
                            color: Color(0xFF1A365D),
                          ),
                        ),
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 20),
                          child: Divider(height: 1, color: Color(0xFFE2E8F0)),
                        ),
                        _buildRowItem(
                          label: 'Next Review Date',
                          value: profile['nextReviewDate'] ?? 'N/A',
                          valueStyle: const TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                            color: Color(0xFF2D3748),
                          ),
                        ),
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 20),
                          child: Divider(height: 1, color: Color(0xFFE2E8F0)),
                        ),
                        LayoutBuilder(
                          builder: (context, constraints) {
                            final isCompact = constraints.maxWidth < 340;

                            return isCompact
                                ? Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      const Text(
                                        'LATEST INR',
                                        style: TextStyle(
                                          fontSize: 16,
                                          fontWeight: FontWeight.w900,
                                          color: Color(0xFF718096),
                                          letterSpacing: 1.0,
                                        ),
                                      ),
                                      const SizedBox(height: 8),
                                      Text(
                                        latestINR.toStringAsFixed(1),
                                        style: const TextStyle(
                                          fontSize: 24,
                                          fontWeight: FontWeight.w900,
                                          color: Color(0xFF6366F1),
                                        ),
                                      ),
                                      Text(
                                        latestINRDate,
                                        style: const TextStyle(
                                          fontSize: 11,
                                          fontWeight: FontWeight.bold,
                                          color: Colors.grey,
                                        ),
                                      ),
                                    ],
                                  )
                                : Row(
                                    mainAxisAlignment:
                                        MainAxisAlignment.spaceBetween,
                                    children: [
                                      const Text(
                                        'LATEST INR',
                                        style: TextStyle(
                                          fontSize: 16,
                                          fontWeight: FontWeight.w900,
                                          color: Color(0xFF718096),
                                          letterSpacing: 1.0,
                                        ),
                                      ),
                                      Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.end,
                                        children: [
                                          Text(
                                            latestINR.toStringAsFixed(1),
                                            style: const TextStyle(
                                              fontSize: 24,
                                              fontWeight: FontWeight.w900,
                                              color: Color(0xFF6366F1),
                                            ),
                                          ),
                                          Text(
                                            latestINRDate,
                                            style: const TextStyle(
                                              fontSize: 11,
                                              fontWeight: FontWeight.bold,
                                              color: Colors.grey,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                  );
                          },
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 17),

                  // 2. Instructions (Kept Separate as per request)
                  if (profile['instructions'] is List &&
                      (profile['instructions'] as List).isNotEmpty)
                    ...List.generate(
                      (profile['instructions'] as List).length,
                      (index) {
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 17),
                          child: _buildSectionCard(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  mainAxisAlignment:
                                      MainAxisAlignment.spaceBetween,
                                  children: [
                                    const Text(
                                      'Instruction',
                                      style: TextStyle(
                                        fontSize: 14,
                                        fontWeight: FontWeight.w800,
                                        color: Colors.grey,
                                      ),
                                    ),
                                    Text(
                                      profile['therapyStartDate'] ?? '',
                                      style: const TextStyle(
                                          fontSize: 12, color: Colors.grey),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  profile['instructions'][index]?.toString() ??
                                      '',
                                  style: const TextStyle(
                                    fontSize: 17,
                                    fontWeight: FontWeight.w800,
                                    color: Color(0xFF2D3748),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    )
                  else
                    Padding(
                      padding: const EdgeInsets.only(bottom: 17),
                      child: _buildSectionCard(
                        child: const Text(
                          'No special instructions recorded.',
                          style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w600,
                              color: Colors.grey),
                        ),
                      ),
                    ),

                  // 3. Therapy Details Card
                  _buildSectionCard(
                    child: _buildSummaryTable([
                      {
                        'label': 'Assigned Doctor',
                        'value': profile['doctorName'] ?? 'Unassigned'
                      },
                      {'label': 'Relief Doctor', 'value': 'N/A'},
                      {
                        'label': 'Primary Caregiver',
                        'value': profile['caregiver'] ?? 'N/A'
                      },
                      {
                        'label': 'Assigned Therapy',
                        'value': profile['therapyDrug'] ?? 'Heparin'
                      },
                    ]),
                  ),
                  const SizedBox(height: 17),

                  // 4. Medical History (Dynamic Chart) Card
                  _buildSectionCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'INR History Trend',
                          style: TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                            color: Color(0xFF2D3748),
                          ),
                        ),
                        const SizedBox(height: 24),
                        _buildINRChart(history.cast<Map<String, dynamic>>()),
                      ],
                    ),
                  ),
                  const SizedBox(height: 17),

                  // 8. Prescription Grid Card
                  _buildSectionCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Current Prescription',
                          style: TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                            color: Color(0xFF2D3748),
                          ),
                        ),
                        const SizedBox(height: 18),
                        _buildPrescriptionTable(profile['weeklyDosage'] ?? {}),
                      ],
                    ),
                  ),
                  const SizedBox(height: 17),

                  // 9. Monitoring & Side Effects Card
                  _buildSectionCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Monitoring Logs',
                          style: TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                            color: Color(0xFF2D3748),
                          ),
                        ),
                        const SizedBox(height: 20),
                        _buildHealthNote('Side Effects',
                            profile['sideEffects'] ?? 'None Reported'),
                        _buildHealthNote('Lifestyle',
                            profile['lifestyleChanges'] ?? 'Stable'),
                        _buildHealthNote(
                            'Other Meds', profile['otherMedication'] ?? 'None'),
                        _buildHealthNote(
                            'Illness', profile['prolongedIllness'] ?? 'None'),
                      ],
                    ),
                  ),
                  const SizedBox(height: 17),

                  // 10. Emergency Contact Card
                  _buildSectionCard(
                    child: _buildSummaryTable([
                      {
                        'label': 'Patient Phone',
                        'value': profile['phone'] ?? '+917448757584'
                      },
                      {
                        'label': 'Emergency Kin',
                        'value': profile['kinName'] ?? 'N/A'
                      },
                      {
                        'label': 'Kin Contact',
                        'value': profile['kinPhone'] ?? 'N/A'
                      },
                    ]),
                  ),
                  const SizedBox(height: 17),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildPageContainer({
    required Widget body,
    Decoration? bodyDecoration,
  }) {
    if (widget.embedInShell) {
      return body;
    }

    return PatientScaffold(
      pageTitle: 'Dashboard',
      currentNavIndex: _currentNavIndex,
      onNavChanged: _handleNav,
      bodyDecoration: bodyDecoration,
      body: body,
    );
  }

  Widget _buildSectionCard({required Widget child}) {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.96),
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      padding: const EdgeInsets.all(22),
      child: child,
    );
  }

  Widget _buildINRChart(List<Map<String, dynamic>> history) {
    if (history.isEmpty) {
      return Container(
        height: 160,
        alignment: Alignment.center,
        child: const Text('Historical data pending...',
            style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
      );
    }

    final spots = history.asMap().entries.map((e) {
      return FlSpot(e.key.toDouble(), (e.value['inr'] as num).toDouble());
    }).toList();

    return SizedBox(
      height: 220,
      child: LineChart(
        LineChartData(
          gridData: FlGridData(
            show: true,
            getDrawingHorizontalLine: (value) =>
                FlLine(color: const Color(0xFFEDF2F7), strokeWidth: 1),
            drawVerticalLine: false,
          ),
          titlesData: FlTitlesData(
            show: true,
            bottomTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: 32,
                getTitlesWidget: (val, meta) {
                  if (val.toInt() >= 0 && val.toInt() < history.length) {
                    final date = history[val.toInt()]['date'] as String;
                    return Padding(
                      padding: const EdgeInsets.only(top: 8.0),
                      child: Text(
                        date.split('-')[0],
                        style: const TextStyle(
                            fontSize: 11,
                            color: Color(0xFF718096),
                            fontWeight: FontWeight.w900),
                      ),
                    );
                  }
                  return const SizedBox();
                },
              ),
            ),
            leftTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: 40,
                getTitlesWidget: (val, meta) => Text(
                  val.toStringAsFixed(1),
                  style: const TextStyle(
                      fontSize: 11,
                      color: Color(0xFF718096),
                      fontWeight: FontWeight.w900),
                ),
              ),
            ),
            topTitles:
                const AxisTitles(sideTitles: SideTitles(showTitles: false)),
            rightTitles:
                const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          ),
          borderData: FlBorderData(show: false),
          lineBarsData: [
            LineChartBarData(
              spots: spots,
              isCurved: true,
              color: const Color(0xFF6366F1),
              barWidth: 5,
              dotData: FlDotData(
                show: true,
                getDotPainter: (spot, percent, barData, index) =>
                    FlDotCirclePainter(
                  radius: 6,
                  color: Colors.white,
                  strokeWidth: 4,
                  strokeColor: const Color(0xFF6366F1),
                ),
              ),
              belowBarData: BarAreaData(
                show: true,
                gradient: LinearGradient(
                  colors: [
                    const Color(0xFF6366F1).withValues(alpha: 0.3),
                    const Color(0xFF6366F1).withValues(alpha: 0.0)
                  ],
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildRowItem(
      {required String label, required String value, TextStyle? valueStyle}) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isCompact = constraints.maxWidth < 340;

        return isCompact
            ? Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label.toUpperCase(),
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w900,
                      color: Color(0xFF718096),
                      letterSpacing: 1.0,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    value,
                    style: valueStyle ??
                        const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w900,
                          color: Color(0xFF2D3748),
                        ),
                  ),
                ],
              )
            : Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    label.toUpperCase(),
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w900,
                      color: Color(0xFF718096),
                      letterSpacing: 1.0,
                    ),
                  ),
                  Flexible(
                    child: Text(
                      value,
                      textAlign: TextAlign.right,
                      style: valueStyle ??
                          const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w900,
                            color: Color(0xFF2D3748),
                          ),
                    ),
                  ),
                ],
              );
      },
    );
  }

  Widget _buildSummaryTable(List<Map<String, String>> items) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: const Color(0xFFE2E8F0), width: 1.5),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        children: items.map((item) {
          final isLast = item == items.last;
          return Container(
            decoration: BoxDecoration(
              border: Border(
                  bottom: isLast
                      ? BorderSide.none
                      : const BorderSide(color: Color(0xFFE2E8F0), width: 1.5)),
            ),
            child: LayoutBuilder(
              builder: (context, constraints) {
                final isCompact = constraints.maxWidth < 340;

                return isCompact
                    ? Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.symmetric(
                                vertical: 12, horizontal: 16),
                            decoration: const BoxDecoration(
                              color: Color(0xFFF8FAFC),
                              border: Border(
                                bottom: BorderSide(
                                  color: Color(0xFFE2E8F0),
                                  width: 1.5,
                                ),
                              ),
                            ),
                            child: Text(
                              item['label']!.toUpperCase(),
                              style: const TextStyle(
                                fontWeight: FontWeight.w900,
                                fontSize: 12,
                                color: Color(0xFF64748B),
                                letterSpacing: 0.8,
                              ),
                            ),
                          ),
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.symmetric(
                                vertical: 16, horizontal: 16),
                            child: Text(
                              item['value']!,
                              style: const TextStyle(
                                fontWeight: FontWeight.w900,
                                fontSize: 14,
                                color: Color(0xFF1E293B),
                              ),
                            ),
                          ),
                        ],
                      )
                    : Row(
                        children: [
                          Expanded(
                            flex: 4,
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                  vertical: 16, horizontal: 16),
                              decoration: const BoxDecoration(
                                color: Color(0xFFF8FAFC),
                                border: Border(
                                  right: BorderSide(
                                    color: Color(0xFFE2E8F0),
                                    width: 1.5,
                                  ),
                                ),
                              ),
                              child: Text(
                                item['label']!.toUpperCase(),
                                style: const TextStyle(
                                  fontWeight: FontWeight.w900,
                                  fontSize: 12,
                                  color: Color(0xFF64748B),
                                  letterSpacing: 0.8,
                                ),
                              ),
                            ),
                          ),
                          Expanded(
                            flex: 6,
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                  vertical: 16, horizontal: 16),
                              child: Text(
                                item['value']!,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w900,
                                  fontSize: 14,
                                  color: Color(0xFF1E293B),
                                ),
                              ),
                            ),
                          ),
                        ],
                      );
              },
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildPrescriptionTable(Map<String, dynamic> dosage) {
    final days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    final dayKeys = [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday'
    ];
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: const Color(0xFFE2E8F0), width: 1.5),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        children: [
          Container(
            decoration: const BoxDecoration(
              color: Color(0xFFF1F5F9),
              border: Border(
                  bottom: BorderSide(color: Color(0xFFE2E8F0), width: 1.5)),
            ),
            child: Row(
              children: [
                Expanded(
                  flex: 4,
                  child: Container(
                    padding: const EdgeInsets.all(16),
                    decoration: const BoxDecoration(
                        border: Border(
                            right: BorderSide(
                                color: Color(0xFFE2E8F0), width: 1.5))),
                    child: const Text('DAY',
                        style: TextStyle(
                            fontWeight: FontWeight.w900,
                            fontSize: 12,
                            color: Color(0xFF475569))),
                  ),
                ),
                Expanded(
                  flex: 6,
                  child: Container(
                    padding: const EdgeInsets.all(16),
                    child: const Text('DOSE (MG)',
                        style: TextStyle(
                            fontWeight: FontWeight.w900,
                            fontSize: 12,
                            color: Color(0xFF475569))),
                  ),
                ),
              ],
            ),
          ),
          ...List.generate(days.length, (index) {
            final day = days[index];
            final dayKey = dayKeys[index];
            final isLast = day == 'SUN';
            final doseValue = dosage[dayKey];
            final dose = (doseValue is num)
                ? doseValue
                : (doseValue is String ? double.tryParse(doseValue) ?? 0 : 0);
            return Container(
              decoration: BoxDecoration(
                border: Border(
                    bottom: isLast
                        ? BorderSide.none
                        : const BorderSide(
                            color: Color(0xFFE2E8F0), width: 1.5)),
              ),
              child: Row(
                children: [
                  Expanded(
                    flex: 4,
                    child: Container(
                      padding: const EdgeInsets.all(16),
                      decoration: const BoxDecoration(
                          border: Border(
                              right: BorderSide(
                                  color: Color(0xFFE2E8F0), width: 1.5))),
                      child: Text(day,
                          style: const TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 14,
                              color: Color(0xFF1E293B))),
                    ),
                  ),
                  Expanded(
                    flex: 6,
                    child: Container(
                      padding: const EdgeInsets.all(16),
                      child: Text(dose.toString(),
                          style: const TextStyle(
                              fontWeight: FontWeight.w900,
                              fontSize: 16,
                              color: Color(0xFF4F46E5))),
                    ),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildHealthNote(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final isCompact = constraints.maxWidth < 340;

          return isCompact
              ? Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label.toUpperCase(),
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w900,
                        color: Color(0xFF94A3B8),
                        letterSpacing: 1.0,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      value,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                        color: Color(0xFF334155),
                      ),
                    ),
                  ],
                )
              : Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      flex: 5,
                      child: Text(
                        label.toUpperCase(),
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w900,
                          color: Color(0xFF94A3B8),
                          letterSpacing: 1.0,
                        ),
                      ),
                    ),
                    Expanded(
                      flex: 5,
                      child: Text(
                        value,
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w800,
                          color: Color(0xFF334155),
                        ),
                      ),
                    ),
                  ],
                );
        },
      ),
    );
  }

  void _handleNav(int index) {
    if (index == _currentNavIndex) return;
    if (widget.embedInShell) {
      widget.onTabChanged?.call(index);
      return;
    }

    switch (index) {
      case 0:
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
