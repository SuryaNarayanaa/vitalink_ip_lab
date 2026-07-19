import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:frontend/core/widgets/common/file_preview_modal.dart';

class PremiumReportCard extends StatelessWidget {
  final dynamic report;
  final VoidCallback? onUpdatePressed;
  final VoidCallback? onViewFilePressed;
  final bool showActions;
  final bool showViewAction;
  final bool showUpdateAction;

  const PremiumReportCard({
    super.key,
    required this.report,
    this.onUpdatePressed,
    this.onViewFilePressed,
    this.showActions = false,
    this.showViewAction = false,
    this.showUpdateAction = false,
  });

  String _formatDate(dynamic date, {bool includeTime = false}) {
    if (date == null) return 'N/A';
    try {
      final DateTime dt = date is DateTime ? date : DateTime.parse(date.toString());
      return DateFormat(includeTime ? 'dd MMM yyyy, hh:mm a' : 'dd MMMM yyyy').format(dt);
    } catch (_) {
      return date.toString();
    }
  }

  Future<void> _launchURL(BuildContext context, String? urlString) async {
    if (urlString == null || urlString.isEmpty) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No file URL available')),
        );
      }
      return;
    }

    try {
      debugPrint('Opening file preview: $urlString');
      
      final uri = Uri.parse(urlString);
      
      // Validate URL format (require authority/host so hostless schemes fail)
      if (!uri.hasScheme ||
          (uri.scheme != 'http' && uri.scheme != 'https') ||
          !uri.hasAuthority ||
          uri.host.isEmpty) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Invalid URL format: $urlString')),
          );
        }
        return;
      }
      
      // Show the file preview modal
      if (context.mounted) {
        await FilePreviewModal.show(
          context,
          fileUrl: urlString,
        );
      }
    } catch (e) {
      debugPrint('Error opening file preview: $e');
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error opening file: $e'),
            duration: const Duration(seconds: 4),
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final double? inr = report['inr_value'] is num 
        ? (report['inr_value'] as num).toDouble() 
        : double.tryParse(report['inr_value']?.toString() ?? '');
    
    final bool isCritical = report['is_critical'] == true;
    final notes = report['notes']?.toString();
    
    Color statusColor = isCritical 
        ? const Color(0xFFEF4444) 
        : (inr != null && inr >= 2.0 && inr <= 3.0 
            ? const Color(0xFF10B981) 
            : const Color(0xFFF59E0B));

    final shouldShowViewAction = showActions || showViewAction;
    final shouldShowUpdateAction = showActions || showUpdateAction;
    final hasViewFileAction = shouldShowViewAction && report['file_url'] != null;

    return Container(
      margin: const EdgeInsets.only(bottom: 20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: statusColor.withValues(alpha: 0.08),
            blurRadius: 15,
            offset: const Offset(0, 8),
          ),
        ],
        border: Border.all(color: statusColor.withValues(alpha: 0.15), width: 1.5),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(24),
        child: Stack(
          children: [
            if (isCritical)
              Positioned(
                right: -20,
                top: -20,
                child: Icon(Icons.warning_amber_rounded, size: 100, color: Colors.red.withValues(alpha: 0.05)),
              ),
            Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _formatDate(report['test_date']),
                            style: GoogleFonts.outfit(
                              fontWeight: FontWeight.w800,
                              fontSize: 18,
                              color: const Color(0xFF1F2937),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Recorded at ${_formatDate(report['test_date'], includeTime: true).contains(',') ? _formatDate(report['test_date'], includeTime: true).split(',').last.trim() : 'N/A'}',
                            style: GoogleFonts.outfit(color: const Color(0xFF9CA3AF), fontSize: 12),
                          ),
                        ],
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                        decoration: BoxDecoration(
                          color: statusColor.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: statusColor.withValues(alpha: 0.3)),
                        ),
                        child: Text(
                          'INR ${inr?.toStringAsFixed(1) ?? 'N/A'}',
                          style: GoogleFonts.outfit(
                            color: statusColor,
                            fontWeight: FontWeight.w900,
                            fontSize: 22,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(6),
                        decoration: BoxDecoration(
                          color: statusColor.withValues(alpha: 0.1),
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          isCritical ? Icons.report_problem_rounded : Icons.verified_rounded,
                          color: statusColor,
                          size: 16,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Text(
                        isCritical ? 'CRITICAL ATTENTION REQUIRED' : 'STABLE HEALTH REPORT',
                        style: GoogleFonts.outfit(
                          fontSize: 12,
                          fontWeight: FontWeight.w800,
                          color: statusColor,
                          letterSpacing: 0.5,
                        ),
                      ),
                    ],
                  ),
                  if (notes != null && notes.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF9FAFB),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: const Color(0xFFE5E7EB)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              const Icon(Icons.note_alt_outlined, size: 14, color: Color(0xFF6B7280)),
                              const SizedBox(width: 6),
                              Text(
                                'CLINICAL NOTES',
                                style: GoogleFonts.outfit(
                                  fontWeight: FontWeight.w700,
                                  fontSize: 11,
                                  color: const Color(0xFF6B7280),
                                  letterSpacing: 0.8,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Text(
                            notes,
                            style: GoogleFonts.outfit(
                              fontSize: 14,
                              color: const Color(0xFF374151),
                              height: 1.5,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                  if (hasViewFileAction || shouldShowUpdateAction) ...[
                    const SizedBox(height: 24),
                    Row(
                      children: [
                        if (hasViewFileAction) ...[
                          Expanded(
                            child: _ActionButton(
                              icon: Icons.picture_as_pdf_outlined,
                              label: 'VIEW PDF',
                              color: const Color(0xFF1E1E5E),
                              onPressed: onViewFilePressed ??
                                  () => _launchURL(context, report['file_url']),
                              isPrimary: false,
                            ),
                          ),
                          if (shouldShowUpdateAction) const SizedBox(width: 12),
                        ],
                        if (shouldShowUpdateAction)
                          Expanded(
                            child: _ActionButton(
                              icon: Icons.edit_note_rounded,
                              label: 'INTERVENE',
                              color: const Color(0xFF6366F1),
                              onPressed: onUpdatePressed ?? () {},
                              isPrimary: true,
                            ),
                          ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onPressed;
  final bool isPrimary;

  const _ActionButton({
    required this.icon,
    required this.label,
    required this.color,
    required this.onPressed,
    required this.isPrimary,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 48,
      child: OutlinedButton.icon(
        onPressed: onPressed,
        icon: Icon(icon, size: 18),
        label: Text(
          label,
          style: GoogleFonts.outfit(fontWeight: FontWeight.w800, fontSize: 13, letterSpacing: 0.5),
        ),
        style: OutlinedButton.styleFrom(
          foregroundColor: isPrimary ? Colors.white : color,
          backgroundColor: isPrimary ? color : Colors.transparent,
          side: BorderSide(color: color, width: 1.5),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      ),
    );
  }
}
