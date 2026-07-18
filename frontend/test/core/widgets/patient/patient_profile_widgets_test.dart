import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/core/widgets/patient/patient_profile_widgets.dart';

void main() {
  const profile = <String, dynamic>{
    'name': 'Test for notifications',
    'opNumber': 'PAT256',
    'targetINR': '1 - 5',
    'age': 50,
    'gender': 'Male',
    'therapyDrug': 'Warfarin',
    'doctorName': 'DOCTOR 1',
  };

  Future<void> pumpProfile(WidgetTester tester, double width) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: Align(
              alignment: Alignment.topCenter,
              child: SizedBox(
                width: width,
                child: PatientProfileContent(
                  profile: profile,
                  onProfileUpdated: () {},
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pump();
  }

  testWidgets('keeps the standard two-column layout at 320px content width',
      (tester) async {
    await pumpProfile(tester, 320);

    final avatarCenter = tester.getCenter(find.text('TF'));
    final nameCenter = tester.getCenter(find.text('Test for notifications'));
    final ageCenter = tester.getCenter(find.text('Age'));
    final genderCenter = tester.getCenter(find.text('Gender'));

    expect((avatarCenter.dy - nameCenter.dy).abs(), lessThan(60));
    expect((ageCenter.dy - genderCenter.dy).abs(), lessThan(1));
    expect(ageCenter.dx, lessThan(genderCenter.dx));
    expect(tester.takeException(), isNull);
  });

  testWidgets('uses full-width stacked cards only when genuinely narrow',
      (tester) async {
    await pumpProfile(tester, 280);

    final ageCenter = tester.getCenter(find.text('Age'));
    final genderCenter = tester.getCenter(find.text('Gender'));
    final cardFinder = find.byType(PatientInfoSmallCard);
    final ageCard = tester.getRect(cardFinder.at(0));
    final genderCard = tester.getRect(cardFinder.at(1));

    expect(ageCenter.dy, lessThan(genderCenter.dy));
    expect(ageCard.width, closeTo(280, 1));
    expect(genderCard.width, closeTo(280, 1));
    expect(ageCard.left, closeTo(genderCard.left, 1));
    expect(tester.takeException(), isNull);
  });
}
