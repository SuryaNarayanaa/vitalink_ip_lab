import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/storage/secure_storage.dart';
import 'package:frontend/app/routers.dart';
import 'package:frontend/services/patient_service.dart';
import 'package:frontend/core/widgets/index.dart';
import 'package:intl/intl.dart';

class PatientProfileContent extends StatelessWidget {
  final Map<String, dynamic> profile;
  final VoidCallback onProfileUpdated;

  const PatientProfileContent({
    super.key,
    required this.profile,
    required this.onProfileUpdated,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isCompact = constraints.maxWidth < 380;

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (isCompact)
              Column(
                children: [
                  _buildAvatar(),
                  const SizedBox(height: 16),
                  _buildHeaderDetails(isCompact: true),
                ],
              )
            else
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  _buildAvatar(),
                  const SizedBox(width: 20),
                  Expanded(child: _buildHeaderDetails()),
                ],
              ),
            const SizedBox(height: 24),

            // Info Cards
            if (isCompact)
              Column(
                children: [
                  PatientInfoSmallCard(
                    icon: Icons.calendar_today,
                    label: 'Age',
                    value: '${profile['age'] ?? 'N/A'} yrs',
                    color: const Color(0xFFFF7643),
                  ),
                  const SizedBox(height: 12),
                  PatientInfoSmallCard(
                    icon: profile['gender'] == 'Female'
                        ? Icons.female
                        : Icons.male,
                    label: 'Gender',
                    value: profile['gender'] ?? 'N/A',
                    color: const Color(0xFF10B981),
                  ),
                ],
              )
            else
              Row(
                children: [
                  Expanded(
                    child: PatientInfoSmallCard(
                      icon: Icons.calendar_today,
                      label: 'Age',
                      value: '${profile['age'] ?? 'N/A'} yrs',
                      color: const Color(0xFFFF7643),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: PatientInfoSmallCard(
                      icon: profile['gender'] == 'Female'
                          ? Icons.female
                          : Icons.male,
                      label: 'Gender',
                      value: profile['gender'] ?? 'N/A',
                      color: const Color(0xFF10B981),
                    ),
                  ),
                ],
              ),
            const SizedBox(height: 12),

            PatientInfoCard(
              icon: Icons.medical_services,
              label: 'Therapy Drug',
              value: profile['therapyDrug'] ?? 'Warfarin',
              color: const Color(0xFF8B5CF6),
            ),
            const SizedBox(height: 12),

            if (profile['doctorName'] != null)
              PatientInfoCard(
                icon: Icons.person,
                label: 'Assigned Doctor',
                value: profile['doctorName']!,
                color: const Color(0xFF3B82F6),
              ),
            const SizedBox(height: 12),

            // Profile Details Section
            PatientProfileDetails(profile: profile),
            const SizedBox(height: 24),

            // Action Buttons
            PatientActionButtons(
              profile: profile,
              onProfileUpdated: onProfileUpdated,
            ),
          ],
        );
      },
    );
  }

  Widget _buildAvatar() {
    return Container(
      width: 100,
      height: 100,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF6366F1), Color(0xFFA5B4FC)],
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.15),
            blurRadius: 12,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: profile['profilePictureUrl'] != null
          ? ClipOval(
              child: Image.network(
                profile['profilePictureUrl']!,
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) =>
                    PatientAvatarPlaceholder(name: profile['name'] ?? 'P'),
              ),
            )
          : PatientAvatarPlaceholder(name: profile['name'] ?? 'P'),
    );
  }

  Widget _buildHeaderDetails({bool isCompact = false}) {
    return Column(
      crossAxisAlignment:
          isCompact ? CrossAxisAlignment.center : CrossAxisAlignment.start,
      children: [
        Text(
          profile['name'] ?? 'Patient Name',
          textAlign: isCompact ? TextAlign.center : TextAlign.start,
          style: const TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w800,
            color: Colors.black87,
          ),
        ),
        if ((profile['opNumber']?.toString().trim().isNotEmpty ?? false)) ...[
          const SizedBox(height: 6),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
            decoration: BoxDecoration(
              color: const Color(0xFFEEF2FF),
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: const Color(0xFFC7D2FE), width: 1),
            ),
            child: Text(
              'OP #${profile['opNumber']}',
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: Color(0xFF4338CA),
                letterSpacing: 0.2,
              ),
            ),
          ),
        ],
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(
            color: const Color(0xFF6366F1).withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: const Color(0xFF6366F1), width: 1.5),
          ),
          child: Text(
            'Target INR: ${profile['targetINR'] ?? '2.0 - 3.0'}',
            textAlign: isCompact ? TextAlign.center : TextAlign.start,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: Color(0xFF6366F1),
            ),
          ),
        ),
      ],
    );
  }
}

class PatientAvatarPlaceholder extends StatelessWidget {
  final String name;

  const PatientAvatarPlaceholder({super.key, required this.name});

  @override
  Widget build(BuildContext context) {
    final parts = name.trim().split(' ').where((e) => e.isNotEmpty).toList();
    String initials;
    if (parts.isEmpty) {
      initials = 'P';
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

class PatientInfoSmallCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color color;

  const PatientInfoSmallCard({
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
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(height: 12),
          Text(
            label,
            style: const TextStyle(
              fontSize: 11,
              color: Colors.black54,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: Colors.black87,
            ),
          ),
        ],
      ),
    );
  }
}

class PatientInfoCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color color;

  const PatientInfoCard({
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
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 10,
            offset: const Offset(0, 4),
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
                  overflow: TextOverflow.ellipsis,
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

class PatientProfileDetails extends StatelessWidget {
  final Map<String, dynamic> profile;

  const PatientProfileDetails({super.key, required this.profile});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Personal Details',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: Colors.black87,
            ),
          ),
          const SizedBox(height: 14),
          PatientDetailRow(label: 'Phone', value: profile['phone'] ?? 'N/A'),
          const SizedBox(height: 12),
          PatientDetailRow(
              label: 'Caregiver', value: profile['caregiver'] ?? 'N/A'),
          const SizedBox(height: 12),
          PatientDetailRow(
              label: 'Kin Name', value: profile['kinName'] ?? 'N/A'),
          const SizedBox(height: 12),
          PatientDetailRow(
              label: 'Kin Phone', value: profile['kinPhone'] ?? 'N/A'),
          const SizedBox(height: 16),
          const Text(
            'Therapy Details',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: Colors.black87,
            ),
          ),
          const SizedBox(height: 14),
          PatientDetailRow(
              label: 'Start Date', value: profile['therapyStartDate'] ?? 'N/A'),
          const SizedBox(height: 12),
          PatientDetailRow(
              label: 'Next Review', value: profile['nextReviewDate'] ?? 'N/A'),
        ],
      ),
    );
  }
}

class PatientDetailRow extends StatelessWidget {
  final String label;
  final String value;

  const PatientDetailRow({super.key, required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isCompact = constraints.maxWidth < 340;

        return isCompact
            ? Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: const TextStyle(
                      fontSize: 14,
                      color: Colors.black54,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    value,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: Colors.black87,
                    ),
                  ),
                ],
              )
            : Row(
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
                  Flexible(
                    child: Text(
                      value,
                      textAlign: TextAlign.right,
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: Colors.black87,
                      ),
                    ),
                  ),
                ],
              );
      },
    );
  }
}

class PatientActionButtons extends StatelessWidget {
  final Map<String, dynamic> profile;
  final VoidCallback onProfileUpdated;

  const PatientActionButtons({
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
              builder: (ctx) => PatientEditProfileModal(
                profile: profile,
                onSuccess: () {
                  Navigator.of(ctx).pop();
                  onProfileUpdated();
                },
              ),
            );
          },
          icon: const Icon(Icons.edit, size: 20),
          label: const Text('Update Profile'),
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFF6366F1),
            foregroundColor: Colors.white,
            padding: const EdgeInsets.symmetric(vertical: 16),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
            elevation: 2,
          ),
        ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: () => _showLogoutConfirmation(context),
          icon: const Icon(Icons.logout, size: 20),
          label: const Text('Logout'),
          style: OutlinedButton.styleFrom(
            foregroundColor: Colors.red,
            side: const BorderSide(color: Colors.red, width: 1.5),
            padding: const EdgeInsets.symmetric(vertical: 16),
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
      builder: (ctx) => LogoutDialog(
        onLogout: () => _performLogout(context),
      ),
    );
  }

  Future<void> _performLogout(BuildContext context) async {
    final SecureStorage secureStorage = AppDependencies.secureStorage;
    await secureStorage.clearAuthData();
    await QueryCache.instance.clear();
    if (context.mounted) {
      Navigator.of(context).pushNamedAndRemoveUntil(
        AppRoutes.login,
        (route) => false,
      );
    }
  }
}

class PatientEditProfileModal extends StatefulWidget {
  final Map<String, dynamic> profile;
  final VoidCallback onSuccess;

  const PatientEditProfileModal({
    super.key,
    required this.profile,
    required this.onSuccess,
  });

  @override
  State<PatientEditProfileModal> createState() =>
      _PatientEditProfileModalState();
}

class _PatientEditProfileModalState extends State<PatientEditProfileModal> {
  final _formKey = GlobalKey<FormState>();

  late final TextEditingController _nameController;
  late final TextEditingController _ageController;
  late final TextEditingController _phoneController;
  late final TextEditingController _caregiverController;
  late final TextEditingController _kinNameController;
  late final TextEditingController _kinPhoneController;
  late final TextEditingController _therapyStartController;

  String? _selectedGender;
  bool _isLoading = false;
  String? _error;
  DateTime _selectedTherapyDate = DateTime.now();

  Future<void> _selectDate(BuildContext context) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedTherapyDate,
      firstDate: DateTime(1900),
      lastDate: DateTime.now(),
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: ColorScheme.light(
              primary: const Color(0xFF6366F1),
              onPrimary: Colors.white,
              onSurface: Colors.black87,
            ),
          ),
          child: child!,
        );
      },
    );

    if (picked != null) {
      setState(() {
        _selectedTherapyDate = picked;
        _therapyStartController.text = DateFormat('dd-MM-yyyy').format(picked);
      });
    }
  }

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.profile['name']);
    _ageController =
        TextEditingController(text: widget.profile['age']?.toString() ?? '');
    _phoneController =
        TextEditingController(text: widget.profile['phone'] ?? '');
    _caregiverController =
        TextEditingController(text: widget.profile['caregiver'] ?? '');
    _kinNameController =
        TextEditingController(text: widget.profile['kinName'] ?? '');
    _kinPhoneController =
        TextEditingController(text: widget.profile['kinPhone'] ?? '');
    _therapyStartController =
        TextEditingController(text: widget.profile['therapyStartDate'] ?? '');
    _selectedGender = widget.profile['gender'];

    if (widget.profile['therapyStartDate'] != null) {
      try {
        _selectedTherapyDate =
            DateFormat('dd-MM-yyyy').parse(widget.profile['therapyStartDate']);
      } catch (_) {
        _selectedTherapyDate = DateTime.now();
      }
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _ageController.dispose();
    _phoneController.dispose();
    _caregiverController.dispose();
    _kinNameController.dispose();
    _kinPhoneController.dispose();
    _therapyStartController.dispose();
    super.dispose();
  }

  Future<void> _saveProfile() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final demographics = <String, dynamic>{};
      final medicalConfig = <String, dynamic>{};

      demographics['name'] = _nameController.text.trim();
      if (_ageController.text.isNotEmpty) {
        demographics['age'] = int.tryParse(_ageController.text) ?? 0;
      }
      if (_selectedGender != null) {
        demographics['gender'] = _selectedGender;
      }
      if (_phoneController.text.trim().isNotEmpty) {
        demographics['phone'] = _phoneController.text.trim();
      }

      final nextOfKin = <String, dynamic>{};
      if (_kinNameController.text.trim().isNotEmpty) {
        nextOfKin['name'] = _kinNameController.text.trim();
      }
      if (_kinPhoneController.text.trim().isNotEmpty) {
        nextOfKin['phone'] = _kinPhoneController.text.trim();
      }
      if (_caregiverController.text.trim().isNotEmpty) {
        nextOfKin['relation'] = _caregiverController.text.trim();
      }
      if (nextOfKin.isNotEmpty) {
        demographics['next_of_kin'] = nextOfKin;
      }

      if (_therapyStartController.text.trim().isNotEmpty) {
        medicalConfig['therapy_start_date'] =
            _therapyStartController.text.trim();
      }

      await PatientService.updateProfile(
        demographics: demographics,
        medicalConfig: medicalConfig.isNotEmpty ? medicalConfig : null,
      );

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
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.9,
      ),
      margin: EdgeInsets.only(bottom: bottomInset),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Handle bar
          const SizedBox(height: 12),
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
          const SizedBox(height: 12),

          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 32),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text(
                      'Update Profile',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w800,
                        color: Color(0xFF1F2937),
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Keep your medical and contact information current',
                      style: TextStyle(
                        fontSize: 14,
                        color: Color(0xFF6B7280),
                      ),
                    ),
                    const SizedBox(height: 24),
                    if (_error != null) ...[
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFEF2F2),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: const Color(0xFFFECACA)),
                        ),
                        child: Text(
                          _error!,
                          style: const TextStyle(
                              color: Color(0xFFDC2626), fontSize: 13),
                        ),
                      ),
                      const SizedBox(height: 16),
                    ],
                    _buildSectionTitle('Demographics'),
                    _buildTextField(
                      controller: _nameController,
                      label: 'Name',
                      icon: Icons.person_outline,
                      validator: (v) => v!.isEmpty ? 'Required' : null,
                    ),
                    const SizedBox(height: 16),
                    LayoutBuilder(
                      builder: (context, constraints) {
                        final isCompact = constraints.maxWidth < 380;

                        return isCompact
                            ? Column(
                                children: [
                                  _buildTextField(
                                    controller: _ageController,
                                    label: 'Age',
                                    icon: Icons.calendar_today_outlined,
                                    keyboardType: TextInputType.number,
                                  ),
                                  const SizedBox(height: 16),
                                  _buildDropdownField(
                                    label: 'Gender',
                                    value: _selectedGender,
                                    items: ['Male', 'Female', 'Other'],
                                    onChanged: (v) =>
                                        setState(() => _selectedGender = v),
                                  ),
                                ],
                              )
                            : Row(
                                children: [
                                  Expanded(
                                    child: _buildTextField(
                                      controller: _ageController,
                                      label: 'Age',
                                      icon: Icons.calendar_today_outlined,
                                      keyboardType: TextInputType.number,
                                    ),
                                  ),
                                  const SizedBox(width: 16),
                                  Expanded(
                                    child: _buildDropdownField(
                                      label: 'Gender',
                                      value: _selectedGender,
                                      items: ['Male', 'Female', 'Other'],
                                      onChanged: (v) => setState(
                                        () => _selectedGender = v,
                                      ),
                                    ),
                                  ),
                                ],
                              );
                      },
                    ),
                    const SizedBox(height: 16),
                    _buildTextField(
                      controller: _phoneController,
                      label: 'Phone Number',
                      icon: Icons.phone_outlined,
                      keyboardType: TextInputType.phone,
                    ),
                    const SizedBox(height: 24),
                    _buildSectionTitle('Caregiver & Kin'),
                    _buildTextField(
                      controller: _caregiverController,
                      label: 'Caregiver Name',
                      icon: Icons.handshake_outlined,
                    ),
                    const SizedBox(height: 16),
                    _buildTextField(
                      controller: _kinNameController,
                      label: 'Next of Kin Name',
                      icon: Icons.family_restroom_outlined,
                    ),
                    const SizedBox(height: 16),
                    _buildTextField(
                      controller: _kinPhoneController,
                      label: 'Kin Phone Number',
                      icon: Icons.contact_phone_outlined,
                      keyboardType: TextInputType.phone,
                    ),
                    const SizedBox(height: 24),
                    _buildSectionTitle('Therapy Configuration'),
                    _buildTextField(
                      controller: _therapyStartController,
                      label: 'Start Date (DD-MM-YYYY)',
                      icon: Icons.date_range_outlined,
                      readOnly: true,
                      onTap: () => _selectDate(context),
                      suffixIcon: const Icon(Icons.calendar_month,
                          color: Color(0xFF9CA3AF), size: 20),
                    ),
                    const SizedBox(height: 32),
                    LayoutBuilder(
                      builder: (context, constraints) {
                        final isCompact = constraints.maxWidth < 380;

                        return isCompact
                            ? Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  ElevatedButton(
                                    onPressed: _isLoading ? null : _saveProfile,
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: const Color(0xFF6366F1),
                                      foregroundColor: Colors.white,
                                      padding: const EdgeInsets.symmetric(
                                          vertical: 16),
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
                                  const SizedBox(height: 12),
                                  OutlinedButton(
                                    onPressed: _isLoading
                                        ? null
                                        : () => Navigator.of(context).pop(),
                                    style: OutlinedButton.styleFrom(
                                      foregroundColor: const Color(0xFF6B7280),
                                      padding: const EdgeInsets.symmetric(
                                          vertical: 16),
                                      shape: RoundedRectangleBorder(
                                        borderRadius: BorderRadius.circular(12),
                                      ),
                                    ),
                                    child: const Text('Cancel'),
                                  ),
                                ],
                              )
                            : Row(
                                children: [
                                  Expanded(
                                    child: OutlinedButton(
                                      onPressed: _isLoading
                                          ? null
                                          : () => Navigator.of(context).pop(),
                                      style: OutlinedButton.styleFrom(
                                        foregroundColor:
                                            const Color(0xFF6B7280),
                                        padding: const EdgeInsets.symmetric(
                                            vertical: 16),
                                        shape: RoundedRectangleBorder(
                                          borderRadius:
                                              BorderRadius.circular(12),
                                        ),
                                      ),
                                      child: const Text('Cancel'),
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    flex: 2,
                                    child: ElevatedButton(
                                      onPressed:
                                          _isLoading ? null : _saveProfile,
                                      style: ElevatedButton.styleFrom(
                                        backgroundColor:
                                            const Color(0xFF6366F1),
                                        foregroundColor: Colors.white,
                                        padding: const EdgeInsets.symmetric(
                                            vertical: 16),
                                        shape: RoundedRectangleBorder(
                                          borderRadius:
                                              BorderRadius.circular(12),
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
                              );
                      },
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionTitle(String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text(
        title.toUpperCase(),
        style: const TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w700,
          color: Color(0xFF9CA3AF),
          letterSpacing: 1,
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
    bool readOnly = false,
    VoidCallback? onTap,
    Widget? suffixIcon,
  }) {
    return TextFormField(
      controller: controller,
      keyboardType: keyboardType,
      validator: validator,
      readOnly: readOnly,
      onTap: onTap,
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: Icon(icon, size: 20, color: const Color(0xFF9CA3AF)),
        suffixIcon: suffixIcon,
        filled: true,
        fillColor: const Color(0xFFF9FAFB),
        border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFFE5E7EB))),
        enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFFE5E7EB))),
        focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFF6366F1), width: 1.5)),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      ),
    );
  }

  Widget _buildDropdownField({
    required String label,
    required String? value,
    required List<String> items,
    required Function(String?) onChanged,
  }) {
    return DropdownButtonFormField<String>(
      initialValue: value,
      items:
          items.map((i) => DropdownMenuItem(value: i, child: Text(i))).toList(),
      onChanged: onChanged,
      decoration: InputDecoration(
        labelText: label,
        filled: true,
        fillColor: const Color(0xFFF9FAFB),
        border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFFE5E7EB))),
        enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFFE5E7EB))),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      ),
    );
  }
}
