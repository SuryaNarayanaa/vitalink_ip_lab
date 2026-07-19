import 'package:flutter/material.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/widgets/index.dart';

/// Example page showing how to integrate the report widgets
/// This demonstrates the complete workflow for viewing and updating reports
class DoctorPatientReportsPage extends StatefulWidget {
  final String patientOpNumber;
  final String patientName;

  const DoctorPatientReportsPage({
    super.key,
    required this.patientOpNumber,
    required this.patientName,
  });

  @override
  State<DoctorPatientReportsPage> createState() =>
      _DoctorPatientReportsPageState();
}

class _DoctorPatientReportsPageState extends State<DoctorPatientReportsPage> {
  @override
  Widget build(BuildContext context) {
    return DoctorScaffold(
      pageTitle: 'Patient Reports - ${widget.patientName}',
      currentNavIndex: 0,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header Section
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: PortalLayout.pageGutter,
              vertical: PortalLayout.itemGap,
            ),
            color: Colors.white,
            child: Row(
              children: [
                IconButton(
                  icon: const Icon(Icons.arrow_back),
                  onPressed: () => Navigator.pop(context),
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'INR Reports',
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                              fontWeight: FontWeight.bold,
                            ),
                      ),
                      PortalLayout.metaSpacer,
                      Text(
                        'OP: ${widget.patientOpNumber}',
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: Colors.grey[600],
                            ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.refresh),
                  onPressed: () => setState(() {}),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          // Reports List
          Expanded(
            child: FutureBuilder<List<Map<String, dynamic>>>(
              future: AppDependencies.doctorRepository
                  .getPatientReports(
                    widget.patientOpNumber,
                    includeUrls: true,
                  )
                  .then((reports) {
                return List<Map<String, dynamic>>.from(
                  reports.map((r) {
                    if (r is Map<String, dynamic>) return r;
                    return Map<String, dynamic>.from(r as Map);
                  }),
                );
              }),
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }

                if (snapshot.hasError) {
                  return Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.error_outline,
                          size: 48,
                          color: Colors.red[400],
                        ),
                        PortalLayout.sectionSpacerTight,
                        Text(
                          'Error loading reports',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        PortalLayout.sectionSpacer,
                        ElevatedButton.icon(
                          onPressed: () => setState(() {}),
                          icon: const Icon(Icons.refresh),
                          label: const Text('Retry'),
                        ),
                      ],
                    ),
                  );
                }

                final reports = snapshot.data ?? [];

                return RefreshIndicator(
                  onRefresh: () async {
                    setState(() {});
                    await Future.delayed(const Duration(milliseconds: 500));
                  },
                  child: DoctorReportsListWidget(
                    reports: reports,
                    opNumber: widget.patientOpNumber,
                    isLoading: false,
                    onRefresh: () => setState(() {}),
                  ),
                );
              },
            ),
          ),
        ],
      ),
      onNavChanged: (index) {
        // Handle navigation if needed
      },
    );
  }
}

/// Alternative implementation using StreamBuilder pattern
/// if you prefer more control over the data flow
class DoctorPatientReportsPageAlt extends StatefulWidget {
  final String patientOpNumber;
  final String patientName;

  const DoctorPatientReportsPageAlt({
    super.key,
    required this.patientOpNumber,
    required this.patientName,
  });

  @override
  State<DoctorPatientReportsPageAlt> createState() =>
      _DoctorPatientReportsPageAltState();
}

class _DoctorPatientReportsPageAltState
    extends State<DoctorPatientReportsPageAlt> {
  late Future<List<Map<String, dynamic>>> _reportsFuture;
  bool _isRefreshing = false;

  @override
  void initState() {
    super.initState();
    _reportsFuture = _loadReports();
  }

  Future<List<Map<String, dynamic>>> _loadReports() async {
    final reports = await AppDependencies.doctorRepository.getPatientReports(
      widget.patientOpNumber,
      includeUrls: true,
    );
    return List<Map<String, dynamic>>.from(
      reports.map((r) {
        if (r is Map<String, dynamic>) return r;
        return Map<String, dynamic>.from(r as Map);
      }),
    );
  }

  Future<void> _refreshReports() async {
    setState(() => _isRefreshing = true);
    try {
      _reportsFuture = _loadReports();
      await _reportsFuture;
    } finally {
      if (mounted) {
        setState(() => _isRefreshing = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return DoctorScaffold(
      pageTitle: 'Patient Reports - ${widget.patientName}',
      currentNavIndex: 0,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header Section
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: PortalLayout.pageGutter,
              vertical: PortalLayout.itemGap,
            ),
            color: Colors.white,
            child: Row(
              children: [
                IconButton(
                  icon: const Icon(Icons.arrow_back),
                  onPressed: () => Navigator.pop(context),
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'INR Reports',
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                              fontWeight: FontWeight.bold,
                            ),
                      ),
                      PortalLayout.metaSpacer,
                      Text(
                        'OP: ${widget.patientOpNumber}',
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: Colors.grey[600],
                            ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.refresh),
                  onPressed: _isRefreshing ? null : _refreshReports,
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          // Reports List
          Expanded(
            child: FutureBuilder<List<Map<String, dynamic>>>(
              future: _reportsFuture,
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }

                if (snapshot.hasError) {
                  return Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.error_outline,
                          size: 48,
                          color: Colors.red[400],
                        ),
                        PortalLayout.sectionSpacerTight,
                        Text(
                          'Error loading reports',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        PortalLayout.sectionSpacer,
                        ElevatedButton.icon(
                          onPressed: _refreshReports,
                          icon: const Icon(Icons.refresh),
                          label: const Text('Retry'),
                        ),
                      ],
                    ),
                  );
                }

                final reports = snapshot.data ?? [];

                return RefreshIndicator(
                  onRefresh: _refreshReports,
                  child: DoctorReportsListWidget(
                    reports: reports,
                    opNumber: widget.patientOpNumber,
                    isLoading: _isRefreshing,
                    onRefresh: _refreshReports,
                  ),
                );
              },
            ),
          ),
        ],
      ),
      onNavChanged: (index) {
        // Handle navigation if needed
      },
    );
  }
}
