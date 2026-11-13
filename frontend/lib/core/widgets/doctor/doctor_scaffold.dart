import 'package:flutter/material.dart';
import 'package:frontend/core/widgets/common/app_navbar.dart';
import 'package:frontend/core/widgets/doctor/doctor_bottom_nav.dart';

class DoctorScaffold extends StatelessWidget {
  final String pageTitle;
  final Widget body;
  final int currentNavIndex;
  final Function(int) onNavChanged;
  final Widget? drawer;
  final Color navbarBackgroundColor;
  final Decoration? bodyDecoration;
  final VoidCallback? onNotificationPressed;
  final int notificationBadgeCount;
  final bool reportsEnabled;

  const DoctorScaffold({
    super.key,
    required this.pageTitle,
    required this.body,
    required this.currentNavIndex,
    required this.onNavChanged,
    this.drawer,
    this.navbarBackgroundColor = Colors.white,
    this.bodyDecoration,
    this.onNotificationPressed,
    this.notificationBadgeCount = 0,
    this.reportsEnabled = true,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      extendBody: true,
      backgroundColor: Colors.transparent,
      drawer: drawer,
      bottomNavigationBar: DoctorBottomNavBar(
        currentIndex: currentNavIndex,
        onTap: onNavChanged,
        reportsEnabled: reportsEnabled,
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
            Expanded(child: body),
          ],
        ),
      ),
    );
  }
}
