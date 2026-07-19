import 'package:flutter/material.dart';
import 'package:frontend/core/motion/app_motion.dart';

/// Press feedback for tappable surfaces (cards, rows).
/// Scale only — no stacking, no layout shift.
class PressScale extends StatefulWidget {
  const PressScale({
    super.key,
    required this.child,
    this.onTap,
    this.onLongPress,
    this.scale = 0.985,
    this.behavior = HitTestBehavior.opaque,
  });

  final Widget child;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final double scale;
  final HitTestBehavior behavior;

  @override
  State<PressScale> createState() => _PressScaleState();
}

class _PressScaleState extends State<PressScale> {
  bool _pressed = false;

  void _setPressed(bool value) {
    if (_pressed == value) return;
    setState(() => _pressed = value);
  }

  @override
  Widget build(BuildContext context) {
    final duration = AppMotion.duration(context, AppMotion.instant);
    final enabled = widget.onTap != null || widget.onLongPress != null;

    return GestureDetector(
      behavior: widget.behavior,
      onTapDown: enabled ? (_) => _setPressed(true) : null,
      onTapUp: enabled ? (_) => _setPressed(false) : null,
      onTapCancel: enabled ? () => _setPressed(false) : null,
      onTap: widget.onTap,
      onLongPress: widget.onLongPress,
      child: AnimatedScale(
        scale: _pressed ? widget.scale : 1,
        duration: duration,
        curve: AppMotion.easeOutQuint,
        child: widget.child,
      ),
    );
  }
}

/// Badge that appears when a non-zero count is present.
class MotionBadge extends StatelessWidget {
  const MotionBadge({
    super.key,
    required this.count,
    this.max = 99,
    this.color = const Color(0xFFDC2626),
    this.textColor = Colors.white,
  });

  final int count;
  final int max;
  final Color color;
  final Color textColor;

  @override
  Widget build(BuildContext context) {
    if (count <= 0) return const SizedBox.shrink();

    final label = count > max ? '$max+' : '$count';
    return Container(
      constraints: const BoxConstraints(minWidth: 16, minHeight: 16),
      padding: const EdgeInsets.symmetric(horizontal: 4),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Colors.white, width: 1),
      ),
      child: Center(
        child: Text(
          label,
          style: TextStyle(
            color: textColor,
            fontSize: 10,
            fontWeight: FontWeight.w700,
            height: 1.1,
          ),
        ),
      ),
    );
  }
}

/// Soft pulse shimmer for skeleton placeholders (loading feedback only).
class Shimmer extends StatefulWidget {
  const Shimmer({
    super.key,
    required this.child,
    this.baseColor = const Color(0xFFE5E7EB),
    this.highlightColor = const Color(0xFFF3F4F6),
  });

  final Widget child;
  final Color baseColor;
  final Color highlightColor;

  @override
  State<Shimmer> createState() => _ShimmerState();
}

class _ShimmerState extends State<Shimmer> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..repeat();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (AppMotion.reduce(context)) {
      _controller.stop();
      _controller.value = 0.5;
    } else if (!_controller.isAnimating) {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (AppMotion.reduce(context)) return widget.child;

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final t = _controller.value;
        return ShaderMask(
          blendMode: BlendMode.srcATop,
          shaderCallback: (bounds) {
            return LinearGradient(
              begin: Alignment(-1.0 - t * 2, 0),
              end: Alignment(1.0 - t * 2, 0),
              colors: [
                widget.baseColor,
                widget.highlightColor,
                widget.baseColor,
              ],
              stops: const [0.25, 0.5, 0.75],
            ).createShader(bounds);
          },
          child: child,
        );
      },
      child: widget.child,
    );
  }
}

/// Subtle fade+slide for secondary routes (push/pop), not bottom-nav tabs.
class FadeSlidePageRoute<T> extends PageRouteBuilder<T> {
  FadeSlidePageRoute({
    required WidgetBuilder builder,
    super.settings,
    Duration duration = AppMotion.layout,
  }) : super(
          transitionDuration: duration,
          reverseTransitionDuration: AppMotion.exitOf(duration),
          pageBuilder: (context, animation, secondaryAnimation) =>
              builder(context),
          transitionsBuilder: (context, animation, secondaryAnimation, child) {
            if (MediaQuery.disableAnimationsOf(context)) {
              return child;
            }
            final curved = CurvedAnimation(
              parent: animation,
              curve: AppMotion.easeOutQuint,
              reverseCurve: AppMotion.easeInSoft,
            );
            return FadeTransition(
              opacity: curved,
              child: SlideTransition(
                position: Tween<Offset>(
                  begin: const Offset(0.03, 0),
                  end: Offset.zero,
                ).animate(curved),
                child: child,
              ),
            );
          },
        );
}
