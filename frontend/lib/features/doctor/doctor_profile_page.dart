import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/query/doctor_query_keys.dart';
import 'package:frontend/features/doctor/data/doctor_repository.dart';
import 'package:frontend/features/doctor/models/doctor_profile_model.dart';
import 'package:frontend/core/widgets/index.dart';

class DoctorProfilePage extends StatelessWidget {
  const DoctorProfilePage({super.key});

  @override
  Widget build(BuildContext context) {
    final DoctorRepository repository = AppDependencies.doctorRepository;

    return UseQuery<DoctorProfileModel>(
      options: QueryOptions<DoctorProfileModel>(
        queryKey: DoctorQueryKeys.profile(),
        queryFn: repository.getDoctorProfile,
      ),
      builder: (context, query) {
        return SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
          physics: const BouncingScrollPhysics(),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (query.isLoading)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.all(32),
                    child: CircularProgressIndicator(),
                  ),
                ),
              if (query.isError)
                ApiErrorState(
                  error: query.error,
                  onRetry: () => query.refetch(),
                  compact: true,
                  title: 'Could not load profile',
                ),
              if (query.isSuccess && query.data != null)
                DoctorProfileContent(
                  profile: query.data!,
                  onProfileUpdated: () => query.refetch(),
                ),
            ],
          ),
        );
      },
    );
  }
}
