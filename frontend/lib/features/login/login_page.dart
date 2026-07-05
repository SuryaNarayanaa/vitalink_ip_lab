import 'package:flutter/material.dart';
import 'package:flutter_tanstack_query/flutter_tanstack_query.dart';
import 'package:frontend/app/routers.dart';
import 'package:frontend/core/di/app_dependencies.dart';
import 'package:frontend/core/network/api_client.dart';
import 'package:frontend/core/storage/secure_storage.dart';
import 'package:frontend/core/widgets/common/api_error_state.dart';
import 'package:frontend/features/login/data/auth_repository.dart';
import 'package:frontend/features/login/models/login_models.dart';
import 'package:google_fonts/google_fonts.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  static const Color _primaryPurple = Color(0xFF6B5FB5);
  static const Color _lightPurple = Color(0xFF9B8FD9);

  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();
  final AuthRepository _authRepository = AppDependencies.authRepository;
  bool _obscurePassword = true;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  void _togglePasswordVisibility() {
    setState(() {
      _obscurePassword = !_obscurePassword;
    });
  }

  Future<void> _handleSuccess(LoginResponse response) async {
    await QueryCache.instance.clear();
    if (!mounted) return;

    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('Login successful')));

    if (response.user.isAdmin) {
      Navigator.of(
        context,
      ).pushNamedAndRemoveUntil(AppRoutes.adminDashboard, (previous) => false);
    } else if (response.user.isDoctor || response.user.isPatient) {
      // Skip onboarding for returning users who already completed it.
      final storage = SecureStorage();
      final alreadyOnboarded = await storage.isOnboardingCompleted();
      if (!mounted) return;

      if (alreadyOnboarded) {
        final route = response.user.isDoctor
            ? AppRoutes.doctorDashboard
            : AppRoutes.patient;
        Navigator.of(context)
            .pushNamedAndRemoveUntil(route, (previous) => false);
      } else {
        Navigator.of(context).pushNamedAndRemoveUntil(
          AppRoutes.onboarding,
          (previous) => false,
          arguments: response.user.isDoctor,
        );
      }
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Login failed: unknown user role from server'),
        ),
      );
    }
  }

  void _handleError(Object error) {
    final message = error is ApiException
        ? '${error.title}: ${error.message}'
        : error.toString();
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('Login failed: $message')));
  }

  void _submit(MutationResult<LoginResponse, LoginRequest> mutation) {
    if (!_formKey.currentState!.validate()) return;

    final request = LoginRequest(
      loginId: _emailController.text.trim(),
      password: _passwordController.text.trim(),
    );

    mutation.mutate(request);
  }

  @override
  Widget build(BuildContext context) {
    final screenHeight = MediaQuery.of(context).size.height;
    final screenWidth = MediaQuery.of(context).size.width;

    return Scaffold(
      backgroundColor: Colors.white,
      body: UseMutation<LoginResponse, LoginRequest>(
        options: MutationOptions<LoginResponse, LoginRequest>(
          mutationFn: _authRepository.login,
          onSuccess: (data, variables) async {
            if (!mounted) return;
            await _handleSuccess(data);
          },
          onError: (error, variables) {
            if (!mounted) return;
            _handleError(error);
          },
        ),
        builder: (context, mutation) {
          final error = mutation.error;
          final errorText =
              error is ApiException ? error.message : error?.toString();

          return SizedBox(
            width: screenWidth,
            height: screenHeight,
            child: Stack(
              children: [
                // Top-left purple curved shape
                Positioned(
                  top: 0,
                  left: 0,
                  child: CustomPaint(
                    size: Size(screenWidth * 0.65, screenHeight * 0.22),
                    painter: _TopLeftCurvePainter(),
                  ),
                ),

                // Bottom-right purple curved shape
                Positioned(
                  bottom: 0,
                  right: 0,
                  child: CustomPaint(
                    size: Size(screenWidth * 0.65, screenHeight * 0.15),
                    painter: _BottomRightCurvePainter(),
                  ),
                ),

                // Main content
                SafeArea(
                  child: SingleChildScrollView(
                    physics: const BouncingScrollPhysics(),
                    child: ConstrainedBox(
                      constraints: BoxConstraints(
                        minHeight: screenHeight -
                            MediaQuery.of(context).padding.top -
                            MediaQuery.of(context).padding.bottom,
                      ),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 32),
                        child: Column(
                          children: [
                            SizedBox(height: screenHeight * 0.08),

                            // Welcome text with nice font
                            Text(
                              'Welcome Back',
                              style: GoogleFonts.poppins(
                                fontSize: 28,
                                fontWeight: FontWeight.w600,
                                color: const Color(0xFF2D3142),
                              ),
                            ),
                            SizedBox(height: screenHeight * 0.03),

                            // Doctor-patient illustration
                            SizedBox(
                              height: screenHeight * 0.25,
                              child: Image.asset(
                                'assets/images/doctor_patient.png',
                                fit: BoxFit.contain,
                                errorBuilder: (context, error, stackTrace) {
                                  return Container(
                                    height: screenHeight * 0.25,
                                    decoration: BoxDecoration(
                                      color: _lightPurple.withAlpha(25),
                                      borderRadius: BorderRadius.circular(20),
                                    ),
                                    child: const Center(
                                      child: Icon(
                                        Icons.medical_services_outlined,
                                        size: 80,
                                        color: _primaryPurple,
                                      ),
                                    ),
                                  );
                                },
                              ),
                            ),
                            SizedBox(height: screenHeight * 0.04),

                            // Login form
                            Form(
                              key: _formKey,
                              child: Column(
                                children: [
                                  // Username field
                                  _buildTextField(
                                    controller: _emailController,
                                    hintText: 'Username',
                                    icon: Icons.person_outline,
                                    validator: (value) {
                                      final v = value?.trim() ?? '';
                                      if (v.isEmpty) {
                                        return 'Username is required';
                                      }
                                      return null;
                                    },
                                  ),
                                  const SizedBox(height: 16),

                                  // Password field
                                  _buildTextField(
                                    controller: _passwordController,
                                    hintText: 'Password',
                                    icon: Icons.lock_outline,
                                    obscureText: _obscurePassword,
                                    suffixIcon: IconButton(
                                      onPressed: _togglePasswordVisibility,
                                      icon: Icon(
                                        _obscurePassword
                                            ? Icons.visibility_off_outlined
                                            : Icons.visibility_outlined,
                                        color: Colors.grey[500],
                                        size: 22,
                                      ),
                                    ),
                                    validator: (value) {
                                      final v = value ?? '';
                                      if (v.isEmpty) {
                                        return 'Password is required';
                                      }
                                      if (v.length < 6) {
                                        return 'Must be at least 6 characters';
                                      }
                                      return null;
                                    },
                                  ),
                                  const SizedBox(height: 28),

                                  // Error message
                                  if (mutation.isError && errorText != null)
                                    Padding(
                                      padding: const EdgeInsets.only(
                                        bottom: 16,
                                      ),
                                      child: ApiErrorState(
                                        error: error,
                                        compact: true,
                                      ),
                                    ),

                                  // Login button
                                  SizedBox(
                                    width: double.infinity,
                                    height: 52,
                                    child: ElevatedButton(
                                      onPressed: mutation.isLoading
                                          ? null
                                          : () => _submit(mutation),
                                      style: ElevatedButton.styleFrom(
                                        backgroundColor: _lightPurple,
                                        foregroundColor: Colors.white,
                                        elevation: 0,
                                        shape: RoundedRectangleBorder(
                                          borderRadius: BorderRadius.circular(
                                            30,
                                          ),
                                        ),
                                      ),
                                      child: mutation.isLoading
                                          ? const SizedBox(
                                              height: 22,
                                              width: 22,
                                              child: CircularProgressIndicator(
                                                strokeWidth: 2.5,
                                                valueColor:
                                                    AlwaysStoppedAnimation(
                                                  Colors.white,
                                                ),
                                              ),
                                            )
                                          : Text(
                                              'LOGIN',
                                              style: GoogleFonts.poppins(
                                                fontSize: 16,
                                                fontWeight: FontWeight.w600,
                                                letterSpacing: 1.5,
                                              ),
                                            ),
                                    ),
                                  ),
                                ],
                              ),
                            ),

                            SizedBox(height: screenHeight * 0.04),

                            // Logos
                            Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                SizedBox(
                                  height: 45,
                                  child: Image.asset(
                                    'assets/images/psg_logo_2.jpg.jpeg',
                                    fit: BoxFit.contain,
                                    errorBuilder: (_, __, ___) =>
                                        const SizedBox.shrink(),
                                  ),
                                ),
                                const SizedBox(width: 20),
                                SizedBox(
                                  height: 45,
                                  child: Image.asset(
                                    'assets/images/psg_ims.png',
                                    fit: BoxFit.contain,
                                    errorBuilder: (_, __, ___) =>
                                        const SizedBox.shrink(),
                                  ),
                                ),
                              ],
                            ),

                            SizedBox(height: screenHeight * 0.06),

                            // Forgot password link
                            Container(
                              width: double.infinity,
                              padding: const EdgeInsets.symmetric(vertical: 16),
                              decoration: const BoxDecoration(
                                border: Border(
                                  top: BorderSide(
                                    color: Color(0xFFE5E5E5),
                                    width: 1,
                                  ),
                                ),
                              ),
                              child: Wrap(
                                alignment: WrapAlignment.center,
                                crossAxisAlignment: WrapCrossAlignment.center,
                                children: [
                                  Text(
                                    'Forgot your password? Contact your administrator to reset it.',
                                    style: GoogleFonts.poppins(
                                      fontSize: 14,
                                      color: Colors.grey[600],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            SizedBox(
                              height: MediaQuery.of(context).padding.bottom + 8,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildTextField({
    required TextEditingController controller,
    required String hintText,
    required IconData icon,
    bool obscureText = false,
    Widget? suffixIcon,
    String? Function(String?)? validator,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFFF5F5F5),
        borderRadius: BorderRadius.circular(30),
      ),
      child: TextFormField(
        controller: controller,
        obscureText: obscureText,
        validator: validator,
        style: GoogleFonts.poppins(fontSize: 15),
        decoration: InputDecoration(
          hintText: hintText,
          hintStyle: GoogleFonts.poppins(color: Colors.grey[500], fontSize: 15),
          prefixIcon: Padding(
            padding: const EdgeInsets.only(left: 16, right: 12),
            child: Icon(icon, color: Colors.grey[500], size: 22),
          ),
          prefixIconConstraints: const BoxConstraints(
            minWidth: 0,
            minHeight: 0,
          ),
          suffixIcon: suffixIcon,
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 20,
            vertical: 16,
          ),
          errorStyle: GoogleFonts.poppins(fontSize: 12),
        ),
      ),
    );
  }
}

// Custom painter for top-left curved shape
class _TopLeftCurvePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [Color(0xFF6B5FB5), Color(0xFF9B8FD9)],
      ).createShader(Rect.fromLTWH(0, 0, size.width, size.height));

    final path = Path();
    path.moveTo(0, 0);
    path.lineTo(size.width, 0);
    path.quadraticBezierTo(
      size.width * 0.85,
      size.height * 0.3,
      size.width * 0.5,
      size.height * 0.7,
    );
    path.quadraticBezierTo(
      size.width * 0.15,
      size.height * 1.1,
      0,
      size.height * 0.85,
    );
    path.lineTo(0, 0);
    path.close();

    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

// Custom painter for bottom-right curved shape
class _BottomRightCurvePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topRight,
        end: Alignment.bottomLeft,
        colors: [Color(0xFF9B8FD9), Color(0xFF6B5FB5)],
      ).createShader(Rect.fromLTWH(0, 0, size.width, size.height));

    final path = Path();
    path.moveTo(size.width, size.height);
    path.lineTo(0, size.height);
    path.quadraticBezierTo(
      size.width * 0.15,
      size.height * 0.7,
      size.width * 0.5,
      size.height * 0.3,
    );
    path.quadraticBezierTo(
      size.width * 0.85,
      -size.height * 0.1,
      size.width,
      size.height * 0.15,
    );
    path.lineTo(size.width, size.height);
    path.close();

    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
