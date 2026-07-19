import 'package:flutter/material.dart';
import 'package:frontend/core/motion/app_motion.dart';

class AppColors {
	// Primary palette
	static const Color primary = Color(0xFF648FFF);
	static const Color secondary = Color(0xFF785EF0);
	static const Color accent = Color(0xFFDC267F);
	static const Color warning = Color(0xFFFE6100);
	static const Color info = Color(0xFFFFB000);
	static const Color navInactive = Color(0xFFB6B6B6);

	// Backgrounds
	// Note: Flutter Color uses ARGB; #ffffff99 (CSS) becomes 0x99FFFFFF in ARGB.
	static const Color backgroundLight = Color(0x99FFFFFF);
	static const Color backgroundMissed = Colors.lightBlue;
	static const Color backgroundDark = Color(0xFF121212);

	// Status
	static const Color success = Color(0xFF2E7D32);
	static const Color error = Color(0xFFD32F2F);
}

class AppTheme {
	static final PageTransitionsTheme _pageTransitions = PageTransitionsTheme(
		builders: {
			for (final platform in TargetPlatform.values)
				platform: const _FadeSlidePageTransitionsBuilder(),
		},
	);

	static ThemeData light = ThemeData(
		useMaterial3: true,
		colorScheme: ColorScheme.fromSeed(
			seedColor: AppColors.primary,
			brightness: Brightness.light,
			surface: AppColors.backgroundLight,
		).copyWith(
			primary: AppColors.primary,
			secondary: AppColors.secondary,
			tertiary: AppColors.accent,
			error: AppColors.error,
		),
		scaffoldBackgroundColor: AppColors.backgroundLight,
		pageTransitionsTheme: _pageTransitions,
		snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
		inputDecorationTheme: const InputDecorationTheme(
			border: OutlineInputBorder(),
		),
		bottomNavigationBarTheme: const BottomNavigationBarThemeData(
			selectedItemColor: AppColors.warning,
			unselectedItemColor: AppColors.navInactive,
			backgroundColor: Colors.white,
		),
		elevatedButtonTheme: ElevatedButtonThemeData(
			style: ElevatedButton.styleFrom(
				minimumSize: const Size.fromHeight(44),
				animationDuration: AppMotion.state,
			),
		),
		filledButtonTheme: FilledButtonThemeData(
			style: FilledButton.styleFrom(
				minimumSize: const Size.fromHeight(44),
				animationDuration: AppMotion.state,
			),
		),
	);

	static ThemeData dark = ThemeData(
		useMaterial3: true,
		colorScheme: ColorScheme.fromSeed(
			seedColor: AppColors.primary,
			brightness: Brightness.dark,
			surface: AppColors.backgroundDark,
		).copyWith(
			primary: AppColors.primary,
			secondary: AppColors.secondary,
			tertiary: AppColors.accent,
			error: AppColors.error,
		),
		scaffoldBackgroundColor: AppColors.backgroundDark,
		pageTransitionsTheme: _pageTransitions,
		snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
		inputDecorationTheme: const InputDecorationTheme(
			border: OutlineInputBorder(),
		),
		bottomNavigationBarTheme: BottomNavigationBarThemeData(
			selectedItemColor: AppColors.warning,
			unselectedItemColor: AppColors.navInactive.withValues(alpha: 0.85),
			backgroundColor: AppColors.backgroundDark,
		),
		elevatedButtonTheme: ElevatedButtonThemeData(
			style: ElevatedButton.styleFrom(
				minimumSize: const Size.fromHeight(44),
				animationDuration: AppMotion.state,
			),
		),
		filledButtonTheme: FilledButtonThemeData(
			style: FilledButton.styleFrom(
				minimumSize: const Size.fromHeight(44),
				animationDuration: AppMotion.state,
			),
		),
	);
}

/// Shared product page transition: short fade + lateral slide.
class _FadeSlidePageTransitionsBuilder extends PageTransitionsBuilder {
	const _FadeSlidePageTransitionsBuilder();

	@override
	Widget buildTransitions<T>(
		PageRoute<T> route,
		BuildContext context,
		Animation<double> animation,
		Animation<double> secondaryAnimation,
		Widget child,
	) {
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
	}
}
