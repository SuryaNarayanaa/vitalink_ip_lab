/// Client-side password policy matching backend `strongPasswordSchema`.
class PasswordPolicy {
  PasswordPolicy._();

  static final RegExp strongPasswordRegex = RegExp(
    r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$',
  );

  static const String requirementsHint =
      'Use 8+ characters with upper, lower, number, and special character';

  static String? validateStrong(String? value, {String emptyMessage = 'Required'}) {
    if (value == null || value.isEmpty) return emptyMessage;
    if (!strongPasswordRegex.hasMatch(value)) {
      return requirementsHint;
    }
    return null;
  }

  static bool isStrong(String value) => strongPasswordRegex.hasMatch(value);
}
