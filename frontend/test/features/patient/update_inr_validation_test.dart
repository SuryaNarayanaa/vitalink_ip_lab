import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/features/patient/patient_update_inr_page.dart';

void main() {
  test('Update INR accepts only a positive decimal in (0, 20]', () {
    expect(validateUpdateInrValue(null), 'Please enter INR value');
    expect(validateUpdateInrValue(''), 'Please enter INR value');
    expect(validateUpdateInrValue('abc'), 'Please enter a valid number');
    expect(validateUpdateInrValue('-1'), 'Please enter a valid number');
    expect(validateUpdateInrValue('0'), 'INR value must be between 0 and 20');
    expect(validateUpdateInrValue('25'), 'INR value must be between 0 and 20');
    expect(validateUpdateInrValue('2.5'), isNull);
    expect(validateUpdateInrValue('20'), isNull);
  });
}
