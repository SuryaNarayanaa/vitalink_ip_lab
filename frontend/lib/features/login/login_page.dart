import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
  final GlobalKey<FormState> _otpFormKey = GlobalKey<FormState>();
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();
  final TextEditingController _otpController = TextEditingController();
  final AuthRepository _authRepository = AppDependencies.authRepository;
  bool _obscurePassword = true;
  LoginOtpChallenge? _otpChallenge;
  LoginTotpChallenge? _totpChallenge;
  bool _isVerifyingOtp = false;
  bool _isResendingOtp = false;
  Object? _otpError;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _otpController.dispose();
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
        Navigator.of(
          context,
        ).pushNamedAndRemoveUntil(route, (previous) => false);
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

  void _submit(MutationResult<LoginResult, LoginRequest> mutation) {
    if (!_formKey.currentState!.validate()) return;

    final request = LoginRequest(
      loginId: _emailController.text.trim(),
      password: _passwordController.text.trim(),
    );

    mutation.mutate(request);
  }

  Future<void> _verifyOtp() async {
    final challenge = _otpChallenge;
    if (challenge == null || !_otpFormKey.currentState!.validate()) return;

    setState(() {
      _isVerifyingOtp = true;
      _otpError = null;
    });

    try {
      final response = await _authRepository.verifyLoginOtp(
        VerifyLoginOtpRequest(
          challengeId: challenge.challengeId,
          code: _otpController.text.trim(),
        ),
      );
      await _handleSuccess(response);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _otpError = error;
      });
      _handleError(error);
    } finally {
      if (mounted) {
        setState(() {
          _isVerifyingOtp = false;
        });
      }
    }
  }

  Future<void> _verifyTotp() async {
    final challenge = _totpChallenge;
    if (challenge == null || !_otpFormKey.currentState!.validate()) return;

    setState(() {
      _isVerifyingOtp = true;
      _otpError = null;
    });

    try {
      final response = await _authRepository.verifyLoginTotp(
        VerifyLoginTotpRequest(
          challengeId: challenge.challengeId,
          code: _otpController.text.trim(),
        ),
      );
      await _handleSuccess(response);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _otpError = error;
      });
      _handleError(error);
    } finally {
      if (mounted) {
        setState(() {
          _isVerifyingOtp = false;
        });
      }
    }
  }

  Future<void> _resendOtp() async {
    final challenge = _otpChallenge;
    if (challenge == null) return;

    setState(() {
      _isResendingOtp = true;
      _otpError = null;
    });

    try {
      final updatedChallenge = await _authRepository.resendLoginOtp(
        ResendLoginOtpRequest(challengeId: challenge.challengeId),
      );
      if (!mounted) return;
      setState(() {
        _otpChallenge = updatedChallenge;
        _otpController.clear();
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('OTP sent to ${updatedChallenge.maskedPhone}')),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _otpError = error;
      });
      _handleError(error);
    } finally {
      if (mounted) {
        setState(() {
          _isResendingOtp = false;
        });
      }
    }
  }

  void _returnToLogin() {
    setState(() {
      _otpChallenge = null;
      _totpChallenge = null;
      _otpController.clear();
      _otpError = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final screenHeight = MediaQuery.of(context).size.height;
    final screenWidth = MediaQuery.of(context).size.width;

    return Scaffold(
      backgroundColor: Colors.white,
      body: UseMutation<LoginResult, LoginRequest>(
        options: MutationOptions<LoginResult, LoginRequest>(
          mutationFn: _authRepository.login,
          onSuccess: (data, variables) async {
            if (!mounted) return;
            if (data.isOtpRequired) {
              setState(() {
                _otpChallenge = data.otpChallenge;
                _totpChallenge = null;
                _otpController.clear();
                _otpError = null;
              });
              return;
            }

            if (data.isTotpRequired) {
              setState(() {
                _totpChallenge = data.totpChallenge;
                _otpChallenge = null;
                _otpController.clear();
                _otpError = null;
              });
              return;
            }

            final response = data.response;
            if (response != null) {
              await _handleSuccess(response);
            }
          },
          onError: (error, variables) {
            if (!mounted) return;
            _handleError(error);
          },
        ),
        builder: (context, mutation) {
          final error = mutation.error;
          final errorText = error is ApiException
              ? error.message
              : error?.toString();

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
                        minHeight:
                            screenHeight -
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

                            if (_otpChallenge == null && _totpChallenge == null)
                              _buildLoginForm(mutation, error, errorText)
                            else if (_otpChallenge != null)
                              _buildOtpForm(_otpChallenge!),
                            if (_totpChallenge != null)
                              _buildTotpForm(_totpChallenge!),

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
    TextInputType? keyboardType,
    List<TextInputFormatter>? inputFormatters,
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
        keyboardType: keyboardType,
        inputFormatters: inputFormatters,
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

  Widget _buildLoginForm(
    MutationResult<LoginResult, LoginRequest> mutation,
    Object? error,
    String? errorText,
  ) {
    return Form(
      key: _formKey,
      child: Column(
        children: [
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
          if (mutation.isError && errorText != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: ApiErrorState(error: error, compact: true),
            ),
          _buildPrimaryButton(
            label: 'LOGIN',
            isLoading: mutation.isLoading,
            onPressed: mutation.isLoading ? null : () => _submit(mutation),
          ),
        ],
      ),
    );
  }

  Widget _buildOtpForm(LoginOtpChallenge challenge) {
    final attempts = challenge.attemptsRemaining;
    final resendCount = challenge.resendCount;
    final maxResends = challenge.maxResends;
    final resendDetail = resendCount != null && maxResends != null
        ? 'Resends used: $resendCount of $maxResends'
        : null;

    return Form(
      key: _otpFormKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: _lightPurple.withAlpha(22),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(
                      Icons.verified_user_outlined,
                      color: _primaryPurple,
                      size: 22,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Verify your phone',
                            style: GoogleFonts.poppins(
                              fontSize: 17,
                              fontWeight: FontWeight.w600,
                              color: const Color(0xFF2D3142),
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            'Enter the OTP sent to ${challenge.maskedPhone}.',
                            style: GoogleFonts.poppins(
                              fontSize: 13,
                              height: 1.45,
                              color: const Color(0xFF4B5164),
                            ),
                          ),
                          if (attempts != null) ...[
                            const SizedBox(height: 6),
                            Text(
                              '$attempts attempts remaining',
                              style: GoogleFonts.poppins(
                                fontSize: 12,
                                color: const Color(0xFF5D6475),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          _buildTextField(
            controller: _otpController,
            hintText: 'OTP code',
            icon: Icons.pin_outlined,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            validator: (value) {
              final v = value?.trim() ?? '';
              if (v.isEmpty) {
                return 'OTP code is required';
              }
              return null;
            },
          ),
          const SizedBox(height: 16),
          if (_otpError != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: ApiErrorState(error: _otpError, compact: true),
            ),
          _buildPrimaryButton(
            label: 'VERIFY OTP',
            isLoading: _isVerifyingOtp,
            onPressed: _isVerifyingOtp ? null : _verifyOtp,
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: TextButton.icon(
                  onPressed: _isResendingOtp ? null : _resendOtp,
                  icon: _isResendingOtp
                      ? const SizedBox(
                          height: 16,
                          width: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.refresh_outlined, size: 18),
                  label: Text(_isResendingOtp ? 'Sending' : 'Resend OTP'),
                ),
              ),
              Expanded(
                child: TextButton.icon(
                  onPressed: _isVerifyingOtp || _isResendingOtp
                      ? null
                      : _returnToLogin,
                  icon: const Icon(Icons.arrow_back_outlined, size: 18),
                  label: const Text('Back'),
                ),
              ),
            ],
          ),
          if (resendDetail != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                resendDetail,
                textAlign: TextAlign.center,
                style: GoogleFonts.poppins(
                  fontSize: 12,
                  color: const Color(0xFF5D6475),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildTotpForm(LoginTotpChallenge challenge) {
    final attempts = challenge.attemptsRemaining;

    return Form(
      key: _otpFormKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: _lightPurple.withAlpha(22),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(
                  Icons.admin_panel_settings_outlined,
                  color: _primaryPurple,
                  size: 22,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Authenticator verification',
                        style: GoogleFonts.poppins(
                          fontSize: 17,
                          fontWeight: FontWeight.w600,
                          color: const Color(0xFF2D3142),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Enter the 6-digit code from your authenticator app.',
                        style: GoogleFonts.poppins(
                          fontSize: 13,
                          height: 1.45,
                          color: const Color(0xFF4B5164),
                        ),
                      ),
                      if (attempts != null) ...[
                        const SizedBox(height: 6),
                        Text(
                          '$attempts attempts remaining',
                          style: GoogleFonts.poppins(
                            fontSize: 12,
                            color: const Color(0xFF5D6475),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          _buildTextField(
            controller: _otpController,
            hintText: 'Authenticator code',
            icon: Icons.pin_outlined,
            keyboardType: TextInputType.number,
            inputFormatters: [
              FilteringTextInputFormatter.digitsOnly,
              LengthLimitingTextInputFormatter(6),
            ],
            validator: (value) {
              final v = value?.trim() ?? '';
              if (v.isEmpty) return 'Authenticator code is required';
              if (v.length != 6) return 'Enter the 6-digit code';
              return null;
            },
          ),
          const SizedBox(height: 16),
          if (_otpError != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: ApiErrorState(error: _otpError, compact: true),
            ),
          _buildPrimaryButton(
            label: 'VERIFY',
            isLoading: _isVerifyingOtp,
            onPressed: _isVerifyingOtp ? null : _verifyTotp,
          ),
          const SizedBox(height: 10),
          TextButton.icon(
            onPressed: _isVerifyingOtp ? null : _returnToLogin,
            icon: const Icon(Icons.arrow_back_outlined, size: 18),
            label: const Text('Back'),
          ),
        ],
      ),
    );
  }

  Widget _buildPrimaryButton({
    required String label,
    required bool isLoading,
    required VoidCallback? onPressed,
  }) {
    return SizedBox(
      width: double.infinity,
      height: 52,
      child: ElevatedButton(
        onPressed: onPressed,
        style: ElevatedButton.styleFrom(
          backgroundColor: _lightPurple,
          foregroundColor: Colors.white,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(30),
          ),
        ),
        child: isLoading
            ? const SizedBox(
                height: 22,
                width: 22,
                child: CircularProgressIndicator(
                  strokeWidth: 2.5,
                  valueColor: AlwaysStoppedAnimation(Colors.white),
                ),
              )
            : Text(
                label,
                style: GoogleFonts.poppins(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 1.5,
                ),
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
