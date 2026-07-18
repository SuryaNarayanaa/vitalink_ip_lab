import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

// PatientService.getPrescriptions() is a static method built around a
// private, statically-initialized Dio client (`_dio`) with no constructor
// injection point, mocking library, or exposed seam for swapping in a fake
// HTTP transport (see lib/services/patient_service.dart). That makes it
// impossible to unit test the method's runtime behavior against a fake
// server without modifying production code, which is out of scope for this
// change.
//
// This PR removed a hardcoded "Aspirin" prescription that was being appended
// to every patient's prescription list regardless of their actual therapy.
// These tests guard against that specific regression, and pin down the
// remaining structure of the method, by inspecting the method body's source
// directly.
String _readPatientServiceSource() {
  final file = File('lib/services/patient_service.dart');
  expect(
    file.existsSync(),
    isTrue,
    reason:
        'Expected to find lib/services/patient_service.dart relative to the '
        'test runner working directory (run `flutter test` from the '
        'frontend/ package root).',
  );
  return file.readAsStringSync();
}

/// Extracts the full `{ ... }` body of the first method whose signature
/// matches [signature], using brace counting so nested blocks don't confuse
/// the extraction.
String _extractMethodBody(String source, String signature) {
  final startIndex = source.indexOf(signature);
  expect(
    startIndex,
    greaterThanOrEqualTo(0),
    reason: 'Could not locate "$signature" in patient_service.dart',
  );

  final openBraceIndex = source.indexOf('{', startIndex);
  expect(openBraceIndex, greaterThanOrEqualTo(0));

  var depth = 0;
  var i = openBraceIndex;
  for (; i < source.length; i++) {
    if (source[i] == '{') depth++;
    if (source[i] == '}') {
      depth--;
      if (depth == 0) break;
    }
  }

  expect(
    depth,
    0,
    reason: 'Could not find a matching closing brace for "$signature"',
  );

  return source.substring(openBraceIndex, i + 1);
}

void main() {
  late String getPrescriptionsBody;

  setUpAll(() {
    final source = _readPatientServiceSource();
    getPrescriptionsBody = _extractMethodBody(
      source,
      'static Future<List<Map<String, dynamic>>> getPrescriptions()',
    );
  });

  group('PatientService.getPrescriptions regression', () {
    test('does not hardcode an additional Aspirin prescription', () {
      expect(
        getPrescriptionsBody.contains('Aspirin'),
        isFalse,
        reason:
            'The hardcoded 75mg Aspirin prescription removed in this PR '
            'must not be reintroduced.',
      );
    });

    test('does not hardcode a "Take in the morning with food" instruction',
        () {
      // This literal was unique to the removed Aspirin block; its presence
      // would indicate the hardcoded entry crept back in under a different
      // drug name.
      expect(
        getPrescriptionsBody.contains('Take in the morning with food'),
        isFalse,
      );
    });

    test('adds exactly one prescription entry, derived from the therapy drug',
        () {
      final addCount =
          RegExp(r'prescriptions\.add\(').allMatches(getPrescriptionsBody).length;

      expect(
        addCount,
        1,
        reason:
            'getPrescriptions() should only ever add a single prescription '
            'entry, built from the patient\'s actual therapy drug.',
      );
      expect(getPrescriptionsBody.contains("'drug': therapyDrug"), isTrue);
    });

    test('guards the single prescription entry on a non-null therapy drug',
        () {
      expect(getPrescriptionsBody.contains('if (therapyDrug != null)'), isTrue);
    });

    test('still returns the prescriptions list (possibly empty)', () {
      expect(getPrescriptionsBody.contains('return prescriptions;'), isTrue);
    });

    test('preserves the expected prescription entry fields', () {
      for (final field in [
        "'drug':",
        "'dosage':",
        "'frequency':",
        "'startDate':",
        "'instructions':",
      ]) {
        expect(
          getPrescriptionsBody.contains(field),
          isTrue,
          reason: 'Expected prescription entry to still include $field',
        );
      }
    });
  });
}