import 'package:flutter/material.dart';

/// 4pt spacing scale for product UI.
/// Prefer [PortalLayout] semantic tokens over raw numbers in portal pages.
class AppSpacing {
  AppSpacing._();

  static const double xxs = 4;
  static const double xs = 8;
  static const double sm = 12;
  static const double md = 16;
  static const double lg = 24;
  static const double xl = 32;
  static const double xxl = 48;
}

/// Semantic layout tokens for Doctor + Patient portals.
///
/// Rhythm model:
/// - Tight (xs–sm): related fields, chips, meta lines
/// - Medium (md): card internal padding, list item gaps
/// - Generous (lg–xl): page edges, major section separation, nav clearance
class PortalLayout {
  PortalLayout._();

  // —— Page frame ——
  /// Horizontal inset from screen edge to content.
  static const double pageGutter = AppSpacing.md;

  /// Space below the app bar before first content.
  static const double pageTop = AppSpacing.md;

  /// Extra top air for form-first screens (profile, update INR).
  static const double pageTopComfortable = AppSpacing.lg;

  /// Bottom clearance when floating bottom nav overlays content (shell tabs).
  /// Covers pill nav (~56) + outer padding (~24) without double-counting
  /// system safe-area (already applied by scaffold SafeArea).
  static const double pageBottomShell = 88;

  /// Bottom clearance on full-screen pages without floating nav.
  static const double pageBottomStandalone = AppSpacing.xl;

  // —— Vertical rhythm ——
  /// Between major blocks (cards, forms, sections).
  static const double sectionGap = AppSpacing.lg;

  /// Between related blocks that still read as one group.
  static const double sectionGapTight = AppSpacing.md;

  /// Between list rows / stacked cards of the same type.
  static const double itemGap = AppSpacing.sm;

  /// Between form fields.
  static const double fieldGap = AppSpacing.sm;

  /// Label → control.
  static const double labelGap = AppSpacing.xs;

  /// Inline meta under a title (name → OP #).
  static const double metaGap = AppSpacing.xxs;

  /// Icon/chip row gaps.
  static const double inlineGap = AppSpacing.xs;

  /// Horizontal gap in two-column form rows.
  static const double columnGap = AppSpacing.sm;

  // —— Surfaces ——
  static const double cardPadding = AppSpacing.md;
  static const double cardPaddingComfortable = 20;
  static const double cardRadius = 16;
  static const double controlRadius = 12;
  static const double pillRadius = 999;

  // —— Fixed helpers ——

  /// Standard scroll padding for a portal page.
  static EdgeInsets pagePadding({
    required bool embedInShell,
    double? top,
    double? horizontal,
    double? bottom,
  }) {
    final h = horizontal ?? pageGutter;
    return EdgeInsets.fromLTRB(
      h,
      top ?? pageTop,
      h,
      bottom ??
          (embedInShell ? pageBottomShell : pageBottomStandalone),
    );
  }

  /// Doctor shell tabs always sit under the floating bottom nav.
  static EdgeInsets get doctorShellPadding => const EdgeInsets.fromLTRB(
        pageGutter,
        pageTop,
        pageGutter,
        pageBottomShell,
      );

  /// Patient shell tab padding (home, dosage, etc.).
  static EdgeInsets patientShellPadding({
    double top = pageTop,
    double? horizontal,
  }) =>
      pagePadding(embedInShell: true, top: top, horizontal: horizontal);

  static EdgeInsets get cardInsets => const EdgeInsets.all(cardPadding);

  static EdgeInsets get cardInsetsComfortable =>
      const EdgeInsets.all(cardPaddingComfortable);

  static SizedBox get sectionSpacer =>
      const SizedBox(height: sectionGap);

  static SizedBox get sectionSpacerTight =>
      const SizedBox(height: sectionGapTight);

  static SizedBox get itemSpacer => const SizedBox(height: itemGap);

  static SizedBox get fieldSpacer => const SizedBox(height: fieldGap);

  static SizedBox get labelSpacer => const SizedBox(height: labelGap);

  static SizedBox get metaSpacer => const SizedBox(height: metaGap);

  static SizedBox get inlineSpacer => const SizedBox(width: inlineGap);

  static SizedBox get columnSpacer => const SizedBox(width: columnGap);
}
