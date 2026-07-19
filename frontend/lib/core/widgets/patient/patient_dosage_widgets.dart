import 'package:flutter/material.dart';
import 'package:frontend/core/constants/layout.dart';

class DosageDateCard extends StatelessWidget {
  final String date;
  final VoidCallback onTap;
  final bool isClickable;

  const DosageDateCard({
    super.key,
    required this.date,
    required this.onTap,
    this.isClickable = true,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isCompact = constraints.maxWidth < 110;

        return GestureDetector(
          onTap: isClickable ? onTap : null,
          child: Container(
            padding: EdgeInsets.symmetric(
              horizontal: isCompact ? 10 : PortalLayout.cardPadding,
              vertical: PortalLayout.itemGap,
            ),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(AppSpacing.xs),
              border: Border.all(color: Colors.grey.shade300),
            ),
            alignment: Alignment.center,
            child: FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(
                date,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: Colors.black87,
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class RemainingDoseCard extends StatelessWidget {
  final String date;

  const RemainingDoseCard({
    super.key,
    required this.date,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(PortalLayout.itemGap),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppSpacing.xs),
        border: Border.all(color: Colors.red.shade300, width: 2),
      ),
      child: Row(
        children: [
          Icon(Icons.error_outline, color: Colors.red.shade400, size: 20),
          PortalLayout.inlineSpacer,
          Expanded(
            child: Text(
              date,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: Colors.grey.shade800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class DosageSection extends StatelessWidget {
  final String title;
  final String? subtitle;
  final List<Widget> children;
  final EdgeInsetsGeometry? padding;

  const DosageSection({
    super.key,
    required this.title,
    this.subtitle,
    required this.children,
    this.padding,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding ??
          const EdgeInsets.symmetric(vertical: AppSpacing.xs),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: Colors.black87,
            ),
          ),
          if (subtitle != null) ...[
            PortalLayout.metaSpacer,
            Text(
              subtitle!,
              style: TextStyle(
                fontSize: 13,
                color: Colors.grey.shade600,
              ),
            ),
          ],
          PortalLayout.itemSpacer,
          ...children,
        ],
      ),
    );
  }
}
