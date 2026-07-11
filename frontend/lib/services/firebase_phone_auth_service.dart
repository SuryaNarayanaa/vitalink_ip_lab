import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';

/// Owns the client-side Firebase SMS lifecycle. The backend never receives the
/// SMS code; it receives only the signed Firebase ID token.
class FirebasePhoneAuthService {
  FirebasePhoneAuthService({FirebaseAuth? auth}) : _authOverride = auth;

  final FirebaseAuth? _authOverride;
  String? _verificationId;
  int? _resendToken;

  Future<FirebaseAuth> _auth() async {
    final authOverride = _authOverride;
    if (authOverride != null) return authOverride;
    if (Firebase.apps.isEmpty) await Firebase.initializeApp();
    return FirebaseAuth.instance;
  }

  Future<void> sendCode({
    required String phoneNumber,
    bool forceResend = false,
    required Future<void> Function(String idToken) onAutoVerified,
  }) async {
    final auth = await _auth();
    final started = Completer<void>();

    await auth.verifyPhoneNumber(
      phoneNumber: phoneNumber,
      timeout: const Duration(seconds: 60),
      forceResendingToken: forceResend ? _resendToken : null,
      verificationCompleted: (credential) async {
        try {
          final token = await _signInAndGetIdToken(auth, credential);
          await onAutoVerified(token);
          if (!started.isCompleted) started.complete();
        } catch (error, stackTrace) {
          if (!started.isCompleted) started.completeError(error, stackTrace);
        }
      },
      verificationFailed: (error) {
        if (!started.isCompleted) {
          started.completeError(error, error.stackTrace);
        }
      },
      codeSent: (verificationId, resendToken) {
        _verificationId = verificationId;
        _resendToken = resendToken;
        if (!started.isCompleted) started.complete();
      },
      codeAutoRetrievalTimeout: (verificationId) {
        _verificationId = verificationId;
      },
    );

    await started.future;
  }

  Future<String> verifySmsCode(String smsCode) async {
    final verificationId = _verificationId;
    if (verificationId == null || verificationId.isEmpty) {
      throw StateError('Request a Firebase verification code first.');
    }

    final auth = await _auth();
    final credential = PhoneAuthProvider.credential(
      verificationId: verificationId,
      smsCode: smsCode,
    );
    return _signInAndGetIdToken(auth, credential);
  }

  Future<String> _signInAndGetIdToken(
    FirebaseAuth auth,
    PhoneAuthCredential credential,
  ) async {
    final result = await auth.signInWithCredential(credential);
    final token = await result.user?.getIdToken(true);
    if (token == null || token.isEmpty) {
      throw StateError('Firebase did not return an ID token.');
    }
    // VitaLink owns the long-lived app session. Avoid leaving an independent
    // Firebase session on the device after extracting its short-lived proof.
    await auth.signOut();
    return token;
  }

  void clear() {
    _verificationId = null;
    _resendToken = null;
  }
}
