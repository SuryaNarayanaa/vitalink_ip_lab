import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:frontend/core/motion/motion_widgets.dart';

class PatientBottomNavBar extends StatelessWidget {
  final int currentIndex;
  final Function(int) onTap;
  final int unreadDoctorUpdatesCount;

  const PatientBottomNavBar({
    super.key,
    required this.currentIndex,
    required this.onTap,
    this.unreadDoctorUpdatesCount = 0,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final navTheme = theme.bottomNavigationBarTheme;
    final activeColor = navTheme.selectedItemColor ?? theme.colorScheme.primary;
    final inactiveColor = navTheme.unselectedItemColor ??
        theme.colorScheme.onSurface.withValues(alpha: 0.55);
    final navBackgroundColor =
        navTheme.backgroundColor ?? theme.colorScheme.surface;

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Container(
          decoration: BoxDecoration(
            color: navBackgroundColor,
            borderRadius: BorderRadius.circular(24),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.08),
                blurRadius: 8,
                offset: const Offset(0, 3),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(24),
            child: BottomNavigationBar(
              currentIndex: currentIndex,
              onTap: onTap,
              type: BottomNavigationBarType.fixed,
              backgroundColor: navBackgroundColor,
              showSelectedLabels: true,
              showUnselectedLabels: true,
              selectedItemColor: activeColor,
              unselectedItemColor: inactiveColor,
              selectedLabelStyle:
                  const TextStyle(fontWeight: FontWeight.w700, fontSize: 10),
              unselectedLabelStyle:
                  const TextStyle(fontWeight: FontWeight.w600, fontSize: 10),
              elevation: 0,
              items: [
                _navItem(
                  iconSvg: _homeIcon,
                  label: 'Home',
                  activeColor: activeColor,
                  inactiveColor: inactiveColor,
                ),
                _navItem(
                  iconSvg: _inrIcon,
                  label: 'Update INR',
                  activeColor: activeColor,
                  inactiveColor: inactiveColor,
                ),
                _navItem(
                  iconSvg: _dosageIcon,
                  label: 'Dosage',
                  activeColor: activeColor,
                  inactiveColor: inactiveColor,
                ),
                _navItem(
                  iconSvg: _recordsIcon,
                  label: 'Notes',
                  activeColor: activeColor,
                  inactiveColor: inactiveColor,
                ),
                _navItem(
                  iconSvg: _profileIcon,
                  label: 'Profile',
                  activeColor: activeColor,
                  inactiveColor: inactiveColor,
                  badgeCount: unreadDoctorUpdatesCount,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  BottomNavigationBarItem _navItem({
    required String iconSvg,
    required String label,
    required Color activeColor,
    required Color inactiveColor,
    int badgeCount = 0,
  }) {
    Widget iconWithBadge(Color color) {
      return Stack(
        clipBehavior: Clip.none,
        children: [
          SvgPicture.string(
            iconSvg,
            colorFilter: ColorFilter.mode(color, BlendMode.srcIn),
          ),
          if (badgeCount > 0)
            Positioned(
              right: -8,
              top: -6,
              child: MotionBadge(count: badgeCount),
            ),
        ],
      );
    }

    return BottomNavigationBarItem(
      icon: iconWithBadge(inactiveColor),
      activeIcon: iconWithBadge(activeColor),
      label: label,
    );
  }
}

const String _homeIcon =
    '''<svg width="22" height="21" viewBox="0 0 22 21" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M11 0.75L1.375 8.15625V19.25C1.375 19.9404 1.93464 20.5 2.625 20.5H8.9375V13.5312H13.0625V20.5H19.375C20.0654 20.5 20.625 19.9404 20.625 19.25V8.15625L11 0.75Z" fill="#B6B6B6"/>
</svg>''';

const String _inrIcon =
    '''<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M12 21L10.55 19.705C5.4 15.03 2 11.95 2 8.15C2 5.06 4.42 2.65 7.5 2.65C9.24 2.65 10.91 3.46 12 4.74C13.09 3.46 14.76 2.65 17.5 2.65C20.58 2.65 23 5.06 23 8.15C23 11.95 19.6 15.03 14.45 19.71L12 21Z" fill="#B6B6B6"/>
</svg>''';

const String _dosageIcon =
    '''<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M19 3H5C3.89543 3 3 3.89543 3 5V19C3 20.1046 3.89543 21 5 21H19C20.1046 21 21 20.1046 21 19V5C21 3.89543 20.1046 3 19 3ZM11 17H9V15H11V17ZM15 17H13V15H15V17ZM11 13H9V11H11V13ZM15 13H13V11H15V13ZM11 9H9V7H11V9ZM15 9H13V7H15V9Z" fill="#B6B6B6"/>
</svg>''';

const String _recordsIcon =
    '''<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2ZM12 18H8V16H12V18ZM16 14H8V12H16V14ZM16 10H8V8H16V10Z" fill="#B6B6B6"/>
</svg>''';

const String _profileIcon =
    '''<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 5C13.66 5 15 6.34 15 8C15 9.66 13.66 11 12 11C10.34 11 9 9.66 9 8C9 6.34 10.34 5 12 5ZM12 19.2C9.5 19.2 7.29 17.92 6 15.98C6.03 13.99 10 12.9 12 12.9C13.99 12.9 17.97 13.99 18 15.98C16.71 17.92 14.5 19.2 12 19.2Z" fill="#B6B6B6"/>
</svg>''';
