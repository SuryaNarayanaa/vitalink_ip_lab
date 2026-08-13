import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/app/routers.dart';
import 'package:frontend/core/di/theme.dart';

class VitalinkApp extends StatelessWidget {
	const VitalinkApp({super.key, required this.queryClient});

	final QueryClient queryClient;

	@override
	Widget build(BuildContext context) {
		return QueryClientProvider(
			client: queryClient,
			child: MaterialApp(
				navigatorKey: AppRouter.navigatorKey,
				navigatorObservers: [AppRouter.routeTracker],
				title: 'Vitalink',
				theme: AppTheme.light,
				// darkTheme: AppTheme.dark,
				initialRoute: AppRouter.initialRoute,
				routes: AppRouter.routes,
				debugShowCheckedModeBanner: false,
			),
		);
	}
}
