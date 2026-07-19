/// Indian primary-mobile helpers shared by doctor/admin/patient forms.
///
/// UI fields collect a 10-digit local number (starting 6–9). API payloads use
/// E.164-style `+91` prefix, matching backend `primaryPhoneNumberSchema`.
class PhoneUtils {
  PhoneUtils._();

  static final RegExp indianMobileRegex = RegExp(r'^[6-9]\d{9}$');

  /// Strip country codes / non-digits so edit forms show a 10-digit local value.
  static String toLocalDigits(String? value) {
    if (value == null || value.trim().isEmpty) return '';
    var digits = value.replaceAll(RegExp(r'\D'), '');
    if (digits.startsWith('91') && digits.length >= 12) {
      digits = digits.substring(digits.length - 10);
    } else if (digits.startsWith('0') && digits.length == 11) {
      digits = digits.substring(1);
    } else if (digits.length > 10) {
      digits = digits.substring(digits.length - 10);
    }
    return digits;
  }

  /// Format a validated (or raw) local input for API submission as `+91…`.
  ///
  /// Returns `null` when [value] is empty after trim so optional fields can omit
  /// the key entirely.
  static String? formatForApi(String? value) {
    final text = value?.trim() ?? '';
    if (text.isEmpty) return null;
    final local = indianMobileRegex.hasMatch(text) ? text : toLocalDigits(text);
    if (local.isEmpty) return null;
    return '+91$local';
  }

  /// Form validator for 10-digit Indian mobiles.
  static String? validate(
    String? value, {
    String label = 'Phone',
    bool required = false,
  }) {
    final text = value?.trim() ?? '';
    if (text.isEmpty) {
      return required ? '$label is required' : null;
    }
    if (!indianMobileRegex.hasMatch(text)) {
      return '$label must be a valid 10-digit number';
    }
    return null;
  }
}
