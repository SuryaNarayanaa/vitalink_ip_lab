import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/app/routers.dart';
import 'package:frontend/features/doctor/data/doctor_repository.dart';
import 'package:frontend/features/doctor/models/doctor_profile_model.dart';
import 'package:frontend/core/widgets/index.dart';

class DoctorProfileContent extends StatelessWidget {
  final DoctorProfileModel profile;
  final VoidCallback onProfileUpdated;

  const DoctorProfileContent({
    super.key,
    required this.profile,
    required this.onProfileUpdated,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        // Profile Avatar
        Container(
          width: 120,
          height: 120,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [Color(0xFFFF7643), Color(0xFFFF9F88)],
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.15),
                blurRadius: 12,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: profile.profilePictureUrl != null
              ? ClipOval(
                  child: Image.network(
                    profile.profilePictureUrl!,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) =>
                        DoctorAvatarPlaceholder(name: profile.name),
                  ),
                )
              : DoctorAvatarPlaceholder(name: profile.name),
        ),
        const SizedBox(height: 20),

        // Doctor Name
        Text(
          profile.name,
          style: const TextStyle(
            fontSize: 24,
            fontWeight: FontWeight.w800,
            color: Colors.black87,
          ),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 8),

        // Department Badge
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          decoration: BoxDecoration(
            color: const Color(0xFFFF7643).withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: const Color(0xFFFF7643), width: 1.5),
          ),
          child: Text(
            profile.department,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: Color(0xFFFF7643),
            ),
          ),
        ),
        const SizedBox(height: 24),

        // Info Cards
        DoctorInfoCard(
          icon: Icons.people,
          label: 'Patients',
          value: profile.patientsCount.toString(),
          color: const Color(0xFF6366F1),
        ),
        const SizedBox(height: 12),

        if (profile.contactNumber != null)
          DoctorInfoCard(
            icon: Icons.phone,
            label: 'Contact',
            value: profile.contactNumber!,
            color: const Color(0xFF10B981),
          ),
        const SizedBox(height: 12),

        // Profile Details Section
        DoctorProfileDetails(profile: profile),
        const SizedBox(height: 24),

        // Action Buttons
        DoctorActionButtons(
          profile: profile,
          onProfileUpdated: onProfileUpdated,
        ),
      ],
    );
  }
}

class DoctorAvatarPlaceholder extends StatelessWidget {
  final String name;

  const DoctorAvatarPlaceholder({super.key, required this.name});

  @override
  Widget build(BuildContext context) {
    final parts = name.trim().split(' ').where((e) => e.isNotEmpty).toList();
    String initials;
    if (parts.isEmpty) {
      initials = '?';
    } else if (parts.length == 1) {
      initials = parts[0][0].toUpperCase();
    } else {
      initials = '${parts[0][0]}${parts[1][0]}'.toUpperCase();
    }
    return Center(
      child: Text(
        initials,
        style: const TextStyle(
          fontSize: 48,
          fontWeight: FontWeight.w700,
          color: Colors.white,
        ),
      ),
    );
  }
}

class DoctorInfoCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color color;

  const DoctorInfoCard({
    super.key,
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 12,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: color, size: 24),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    fontSize: 12,
                    color: Colors.black54,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  value,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: Colors.black87,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class DoctorProfileDetails extends StatelessWidget {
  final DoctorProfileModel profile;

  const DoctorProfileDetails({super.key, required this.profile});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 12,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Profile Information',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: Colors.black87,
            ),
          ),
          const SizedBox(height: 14),
          DoctorDetailRow(label: 'Name', value: profile.name),
          const SizedBox(height: 12),
          DoctorDetailRow(label: 'Department', value: profile.department),
          if (profile.contactNumber != null) ...[
            const SizedBox(height: 12),
            DoctorDetailRow(label: 'Contact', value: profile.contactNumber!),
          ],
          const SizedBox(height: 12),
          DoctorDetailRow(
            label: 'Total Patients',
            value: profile.patientsCount.toString(),
          ),
        ],
      ),
    );
  }
}

class DoctorDetailRow extends StatelessWidget {
  final String label;
  final String value;

  const DoctorDetailRow({super.key, required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: const TextStyle(
            fontSize: 14,
            color: Colors.black54,
            fontWeight: FontWeight.w500,
          ),
        ),
        Text(
          value,
          style: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            color: Colors.black87,
          ),
        ),
      ],
    );
  }
}

class DoctorActionButtons extends StatelessWidget {
  final DoctorProfileModel profile;
  final VoidCallback onProfileUpdated;

  const DoctorActionButtons({
    super.key,
    required this.profile,
    required this.onProfileUpdated,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ElevatedButton.icon(
          onPressed: () {
            showModalBottomSheet(
              context: context,
              isScrollControlled: true,
              backgroundColor: Colors.transparent,
              builder: (ctx) => DoctorEditProfileModal(
                profile: profile,
                onSuccess: () {
                  Navigator.of(ctx).pop();
                  onProfileUpdated();
                },
              ),
            );
          },
          icon: const Icon(Icons.edit),
          label: const Text('Edit Profile'),
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFFFF7643),
            foregroundColor: Colors.white,
            padding: const EdgeInsets.symmetric(vertical: 14),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
        ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: () => _showLogoutConfirmation(context),
          icon: const Icon(Icons.logout),
          label: const Text('Logout'),
          style: OutlinedButton.styleFrom(
            foregroundColor: Colors.red,
            side: const BorderSide(color: Colors.red, width: 1.5),
            padding: const EdgeInsets.symmetric(vertical: 14),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
        ),
      ],
    );
  }

  void _showLogoutConfirmation(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => LogoutDialog(onLogout: () => _performLogout(context)),
    );
  }

  Future<void> _performLogout(BuildContext context) async {
    await AppDependencies.authRepository.logout();
    await QueryCache.instance.clear();

    if (context.mounted) {
      Navigator.of(
        context,
      ).pushNamedAndRemoveUntil(AppRoutes.login, (route) => false);
    }
  }
}

class DoctorEditProfileModal extends StatefulWidget {
  final DoctorProfileModel profile;
  final VoidCallback onSuccess;

  const DoctorEditProfileModal({
    super.key,
    required this.profile,
    required this.onSuccess,
  });

  @override
  State<DoctorEditProfileModal> createState() => _DoctorEditProfileModalState();
}

class _DoctorEditProfileModalState extends State<DoctorEditProfileModal> {
  final _formKey = GlobalKey<FormState>();
  final DoctorRepository _repository = AppDependencies.doctorRepository;

  late final TextEditingController _nameController;
  late final TextEditingController _departmentController;
  late final TextEditingController _contactController;

  bool _isLoading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.profile.name);
    _departmentController = TextEditingController(
      text: widget.profile.department,
    );
    _contactController = TextEditingController(
      text: widget.profile.contactNumber ?? '',
    );
  }

  @override
  void dispose() {
    _nameController.dispose();
    _departmentController.dispose();
    _contactController.dispose();
    super.dispose();
  }

  Future<void> _saveProfile() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final data = <String, dynamic>{};

      if (_nameController.text.trim() != widget.profile.name) {
        data['name'] = _nameController.text.trim();
      }
      if (_departmentController.text.trim() != widget.profile.department) {
        data['department'] = _departmentController.text.trim();
      }
      if (_contactController.text.trim() !=
          (widget.profile.contactNumber ?? '')) {
        data['contact_number'] = _contactController.text.trim();
      }

      if (data.isEmpty) {
        widget.onSuccess();
        return;
      }

      await _repository.updateProfile(data);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Profile updated successfully'),
            backgroundColor: Color(0xFF10B981),
          ),
        );
        widget.onSuccess();
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Container(
      margin: EdgeInsets.only(bottom: bottomInset),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Handle bar
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: const Color(0xFFE5E7EB),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 20),

                // Header
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFF7643).withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Icon(
                        Icons.edit,
                        color: Color(0xFFFF7643),
                        size: 24,
                      ),
                    ),
                    const SizedBox(width: 16),
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Edit Profile',
                            style: TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.w700,
                              color: Color(0xFF1F2937),
                            ),
                          ),
                          SizedBox(height: 4),
                          Text(
                            'Update your profile information',
                            style: TextStyle(
                              fontSize: 14,
                              color: Color(0xFF6B7280),
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.of(context).pop(),
                      icon: const Icon(Icons.close, color: Color(0xFF6B7280)),
                    ),
                  ],
                ),
                const SizedBox(height: 24),

                // Error message
                if (_error != null) ...[
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFEF2F2),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: const Color(0xFFFECACA)),
                    ),
                    child: Row(
                      children: [
                        const Icon(
                          Icons.error_outline,
                          color: Color(0xFFDC2626),
                          size: 20,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            _error!,
                            style: const TextStyle(
                              color: Color(0xFFDC2626),
                              fontSize: 13,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                ],

                // Name field
                _buildTextField(
                  controller: _nameController,
                  label: 'Name',
                  icon: Icons.person_outline,
                  validator: (value) {
                    if (value == null || value.trim().isEmpty) {
                      return 'Name is required';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 16),

                // Department field
                _buildTextField(
                  controller: _departmentController,
                  label: 'Department',
                  icon: Icons.business_outlined,
                ),
                const SizedBox(height: 16),

                // Contact field
                _buildTextField(
                  controller: _contactController,
                  label: 'Contact Number',
                  icon: Icons.phone_outlined,
                  keyboardType: TextInputType.phone,
                  helperText: '+91 is added automatically',
                  validator: (value) {
                    final digits = value?.replaceAll(RegExp(r'\D'), '') ?? '';
                    if (value != null &&
                        value.isNotEmpty &&
                        digits.length != 10 &&
                        !(digits.length == 12 && digits.startsWith('91'))) {
                      return 'Enter a 10-digit Indian number';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 24),

                // Action buttons
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: _isLoading
                            ? null
                            : () => Navigator.of(context).pop(),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: const Color(0xFF6B7280),
                          side: const BorderSide(color: Color(0xFFE5E7EB)),
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                        child: const Text('Cancel'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      flex: 2,
                      child: ElevatedButton(
                        onPressed: _isLoading ? null : _saveProfile,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFFFF7643),
                          foregroundColor: Colors.white,
                          disabledBackgroundColor: const Color(0xFFFFB99A),
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                        child: _isLoading
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : const Text('Save Changes'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildTextField({
    required TextEditingController controller,
    required String label,
    required IconData icon,
    TextInputType? keyboardType,
    String? Function(String?)? validator,
    String? helperText,
  }) {
    return TextFormField(
      controller: controller,
      keyboardType: keyboardType,
      validator: validator,
      style: const TextStyle(fontSize: 15, color: Color(0xFF1F2937)),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(color: Color(0xFF6B7280), fontSize: 14),
        prefixIcon: Icon(icon, color: const Color(0xFF9CA3AF), size: 22),
        helperText: helperText,
        filled: true,
        fillColor: const Color(0xFFF9FAFB),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFFE5E7EB)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFFE5E7EB)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFFFF7643), width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFFDC2626)),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFFDC2626), width: 1.5),
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 14,
        ),
      ),
    );
  }
}
