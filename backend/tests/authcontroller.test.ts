import axios, { AxiosInstance } from 'axios';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import mongoose from 'mongoose';
import app from '@alias/app';
import { AdminMfaChallenge, AdminProfile, AuditLog, AuthSession, DoctorProfile, OtpChallenge, PatientProfile, User } from '@alias/models';
import { Server } from 'http';
import { OtpChallengeStatus } from '@alias/models/otpchallenge.model';
import { AdminMfaChallengeStatus } from '@alias/models/adminmfachallenge.model';
import { generateTotpCode } from '@alias/services/admin-totp.service';

var mockVerifyFirebasePhoneIdToken: jest.Mock;

const expectNoMfaSecrets = (userPayload: any) => {
    expect(userPayload).toBeDefined();
    expect(userPayload.password).toBeUndefined();
    expect(userPayload.salt).toBeUndefined();
    expect(userPayload.admin_mfa).toBeUndefined();

    const serialized = JSON.stringify(userPayload);
    expect(serialized).not.toContain('secret_ciphertext');
    expect(serialized).not.toContain('secret_iv');
    expect(serialized).not.toContain('secret_auth_tag');
    expect(serialized).not.toContain('pending_secret_ciphertext');
    expect(serialized).not.toContain('pending_secret_iv');
    expect(serialized).not.toContain('pending_secret_auth_tag');
    expect(serialized).not.toContain('last_verified_time_step');
}

jest.mock('@alias/services/firebase-phone-auth.service', () => ({
    __esModule: true,
    toFirebaseE164: (phoneNumber: string) => phoneNumber,
    verifyFirebasePhoneIdToken: (mockVerifyFirebasePhoneIdToken = jest.fn(async (_token, phoneNumber) => ({
        uid: `firebase-${phoneNumber.replace(/\D/g, '')}`,
        phone_number: phoneNumber,
    }))),
}));

describe('Auth Routes', () => {
    let mongoContainer: StartedTestContainer;
    let server: Server;
    let api: AxiosInstance;
    let baseURL: string;
    let testUser: any;
    let testToken: string;
    let unverifiedDoctorUser: any;
    let unverifiedDoctorProfile: any;
    let unverifiedPatientUser: any;
    let unverifiedPatientProfile: any;
    let adminUser: any;
    let mfaAdminUser: any;
    let mfaAdminSecret: string;

    beforeAll(async () => {
        mongoContainer = await new GenericContainer('mongo:7.0')
            .withExposedPorts(27017)
            .start();
        const mongoUri = `mongodb://${mongoContainer.getHost()}:${mongoContainer.getMappedPort(27017)}/test`;
        await mongoose.connect(mongoUri);

        server = app.listen(0);
        const address = server.address();
        const port = typeof address === 'object' && address !== null ? address.port : 3000;
        baseURL = `http://localhost:${port}`;
        api = axios.create({ baseURL, validateStatus: () => true });

        const doctorProfile = await DoctorProfile.create({
            name: 'Test Doctor',
            department: 'General',
            contact_number: '+919000002222',
            phone_verification: {
                status: 'VERIFIED',
                verified_at: new Date(),
            },
        });

        testUser = await User.create({
            login_id: 'testuser',
            password: 'testpassword123',
            user_type: 'DOCTOR',
            profile_id: doctorProfile._id,
            is_active: true
        });

        unverifiedDoctorProfile = await DoctorProfile.create({
            name: 'Unverified Doctor',
            department: 'General',
            contact_number: '+919000003333',
            phone_verification: {
                status: 'PENDING',
            },
        });

        unverifiedDoctorUser = await User.create({
            login_id: 'unverified-doctor',
            password: 'testpassword123',
            user_type: 'DOCTOR',
            profile_id: unverifiedDoctorProfile._id,
            is_active: true
        });

        unverifiedPatientProfile = await PatientProfile.create({
            demographics: {
                name: 'Unverified Patient',
                phone: '+919000004444',
                phone_verification: {
                    status: 'PENDING',
                },
            },
        });

        unverifiedPatientUser = await User.create({
            login_id: 'unverified-patient',
            password: 'testpassword123',
            user_type: 'PATIENT',
            profile_id: unverifiedPatientProfile._id,
            is_active: true
        });

        const adminProfile = await AdminProfile.create({
            name: 'Test Admin',
        }) as any;

        adminUser = await User.create({
            login_id: 'admin-user',
            password: 'testpassword123',
            user_type: 'ADMIN',
            profile_id: adminProfile._id,
            is_active: true
        });

        const mfaAdminProfile = await AdminProfile.create({
            name: 'MFA Admin',
        }) as any;

        mfaAdminUser = await User.create({
            login_id: 'mfa-admin',
            password: 'testpassword123',
            user_type: 'ADMIN',
            profile_id: mfaAdminProfile._id,
            is_active: true
        });
    }, 120000);

    afterAll(async () => {
        await mongoose.connection.dropDatabase();
        await mongoose.connection.close();
        await mongoContainer.stop();
        server.close();
    });

    beforeEach(() => {
        mockVerifyFirebasePhoneIdToken.mockReset();
        mockVerifyFirebasePhoneIdToken.mockImplementation(async (_token, phoneNumber) => ({
            uid: `firebase-${phoneNumber.replace(/\D/g, '')}`,
            phone_number: phoneNumber,
        }));
    });

    describe('POST /api/auth/login', () => {
        test('should login successfully with valid credentials', async () => {
            const response = await api.post('/api/auth/login', {
                login_id: 'testuser',
                password: 'testpassword123'
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.token).toBeDefined();
            expect(response.data.data.refresh_token).toBeDefined();
            expect(response.data.data.session.session_id).toBeDefined();
            expect(response.data.data.user).toBeDefined();
            expect(response.data.data.user.login_id).toBe('testuser');
            expect(response.data.data.user.password_expired).toBe(false);
            expect(response.data.data.user.must_change_password).toBe(false);
            expect(response.data.data.user.password_policy.expiry_days).toBe(90);
            expect(response.data.data.user.password_policy.history_count).toBe(5);
            expectNoMfaSecrets(response.data.data.user);
            testToken = response.data.data.token;

            const session = await AuthSession.findById(response.data.data.session.session_id).lean();
            expect(session).toBeDefined();
            expect(session?.refresh_token_hash).toBeDefined();
            expect(session?.refresh_token_hash).not.toBe(response.data.data.refresh_token);
            expect(session?.refresh_token_hash).not.toContain(response.data.data.refresh_token);

            const auditLog: any = await AuditLog.findOne({
                user_id: testUser._id,
                action: 'LOGIN',
                'metadata.login_attempt.outcome': 'success',
            }).sort({ createdAt: -1 }).lean();
            expect(auditLog).toBeDefined();
            expect(auditLog?.ip_address).toBeDefined();
            expect(auditLog?.metadata?.login_attempt?.ip_address).toBeDefined();
            expect(auditLog?.metadata?.login_attempt?.normalized_login_id).toBe('testuser');
            expect(JSON.stringify(auditLog?.metadata)).not.toContain('testpassword123');
        });

        test('should return a phone OTP challenge for unverified patient login without issuing a token', async () => {
            const response = await api.post('/api/auth/login', {
                login_id: 'unverified-patient',
                password: 'testpassword123'
            });

            expect(response.status).toBe(202);
            expect(response.data.success).toBe(true);
            expect(response.data.data.auth_status).toBe('OTP_REQUIRED');
            expect(response.data.data.token).toBeUndefined();
            expect(response.data.data.challenge.challenge_id).toBeDefined();
            expect(response.data.data.challenge.phone.masked).toBe('********4444');
            expect(response.data.data.challenge.phone.masked).not.toContain('9000004444');
            expect(response.data.data.challenge.phone.number).toBe('+919000004444');
            expect(response.data.data.challenge.provider).toBe('firebase_auth');

            const savedChallenge = await OtpChallenge.findById(response.data.data.challenge.challenge_id);
            expect(savedChallenge?.user_id.toString()).toBe(unverifiedPatientUser._id.toString());
            expect(savedChallenge?.user_type).toBe('PATIENT');
            expect(savedChallenge?.phone_hash).not.toContain('4444');
            expect(savedChallenge?.provider).toBe('firebase_auth');
        });

        test('should return a phone OTP challenge for unverified doctor login', async () => {
            const response = await api.post('/api/auth/login', {
                login_id: 'unverified-doctor',
                password: 'testpassword123'
            });

            expect(response.status).toBe(202);
            expect(response.data.data.auth_status).toBe('OTP_REQUIRED');
            expect(response.data.data.challenge.phone.masked).toBe('********3333');
            expect(response.data.data.challenge.phone.number).toBe('+919000003333');
        });

        test('should login admin without phone OTP behavior', async () => {
            const response = await api.post('/api/auth/login', {
                login_id: 'admin-user',
                password: 'testpassword123'
            });

            expect(response.status).toBe(200);
            expect(response.data.data.token).toBeDefined();
            expect(response.data.data.refresh_token).toBeDefined();
            expect(response.data.data.user.login_id).toBe('admin-user');
            expectNoMfaSecrets(response.data.data.user);
        });

        test('should setup and activate admin authenticator-app MFA without storing plaintext secret', async () => {
            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'mfa-admin',
                password: 'testpassword123'
            });
            const token = loginResponse.data.data.token;

            const setupResponse = await api.post('/api/auth/admin/mfa/totp/setup', {}, {
                headers: { Authorization: `Bearer ${token}` }
            });

            expect(setupResponse.status).toBe(200);
            expect(setupResponse.data.data.factor_type).toBe('AUTHENTICATOR_APP');
            expect(setupResponse.data.data.secret).toMatch(/^[A-Z2-7]+$/);
            expect(setupResponse.data.data.otpauth_url).toContain('otpauth://totp/');
            mfaAdminSecret = setupResponse.data.data.secret;

            const userAfterSetup = await User.findById(mfaAdminUser._id).lean();
            expect(userAfterSetup?.admin_mfa?.totp?.status).toBe('PENDING');
            expect(userAfterSetup?.admin_mfa?.totp?.pending_secret_ciphertext).toBeDefined();
            expect(userAfterSetup?.admin_mfa?.totp?.pending_secret_ciphertext).not.toBe(setupResponse.data.data.secret);

            const activationResponse = await api.post('/api/auth/admin/mfa/totp/activate', {
                code: generateTotpCode(setupResponse.data.data.secret),
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });

            expect(activationResponse.status).toBe(200);
            expect(activationResponse.data.data.status).toBe('ENABLED');

            const statusResponse = await api.get('/api/auth/admin/mfa/totp/status', {
                headers: { Authorization: `Bearer ${token}` }
            });

            expect(statusResponse.status).toBe(200);
            expect(statusResponse.data.data.factor_type).toBe('AUTHENTICATOR_APP');
            expect(statusResponse.data.data.status).toBe('ENABLED');
            expect(statusResponse.data.data.enabled).toBe(true);
            expect(statusResponse.data.data.secret_ciphertext).toBeUndefined();
            expect(statusResponse.data.data.pending_secret_ciphertext).toBeUndefined();

            const userAfterActivation = await User.findById(mfaAdminUser._id).lean();
            expect(userAfterActivation?.admin_mfa?.totp?.status).toBe('ENABLED');
            expect(userAfterActivation?.admin_mfa?.totp?.secret_ciphertext).toBeDefined();
            expect(userAfterActivation?.admin_mfa?.totp?.secret_ciphertext).not.toBe(setupResponse.data.data.secret);
            expect(userAfterActivation?.admin_mfa?.totp?.pending_secret_ciphertext).toBeUndefined();

            const activeCiphertext = userAfterActivation?.admin_mfa?.totp?.secret_ciphertext;
            const reEnrollmentResponse = await api.post('/api/auth/admin/mfa/totp/setup', {}, {
                headers: { Authorization: `Bearer ${token}` }
            });

            expect(reEnrollmentResponse.status).toBe(409);

            const userAfterRejectedSetup = await User.findById(mfaAdminUser._id).lean();
            expect(userAfterRejectedSetup?.admin_mfa?.totp?.status).toBe('ENABLED');
            expect(userAfterRejectedSetup?.admin_mfa?.totp?.secret_ciphertext).toBe(activeCiphertext);
            expect(userAfterRejectedSetup?.admin_mfa?.totp?.pending_secret_ciphertext).toBeUndefined();
        });

        test('should require admin TOTP challenge after MFA is enabled and issue token only after verification', async () => {
            expect(mfaAdminSecret).toBeDefined();

            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'mfa-admin',
                password: 'testpassword123'
            });

            expect(loginResponse.status).toBe(202);
            expect(loginResponse.data.data.auth_status).toBe('TOTP_REQUIRED');
            expect(loginResponse.data.data.token).toBeUndefined();
            expect(loginResponse.data.data.challenge.factor_type).toBe('AUTHENTICATOR_APP');

            const verifyResponse = await api.post('/api/auth/login/totp/verify', {
                challenge_id: loginResponse.data.data.challenge.challenge_id,
                code: generateTotpCode(mfaAdminSecret),
            });

            expect(verifyResponse.status).toBe(200);
            expect(verifyResponse.data.data.token).toBeDefined();
            expect(verifyResponse.data.data.refresh_token).toBeDefined();
            expect(verifyResponse.data.data.user.login_id).toBe('mfa-admin');
            expectNoMfaSecrets(verifyResponse.data.data.user);

            const meResponse = await api.get('/api/auth/me', {
                headers: { Authorization: `Bearer ${verifyResponse.data.data.token}` }
            });
            expect(meResponse.status).toBe(200);
            expect(meResponse.data.data.user.login_id).toBe('mfa-admin');
            expectNoMfaSecrets(meResponse.data.data.user);

            const challenge = await AdminMfaChallenge.findById(loginResponse.data.data.challenge.challenge_id);
            expect(challenge?.status).toBe(AdminMfaChallengeStatus.VERIFIED);
        });

        test('should reject failed and replayed admin TOTP login verification', async () => {
            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'mfa-admin',
                password: 'testpassword123'
            });
            expect(loginResponse.status).toBe(202);
            const challengeId = loginResponse.data.data.challenge.challenge_id;

            const failedResponse = await api.post('/api/auth/login/totp/verify', {
                challenge_id: challengeId,
                code: '000000',
            });

            expect(failedResponse.status).toBe(401);
            expect(failedResponse.data.data?.token).toBeUndefined();

            await AdminMfaChallenge.findByIdAndUpdate(challengeId, {
                $set: { status: AdminMfaChallengeStatus.VERIFIED },
            });

            const replayResponse = await api.post('/api/auth/login/totp/verify', {
                challenge_id: challengeId,
                code: '000000',
            });

            expect(replayResponse.status).toBe(410);
        });

        test('should verify patient login OTP, mark phone verified, and issue a token', async () => {
            await PatientProfile.findByIdAndUpdate(unverifiedPatientProfile._id, {
                $set: {
                    'demographics.phone_verification.status': 'PENDING',
                    'demographics.phone_verification.verified_at': undefined,
                },
            });

            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'unverified-patient',
                password: 'testpassword123'
            });
            const challengeId = loginResponse.data.data.challenge.challenge_id;

            const response = await api.post('/api/auth/login/otp/verify', {
                challenge_id: challengeId,
                firebase_id_token: 'patient-firebase-id-token',
            });

            expect(response.status).toBe(200);
            expect(response.data.data.token).toBeDefined();
            expect(response.data.data.refresh_token).toBeDefined();
            expect(response.data.data.user.login_id).toBe('unverified-patient');
            expect(mockVerifyFirebasePhoneIdToken).toHaveBeenCalledWith('patient-firebase-id-token', '+919000004444');

            const patientProfile = await PatientProfile.findById(unverifiedPatientProfile._id);
            expect(patientProfile?.demographics?.phone_verification?.status).toBe('VERIFIED');
            expect(patientProfile?.demographics?.phone_verification?.verified_at).toBeDefined();
        });

        test('should not mark phone verified after Firebase rejects the ID token', async () => {
            await DoctorProfile.findByIdAndUpdate(unverifiedDoctorProfile._id, {
                $set: {
                    'phone_verification.status': 'PENDING',
                    'phone_verification.verified_at': undefined,
                },
            });
            mockVerifyFirebasePhoneIdToken.mockRejectedValueOnce(new Error('invalid Firebase token'));

            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'unverified-doctor',
                password: 'testpassword123'
            });
            const response = await api.post('/api/auth/login/otp/verify', {
                challenge_id: loginResponse.data.data.challenge.challenge_id,
                firebase_id_token: 'invalid-firebase-id-token',
            });

            expect(response.status).toBe(401);
            expect(response.data.data?.token).toBeUndefined();

            const doctorProfile = await DoctorProfile.findById(unverifiedDoctorProfile._id);
            expect(doctorProfile?.phone_verification?.status).toBe('PENDING');
            expect(doctorProfile?.phone_verification?.verified_at).toBeUndefined();
        });

        test('should reject expired and locked login OTP challenges before issuing a token', async () => {
            await PatientProfile.findByIdAndUpdate(unverifiedPatientProfile._id, {
                $set: {
                    'demographics.phone_verification.status': 'PENDING',
                    'demographics.phone_verification.verified_at': undefined,
                },
            });

            const expiredLogin = await api.post('/api/auth/login', {
                login_id: 'unverified-patient',
                password: 'testpassword123'
            });
            await OtpChallenge.findByIdAndUpdate(expiredLogin.data.data.challenge.challenge_id, {
                $set: { expires_at: new Date(Date.now() - 1000) },
            });

            const expiredResponse = await api.post('/api/auth/login/otp/verify', {
                challenge_id: expiredLogin.data.data.challenge.challenge_id,
                firebase_id_token: 'firebase-id-token',
            });
            expect(expiredResponse.status).toBe(410);

            const lockedLogin = await api.post('/api/auth/login', {
                login_id: 'unverified-patient',
                password: 'testpassword123'
            });
            await OtpChallenge.findByIdAndUpdate(lockedLogin.data.data.challenge.challenge_id, {
                $set: {
                    status: OtpChallengeStatus.LOCKED,
                    attempt_count: 5,
                },
            });

            const lockedResponse = await api.post('/api/auth/login/otp/verify', {
                challenge_id: lockedLogin.data.data.challenge.challenge_id,
                firebase_id_token: 'firebase-id-token',
            });
            expect(lockedResponse.status).toBe(423);
        });

        test('should prevent cross-account login challenge replay after registered phone changes', async () => {
            await DoctorProfile.findByIdAndUpdate(unverifiedDoctorProfile._id, {
                $set: {
                    contact_number: '+919000003333',
                    'phone_verification.status': 'PENDING',
                },
            });

            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'unverified-doctor',
                password: 'testpassword123'
            });

            await DoctorProfile.findByIdAndUpdate(unverifiedDoctorProfile._id, {
                $set: { contact_number: '+919000007777' },
            });

            const response = await api.post('/api/auth/login/otp/verify', {
                challenge_id: loginResponse.data.data.challenge.challenge_id,
                firebase_id_token: 'firebase-id-token',
            });

            expect(response.status).toBe(403);
            expect(mockVerifyFirebasePhoneIdToken).not.toHaveBeenCalled();

            await DoctorProfile.findByIdAndUpdate(unverifiedDoctorProfile._id, {
                $set: { contact_number: '+919000003333' },
            });
        });

        test('should not issue a token if the phone changes after Firebase verifies but before profile verification update', async () => {
            await PatientProfile.findByIdAndUpdate(unverifiedPatientProfile._id, {
                $set: {
                    'demographics.phone': '+919000004444',
                    'demographics.phone_verification.status': 'PENDING',
                },
                $unset: {
                    'demographics.phone_verification.verified_at': '',
                },
            });

            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'unverified-patient',
                password: 'testpassword123'
            });
            const challengeId = loginResponse.data.data.challenge.challenge_id;

            mockVerifyFirebasePhoneIdToken.mockImplementationOnce(async () => {
                await PatientProfile.findByIdAndUpdate(unverifiedPatientProfile._id, {
                    $set: { 'demographics.phone': '+919000008888' },
                });
                return { uid: 'firebase-race-test', phone_number: '+919000004444' };
            });

            const response = await api.post('/api/auth/login/otp/verify', {
                challenge_id: challengeId,
                firebase_id_token: 'firebase-id-token',
            });

            expect(response.status).toBe(409);
            expect(response.data.data?.token).toBeUndefined();

            const patientProfile = await PatientProfile.findById(unverifiedPatientProfile._id);
            expect(patientProfile?.demographics?.phone).toBe('+919000008888');
            expect(patientProfile?.demographics?.phone_verification?.status).toBe('PENDING');
            expect(patientProfile?.demographics?.phone_verification?.verified_at).toBeUndefined();
        });

        test('should resend login OTP through the existing challenge policy', async () => {
            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'unverified-doctor',
                password: 'testpassword123'
            });
            const challengeId = loginResponse.data.data.challenge.challenge_id;
            await OtpChallenge.findByIdAndUpdate(challengeId, {
                $set: { resend_available_at: new Date(Date.now() - 1000) },
            });
            const response = await api.post('/api/auth/login/otp/resend', {
                challenge_id: challengeId,
            });

            expect(response.status).toBe(200);
            expect(response.data.data.auth_status).toBe('OTP_REQUIRED');
            expect(response.data.data.challenge.provider).toBe('firebase_auth');
        });

        test('should fail with invalid login_id', async () => {
            const response = await api.post('/api/auth/login', {
                login_id: 'nonexistentuser',
                password: 'testpassword123'
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
            expect(response.data.message).toBe("User Doesn't exist");
        });

        test('should fail with invalid password', async () => {
            const response = await api.post('/api/auth/login', {
                login_id: 'testuser',
                password: 'wrongpassword'
            });

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
            expect(response.data.message).toBe('Invalid credentials');

            const auditLog: any = await AuditLog.findOne({
                user_id: testUser._id,
                action: 'LOGIN_FAILED',
                'metadata.login_attempt.outcome': 'invalid_credentials',
            }).sort({ createdAt: -1 }).lean();
            expect(auditLog).toBeDefined();
            expect(auditLog?.success).toBe(false);
            expect(auditLog?.metadata?.login_attempt?.normalized_login_id).toBe('testuser');
            expect(auditLog?.metadata?.login_attempt?.failed_login_attempts).toBeGreaterThanOrEqual(1);
            expect(JSON.stringify(auditLog?.metadata)).not.toContain('wrongpassword');
        });

        test('should fail with inactive user account', async () => {
            await User.findByIdAndUpdate(testUser._id, { is_active: false });

            const response = await api.post('/api/auth/login', {
                login_id: 'testuser',
                password: 'testpassword123'
            });

            expect(response.status).toBe(403);
            expect(response.data.success).toBe(false);
            expect(response.data.message).toBe('Account is inactive. Please contact support.');

            await User.findByIdAndUpdate(testUser._id, { is_active: true });
        });

        test('should fail with missing login_id', async () => {
            const response = await api.post('/api/auth/login', {
                password: 'testpassword123'
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should fail with missing password', async () => {
            const response = await api.post('/api/auth/login', {
                login_id: 'testuser'
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });
    });

    describe('POST /api/auth/refresh', () => {
        test('should rotate refresh token and invalidate the previous access token', async () => {
            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'testuser',
                password: 'testpassword123'
            });
            const originalToken = loginResponse.data.data.token;
            const originalRefreshToken = loginResponse.data.data.refresh_token;

            const refreshResponse = await api.post('/api/auth/refresh', {
                refresh_token: originalRefreshToken,
            });

            expect(refreshResponse.status).toBe(200);
            expect(refreshResponse.data.data.token).toBeDefined();
            expect(refreshResponse.data.data.refresh_token).toBeDefined();
            expect(refreshResponse.data.data.token).not.toBe(originalToken);
            expect(refreshResponse.data.data.refresh_token).not.toBe(originalRefreshToken);

            const oldTokenResponse = await api.get('/api/auth/me', {
                headers: { Authorization: `Bearer ${originalToken}` }
            });
            expect(oldTokenResponse.status).toBe(401);

            const newTokenResponse = await api.get('/api/auth/me', {
                headers: { Authorization: `Bearer ${refreshResponse.data.data.token}` }
            });
            expect(newTokenResponse.status).toBe(200);

            const replayResponse = await api.post('/api/auth/refresh', {
                refresh_token: originalRefreshToken,
            });
            expect(replayResponse.status).toBe(401);
        });

        test('should reject missing or invalid refresh tokens', async () => {
            const missingResponse = await api.post('/api/auth/refresh', {});
            expect(missingResponse.status).toBe(400);

            const invalidResponse = await api.post('/api/auth/refresh', {
                refresh_token: 'not-a-real-refresh-token',
            });
            expect(invalidResponse.status).toBe(401);
        });
    });

    describe('POST /api/auth/revoke', () => {
        test('should revoke a refresh token and reject the current access token', async () => {
            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'testuser',
                password: 'testpassword123'
            });
            const token = loginResponse.data.data.token;
            const refreshToken = loginResponse.data.data.refresh_token;

            const response = await api.post('/api/auth/revoke', {
                refresh_token: refreshToken,
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);

            const meResponse = await api.get('/api/auth/me', {
                headers: { Authorization: `Bearer ${token}` }
            });
            expect(meResponse.status).toBe(401);

            const refreshResponse = await api.post('/api/auth/refresh', {
                refresh_token: refreshToken,
            });
            expect(refreshResponse.status).toBe(401);
        });
    });

    describe('POST /api/auth/logout', () => {
        test('should logout successfully with valid token', async () => {
            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'testuser',
                password: 'testpassword123'
            });
            const token = loginResponse.data.data.token;

            const response = await api.post('/api/auth/logout', {}, {
                headers: { Authorization: `Bearer ${token}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.message).toBe('Logout successful. Please clear the token from client-side.');

            const meResponse = await api.get('/api/auth/me', {
                headers: { Authorization: `Bearer ${token}` }
            });
            expect(meResponse.status).toBe(401);
        });

        test('should fail without authentication token', async () => {
            const response = await api.post('/api/auth/logout');

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });

        test('should fail with invalid token', async () => {
            const response = await api.post('/api/auth/logout', {}, {
                headers: { Authorization: 'Bearer invalidtoken123' }
            });

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });
    });

    describe('GET /api/auth/me', () => {
        test('should get user profile successfully with valid token', async () => {
            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'testuser',
                password: 'testpassword123'
            });
            const token = loginResponse.data.data.token;

            const response = await api.get('/api/auth/me', {
                headers: { Authorization: `Bearer ${token}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.user).toBeDefined();
            expect(response.data.data.user.login_id).toBe('testuser');
            expect(response.data.data.user.password).toBeUndefined();
            expect(response.data.data.user.salt).toBeUndefined();
            expect(response.data.data.user.password_history).toBeUndefined();
            expect(response.data.data.user.password_expired).toBe(false);
            expect(response.data.data.user.password_expires_at).toBeDefined();
            expectNoMfaSecrets(response.data.data.user);
        });

        test('should fail without authentication token', async () => {
            const response = await api.get('/api/auth/me');

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });

        test('should fail with invalid token', async () => {
            const response = await api.get('/api/auth/me', {
                headers: { Authorization: 'Bearer invalidtoken123' }
            });

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });
    });

    describe('Password policy', () => {
        test('should expose expired password state on login and me responses', async () => {
            const profile = await DoctorProfile.create({
                name: 'Expired Password Doctor',
                department: 'General',
                contact_number: '+919000005555',
                phone_verification: {
                    status: 'VERIFIED',
                    verified_at: new Date(),
                },
            });
            const expiredUser = await User.create({
                login_id: 'expired-password-user',
                password: 'Expired@123',
                user_type: 'DOCTOR',
                profile_id: profile._id,
                is_active: true,
            });
            await User.findByIdAndUpdate(expiredUser._id, {
                $set: { password_changed_at: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000) },
            });

            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'expired-password-user',
                password: 'Expired@123',
            });

            expect(loginResponse.status).toBe(200);
            expect(loginResponse.data.data.token).toBeDefined();
            expect(loginResponse.data.data.user.password_expired).toBe(true);
            expect(loginResponse.data.data.user.must_change_password).toBe(true);
            expect(loginResponse.data.data.user.password_expires_at).toBeDefined();

            const meResponse = await api.get('/api/auth/me', {
                headers: { Authorization: `Bearer ${loginResponse.data.data.token}` },
            });
            expect(meResponse.status).toBe(200);
            expect(meResponse.data.data.user.password_expired).toBe(true);
            expect(meResponse.data.data.user.must_change_password).toBe(true);
        });

        test('should reject password reuse from recent password history', async () => {
            const profile = await DoctorProfile.create({
                name: 'History Doctor',
                department: 'General',
                contact_number: '+919000006666',
                phone_verification: {
                    status: 'VERIFIED',
                    verified_at: new Date(),
                },
            });
            const historyUser = await User.create({
                login_id: 'history-user',
                password: 'History@123',
                user_type: 'DOCTOR',
                profile_id: profile._id,
                is_active: true,
            });

            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'history-user',
                password: 'History@123',
            });
            const token = loginResponse.data.data.token;

            const changeResponse = await api.post('/api/auth/change-password', {
                current_password: 'History@123',
                new_password: 'History@456',
            }, {
                headers: { Authorization: `Bearer ${token}` },
            });
            expect(changeResponse.status).toBe(200);
            expect(changeResponse.data.data.must_change_password).toBe(false);

            const storedUser = await User.findById(historyUser._id).select('+password_history').lean();
            expect(storedUser?.password_history?.length).toBe(1);
            expect(storedUser?.password_history?.[0].password).toBeDefined();
            expect(storedUser?.password_history?.[0].password).not.toBe('History@123');
            expect(storedUser?.password_history?.[0].salt).toBeDefined();

            const reloginResponse = await api.post('/api/auth/login', {
                login_id: 'history-user',
                password: 'History@456',
            });
            expect(reloginResponse.status).toBe(200);

            const reuseResponse = await api.post('/api/auth/change-password', {
                current_password: 'History@456',
                new_password: 'History@123',
            }, {
                headers: { Authorization: `Bearer ${reloginResponse.data.data.token}` },
            });
            expect(reuseResponse.status).toBe(400);
            expect(reuseResponse.data.message).toBe('New password cannot match a recently used password');
        });

        test('should revoke all active sessions after password change', async () => {
            const profile = await DoctorProfile.create({
                name: 'Session Revoked Password Doctor',
                department: 'General',
                contact_number: 'doctor-channel-ending-6767',
                phone_verification: {
                    status: 'VERIFIED',
                    verified_at: new Date(),
                },
            });
            await User.create({
                login_id: 'password-session-user',
                password: 'Session@123',
                user_type: 'DOCTOR',
                profile_id: profile._id,
                is_active: true,
            });

            const firstLogin = await api.post('/api/auth/login', {
                login_id: 'password-session-user',
                password: 'Session@123',
            });
            const secondLogin = await api.post('/api/auth/login', {
                login_id: 'password-session-user',
                password: 'Session@123',
            });
            expect(firstLogin.status).toBe(200);
            expect(secondLogin.status).toBe(200);

            const changeResponse = await api.post('/api/auth/change-password', {
                current_password: 'Session@123',
                new_password: 'Session@456',
            }, {
                headers: { Authorization: `Bearer ${firstLogin.data.data.token}` },
            });
            expect(changeResponse.status).toBe(200);
            expect(changeResponse.data.data.invalidated_sessions).toBeGreaterThanOrEqual(2);

            const oldAccessResponse = await api.get('/api/auth/me', {
                headers: { Authorization: `Bearer ${firstLogin.data.data.token}` },
            });
            expect(oldAccessResponse.status).toBe(401);

            const otherAccessResponse = await api.get('/api/auth/me', {
                headers: { Authorization: `Bearer ${secondLogin.data.data.token}` },
            });
            expect(otherAccessResponse.status).toBe(401);

            const oldRefreshResponse = await api.post('/api/auth/refresh', {
                refresh_token: secondLogin.data.data.refresh_token,
            });
            expect(oldRefreshResponse.status).toBe(401);

            const revokedSession = await AuthSession.findById(firstLogin.data.data.session.session_id).lean();
            expect(revokedSession?.revoked_at).toBeDefined();
            expect(revokedSession?.revoked_reason).toBe('PASSWORD_CHANGED');
        });
    });
});
