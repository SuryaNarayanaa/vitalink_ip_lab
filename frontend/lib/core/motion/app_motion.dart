import 'package:flutter/material.dart';

/// Product-register motion tokens for VitaLink.
///
/// Durations stay in the 100–250ms band for feedback and state changes.
/// Longer entrance timings are reserved for content-ready reveals only.
/// Always route through [AppMotion] so reduced-motion is respected.
class AppMotion {
  AppMotion._();

  /// Instant feedback: press, color, toggle.
  static const Duration instant = Duration(milliseconds: 120);

  /// Default state change: menu, hover-equivalent, content crossfade.
  static const Duration state = Duration(milliseconds: 220);

  /// Layout-ish transitions: expand, drawer, view mode switch.
  static const Duration layout = Duration(milliseconds: 300);

  /// Content-ready reveal after loading (not page-load choreography).
  static const Duration reveal = Duration(milliseconds: 280);

  /// Cap for list stagger so long lists never feel slow.
  static const Duration staggerStep = Duration(milliseconds: 40);
  static const int maxStaggerItems = 8;

  /// Ease-out quart — smooth natural deceleration.
  static const Curve easeOutQuart = Cubic(0.25, 1.0, 0.5, 1.0);

  /// Ease-out quint — slightly snappier product feel.
  static const Curve easeOutQuint = Cubic(0.22, 1.0, 0.36, 1.0);

  /// Ease-out expo — decisive crossfades.
  static const Curve easeOutExpo = Cubic(0.16, 1.0, 0.3, 1.0);

  /// Exit curves run slightly faster than enter.
  static const Curve easeInSoft = Cubic(0.4, 0.0, 1.0, 1.0);

  static bool reduce(BuildContext context) {
    return MediaQuery.disableAnimationsOf(context);
  }

  static Duration duration(
    BuildContext context,
    Duration preferred, {
    Duration reduced = Duration.zero,
  }) {
    return reduce(context) ? reduced : preferred;
  }

  static Duration exitOf(Duration enter) {
    final enterMs = enter.inMilliseconds;
    if (enterMs <= 0) return Duration.zero;
    // clamp() requires lower ≤ upper; short enters skip the 80ms floor.
    if (enterMs < 80) {
      return Duration(milliseconds: (enterMs * 0.75).round());
    }
    final ms = (enterMs * 0.75).round();
    return Duration(milliseconds: ms.clamp(80, enterMs));
  }

  static Duration staggerDelay(int index) {
    final capped = index.clamp(0, maxStaggerItems - 1);
    return staggerStep * capped;
  }

  /// Fade + slight upward slide transition builder for [AnimatedSwitcher].
  static Widget fadeSlideTransition(
    Widget child,
    Animation<double> animation, {
    Offset begin = const Offset(0, 0.02),
  }) {
    final curved = CurvedAnimation(parent: animation, curve: easeOutQuint);
    return FadeTransition(
      opacity: curved,
      child: SlideTransition(
        position: Tween<Offset>(begin: begin, end: Offset.zero).animate(curved),
        child: child,
      ),
    );
  }

  /// Shared fade + lateral slide for [PageRoute] / [PageTransitionsBuilder].
  ///
  /// Honors reduced-motion (disableAnimations) by returning [child] unchanged.
  static Widget buildFadeSlidePageTransition({
    required BuildContext context,
    required Animation<double> animation,
    required Widget child,
    Offset begin = const Offset(0.03, 0),
  }) {
    if (MediaQuery.disableAnimationsOf(context)) {
      return child;
    }
    final curved = CurvedAnimation(
      parent: animation,
      curve: easeOutQuint,
      reverseCurve: easeInSoft,
    );
    return FadeTransition(
      opacity: curved,
      child: SlideTransition(
        position: Tween<Offset>(
          begin: begin,
          end: Offset.zero,
        ).animate(curved),
        child: child,
      ),
    );
  }

  /// Simple fade for reduced motion or tight spaces.
  static Widget fadeTransition(Widget child, Animation<double> animation) {
    return FadeTransition(
      opacity: CurvedAnimation(parent: animation, curve: easeOutQuint),
      child: child,
    );
  }
}
