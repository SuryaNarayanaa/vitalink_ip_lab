import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/app/app.dart';
import 'package:frontend/core/di/app_dependencies.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await QueryCache.instance.initialize();
  await NetworkPolicy.instance.initialize();
  await AppDependencies.pushNotifications.initialize();

  final queryClient = AppDependencies.createQueryClient(
    onError: (error) => debugPrint('Query error: $error'),
  );

  runApp(VitalinkApp(queryClient: queryClient));
}
