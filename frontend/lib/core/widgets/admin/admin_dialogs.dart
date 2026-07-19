import 'package:flutter/material.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/features/admin/data/admin_repository.dart';

/// Reusable dialog helpers for admin CRUD operations.
/// These use the [AdminRepository] directly via [AppDependencies] instead of
/// Riverpod providers (matching the target project conventions).

final AdminRepository _repo = AppDependencies.adminRepository;
final RegExp _strongPasswordRegex =
    RegExp(r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$');

String? _validateStrongPassword(String? value) {
  if (value == null || value.isEmpty) return 'Required';
  if (!_strongPasswordRegex.hasMatch(value)) {
    return 'Use 8+ chars with upper/lower/number/special';
  }
  return null;
}

// =============================================================================
// DOCTOR DIALOGS
// =============================================================================

String? _resolveHospitalId(dynamic hospitalRef) {
  if (hospitalRef is Map<String, dynamic>) {
    return (hospitalRef['_id'] ?? hospitalRef['id'])?.toString();
  }
  if (hospitalRef != null) {
    return hospitalRef.toString();
  }
  return null;
}

Future<bool> showAddDoctorDialog(
  BuildContext context, {
  VoidCallback? onSuccess,
}) async {
  final formKey = GlobalKey<FormState>();
  final loginId = TextEditingController();
  final password = TextEditingController();
  final name = TextEditingController();
  final department = TextEditingController();
  final contact = TextEditingController();
  bool loading = false;
  String? selectedHospitalId;
  List<Map<String, dynamic>> hospitalList = [];
  bool hospitalsLoading = true;
  bool hospitalsRequested = false;
  String? hospitalsError;

  final result = await showDialog<bool>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) {
        if (!hospitalsRequested) {
          hospitalsRequested = true;
          _repo.getHospitals().then((response) {
            final items = response['hospitals'] as List? ?? [];
            if (ctx.mounted) {
              setState(() {
                hospitalList = items.cast<Map<String, dynamic>>();
                hospitalsLoading = false;
              });
            }
          }).catchError((e) {
            if (ctx.mounted) {
              setState(() {
                hospitalsError = e.toString();
                hospitalsLoading = false;
              });
            }
          });
        }

        return AlertDialog(
          title: const Text('Register New Doctor'),
          content: SingleChildScrollView(
            child: Form(
              key: formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextFormField(
                    controller: loginId,
                    decoration: const InputDecoration(
                      labelText: 'Login ID',
                      prefixIcon: Icon(Icons.person_outline_rounded),
                    ),
                    enabled: !loading,
                    validator: (v) =>
                        (v == null || v.trim().isEmpty) ? 'Required' : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: password,
                    decoration: const InputDecoration(
                      labelText: 'Password',
                      prefixIcon: Icon(Icons.lock_outline_rounded),
                    ),
                    obscureText: true,
                    enabled: !loading,
                    validator: _validateStrongPassword,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: name,
                    decoration: const InputDecoration(
                      labelText: 'Full Name',
                      prefixIcon: Icon(Icons.badge_rounded),
                    ),
                    enabled: !loading,
                    validator: (v) =>
                        (v == null || v.trim().isEmpty) ? 'Required' : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: department,
                    decoration: const InputDecoration(
                      labelText: 'Department',
                      hintText: 'e.g., Cardiology',
                      prefixIcon: Icon(Icons.local_hospital_rounded),
                    ),
                    enabled: !loading,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: contact,
                    decoration: const InputDecoration(
                      labelText: 'Contact Number',
                      hintText: '10-digit Indian number',
                      helperText: '+91 is added automatically',
                      prefixIcon: Icon(Icons.phone_rounded),
                    ),
                    keyboardType: TextInputType.phone,
                    enabled: !loading,
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String?>(
                    initialValue: selectedHospitalId,
                    decoration: const InputDecoration(
                      labelText: 'Hospital',
                      prefixIcon: Icon(Icons.local_hospital_outlined),
                      hintText: 'Select hospital',
                    ),
                    isExpanded: true,
                    items: [
                      const DropdownMenuItem<String?>(
                        value: null,
                        child: Text('No hospital'),
                      ),
                      ...hospitalList.map((hospital) {
                        final id =
                            (hospital['_id'] ?? hospital['id'])?.toString() ??
                                '';
                        final name = hospital['name'] as String? ??
                            hospital['code'] as String? ??
                            'Hospital';
                        return DropdownMenuItem<String?>(
                          value: id.isNotEmpty ? id : null,
                          child: Text(name),
                        );
                      }),
                    ],
                    onChanged: hospitalsLoading
                        ? null
                        : (value) => setState(() => selectedHospitalId = value),
                    hint: hospitalsLoading
                        ? const Text('Loading hospitals...')
                        : const Text('Select hospital'),
                  ),
                  if (hospitalsError != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        hospitalsError!,
                        style: TextStyle(
                          color: Theme.of(ctx).colorScheme.error,
                          fontSize: 12,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: loading ? null : () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: loading
                  ? null
                  : () async {
                      if (!formKey.currentState!.validate()) return;
                      setState(() => loading = true);
                      try {
                        await _repo.createDoctor({
                          'login_id': loginId.text.trim(),
                          'password': password.text,
                          'name': name.text.trim(),
                          'department': department.text.trim().isNotEmpty
                              ? department.text.trim()
                              : 'General',
                          if (contact.text.trim().isNotEmpty)
                            'contact_number': contact.text.trim(),
                          if (selectedHospitalId != null &&
                              selectedHospitalId!.isNotEmpty)
                            'hospital_id': selectedHospitalId,
                        });
                        if (ctx.mounted) Navigator.pop(ctx, true);
                      } catch (e) {
                        if (ctx.mounted) {
                          ScaffoldMessenger.of(ctx).showSnackBar(
                            SnackBar(
                              content: Text('Error: $e'),
                              backgroundColor: Colors.red,
                            ),
                          );
                          setState(() => loading = false);
                        }
                      }
                    },
              child: loading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Register'),
            ),
          ],
        );
      },
    ),
  );

  if (result == true && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Doctor registered successfully'),
        backgroundColor: Colors.green,
      ),
    );
    onSuccess?.call();
  }
  return result ?? false;
}

Future<bool> showEditDoctorDialog(
  BuildContext context, {
  required String doctorId,
  required Map<String, dynamic> currentData,
  VoidCallback? onSuccess,
}) async {
  final formKey = GlobalKey<FormState>();
  final name = TextEditingController(
    text: currentData['name'] as String? ?? '',
  );
  final department = TextEditingController(
    text: currentData['department'] as String? ?? '',
  );
  final contact = TextEditingController(
    text: currentData['contact_number'] as String? ?? '',
  );
  bool loading = false;
  String? selectedHospitalId = _resolveHospitalId(currentData['hospital_id']);
  List<Map<String, dynamic>> hospitalList = [];
  bool hospitalsLoading = true;
  bool hospitalsRequested = false;
  String? hospitalsError;

  final result = await showDialog<bool>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) {
        if (!hospitalsRequested) {
          hospitalsRequested = true;
          _repo.getHospitals().then((response) {
            final items = response['hospitals'] as List? ?? [];
            if (ctx.mounted) {
              setState(() {
                hospitalList = items.cast<Map<String, dynamic>>();
                hospitalsLoading = false;
              });
            }
          }).catchError((e) {
            if (ctx.mounted) {
              setState(() {
                hospitalsError = e.toString();
                hospitalsLoading = false;
              });
            }
          });
        }

        return AlertDialog(
          title: const Text('Edit Doctor'),
          content: SingleChildScrollView(
            child: Form(
              key: formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextFormField(
                    controller: name,
                    decoration: const InputDecoration(labelText: 'Full Name'),
                    enabled: !loading,
                    validator: (v) =>
                        (v == null || v.trim().isEmpty) ? 'Required' : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: department,
                    decoration: const InputDecoration(labelText: 'Department'),
                    enabled: !loading,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: contact,
                    decoration: const InputDecoration(
                      labelText: 'Contact Number',
                      hintText: '10-digit Indian number',
                      helperText: '+91 is added automatically',
                    ),
                    keyboardType: TextInputType.phone,
                    enabled: !loading,
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String?>(
                    initialValue: selectedHospitalId,
                    decoration: const InputDecoration(
                      labelText: 'Hospital',
                      prefixIcon: Icon(Icons.local_hospital_outlined),
                      hintText: 'Select hospital',
                    ),
                    isExpanded: true,
                    items: [
                      const DropdownMenuItem<String?>(
                        value: null,
                        child: Text('No hospital'),
                      ),
                      ...hospitalList.map((hospital) {
                        final id =
                            (hospital['_id'] ?? hospital['id'])?.toString() ??
                                '';
                        final name = hospital['name'] as String? ??
                            hospital['code'] as String? ??
                            'Hospital';
                        return DropdownMenuItem<String?>(
                          value: id.isNotEmpty ? id : null,
                          child: Text(name),
                        );
                      }),
                    ],
                    onChanged: hospitalsLoading
                        ? null
                        : (value) => setState(() => selectedHospitalId = value),
                    hint: hospitalsLoading
                        ? const Text('Loading hospitals...')
                        : const Text('Select hospital'),
                  ),
                  if (hospitalsError != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        hospitalsError!,
                        style: TextStyle(
                          color: Theme.of(ctx).colorScheme.error,
                          fontSize: 12,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: loading ? null : () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: loading
                  ? null
                  : () async {
                      if (!formKey.currentState!.validate()) return;
                      setState(() => loading = true);
                      try {
                        await _repo.updateDoctor(doctorId, {
                          'name': name.text.trim(),
                          'department': department.text.trim(),
                          'contact_number': contact.text.trim(),
                          if (selectedHospitalId != null &&
                              selectedHospitalId!.isNotEmpty)
                            'hospital_id': selectedHospitalId,
                        });
                        if (ctx.mounted) Navigator.pop(ctx, true);
                      } catch (e) {
                        if (ctx.mounted) {
                          ScaffoldMessenger.of(ctx).showSnackBar(
                            SnackBar(
                              content: Text('Error: $e'),
                              backgroundColor: Colors.red,
                            ),
                          );
                          setState(() => loading = false);
                        }
                      }
                    },
              child: loading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Update'),
            ),
          ],
        );
      },
    ),
  );

  if (result == true && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Doctor updated successfully'),
        backgroundColor: Colors.green,
      ),
    );
    onSuccess?.call();
  }
  return result ?? false;
}

// =============================================================================
// PATIENT DIALOGS
// =============================================================================

Future<bool> showAddPatientDialog(
  BuildContext context, {
  List<Map<String, dynamic>> doctors = const [],
  VoidCallback? onSuccess,
}) async {
  final formKey = GlobalKey<FormState>();
  final loginId = TextEditingController();
  final password = TextEditingController();
  final name = TextEditingController();
  final age = TextEditingController();
  final phone = TextEditingController();
  String? selectedDoctorId;
  String? selectedGender;

  // Auto-fetch doctors if none provided
  List<Map<String, dynamic>> doctorList = List.from(doctors);
  bool doctorsLoading = doctorList.isEmpty;
  bool doctorsRequested = !doctorsLoading;
  String? doctorsError;
  bool loading = false;

  final result = await showDialog<bool>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) {
        // Fetch doctors on first build if list is empty
        if (!doctorsRequested) {
          doctorsRequested = true;
          _repo.getAllDoctors(limit: 100, isActive: 'true').then((response) {
            final items = response['doctors'] as List? ?? [];
            if (ctx.mounted) {
              setState(() {
                doctorList = items.cast<Map<String, dynamic>>();
                doctorsLoading = false;
              });
            }
          }).catchError((e) {
            if (ctx.mounted) {
              setState(() {
                doctorsError = e.toString();
                doctorsLoading = false;
              });
            }
          });
        }

        return AlertDialog(
          title: const Text('Onboard New Patient'),
          content: SingleChildScrollView(
            child: Form(
              key: formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextFormField(
                    controller: loginId,
                    decoration: const InputDecoration(
                      labelText: 'Login ID',
                      prefixIcon: Icon(Icons.person_outline_rounded),
                    ),
                    enabled: !loading,
                    validator: (v) =>
                        (v == null || v.trim().isEmpty) ? 'Required' : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: password,
                    decoration: const InputDecoration(
                      labelText: 'Password',
                      prefixIcon: Icon(Icons.lock_outline_rounded),
                    ),
                    obscureText: true,
                    enabled: !loading,
                    validator: _validateStrongPassword,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: name,
                    decoration: const InputDecoration(
                      labelText: 'Full Name',
                      prefixIcon: Icon(Icons.badge_rounded),
                    ),
                    enabled: !loading,
                    validator: (v) =>
                        (v == null || v.trim().isEmpty) ? 'Required' : null,
                  ),
                  const SizedBox(height: 12),
                  if (doctorsLoading)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 8),
                      child: Row(
                        children: [
                          SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                          SizedBox(width: 12),
                          Text('Loading doctors...'),
                        ],
                      ),
                    )
                  else if (doctorsError != null)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Text(
                        'Failed to load doctors',
                        style: TextStyle(color: Colors.red[700]),
                      ),
                    )
                  else
                    DropdownButtonFormField<String>(
                      decoration: const InputDecoration(
                        labelText: 'Assigned Doctor',
                        prefixIcon: Icon(Icons.medical_services_rounded),
                      ),
                      items: doctorList.map((d) {
                        final profile =
                            d['profile_id'] as Map<String, dynamic>? ?? {};
                        final dName = profile['name'] as String? ??
                            d['name'] as String? ??
                            d['login_id'] as String? ??
                            'Unknown';
                        return DropdownMenuItem(
                          value: d['_id'] as String? ?? d['id'] as String?,
                          child: Text(dName),
                        );
                      }).toList(),
                      onChanged: (v) => setState(() => selectedDoctorId = v),
                      validator: (v) => v == null ? 'Required' : null,
                    ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          controller: age,
                          decoration: const InputDecoration(labelText: 'Age'),
                          keyboardType: TextInputType.number,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          decoration: const InputDecoration(
                            labelText: 'Gender',
                          ),
                          items: const [
                            DropdownMenuItem(
                              value: 'Male',
                              child: Text('Male'),
                            ),
                            DropdownMenuItem(
                              value: 'Female',
                              child: Text('Female'),
                            ),
                            DropdownMenuItem(
                              value: 'Other',
                              child: Text('Other'),
                            ),
                          ],
                          onChanged: (v) => setState(() => selectedGender = v),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: phone,
                    decoration: const InputDecoration(
                      labelText: 'Phone Number',
                      hintText: '10-digit Indian number',
                      helperText: '+91 is added automatically',
                      prefixIcon: Icon(Icons.phone_rounded),
                    ),
                    keyboardType: TextInputType.phone,
                    enabled: !loading,
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: loading ? null : () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: loading
                  ? null
                  : () async {
                      if (!formKey.currentState!.validate() ||
                          selectedDoctorId == null) {
                        return;
                      }
                      setState(() => loading = true);
                      try {
                        await _repo.createPatient({
                          'login_id': loginId.text.trim(),
                          'password': password.text,
                          'assigned_doctor_id': selectedDoctorId,
                          'demographics': {
                            'name': name.text.trim(),
                            if (age.text.isNotEmpty)
                              'age': int.tryParse(age.text),
                            if (selectedGender != null)
                              'gender': selectedGender,
                            if (phone.text.trim().isNotEmpty)
                              'phone': phone.text.trim(),
                          },
                        });
                        if (ctx.mounted) Navigator.pop(ctx, true);
                      } catch (e) {
                        if (ctx.mounted) {
                          ScaffoldMessenger.of(ctx).showSnackBar(
                            SnackBar(
                              content: Text('Error: $e'),
                              backgroundColor: Colors.red,
                            ),
                          );
                          setState(() => loading = false);
                        }
                      }
                    },
              child: loading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Onboard'),
            ),
          ],
        );
      },
    ),
  );

  if (result == true && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Patient onboarded successfully'),
        backgroundColor: Colors.green,
      ),
    );
    onSuccess?.call();
  }
  return result ?? false;
}

Future<bool> showEditPatientDialog(
  BuildContext context, {
  required String patientId,
  required Map<String, dynamic> currentData,
  VoidCallback? onSuccess,
}) async {
  final formKey = GlobalKey<FormState>();
  final name =
      TextEditingController(text: currentData['name'] as String? ?? '');
  final age = TextEditingController(
    text: currentData['age'] != null ? '${currentData['age']}' : '',
  );
  final phone = TextEditingController(
    text: currentData['phone'] as String? ?? '',
  );
  String? selectedGender = currentData['gender'] as String?;
  bool loading = false;

  final result = await showDialog<bool>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) {
        return AlertDialog(
          title: const Text('Edit Patient Details'),
          content: SingleChildScrollView(
            child: Form(
              key: formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextFormField(
                    controller: name,
                    decoration: const InputDecoration(
                      labelText: 'Full Name',
                      prefixIcon: Icon(Icons.badge_rounded),
                    ),
                    enabled: !loading,
                    validator: (v) =>
                        (v == null || v.trim().isEmpty) ? 'Required' : null,
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          controller: age,
                          decoration: const InputDecoration(labelText: 'Age'),
                          keyboardType: TextInputType.number,
                          enabled: !loading,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          initialValue: ['Male', 'Female', 'Other'].contains(
                            selectedGender,
                          )
                              ? selectedGender
                              : null,
                          decoration:
                              const InputDecoration(labelText: 'Gender'),
                          items: const [
                            DropdownMenuItem(
                                value: 'Male', child: Text('Male')),
                            DropdownMenuItem(
                              value: 'Female',
                              child: Text('Female'),
                            ),
                            DropdownMenuItem(
                                value: 'Other', child: Text('Other')),
                          ],
                          onChanged: loading
                              ? null
                              : (v) => setState(() => selectedGender = v),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: phone,
                    decoration: const InputDecoration(
                      labelText: 'Phone Number',
                      hintText: '10-digit Indian number',
                      helperText: '+91 is added automatically',
                      prefixIcon: Icon(Icons.phone_rounded),
                    ),
                    keyboardType: TextInputType.phone,
                    enabled: !loading,
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: loading ? null : () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: loading
                  ? null
                  : () async {
                      if (!formKey.currentState!.validate()) return;
                      setState(() => loading = true);
                      try {
                        await _repo.updatePatient(patientId, {
                          'demographics': {
                            'name': name.text.trim(),
                            if (age.text.trim().isNotEmpty)
                              'age': int.tryParse(age.text.trim()),
                            if (selectedGender != null)
                              'gender': selectedGender,
                            if (phone.text.trim().isNotEmpty)
                              'phone': phone.text.trim(),
                          },
                        });
                        if (ctx.mounted) Navigator.pop(ctx, true);
                      } catch (e) {
                        if (ctx.mounted) {
                          ScaffoldMessenger.of(ctx).showSnackBar(
                            SnackBar(
                              content: Text('Error: $e'),
                              backgroundColor: Colors.red,
                            ),
                          );
                          setState(() => loading = false);
                        }
                      }
                    },
              child: loading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Update'),
            ),
          ],
        );
      },
    ),
  );

  if (result == true && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Patient updated successfully'),
        backgroundColor: Colors.green,
      ),
    );
    onSuccess?.call();
  }
  return result ?? false;
}

// =============================================================================
// COMMON DIALOGS
// =============================================================================

Future<bool> showDeactivateConfirmDialog(
  BuildContext context, {
  required String userId,
  required String userName,
  required String userType,
  required Future<void> Function() onConfirm,
  VoidCallback? onSuccess,
}) async {
  bool loading = false;
  final result = await showDialog<bool>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) {
        return AlertDialog(
          title: Text('Deactivate $userType'),
          content: Text(
            'Are you sure you want to deactivate $userName? They will no longer be able to access the system.',
          ),
          actions: [
            TextButton(
              onPressed: loading ? null : () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: Theme.of(ctx).colorScheme.error,
              ),
              onPressed: loading
                  ? null
                  : () async {
                      setState(() => loading = true);
                      try {
                        await onConfirm();
                        if (ctx.mounted) Navigator.pop(ctx, true);
                      } catch (e) {
                        if (ctx.mounted) {
                          ScaffoldMessenger.of(ctx).showSnackBar(
                            SnackBar(
                              content: Text('Error: $e'),
                              backgroundColor: Colors.red,
                            ),
                          );
                          setState(() => loading = false);
                        }
                      }
                    },
              child: loading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Text('Deactivate'),
            ),
          ],
        );
      },
    ),
  );

  if (result == true && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('$userType deactivated'),
        backgroundColor: Colors.green,
      ),
    );
    onSuccess?.call();
  }
  return result ?? false;
}

Future<bool> showStatusToggleDialog(
  BuildContext context, {
  required bool isActive,
  required String userName,
  required String userType,
  required Future<void> Function() onConfirm,
  VoidCallback? onSuccess,
}) async {
  final action = isActive ? 'Deactivate' : 'Activate';
  bool loading = false;

  final result = await showDialog<bool>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) {
        return AlertDialog(
          title: Text('$action $userType'),
          content: Text('Are you sure you want to $action $userName?'),
          actions: [
            TextButton(
              onPressed: loading ? null : () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              style: isActive
                  ? FilledButton.styleFrom(
                      backgroundColor: Theme.of(ctx).colorScheme.error,
                    )
                  : null,
              onPressed: loading
                  ? null
                  : () async {
                      setState(() => loading = true);
                      try {
                        await onConfirm();
                        if (ctx.mounted) Navigator.pop(ctx, true);
                      } catch (e) {
                        if (ctx.mounted) {
                          ScaffoldMessenger.of(ctx).showSnackBar(
                            SnackBar(
                              content: Text('Error: $e'),
                              backgroundColor: Colors.red,
                            ),
                          );
                          setState(() => loading = false);
                        }
                      }
                    },
              child: loading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : Text(action),
            ),
          ],
        );
      },
    ),
  );

  if (result == true && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('User status updated'),
        backgroundColor: Colors.green,
      ),
    );
    onSuccess?.call();
  }
  return result ?? false;
}

Future<bool> showResetPasswordDialog(
  BuildContext context, {
  required String userId,
  required String userName,
  VoidCallback? onSuccess,
}) async {
  final formKey = GlobalKey<FormState>();
  final passwordCtrl = TextEditingController();
  bool loading = false;

  final result = await showDialog<bool>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) {
        return AlertDialog(
          title: Text('Reset Password for $userName'),
          content: Form(
            key: formKey,
            child: TextFormField(
              controller: passwordCtrl,
              decoration: const InputDecoration(
                labelText: 'New Password',
                prefixIcon: Icon(Icons.lock_rounded),
              ),
              obscureText: true,
              enabled: !loading,
              validator: _validateStrongPassword,
            ),
          ),
          actions: [
            TextButton(
              onPressed: loading ? null : () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: loading
                  ? null
                  : () async {
                      if (!formKey.currentState!.validate()) return;
                      setState(() => loading = true);
                      try {
                        await _repo.resetUserPassword(
                          userId,
                          newPassword: passwordCtrl.text,
                        );
                        if (ctx.mounted) Navigator.pop(ctx, true);
                      } catch (e) {
                        if (ctx.mounted) {
                          ScaffoldMessenger.of(ctx).showSnackBar(
                            SnackBar(
                              content: Text('Error: $e'),
                              backgroundColor: Colors.red,
                            ),
                          );
                          setState(() => loading = false);
                        }
                      }
                    },
              child: loading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Reset'),
            ),
          ],
        );
      },
    ),
  );

  if (result == true && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Password reset successfully'),
        backgroundColor: Colors.green,
      ),
    );
    onSuccess?.call();
  }
  return result ?? false;
}

Future<bool> showReassignPatientDialog(
  BuildContext context, {
  required String patientOpNum,
  required String currentDoctorId,
  List<Map<String, dynamic>> doctors = const [],
  VoidCallback? onSuccess,
}) async {
  String? selectedDoctorId =
      currentDoctorId.isNotEmpty ? currentDoctorId : null;

  // Auto-fetch doctors if none provided
  List<Map<String, dynamic>> doctorList = List.from(doctors);
  bool doctorsLoading = doctorList.isEmpty;
  bool doctorsRequested = !doctorsLoading;
  String? doctorsError;
  bool loading = false;

  final result = await showDialog<bool>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) {
        // Fetch doctors on first build if list is empty
        if (!doctorsRequested) {
          doctorsRequested = true;
          _repo.getAllDoctors(limit: 100, isActive: 'true').then((response) {
            final items = response['doctors'] as List? ?? [];
            if (ctx.mounted) {
              setState(() {
                doctorList = items.cast<Map<String, dynamic>>();
                doctorsLoading = false;
              });
            }
          }).catchError((e) {
            if (ctx.mounted) {
              setState(() {
                doctorsError = e.toString();
                doctorsLoading = false;
              });
            }
          });
        }

        return AlertDialog(
          title: const Text('Reassign Doctor'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Select a new doctor for this patient'),
              const SizedBox(height: 16),
              if (doctorsLoading)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 8),
                  child: Row(
                    children: [
                      SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                      SizedBox(width: 12),
                      Text('Loading doctors...'),
                    ],
                  ),
                )
              else if (doctorsError != null)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Text(
                    'Failed to load doctors',
                    style: TextStyle(color: Colors.red[700]),
                  ),
                )
              else
                DropdownButtonFormField<String>(
                  initialValue: doctorList.any(
                    (d) => (d['_id'] ?? d['id']) == selectedDoctorId,
                  )
                      ? selectedDoctorId
                      : null,
                  decoration: const InputDecoration(
                    labelText: 'New Doctor',
                    prefixIcon: Icon(Icons.medical_services_rounded),
                  ),
                  items: doctorList.map((d) {
                    final profile =
                        d['profile_id'] as Map<String, dynamic>? ?? {};
                    final dName = profile['name'] as String? ??
                        d['name'] as String? ??
                        d['login_id'] as String? ??
                        'Unknown';
                    return DropdownMenuItem(
                      value: d['_id'] as String? ?? d['id'] as String?,
                      child: Text(dName),
                    );
                  }).toList(),
                  onChanged: (v) => setState(() => selectedDoctorId = v),
                ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: loading ? null : () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: (loading ||
                      selectedDoctorId == null ||
                      selectedDoctorId == currentDoctorId)
                  ? null
                  : () async {
                      setState(() => loading = true);
                      try {
                        await _repo.reassignPatient(
                          patientOpNum,
                          selectedDoctorId!,
                        );
                        if (ctx.mounted) Navigator.pop(ctx, true);
                      } catch (e) {
                        if (ctx.mounted) {
                          ScaffoldMessenger.of(ctx).showSnackBar(
                            SnackBar(
                              content: Text('Error: $e'),
                              backgroundColor: Colors.red,
                            ),
                          );
                          setState(() => loading = false);
                        }
                      }
                    },
              child: loading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Reassign'),
            ),
          ],
        );
      },
    ),
  );

  if (result == true && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Patient reassigned successfully'),
        backgroundColor: Colors.green,
      ),
    );
    onSuccess?.call();
  }
  return result ?? false;
}
