import 'package:flutter/material.dart';
import 'package:frontend/core/constants/layout.dart';
import 'package:styled_widget/styled_widget.dart';

/// A reusable section header widget with optional action button.
class SectionHeader extends StatelessWidget {
  final String title;
  final IconData? icon;
  final Widget? action;
  final Color? iconColor;
  final EdgeInsetsGeometry? padding;
  final TextStyle? titleStyle;

  const SectionHeader({
    super.key,
    required this.title,
    this.icon,
    this.action,
    this.iconColor,
    this.padding,
    this.titleStyle,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding ??
          const EdgeInsets.symmetric(vertical: PortalLayout.itemGap),
      child: Row(
        children: [
          if (icon != null)
            Icon(icon, size: 20, color: iconColor ?? const Color(0xFF6366F1))
                .padding(all: AppSpacing.xs)
                .decorated(
                  color: (iconColor ?? const Color(0xFF6366F1))
                      .withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(AppSpacing.xs),
                )
                .padding(right: PortalLayout.itemGap),
          Text(
            title,
            style: titleStyle ??
                const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  color: Color(0xFF1F2937),
                ),
          ).expanded(),
          if (action != null) action!,
        ],
      ),
    );
  }
}
