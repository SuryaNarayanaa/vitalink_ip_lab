import 'package:flutter/material.dart';
import 'package:frontend/core/widgets/common/app_navbar.dart';
import 'package:frontend/core/widgets/patient/patient_bottom_nav.dart';

class PatientScaffold extends StatelessWidget {
  static const dosageBodyDecoration = BoxDecoration(
    gradient: LinearGradient(
      begin: Alignment.topCenter,
      end: Alignment.bottomCenter,
      colors: [Color(0xFFC8B5E1), Color(0xFFF8C7D7)],
    ),
  );

  final String pageTitle;
  final Widget body;
  final int currentNavIndex;
  final Function(int) onNavChanged;
  final Widget? drawer;
  final Color navbarBackgroundColor;
  final Decoration? bodyDecoration;
  final int unreadDoctorUpdatesCount;
  final VoidCallback? onNotificationPressed;
  final int notificationBadgeCount;

  const PatientScaffold({
    super.key,
    required this.pageTitle,
    required this.body,
    required this.currentNavIndex,
    required this.onNavChanged,
    this.drawer,
    this.navbarBackgroundColor = Colors.white,
    this.bodyDecoration,
    this.unreadDoctorUpdatesCount = 0,
    this.onNotificationPressed,
    this.notificationBadgeCount = 0,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      extendBody: true,
      backgroundColor: Colors.transparent,
      drawer: drawer,
      bottomNavigationBar: PatientBottomNavBar(
        currentIndex: currentNavIndex,
        onTap: onNavChanged,
        unreadDoctorUpdatesCount: unreadDoctorUpdatesCount,
      ),
      body: Container(
        decoration: bodyDecoration ?? const BoxDecoration(color: Colors.white),
        child: Column(
          children: [
            AppNavBar(
              pageTitle: pageTitle,
              backgroundColor: navbarBackgroundColor,
              onNotificationPressed: onNotificationPressed,
              notificationBadgeCount: notificationBadgeCount,
            ),
            Expanded(child: SafeArea(top: false, child: body)),
          ],
        ),
      ),
    );
  }
}
