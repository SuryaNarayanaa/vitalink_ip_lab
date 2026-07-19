import 'package:flutter/material.dart';
import 'package:frontend/core/motion/motion_widgets.dart';

/// Lightweight placeholder used while dashboard queries load.
/// Prefer this over a full-screen spinner so layout and hierarchy stay visible.
class PageSkeleton extends StatelessWidget {
  const PageSkeleton({
    super.key,
    this.cardCount = 3,
    this.showHeader = true,
    this.padding = const EdgeInsets.fromLTRB(16, 20, 16, 24),
  });

  final int cardCount;
  final bool showHeader;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: padding,
      child: Shimmer(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (showHeader) ...[
              const _SkeletonBar(height: 22, widthFactor: 0.45),
              const SizedBox(height: 12),
              const _SkeletonBar(height: 14, widthFactor: 0.7),
              const SizedBox(height: 20),
            ],
            for (var i = 0; i < cardCount; i++) ...[
              if (i > 0) const SizedBox(height: 14),
              const _SkeletonCard(),
            ],
          ],
        ),
      ),
    );
  }
}

/// Compact list skeleton for patient/doctor collection screens.
class ListSkeleton extends StatelessWidget {
  const ListSkeleton({
    super.key,
    this.itemCount = 5,
    this.padding = EdgeInsets.zero,
    this.shrinkWrap = false,
  });

  final int itemCount;
  final EdgeInsetsGeometry padding;
  final bool shrinkWrap;

  @override
  Widget build(BuildContext context) {
    return Shimmer(
      child: ListView.separated(
        primary: !shrinkWrap,
        physics: shrinkWrap
            ? const NeverScrollableScrollPhysics()
            : const AlwaysScrollableScrollPhysics(),
        shrinkWrap: shrinkWrap,
        padding: padding,
        itemCount: itemCount,
        separatorBuilder: (_, _) => const SizedBox(height: 12),
        itemBuilder: (_, _) => const _SkeletonCard(compact: true),
      ),
    );
  }
}

class _SkeletonCard extends StatelessWidget {
  const _SkeletonCard({this.compact = false});

  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.all(compact ? 14 : 16),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.72),
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 8,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _SkeletonBar(height: compact ? 14 : 16, widthFactor: 0.55),
          SizedBox(height: compact ? 10 : 12),
          _SkeletonBar(height: compact ? 10 : 12, widthFactor: 0.9),
          SizedBox(height: compact ? 6 : 8),
          _SkeletonBar(height: compact ? 10 : 12, widthFactor: 0.65),
        ],
      ),
    );
  }
}

class _SkeletonBar extends StatelessWidget {
  const _SkeletonBar({
    required this.height,
    this.widthFactor = 1,
  });

  final double height;
  final double widthFactor;

  @override
  Widget build(BuildContext context) {
    return FractionallySizedBox(
      widthFactor: widthFactor.clamp(0.1, 1.0).toDouble(),
      alignment: Alignment.centerLeft,
      child: Container(
        height: height,
        decoration: BoxDecoration(
          color: const Color(0xFFE5E7EB),
          borderRadius: BorderRadius.circular(8),
        ),
      ),
    );
  }
}
