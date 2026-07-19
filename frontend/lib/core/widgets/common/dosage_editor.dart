import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// A widget for viewing and editing weekly dosage schedule with toggle switches.
class DosageEditor extends StatefulWidget {
  final Map<String, dynamic>? initialDosage;
  final bool readOnly;
  final Function(Map<String, double>)? onSave;
  final VoidCallback? onCancel;

  const DosageEditor({
    super.key,
    this.initialDosage,
    this.readOnly = true,
    this.onSave,
    this.onCancel,
  });

  @override
  State<DosageEditor> createState() => _DosageEditorState();
}

class _DosageEditorState extends State<DosageEditor> {
  late Map<String, TextEditingController> _controllers;
  late Map<String, bool> _enabled;
  bool _isEditing = false;
  bool _hasChanges = false;

  static const _days = [
    ('monday', 'Mon'),
    ('tuesday', 'Tue'),
    ('wednesday', 'Wed'),
    ('thursday', 'Thu'),
    ('friday', 'Fri'),
    ('saturday', 'Sat'),
    ('sunday', 'Sun'),
  ];

  @override
  void initState() {
    super.initState();
    _isEditing = !widget.readOnly;
    _initControllers();
  }

  void _initControllers() {
    _controllers = {};
    _enabled = {};
    for (final (key, _) in _days) {
      final value = widget.initialDosage?[key];
      final numValue = value is num ? value.toDouble() : (double.tryParse(value?.toString() ?? '0') ?? 0);
      _controllers[key] = TextEditingController(
        text: numValue > 0 ? numValue.toString() : '',
      );
      _enabled[key] = numValue > 0;
    }
  }

  @override
  void didUpdateWidget(DosageEditor oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.initialDosage != widget.initialDosage && !_isEditing) {
      _disposeControllers();
      _initControllers();
    }
  }

  void _disposeControllers() {
    for (final c in _controllers.values) {
      c.dispose();
    }
  }

  @override
  void dispose() {
    _disposeControllers();
    super.dispose();
  }

  Map<String, double> _buildDosageMap() {
    final map = <String, double>{};
    for (final (key, _) in _days) {
      if (_enabled[key] == true) {
        final text = _controllers[key]?.text.trim() ?? '0';
        map[key] = double.tryParse(text) ?? 0;
      } else {
        map[key] = 0;
      }
    }
    return map;
  }

  void _toggleDay(String key, bool value) {
    setState(() {
      _enabled[key] = value;
      _hasChanges = true;
      if (!value) {
        _controllers[key]?.text = '';
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        // Header with Edit button
        if (!_isEditing && widget.onSave != null)
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: () => setState(() => _isEditing = true),
              icon: const Icon(Icons.edit, size: 18),
              label: const Text('Edit'),
              style: TextButton.styleFrom(
                foregroundColor: const Color(0xFF6366F1),
              ),
            ),
          ),
        
        // Days list
        ..._days.map((day) {
          final (key, label) = day;
          return _DosageRow(
            label: label,
            dayKey: key,
            controller: _controllers[key]!,
            enabled: _enabled[key] ?? false,
            isEditing: _isEditing,
            onToggle: _isEditing ? (val) => _toggleDay(key, val) : null,
            onChanged: _isEditing ? () => setState(() => _hasChanges = true) : null,
          );
        }),
        
        // Action buttons when editing
        if (_isEditing && widget.onSave != null) ...[
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () {
                    _disposeControllers();
                    _initControllers();
                    setState(() {
                      _isEditing = false;
                      _hasChanges = false;
                    });
                    widget.onCancel?.call();
                  },
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFF6B7280),
                    side: const BorderSide(color: Color(0xFFE5E7EB)),
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                  child: const Text('Cancel'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton(
                  onPressed: _hasChanges
                      ? () {
                          widget.onSave?.call(_buildDosageMap());
                          setState(() {
                            _isEditing = false;
                            _hasChanges = false;
                          });
                        }
                      : null,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF6366F1),
                    foregroundColor: Colors.white,
                    disabledBackgroundColor: const Color(0xFFE5E7EB),
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                  child: const Text('Save Changes'),
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }
}

class _DosageRow extends StatelessWidget {
  final String label;
  final String dayKey;
  final TextEditingController controller;
  final bool enabled;
  final bool isEditing;
  final ValueChanged<bool>? onToggle;
  final VoidCallback? onChanged;

  const _DosageRow({
    required this.label,
    required this.dayKey,
    required this.controller,
    required this.enabled,
    required this.isEditing,
    this.onToggle,
    this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: enabled ? const Color(0xFFF0F4FF) : const Color(0xFFF9FAFB),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: enabled ? const Color(0xFF6366F1).withValues(alpha: 0.3) : const Color(0xFFE5E7EB),
        ),
      ),
      child: Row(
        children: [
          // Toggle switch
          SizedBox(
            width: 48,
            height: 28,
            child: FittedBox(
              fit: BoxFit.contain,
              child: Switch(
                value: enabled,
                onChanged: isEditing ? onToggle : null,
                activeThumbColor: const Color(0xFF6366F1),
                activeTrackColor: const Color(0xFFC7D2FE),
                inactiveThumbColor: const Color(0xFF9CA3AF),
                inactiveTrackColor: const Color(0xFFE5E7EB),
              ),
            ),
          ),
          const SizedBox(width: 12),
          // Day label
          SizedBox(
            width: 45,
            child: Text(
              label,
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w600,
                color: enabled ? const Color(0xFF1F2937) : const Color(0xFF9CA3AF),
              ),
            ),
          ),
          const Spacer(),
          // Dosage input
          if (isEditing && enabled)
            SizedBox(
              width: 100,
              child: TextField(
                controller: controller,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                textAlign: TextAlign.right,
                inputFormatters: [
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
                  TextInputFormatter.withFunction((oldValue, newValue) =>
                      RegExp(r'^\d*\.?\d*$').hasMatch(newValue.text)
                          ? newValue
                          : oldValue),
                ],
                onChanged: (_) => onChanged?.call(),
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  color: Color(0xFF1F2937),
                ),
                decoration: InputDecoration(
                  hintText: '0',
                  hintStyle: TextStyle(
                    color: const Color(0xFF9CA3AF).withValues(alpha: 0.7),
                  ),
                  suffixText: 'mg',
                  suffixStyle: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    color: Color(0xFF6B7280),
                  ),
                  isDense: true,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: const BorderSide(color: Color(0xFFE5E7EB)),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: const BorderSide(color: Color(0xFFE5E7EB)),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: const BorderSide(color: Color(0xFF6366F1), width: 1.5),
                  ),
                ),
              ),
            )
          else
            Container(
              width: 100,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: const Color(0xFFE5E7EB)),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  Text(
                    enabled ? (controller.text.isEmpty ? '0' : controller.text) : '0',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: enabled ? const Color(0xFF1F2937) : const Color(0xFF9CA3AF),
                    ),
                  ),
                  const SizedBox(width: 4),
                  Text(
                    'mg',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                      color: enabled ? const Color(0xFF6B7280) : const Color(0xFF9CA3AF),
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

/// A read-only display of weekly dosage (compact view).
class DosageDisplay extends StatelessWidget {
  final Map<String, dynamic>? dosage;

  const DosageDisplay({super.key, this.dosage});

  static const _days = [
    ('monday', 'Mon'),
    ('tuesday', 'Tue'),
    ('wednesday', 'Wed'),
    ('thursday', 'Thu'),
    ('friday', 'Fri'),
    ('saturday', 'Sat'),
    ('sunday', 'Sun'),
  ];

  @override
  Widget build(BuildContext context) {
    if (dosage == null || dosage!.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFFF9FAFB),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFFE5E7EB)),
        ),
        child: const Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.medication_outlined, color: Color(0xFF9CA3AF), size: 20),
            SizedBox(width: 8),
            Text(
              'No dosage prescribed',
              style: TextStyle(
                color: Color(0xFF6B7280),
                fontStyle: FontStyle.italic,
              ),
            ),
          ],
        ),
      );
    }

    // Check if all dosages are 0
    bool allZero = true;
    for (final (key, _) in _days) {
      final value = dosage?[key];
      final numValue = value is num ? value.toDouble() : (double.tryParse(value?.toString() ?? '0') ?? 0);
      if (numValue > 0) {
        allZero = false;
        break;
      }
    }

    if (allZero) {
      return Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFFF9FAFB),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFFE5E7EB)),
        ),
        child: const Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.medication_outlined, color: Color(0xFF9CA3AF), size: 20),
            SizedBox(width: 8),
            Text(
              'No dosage prescribed',
              style: TextStyle(
                color: Color(0xFF6B7280),
                fontStyle: FontStyle.italic,
              ),
            ),
          ],
        ),
      );
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: _days.map((day) {
        final (key, label) = day;
        final value = dosage?[key];
        final numValue = value is num ? value.toDouble() : (double.tryParse(value?.toString() ?? '0') ?? 0);
        final isActive = numValue > 0;

        return Container(
          margin: const EdgeInsets.only(bottom: 6),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: isActive ? const Color(0xFFF0F4FF) : const Color(0xFFF9FAFB),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: isActive ? const Color(0xFF6366F1).withValues(alpha: 0.3) : const Color(0xFFE5E7EB),
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: isActive ? const Color(0xFF6366F1) : const Color(0xFFD1D5DB),
                ),
              ),
              const SizedBox(width: 12),
              SizedBox(
                width: 45,
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: isActive ? const Color(0xFF1F2937) : const Color(0xFF9CA3AF),
                  ),
                ),
              ),
              const Spacer(),
              Text(
                isActive ? '${numValue.toStringAsFixed(numValue.truncateToDouble() == numValue ? 0 : 1)} mg' : '—',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: isActive ? const Color(0xFF6366F1) : const Color(0xFF9CA3AF),
                ),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }
}
