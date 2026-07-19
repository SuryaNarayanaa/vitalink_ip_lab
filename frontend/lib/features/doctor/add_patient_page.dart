import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/query/doctor_query_keys.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/core/utils/phone_utils.dart';
import 'package:frontend/features/doctor/data/doctor_repository.dart';
import 'package:frontend/features/doctor/models/doctor_profile_model.dart';
import 'package:styled_widget/styled_widget.dart';

class AddPatientForm extends StatefulWidget {
  const AddPatientForm({super.key, this.onSuccess});

  final VoidCallback? onSuccess;

  @override
  State<AddPatientForm> createState() => _AddPatientFormState();
}

class _AddPatientFormState extends State<AddPatientForm> {
  final _formKey = GlobalKey<FormState>();
  final DoctorRepository _repo = AppDependencies.doctorRepository;

  final _nameCtrl = TextEditingController();
  final _opCtrl = TextEditingController();
  final _ageCtrl = TextEditingController();
  final _contactCtrl = TextEditingController();
  final _targetMinCtrl = TextEditingController();
  final _targetMaxCtrl = TextEditingController();
  final _therapyStartCtrl = TextEditingController();
  final _kinNameCtrl = TextEditingController();
  final _kinContactCtrl = TextEditingController();

  final _monCtrl = TextEditingController();
  final _tueCtrl = TextEditingController();
  final _wedCtrl = TextEditingController();
  final _thuCtrl = TextEditingController();
  final _friCtrl = TextEditingController();
  final _satCtrl = TextEditingController();
  final _sunCtrl = TextEditingController();

  final _historyDiagCtrl = TextEditingController();
  final _historyDurationCtrl = TextEditingController();

  String _gender = 'Male';
  String? _therapy;
  String _historyUnit = 'Days';
  final Map<String, bool> _dayEnabled = {
    'Mon': false,
    'Tue': false,
    'Wed': false,
    'Thu': false,
    'Fri': false,
    'Sat': false,
    'Sun': false,
  };
  DateTime? _therapyStartDate;

  @override
  void dispose() {
    _nameCtrl.dispose();
    _opCtrl.dispose();
    _ageCtrl.dispose();
    _contactCtrl.dispose();
    _targetMinCtrl.dispose();
    _targetMaxCtrl.dispose();
    _therapyStartCtrl.dispose();
    _kinNameCtrl.dispose();
    _kinContactCtrl.dispose();
    _monCtrl.dispose();
    _tueCtrl.dispose();
    _wedCtrl.dispose();
    _thuCtrl.dispose();
    _friCtrl.dispose();
    _satCtrl.dispose();
    _sunCtrl.dispose();
    _historyDiagCtrl.dispose();
    _historyDurationCtrl.dispose();
    super.dispose();
  }

  Map<String, dynamic> _buildPayload() {
    double? numFromCtrl(TextEditingController c) {
      final v = c.text.trim();
      if (v.isEmpty) return null;
      return double.tryParse(v);
    }

    Map<String, double>? dosage() {
      final map = <String, double>{};
      void add(String key, String dayLabel, TextEditingController c) {
        if (_dayEnabled[dayLabel] != true) return;
        final v = numFromCtrl(c);
        if (v != null) map[key] = v;
      }

      add('monday', 'Mon', _monCtrl);
      add('tuesday', 'Tue', _tueCtrl);
      add('wednesday', 'Wed', _wedCtrl);
      add('thursday', 'Thu', _thuCtrl);
      add('friday', 'Fri', _friCtrl);
      add('saturday', 'Sat', _satCtrl);
      add('sunday', 'Sun', _sunCtrl);
      return map.isEmpty ? null : map;
    }

    Map<String, dynamic>? medicalHistory() {
      if (_historyDiagCtrl.text.trim().isEmpty &&
          _historyDurationCtrl.text.trim().isEmpty) {
        return null;
      }
      return {
        'diagnosis': _historyDiagCtrl.text.trim().isEmpty
            ? null
            : _historyDiagCtrl.text.trim(),
        'duration_value': double.tryParse(_historyDurationCtrl.text.trim()),
        'duration_unit':
            _historyDurationCtrl.text.trim().isEmpty ? null : _historyUnit,
      };
    }

    final payload = <String, dynamic>{
      'name': _nameCtrl.text.trim(),
      'op_num': _opCtrl.text.trim(),
      'age': _ageCtrl.text.trim().isEmpty
          ? null
          : int.tryParse(_ageCtrl.text.trim()),
      'gender': _gender,
      'contact_no': PhoneUtils.formatForApi(_contactCtrl.text),
      'target_inr_min': numFromCtrl(_targetMinCtrl),
      'target_inr_max': numFromCtrl(_targetMaxCtrl),
      'therapy': _therapy,
      'therapy_start_date': _therapyStartCtrl.text.trim().isEmpty
          ? null
          : _therapyStartCtrl.text.trim(),
      'prescription': dosage(),
      'medical_history': medicalHistory() == null ? null : [medicalHistory()],
      'kin_name':
          _kinNameCtrl.text.trim().isEmpty ? null : _kinNameCtrl.text.trim(),
      'kin_contact_number': PhoneUtils.formatForApi(_kinContactCtrl.text),
    };

    payload.removeWhere((key, value) => value == null);
    return payload;
  }

  Future<void> _pickTherapyDate() async {
    final now = DateTime.now();
    final initial = _therapyStartDate ?? now;
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(now.year - 5),
      lastDate: DateTime(now.year + 5),
      helpText: 'Select therapy start date',
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: Theme.of(context)
                .colorScheme
                .copyWith(primary: const Color(0xFF6B5FB3)),
          ),
          child: child ?? const SizedBox.shrink(),
        );
      },
    );

    if (picked != null) {
      _therapyStartDate = picked;
      final formatted =
          '${picked.day.toString().padLeft(2, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.year}';
      _therapyStartCtrl.text = formatted;
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    return UseMutation<Map<String, dynamic>, Map<String, dynamic>>(
      options: MutationOptions<Map<String, dynamic>, Map<String, dynamic>>(
        mutationFn: _repo.addPatient,
        onSuccess: (data, variables) async {
          if (!context.mounted) return;
          QueryClientProvider.of(context).invalidateQueries(
            DoctorQueryKeys.patients(),
          );
          final temporaryPassword = data['temporary_password'] as String?;
          if (temporaryPassword != null && context.mounted) {
            await showDialog<void>(
              context: context,
              barrierDismissible: false,
              builder: (dialogContext) => AlertDialog(
                title: const Text('Patient account created'),
                content: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Share this one-time password with the patient through an approved secure channel. It will not be shown again.',
                    ),
                    const SizedBox(height: 16),
                    const Text('Temporary password', style: TextStyle(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 6),
                    SelectableText(temporaryPassword),
                  ],
                ),
                actions: [
                  FilledButton(
                    onPressed: () => Navigator.of(dialogContext).pop(),
                    child: const Text('I have recorded it securely'),
                  ),
                ],
              ),
            );
          }
          if (!context.mounted) return;
          widget.onSuccess?.call();
        },
        onError: (error, variables) {
          if (!context.mounted) return;
          final message =
              error is ApiException ? error.message : error.toString();
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Failed: $message')),
          );
        },
      ),
      builder: (context, mutation) {
        final keyboardInset = MediaQuery.viewInsetsOf(context).bottom;
        return ScrollConfiguration(
          behavior: const MaterialScrollBehavior()
              .copyWith(physics: const BouncingScrollPhysics()),
          child: SingleChildScrollView(
            padding: EdgeInsets.fromLTRB(20, 22, 20, 22 + keyboardInset),
            physics: const BouncingScrollPhysics(),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const _DoctorGreeting(),
                ClipRRect(
                  borderRadius: BorderRadius.circular(20),
                  child: BackdropFilter(
                    filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
                    child: Container(
                      width: double.infinity,
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.94),
                        borderRadius: BorderRadius.circular(20),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.08),
                            blurRadius: 20,
                            offset: const Offset(0, 10),
                          ),
                        ],
                      ),
                      child: Form(
                        key: _formKey,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _sectionTitle('Patient Details'),
                            _buildTextField(_nameCtrl, 'Name',
                                hint: 'Enter patient name', isRequired: true),
                            _buildTextField(_opCtrl, 'OP Number',
                                hint: 'Enter OP number', isRequired: true),
                            Row(
                              children: [
                                Expanded(
                                    child: _buildTextField(_ageCtrl, 'Age',
                                        hint: 'Enter your age',
                                        keyboard: TextInputType.number,
                                        numeric: true,
                                        integerOnly: true,
                                        min: 1,
                                        max: 120)),
                                const SizedBox(width: 12),
                                Expanded(
                                    child: _buildDropdown(
                                        'Gender',
                                        _gender,
                                        ['Male', 'Female', 'Other'],
                                        (v) => setState(() => _gender = v),
                                        isRequired: true)),
                              ],
                            ),
                            Row(
                              children: [
                                Expanded(
                                    child: _buildTextField(
                                        _targetMinCtrl, 'Target INR Min',
                                        hint: 'Min',
                                        isRequired: true,
                                        numeric: true,
                                        min: 0,
                                        minExclusive: true,
                                        keyboard: const TextInputType
                                            .numberWithOptions(decimal: true))),
                                const SizedBox(width: 12),
                                Expanded(
                                    child: _buildTextField(
                                        _targetMaxCtrl, 'Target INR Max',
                                        hint: 'Max',
                                        isRequired: true,
                                        numeric: true,
                                        min: 0,
                                        minExclusive: true,
                                        greaterThan: _targetMinCtrl,
                                        keyboard: const TextInputType
                                            .numberWithOptions(decimal: true))),
                              ],
                            ),
                            _buildDropdown('Therapy', _therapy, _therapyOptions,
                                (v) => setState(() => _therapy = v),
                                isRequired: true),
                            const SizedBox(height: 12),
                            _medicalHistoryCard(),
                            const SizedBox(height: 14),
                            _buildDateField(
                              controller: _therapyStartCtrl,
                              label: 'Therapy Start Date',
                              hint: 'dd-mm-yyyy',
                              isRequired: true,
                              onTap: _pickTherapyDate,
                            ),
                            const SizedBox(height: 10),
                            _sectionTitle('Prescription *'),
                            _dosageList(),
                            const SizedBox(height: 14),
                            _buildTextField(_contactCtrl, 'Contact',
                                hint: '10-digit Indian number (+91 automatic)',
                                isRequired: true,
                                keyboard: TextInputType.phone,
                                validator: (value) => PhoneUtils.validate(
                                      value,
                                      label: 'Contact',
                                      required: true,
                                    )),
                            _buildTextField(_kinNameCtrl, 'Kin Name',
                                hint: 'Enter Kin name', isRequired: true),
                            _buildTextField(_kinContactCtrl, 'Kin Contact',
                                hint: '10-digit Indian number',
                                isRequired: true,
                                keyboard: TextInputType.phone,
                                validator: (value) => PhoneUtils.validate(
                                      value,
                                      label: 'Kin Contact',
                                      required: true,
                                    )),
                            const SizedBox(height: 10),
                            SizedBox(
                              width: double.infinity,
                              child: ElevatedButton(
                                onPressed: mutation.isLoading
                                    ? null
                                    : () {
                                        if (_formKey.currentState?.validate() ??
                                            false) {
                                          mutation.mutate(_buildPayload());
                                        }
                                      },
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: Colors.white,
                                  foregroundColor: Colors.black,
                                  elevation: 0,
                                  side: const BorderSide(
                                      color: Colors.black87, width: 1),
                                  padding:
                                      const EdgeInsets.symmetric(vertical: 16),
                                  shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(12)),
                                ),
                                child: mutation.isLoading
                                    ? const SizedBox(
                                        height: 20,
                                        width: 20,
                                        child: CircularProgressIndicator(
                                            strokeWidth: 2))
                                    : const Text('Add Patient'),
                              ),
                            ),
                          ],
                        ).padding(all: 18),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _sectionTitle(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 8, top: 12),
        child: Text(
          text,
          style: const TextStyle(
              fontSize: 16, fontWeight: FontWeight.w700, color: Colors.black87),
        ),
      );

  Widget _medicalHistoryCard() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFF8F7FB),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.grey.shade300),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 8,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Medical History',
            style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: Colors.black87),
          ),
          const SizedBox(height: 10),
          _buildTextField(_historyDiagCtrl, 'Diagnosis',
              hint: 'Enter diagnosis'),
          Row(
            children: [
              Expanded(
                  child: _buildTextField(_historyDurationCtrl, 'Duration',
                      hint: 'Duration',
                      keyboard: TextInputType.number,
                      numeric: true,
                      min: 0,
                      minExclusive: true)),
              const SizedBox(width: 12),
              Expanded(
                  child: _buildDropdown('Unit', _historyUnit, _durationUnits,
                      (v) => setState(() => _historyUnit = v))),
            ],
          ),
          const SizedBox(height: 6),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: null, // TODO: support adding multiple medical history entries
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 12),
                side: const BorderSide(color: Colors.black87, width: 1),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10)),
              ),
              child: const Text('+ Add Medical History',
                  style: TextStyle(
                      color: Colors.black87, fontWeight: FontWeight.w600)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTextField(
    TextEditingController controller,
    String label, {
    String? hint,
    bool isRequired = false,
    TextInputType keyboard = TextInputType.text,
    bool readOnly = false,
    bool numeric = false,
    bool integerOnly = false,
    double? min,
    double? max,
    bool minExclusive = false,
    TextEditingController? greaterThan,
    VoidCallback? onTap,
    Widget? suffix,
    String? Function(String?)? validator,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          isRequired ? '$label *' : label,
          style: const TextStyle(
              fontWeight: FontWeight.w700, fontSize: 13, color: Colors.black87),
        ),
        const SizedBox(height: 6),
        TextFormField(
          controller: controller,
          keyboardType: keyboard,
          readOnly: readOnly,
          onTap: onTap,
          validator: (value) {
            if (validator != null) return validator(value);
            if (isRequired && (value == null || value.trim().isEmpty)) {
              return '$label is required';
            }
            final text = value?.trim() ?? '';
            if (numeric && text.isNotEmpty) {
              final parsed = double.tryParse(text);
              if (parsed == null || !parsed.isFinite) {
                return '$label must be a valid number';
              }
              if (integerOnly && parsed != parsed.truncateToDouble()) {
                return '$label must be a whole number';
              }
              if (min != null &&
                  (minExclusive ? parsed <= min : parsed < min)) {
                return minExclusive
                    ? '$label must be greater than $min'
                    : '$label must be at least $min';
              }
              if (max != null && parsed > max) {
                return '$label must not exceed $max';
              }
              final comparison = greaterThan == null
                  ? null
                  : double.tryParse(greaterThan.text.trim());
              if (comparison != null && parsed <= comparison) {
                return '$label must be greater than Target INR Min';
              }
            }
            return null;
          },
          decoration: InputDecoration(
            hintText: hint,
            filled: true,
            fillColor: Colors.white,
            suffixIcon: suffix,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide.none,
            ),
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          ),
        ),
      ],
    ).padding(bottom: 12);
  }

  Widget _buildDateField({
    required TextEditingController controller,
    required String label,
    String? hint,
    bool isRequired = false,
    required VoidCallback onTap,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          isRequired ? '$label *' : label,
          style: const TextStyle(
              fontWeight: FontWeight.w700, fontSize: 13, color: Colors.black87),
        ),
        const SizedBox(height: 6),
        TextFormField(
          controller: controller,
          readOnly: true,
          onTap: onTap,
          validator: (value) {
            if (isRequired && (value == null || value.trim().isEmpty)) {
              return '$label is required';
            }
            return null;
          },
          decoration: InputDecoration(
            hintText: hint,
            suffixIcon:
                const Icon(Icons.calendar_today, color: Color(0xFF6B7280)),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: Colors.grey.shade300),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: Colors.grey.shade300),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: Color(0xFF6B5FB3)),
            ),
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          ),
        ),
      ],
    ).padding(bottom: 12);
  }

  Widget _buildDropdown(
    String label,
    String? value,
    List<String> items,
    ValueChanged<String> onChanged, {
    bool isRequired = false,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          isRequired ? '$label *' : label,
          style: const TextStyle(
              fontWeight: FontWeight.w700, fontSize: 13, color: Colors.black87),
        ),
        const SizedBox(height: 6),
        DropdownButtonFormField<String>(
          initialValue: value,
          isExpanded: true,
          icon: Icon(Icons.keyboard_arrow_down,
              color: Colors.grey[700], size: 24),
          validator: (selectedValue) {
            if (isRequired &&
                (selectedValue == null || selectedValue.trim().isEmpty)) {
              return '$label is required';
            }
            return null;
          },
          decoration: InputDecoration(
            hintText: 'Select',
            hintStyle: TextStyle(
              color: Colors.grey[600],
              fontSize: 14,
              fontWeight: FontWeight.w400,
            ),
            filled: true,
            fillColor: Colors.white,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: Colors.grey.shade300, width: 1),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: Colors.grey.shade300, width: 1),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: Color(0xFF6B5FB3)),
            ),
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          ),
          items: items
              .map((e) => DropdownMenuItem<String>(
                    value: e,
                    child: Text(
                      e,
                      style: const TextStyle(
                        color: Colors.black87,
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ))
              .toList(),
          onChanged: (v) {
            if (v != null) onChanged(v);
          },
          dropdownColor: Colors.white,
          borderRadius: BorderRadius.circular(12),
          menuMaxHeight: 300,
        ),
      ],
    ).padding(bottom: 12);
  }

  Widget _dosageList() {
    return Column(
      children: [
        _dayDose('Mon', _monCtrl),
        _dayDose('Tue', _tueCtrl),
        _dayDose('Wed', _wedCtrl),
        _dayDose('Thu', _thuCtrl),
        _dayDose('Fri', _friCtrl),
        _dayDose('Sat', _satCtrl),
        _dayDose('Sun', _sunCtrl),
      ],
    );
  }

  Widget _dayDose(String day, TextEditingController ctrl) {
    final enabled = _dayEnabled[day] ?? false;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          _FancyToggle(
            value: enabled,
            onChanged: (v) => setState(() => _dayEnabled[day] = v),
          ),
          const SizedBox(width: 10),
          SizedBox(
            width: 48,
            child:
                Text(day, style: const TextStyle(fontWeight: FontWeight.w600)),
          ),
          const Spacer(),
          SizedBox(
            width: 100,
            child: TextFormField(
              controller: ctrl,
              enabled: enabled,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              validator: (value) {
                if (!enabled) return null;
                final text = value?.trim() ?? '';
                if (text.isEmpty) return '$day dose is required';
                final dose = double.tryParse(text);
                if (dose == null || !dose.isFinite) {
                  return '$day dose must be numeric';
                }
                if (dose <= 0) return '$day dose must be greater than 0';
                return null;
              },
              decoration: InputDecoration(
                hintText: 'mg',
                suffixText: 'mg',
                filled: true,
                fillColor: Colors.white,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: BorderSide.none,
                ),
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              ),
            ),
          ),
        ],
      ),
    );
  }

  List<String> get _therapyOptions => const [
        'Warfarin',
        'Heparin',
        'Dabigatran',
        'Rivaroxaban',
        'Acitrom',
      ];

  List<String> get _durationUnits => const ['Days', 'Weeks', 'Months', 'Years'];
}

class AddPatientPage extends StatelessWidget {
  const AddPatientPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFFC8B5E1), Color(0xFFF8C7D7)],
          ),
        ),
        child: SafeArea(
          child: const AddPatientForm(),
        ),
      ),
    );
  }
}

class _DoctorGreeting extends StatelessWidget {
  const _DoctorGreeting();

  @override
  Widget build(BuildContext context) {
    return UseQuery<DoctorProfileModel>(
      options: QueryOptions<DoctorProfileModel>(
        queryKey: DoctorQueryKeys.profile(),
        queryFn: AppDependencies.doctorRepository.getDoctorProfile,
      ),
      builder: (context, query) {
        final doctorName = query.isSuccess ? query.data?.name.trim() : null;
        if (doctorName == null ||
            doctorName.isEmpty ||
            doctorName.toLowerCase() == 'unknown') {
          return const SizedBox.shrink();
        }

        return Text(
          'Welcome, $doctorName',
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            color: Colors.white,
          ),
        ).padding(bottom: 14);
      },
    );
  }
}

class _FancyToggle extends StatefulWidget {
  const _FancyToggle({required this.value, required this.onChanged});
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  State<_FancyToggle> createState() => _FancyToggleState();
}

class _FancyToggleState extends State<_FancyToggle> {
  static const Color _trackOff = Color(0xfff2f2f2);
  static const Color _trackOn = Color(0xffe7f7ef); // soft green by default
  static const Color _thumbOff = Color(0xffb0b0b0);
  static const Color _thumbOn = Color(0xff30c86b);

  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final isOn = widget.value;
    final trackColor = isOn ? _trackOn : _trackOff;
    final thumbColor = isOn ? _thumbOn : _thumbOff;

    return GestureDetector(
      onTapDown: (_) => setState(() => _pressed = true),
      onTapUp: (_) {
        setState(() => _pressed = false);
        widget.onChanged(!widget.value);
      },
      onTapCancel: () => setState(() => _pressed = false),
      child: Container(
        width: 58,
        height: 26,
        padding: const EdgeInsets.symmetric(horizontal: 3),
        decoration: BoxDecoration(
          color: trackColor,
          borderRadius: BorderRadius.circular(13),
        ),
        child: AnimatedAlign(
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOut,
          alignment: isOn ? Alignment.centerRight : Alignment.centerLeft,
          child: AnimatedScale(
            duration: const Duration(milliseconds: 100),
            curve: Curves.easeOut,
            scale: _pressed ? 0.9 : 1.0,
            child: Container(
              width: 18,
              height: 18,
              decoration: BoxDecoration(
                color: thumbColor,
                borderRadius: BorderRadius.circular(9),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
