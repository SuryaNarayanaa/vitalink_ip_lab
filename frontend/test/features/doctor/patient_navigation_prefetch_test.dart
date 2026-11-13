import 'dart:io';
import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/core/query/doctor_query_keys.dart';
import 'package:frontend/features/doctor/data/doctor_repository.dart';
import 'package:frontend/features/doctor/models/patient_detail_model.dart';
import 'package:frontend/features/doctor/models/patient_model.dart';
import 'package:frontend/features/doctor/view_patient_page.dart';
import 'package:google_fonts/google_fonts.dart';

class DelayedDetailRepository extends DoctorRepository {
  DelayedDetailRepository() : super(apiClient: ApiClient());
  final calls = <String, int>{};
  @override
  Future<PatientDetailModel> getPatientDetail(String opNumber) async {
    final version = calls.update(opNumber, (v) => v + 1, ifAbsent: () => 1);
    await Future<void>.delayed(const Duration(seconds: 3));
    return PatientDetailModel(
      id: opNumber,
      name: 'Patient $opNumber v$version',
      opNumber: opNumber,
      weeklyDosage: const {},
      medicalConfig: const {},
    );
  }
}

final navigationPatients = List.generate(
  5,
  (i) =>
      PatientModel(id: 'p$i', name: 'Patient ${i + 1}', opNumber: 'OP${i + 1}'),
);

void main() {
  setUpAll(() async {
    var directory = File(Platform.resolvedExecutable).parent;
    while (!File(
      '${directory.path}/bin/cache/artifacts/material_fonts/roboto-regular.ttf',
    ).existsSync()) {
      final parent = directory.parent;
      if (parent.path == directory.path) {
        throw StateError('Flutter SDK Roboto font not found');
      }
      directory = parent;
    }
    final bytes = await File(
      '${directory.path}/bin/cache/artifacts/material_fonts/roboto-regular.ttf',
    ).readAsBytes();
    await (FontLoader(
      'Roboto',
    )..addFont(Future.value(ByteData.sublistView(bytes)))).load();
  });
  setUp(() {
    GoogleFonts.config.allowRuntimeFetching = false;
  });
  tearDown(() async {
    await QueryCache.instance.clear();
  });

  Future<void> mount(
    WidgetTester tester,
    DelayedDetailRepository repository,
    QueryClient client, {
    int index = 0,
  }) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      QueryClientProvider(
        client: client,
        child: MaterialApp(
          theme: ThemeData(fontFamily: 'Roboto'),
          home: ViewPatientPage(
            opNumber: navigationPatients[index].opNumber!,
            allPatients: navigationPatients,
            initialIndex: index,
            repository: repository,
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
  }

  testWidgets(
    'only adjacent patients prefetch and warm Next skips a three-second wait',
    (tester) async {
      final repository = DelayedDetailRepository();
      await mount(
        tester,
        repository,
        AppDependencies.createQueryClient(),
        index: 2,
      );
      expect(repository.calls.keys.toSet(), {'OP2', 'OP3', 'OP4'});
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Next'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pump();
      expect(find.text('Patient OP4 v1'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(repository.calls['OP4'], 1);
      expect(repository.calls['OP5'], 1);
      expect(repository.calls.containsKey('OP1'), isFalse);
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'rapid Next reuses the pending prefetch instead of sending another request',
    (tester) async {
      final repository = DelayedDetailRepository();
      await mount(tester, repository, AppDependencies.createQueryClient());
      await tester.tap(find.text('Next'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      expect(repository.calls['OP2'], 1);
      expect(find.byType(CircularProgressIndicator), findsWidgets);
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
      expect(find.text('Patient OP2 v1'), findsOneWidget);
      expect(repository.calls['OP2'], 1);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'invalidating a prefetched patient loads updated details on entry',
    (tester) async {
      final repository = DelayedDetailRepository();
      final client = AppDependencies.createQueryClient();
      await mount(tester, repository, client);
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
      client.invalidateQueries(DoctorQueryKeys.patientDetail('OP2'));
      await tester.pump();
      await tester.tap(find.text('Next'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      expect(find.text('Patient OP2 v1'), findsNothing);
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
      expect(find.text('Patient OP2 v2'), findsOneWidget);
      expect(repository.calls['OP2'], 2);
      expect(tester.takeException(), isNull);
    },
  );
}
