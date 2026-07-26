import 'package:flutter/material.dart';
import 'package:frontend/features/admin/access_control_page.dart';
import 'package:frontend/features/admin/data/admin_repository.dart';

/// Backward-compatible name for the V2 access-control surface.
class RolesRbacPage extends StatelessWidget {
  const RolesRbacPage({super.key, this.repository});

  final AdminRepository? repository;

  @override
  Widget build(BuildContext context) {
    return AccessControlPage(repository: repository);
  }
}
