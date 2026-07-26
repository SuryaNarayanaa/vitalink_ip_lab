import 'package:flutter/material.dart';
import 'package:frontend/features/admin/admin_accounts_page.dart';
import 'package:frontend/features/admin/data/admin_repository.dart';

/// Backward-compatible name for the V2 administrator-account surface.
///
/// Doctor and Patient lifecycle remains on their dedicated pages. This page
/// never offers Application Admin creation or management.
class UserLifecyclePage extends StatelessWidget {
  const UserLifecyclePage({super.key, this.repository});

  final AdminRepository? repository;

  @override
  Widget build(BuildContext context) {
    return AdminAccountsPage(repository: repository);
  }
}
