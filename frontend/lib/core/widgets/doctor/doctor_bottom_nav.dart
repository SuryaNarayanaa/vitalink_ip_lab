import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

class DoctorBottomNavBar extends StatelessWidget {
  final int currentIndex;
  final Function(int) onTap;

  const DoctorBottomNavBar({
    super.key,
    required this.currentIndex,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final navTheme = theme.bottomNavigationBarTheme;
    final activeColor = navTheme.selectedItemColor ?? theme.colorScheme.primary;
    final inactiveColor =
        navTheme.unselectedItemColor ??
        theme.colorScheme.onSurface.withValues(alpha: 0.55);
    final navBackgroundColor = navTheme.backgroundColor ?? theme.colorScheme.surface;

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
                  iconSvg: _addIcon,
                  label: 'Add',
                  activeColor: activeColor,
                  inactiveColor: inactiveColor,
                ),
                _navItem(
                  iconSvg: _reportsIcon,
                  label: 'Reports',
                  activeColor: activeColor,
                  inactiveColor: inactiveColor,
                ),
                _navItem(
                  iconSvg: _profileIcon,
                  label: 'Profile',
                  activeColor: activeColor,
                  inactiveColor: inactiveColor,
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
  }) {
    return BottomNavigationBarItem(
      icon: SvgPicture.string(
        iconSvg,
        colorFilter: ColorFilter.mode(inactiveColor, BlendMode.srcIn),
      ),
      activeIcon: SvgPicture.string(
        iconSvg,
        colorFilter: ColorFilter.mode(activeColor, BlendMode.srcIn),
      ),
      label: label,
    );
  }
}

const String _homeIcon =
    '''<svg width="22" height="21" viewBox="0 0 22 21" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M11 0.75L1.375 8.15625V19.25C1.375 19.9404 1.93464 20.5 2.625 20.5H8.9375V13.5312H13.0625V20.5H19.375C20.0654 20.5 20.625 19.9404 20.625 19.25V8.15625L11 0.75Z" fill="#B6B6B6"/>
</svg>''';

const String _addIcon =
    '''<svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M11 1.375C5.77188 1.375 1.375 5.77188 1.375 11C1.375 16.2281 5.77188 20.625 11 20.625C16.2281 20.625 20.625 16.2281 20.625 11C20.625 5.77188 16.2281 1.375 11 1.375ZM15.125 11.9375H11.9375V15.125C11.9375 15.5977 11.4727 16.0625 11 16.0625C10.5273 16.0625 10.0625 15.5977 10.0625 15.125V11.9375H6.875C6.40234 11.9375 5.9375 11.4727 5.9375 11C5.9375 10.5273 6.40234 10.0625 6.875 10.0625H10.0625V6.875C10.0625 6.40234 10.5273 5.9375 11 5.9375C11.4727 5.9375 11.9375 6.40234 11.9375 6.875V10.0625H15.125C15.5977 10.0625 16.0625 10.5273 16.0625 11C16.0625 11.4727 15.5977 11.9375 15.125 11.9375Z" fill="#B6B6B6"/>
</svg>''';

const String _reportsIcon =
    '''<svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M6.25 1.375C5.00586 1.375 4 2.38086 4 3.625V18.375C4 19.6191 5.00586 20.625 6.25 20.625H15.75C16.9941 20.625 18 19.6191 18 18.375V7.54688C18 6.9668 17.7051 6.42383 17.2246 6.07617L12.7246 2.9043C12.3984 2.66797 12.0059 2.54199 11.6035 2.54199H6.25ZM12.375 7.5625V3.92578L16.0938 6.5625H13.625C12.9336 6.5625 12.375 6.98047 12.375 7.5625ZM7.5625 10.0625C7.5625 9.58984 7.98242 9.125 8.5625 9.125H13.4375C14.0176 9.125 14.4375 9.58984 14.4375 10.0625C14.4375 10.5352 14.0176 11 13.4375 11H8.5625C7.98242 11 7.5625 10.5352 7.5625 10.0625ZM8.5625 12.375C7.98242 12.375 7.5625 12.8398 7.5625 13.3125C7.5625 13.7852 7.98242 14.25 8.5625 14.25H13.4375C14.0176 14.25 14.4375 13.7852 14.4375 13.3125C14.4375 12.8398 14.0176 12.375 13.4375 12.375H8.5625ZM8.5625 15.625C7.98242 15.625 7.5625 16.0898 7.5625 16.5625C7.5625 17.0352 7.98242 17.5 8.5625 17.5H11.375C11.9551 17.5 12.375 17.0352 12.375 16.5625C12.375 16.0898 11.9551 15.625 11.375 15.625H8.5625Z" fill="#B6B6B6"/>
</svg>''';

const String _profileIcon =
    '''<svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M11 12.375C8.13477 12.375 5.78125 14.7285 5.78125 17.5938C5.78125 19.6836 4.18164 20.625 3.4375 20.625C2.69336 20.625 2.0625 19.9941 2.0625 19.25V17.5938C2.0625 12.5312 6.02539 8.5625 11 8.5625C15.9746 8.5625 19.9375 12.5312 19.9375 17.5938V19.25C19.9375 19.9941 19.3066 20.625 18.5625 20.625C17.8184 20.625 16.2188 19.6836 16.2188 17.5938C16.2188 14.7285 13.8652 12.375 11 12.375ZM11 6.875C8.98047 6.875 7.34375 5.23828 7.34375 3.21875C7.34375 1.19922 8.98047 -0.4375 11 -0.4375C13.0195 -0.4375 14.6562 1.19922 14.6562 3.21875C14.6562 5.23828 13.0195 6.875 11 6.875Z" fill="#B6B6B6"/>
</svg>''';
