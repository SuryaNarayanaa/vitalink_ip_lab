import 'package:flutter/material.dart';
import 'package:frontend/core/constants/layout.dart';
import 'package:styled_widget/styled_widget.dart';

/// A reusable card widget for displaying information sections.
class InfoCard extends StatelessWidget {
  final String? title;
  final Widget child;
  final EdgeInsetsGeometry? padding;
  final EdgeInsetsGeometry? margin;
  final Color? backgroundColor;
  final List<Widget>? actions;

  const InfoCard({
    super.key,
    this.title,
    required this.child,
    this.padding,
    this.margin,
    this.backgroundColor,
    this.actions,
  });

  @override
  Widget build(BuildContext context) {
    return <Widget>[
      if (title != null || actions != null)
        <Widget>[
          if (title != null)
            Text(title!)
                .fontSize(16)
                .fontWeight(FontWeight.w600)
                .textColor(const Color(0xFF1F2937)),
          if (actions != null) actions!.toRow(mainAxisSize: MainAxisSize.min),
        ]
            .toRow(mainAxisAlignment: MainAxisAlignment.spaceBetween)
            .padding(
              horizontal: PortalLayout.cardPadding,
              top: PortalLayout.cardPadding,
              bottom: AppSpacing.xs,
            ),
      Padding(
        padding: padding ??
            const EdgeInsets.fromLTRB(
              PortalLayout.cardPadding,
              AppSpacing.xs,
              PortalLayout.cardPadding,
              PortalLayout.cardPadding,
            ),
        child: child,
      ),
    ]
        .toColumn(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
        )
        .decorated(
          color: backgroundColor ?? Colors.white,
          borderRadius: BorderRadius.circular(PortalLayout.cardRadius),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.05),
              blurRadius: 10,
              offset: const Offset(0, 4),
            ),
          ],
        );
  }
}

/// A row widget for displaying label-value pairs in an InfoCard.
class InfoRow extends StatelessWidget {
  final String label;
  final String value;
  final IconData? icon;
  final Color? valueColor;
  final TextStyle? labelStyle;
  final TextStyle? valueStyle;

  const InfoRow({
    super.key,
    required this.label,
    required this.value,
    this.icon,
    this.valueColor,
    this.labelStyle,
    this.valueStyle,
  });

  @override
  Widget build(BuildContext context) {
    return <Widget>[
      if (icon != null)
        Icon(icon, size: 18, color: const Color(0xFF6B7280))
            .padding(right: AppSpacing.xs),
      Text(label, style: labelStyle ??
          const TextStyle(
            fontSize: 14,
            color: Color(0xFF6B7280),
            fontWeight: FontWeight.w500,
          ))
          .width(120),
      Text(value, style: valueStyle ??
          TextStyle(
            fontSize: 14,
            color: valueColor ?? const Color(0xFF1F2937),
            fontWeight: FontWeight.w500,
          ))
          .expanded(),
    ]
        .toRow(crossAxisAlignment: CrossAxisAlignment.start)
        .padding(vertical: AppSpacing.xxs + 2);
  }
}
