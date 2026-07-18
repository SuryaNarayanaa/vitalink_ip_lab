import axios, { AxiosInstance } from 'axios';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import mongoose from 'mongoose';
import app from '@alias/app';
import { AdminMfaChallenge, AdminProfile, AuditLog, AuthSession, DoctorProfile, Hospital, OtpChallenge, PatientProfile, User } from '@alias/models';
import { Server } from 'http';
import { OtpChallengeStatus } from '@alias/models/otpchallenge.model';
import { AdminMfaChallengeStatus } from '@alias/models/adminmfachallenge.model';
import { createAdminTotpEnrollment, generateTotpCode, replaceAdminTotpForRecovery } from '@alias/services/admin-totp.service';
import { updateSystemConfig } from '@alias/services/config.service';
import { setUserPasswordWithPolicy } from '@alias/services/password.service';
import { ensureAuthGenerationDefaults, ensureChallengeAuditRetention } from '@alias/config/db';

var mockStartVerification: jest.Mock;
var mockCheckVerification: jest.Mock;

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

jest.mock('@alias/services/twilio-verify.service', () => ({
    __esModule: true,
    maskPhoneNumber: (phoneNumber: string) => {
        const digits = phoneNumber.replace(/\D/g, '');
        if (digits.length <= 4) return '****';
        return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
    },
    twilioVerifyService: {
        startVerification: (mockStartVerification = jest.fn()),
        checkVerification: (mockCheckVerification = jest.fn()),
    },
    TwilioVerifyService: jest.fn(),
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
    let authHospital: any;

    beforeAll(async () => {
        mongoContainer = await new GenericContainer('mongo:7.0')
            .withExposedPorts(27017)
            .start();
        const mongoUri = `mongodb://${mongoContainer.getHost()}:${mongoContainer.getMappedPort(27017)}/test`;
        await mongoose.connect(mongoUri);
        await ensureChallengeAuditRetention();

        server = app.listen(0);
        const address = server.address();
        const port = typeof address === 'object' && address !== null ? address.port : 3000;
        baseURL = `http://localhost:${port}`;
        api = axios.create({ baseURL, validateStatus: () => true });

        authHospital = await Hospital.create({
            code: 'AUTH_ACTIVE', name: 'Auth Active Hospital', location: 'Test',
            admin_email: 'auth-active@example.com',
        });

        const doctorProfile = await DoctorProfile.create({
            name: 'Test Doctor',
            department: 'General',
            contact_number: '+919000002222',
            hospital_id: authHospital._id,
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
            hospital_id: authHospital._id,
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
            hospital_id: authHospital._id,
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
        await new Promise<void>((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
    });

    beforeEach(() => {
        mockStartVerification.mockReset();
        mockCheckVerification.mockReset();
        mockStartVerification.mockResolvedValue({
            sid: 'test-verification-id',
            status: 'pending',
        });
        mockCheckVerification.mockResolvedValue({
            status: 'approved',
            valid: true,
        });
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

        test('does not return a usable session when the LOGIN success audit cannot be persisted', async () => {
            const existingSessionIds = (await AuthSession.find({ user_id: testUser._id }).select('_id').lean())
                .map(session => String(session._id));
            const auditSpy = jest.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('audit unavailable') as never);
            try {
                const response = await api.post('/api/auth/login', {
                    login_id: 'testuser',
                    password: 'testpassword123',
                });
                expect(response.status).toBe(503);
                expect(response.data.data?.token).toBeUndefined();

                const retiredSession = await AuthSession.findOne({
                    user_id: testUser._id,
                    _id: { $nin: existingSessionIds },
                }).sort({ createdAt: -1 }).lean();
                expect(retiredSession?.revoked_at).toBeDefined();
                expect(retiredSession?.revoked_reason).toBe('USER_REVOKED');
            } finally {
                auditSpy.mockRestore();
            }
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
            expect(mockStartVerification).toHaveBeenCalledWith('+919000004444', 'sms');

            const savedChallenge = await OtpChallenge.findById(response.data.data.challenge.challenge_id);
            expect(savedChallenge?.user_id.toString()).toBe(unverifiedPatientUser._id.toString());
            expect(savedChallenge?.user_type).toBe('PATIENT');
            expect(savedChallenge?.phone_hash).not.toContain('4444');
            expect(await AuditLog.exists({
                user_id: unverifiedPatientUser._id,
                action: 'LOGIN_CHALLENGE',
                success: true,
            })).toBeTruthy();
            expect(await AuditLog.exists({
                user_id: unverifiedPatientUser._id,
                action: 'LOGIN',
                success: true,
            })).toBeNull();
        });

        test('should return a phone OTP challenge for unverified doctor login', async () => {
            const response = await api.post('/api/auth/login', {
                login_id: 'unverified-doctor',
                password: 'testpassword123'
            });

            expect(response.status).toBe(202);
            expect(response.data.data.auth_status).toBe('OTP_REQUIRED');
            expect(response.data.data.challenge.phone.masked).toBe('********3333');
            expect(mockStartVerification).toHaveBeenCalledWith('+919000003333', 'sms');
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
            expect(mockStartVerification).not.toHaveBeenCalled();
        });

        test('should setup and activate admin authenticator-app MFA without storing plaintext secret', async () => {
            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'mfa-admin',
                password: 'testpassword123'
            });
            const token = loginResponse.data.data.token;

            const concurrentSetupResponses = await Promise.all([
                api.post('/api/auth/admin/mfa/totp/setup', {}, {
                    headers: { Authorization: `Bearer ${token}` }
                }),
                api.post('/api/auth/admin/mfa/totp/setup', {}, {
                    headers: { Authorization: `Bearer ${token}` }
                }),
            ]);
            expect(concurrentSetupResponses.map(response => response.status).sort()).toEqual([200, 409]);
            const setupResponse = concurrentSetupResponses.find(response => response.status === 200)!;

            expect(setupResponse.status).toBe(200);
            expect(setupResponse.data.data.factor_type).toBe('AUTHENTICATOR_APP');
            expect(setupResponse.data.data.secret).toMatch(/^[A-Z2-7]+$/);
            expect(setupResponse.data.data.otpauth_url).toContain('otpauth://totp/');
            mfaAdminSecret = setupResponse.data.data.secret;

            const userAfterSetup = await User.findById(mfaAdminUser._id).lean();
            expect(userAfterSetup?.admin_mfa?.totp?.status).toBe('PENDING');
            expect(userAfterSetup?.admin_mfa?.totp?.pending_secret_ciphertext).toBeDefined();
            expect(userAfterSetup?.admin_mfa?.totp?.pending_secret_ciphertext).not.toBe(setupResponse.data.data.secret);

            const activationCode = generateTotpCode(setupResponse.data.data.secret);
            const cleanupSpy = jest.spyOn(AuthSession, 'updateMany').mockRejectedValueOnce(new Error('cleanup unavailable'));
            let activationResponse: any;
            try {
                activationResponse = await api.post('/api/auth/admin/mfa/totp/activate', {
                    code: activationCode,
                }, {
                    headers: { Authorization: `Bearer ${token}` }
                });
            } finally {
                cleanupSpy.mockRestore();
            }

            expect(activationResponse.status).toBe(200);
            expect(activationResponse.data.data.status).toBe('ENABLED');
            expect(activationResponse.data.data.invalidated_sessions).toBe(0);
            expect(activationResponse.data.data.revocation_cleanup_completed).toBe(false);
            expect(activationResponse.data.data.audit_recorded).toBe(true);
            const lifecycleAudits: any[] = await AuditLog.find({
                user_id: mfaAdminUser._id,
                action: { $in: ['MFA_SETUP', 'MFA_ACTIVATE'] },
                success: true,
            }).lean();
            expect(lifecycleAudits.map(log => log.action)).toEqual(expect.arrayContaining(['MFA_SETUP', 'MFA_ACTIVATE']));
            expect(JSON.stringify(lifecycleAudits)).not.toContain(setupResponse.data.data.secret);
            expect(JSON.stringify(lifecycleAudits)).not.toContain(activationCode);

            // MFA activation advances the account generation, so the session
            // that enrolled the factor is intentionally retired.
            const retiredStatusResponse = await api.get('/api/auth/admin/mfa/totp/status', {
                headers: { Authorization: `Bearer ${token}` }
            });
            expect(retiredStatusResponse.status).toBe(401);
            const retiredRefreshResponse = await api.post('/api/auth/refresh', {
                refresh_token: loginResponse.data.data.refresh_token,
            });
            expect(retiredRefreshResponse.status).toBe(401);

            const postActivationLogin = await api.post('/api/auth/login', {
                login_id: 'mfa-admin', password: 'testpassword123',
            });
            const postActivationVerification = await api.post('/api/auth/login/totp/verify', {
                challenge_id: postActivationLogin.data.data.challenge.challenge_id,
                code: generateTotpCode(setupResponse.data.data.secret, Math.floor(Date.now() / 30_000) + 1),
            });
            expect(postActivationVerification.status).toBe(200);
            const postActivationToken = postActivationVerification.data.data.token;

            const statusResponse = await api.get('/api/auth/admin/mfa/totp/status', {
                headers: { Authorization: `Bearer ${postActivationToken}` }
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
            expect(userAfterActivation?.admin_mfa?.totp?.last_verified_time_step).toBeDefined();

            const replayLogin = await api.post('/api/auth/login', {
                login_id: 'mfa-admin',
                password: 'testpassword123'
            });
            const replayResponse = await api.post('/api/auth/login/totp/verify', {
                challenge_id: replayLogin.data.data.challenge.challenge_id,
                code: activationCode,
            });
            expect(replayResponse.status).toBe(401);
            expect(replayResponse.data.data?.token).toBeUndefined();

            const activeCiphertext = userAfterActivation?.admin_mfa?.totp?.secret_ciphertext;
            const reEnrollmentResponse = await api.post('/api/auth/admin/mfa/totp/setup', {}, {
                headers: { Authorization: `Bearer ${postActivationToken}` }
            });

            expect(reEnrollmentResponse.status).toBe(409);

            const userAfterRejectedSetup = await User.findById(mfaAdminUser._id).lean();
            expect(userAfterRejectedSetup?.admin_mfa?.totp?.status).toBe('ENABLED');
            expect(userAfterRejectedSetup?.admin_mfa?.totp?.secret_ciphertext).toBe(activeCiphertext);
            expect(userAfterRejectedSetup?.admin_mfa?.totp?.pending_secret_ciphertext).toBeUndefined();

            // Simulate the next TOTP period for the remaining login tests.
            await User.updateOne(
                { _id: mfaAdminUser._id },
                { $unset: { 'admin_mfa.totp.last_verified_time_step': 1 } },
            );
        });

        test('allows only one winner when initial TOTP setup races supervised recovery', async () => {
            const profile = await AdminProfile.create({ name: 'Setup Recovery Race Admin' });
            const account = await User.create({
                login_id: 'setup-recovery-race-admin', password: 'SetupRace@123', user_type: 'ADMIN',
                profile_id: profile._id, is_active: true,
            });
            const [setupCopy, recoveryCopy] = await Promise.all([
                User.findById(account._id), User.findById(account._id),
            ]);
            const results = await Promise.allSettled([
                createAdminTotpEnrollment(setupCopy),
                replaceAdminTotpForRecovery(recoveryCopy),
            ]);
            expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
            expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
            expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.statusCode).toBe(409);
            const winner = (results.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<any>).value;
            expect(winner.secret).toMatch(/^[A-Z2-7]+$/);
            const stored: any = await User.findById(account._id).lean();
            expect([
                stored.admin_mfa.totp.pending_secret_ciphertext,
                stored.admin_mfa.totp.secret_ciphertext,
            ].filter(Boolean)).toHaveLength(1);
            await Promise.all([User.deleteOne({ _id: account._id }), AdminProfile.deleteOne({ _id: profile._id })]);
        });

        test('should authenticate a legacy enabled TOTP account after generation backfill', async () => {
            await User.collection.updateOne(
                { _id: mfaAdminUser._id },
                {
                    $unset: {
                        security_version: 1,
                        'admin_mfa.totp.factor_generation': 1,
                        'admin_mfa.totp.last_verified_time_step': 1,
                    },
                },
            );
            await ensureAuthGenerationDefaults();
            const login = await api.post('/api/auth/login', {
                login_id: 'mfa-admin', password: 'testpassword123',
            });
            expect(login.status).toBe(202);
            const verified = await api.post('/api/auth/login/totp/verify', {
                challenge_id: login.data.data.challenge.challenge_id,
                code: generateTotpCode(mfaAdminSecret),
            });
            expect(verified.status).toBe(200);
            await Promise.all([
                User.updateOne(
                    { _id: mfaAdminUser._id },
                    { $unset: { 'admin_mfa.totp.last_verified_time_step': 1 } },
                ),
                AdminMfaChallenge.deleteMany({ user_id: mfaAdminUser._id }),
            ]);
        });

        test('should expose only one pending challenge across concurrent admin logins', async () => {
            const responses = await Promise.all([
                api.post('/api/auth/login', { login_id: 'mfa-admin', password: 'testpassword123' }),
                api.post('/api/auth/login', { login_id: 'mfa-admin', password: 'testpassword123' }),
            ]);
            expect(responses.every(response => response.status === 202)).toBe(true);
            expect(new Set(responses.map(response => response.data.data.challenge.challenge_id)).size).toBe(1);
            expect(await AdminMfaChallenge.countDocuments({
                user_id: mfaAdminUser._id,
                status: AdminMfaChallengeStatus.PENDING,
            })).toBe(1);
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
            expect(mockStartVerification).not.toHaveBeenCalled();

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

        test('should allow only one concurrent verification of an admin TOTP challenge', async () => {
            await User.updateOne(
                { _id: mfaAdminUser._id },
                { $unset: { 'admin_mfa.totp.last_verified_time_step': 1 } },
            );
            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'mfa-admin',
                password: 'testpassword123'
            });
            const challengeId = loginResponse.data.data.challenge.challenge_id;
            const code = generateTotpCode(mfaAdminSecret);
            const sessionsBefore = await AuthSession.countDocuments({ user_id: mfaAdminUser._id });

            const responses = await Promise.all([
                api.post('/api/auth/login/totp/verify', { challenge_id: challengeId, code }),
                api.post('/api/auth/login/totp/verify', { challenge_id: challengeId, code }),
            ]);

            expect(responses.filter(response => response.status === 200)).toHaveLength(1);
            expect(responses.filter(response => response.status !== 200)).toHaveLength(1);
            expect([401, 410]).toContain(responses.find(response => response.status !== 200)?.status);
            expect(await AuthSession.countDocuments({ user_id: mfaAdminUser._id })).toBe(sessionsBefore + 1);
            expect(await AdminMfaChallenge.countDocuments({
                user_id: mfaAdminUser._id,
                status: AdminMfaChallengeStatus.VERIFIED,
                _id: challengeId,
            })).toBe(1);
        });

        test('should restore replay state without erasing a concurrent lockout when challenge consumption loses a race', async () => {
            const priorStep = Math.floor(Date.now() / 30_000) - 1;
            const priorLogin = new Date('2025-01-01T00:00:00.000Z');
            await User.updateOne({ _id: mfaAdminUser._id }, {
                $set: {
                    'admin_mfa.totp.last_verified_time_step': priorStep,
                    'admin_mfa.totp.last_verified_at': priorLogin,
                    last_login_at: priorLogin,
                    failed_login_attempts: 2,
                },
                $unset: { 'admin_mfa.totp.last_verified_challenge_id': 1, locked_until: 1 },
            });
            const login = await api.post('/api/auth/login', {
                login_id: 'mfa-admin', password: 'testpassword123',
            });
            const challengeId = login.data.data.challenge.challenge_id;
            await User.updateOne({ _id: mfaAdminUser._id }, {
                $set: { last_login_at: priorLogin, failed_login_attempts: 2 },
            });

            const original = AdminMfaChallenge.findOneAndUpdate.bind(AdminMfaChallenge);
            const spy = jest.spyOn(AdminMfaChallenge, 'findOneAndUpdate').mockImplementation(((...args: any[]) => {
                const update = args[1];
                if (update?.$set?.status === AdminMfaChallengeStatus.VERIFIED) return Promise.resolve(null) as any;
                return original(...args) as any;
            }) as any);
            const originalUserUpdate = User.updateOne.bind(User);
            const concurrentLockedUntil = new Date(Date.now() + 15 * 60_000);
            let lockoutInjected = false;
            const userUpdateSpy = jest.spyOn(User, 'updateOne').mockImplementation(((...args: any[]) => {
                if (!lockoutInjected && args[0]?.['admin_mfa.totp.last_verified_challenge_id']) {
                    lockoutInjected = true;
                    return (async () => {
                        await User.collection.updateOne(
                            { _id: mfaAdminUser._id },
                            { $set: { failed_login_attempts: 5, locked_until: concurrentLockedUntil } },
                        );
                        return originalUserUpdate(...args) as any;
                    })() as any;
                }
                return originalUserUpdate(...args) as any;
            }) as any);
            try {
                const response = await api.post('/api/auth/login/totp/verify', {
                    challenge_id: challengeId,
                    code: generateTotpCode(mfaAdminSecret),
                });
                expect(response.status).toBe(410);
                const restored: any = await User.findById(mfaAdminUser._id).lean();
                expect(restored.admin_mfa.totp.last_verified_time_step).toBe(priorStep);
                expect(restored.admin_mfa.totp.last_verified_at).toEqual(priorLogin);
                expect(restored.last_login_at).toEqual(priorLogin);
                expect(lockoutInjected).toBe(true);
                expect(restored.failed_login_attempts).toBe(5);
                expect(restored.locked_until).toEqual(concurrentLockedUntil);
                await User.updateOne(
                    { _id: mfaAdminUser._id },
                    { $set: { failed_login_attempts: 2 }, $unset: { locked_until: 1 } },
                );
            } finally {
                spy.mockRestore();
                userUpdateSpy.mockRestore();
            }
        });

        test('does not accept a TOTP challenge after the password generation changes', async () => {
            await User.updateOne({ _id: mfaAdminUser._id }, {
                $unset: { 'admin_mfa.totp.last_verified_time_step': 1 },
            });
            const before: any = await User.findById(mfaAdminUser._id).select('+password_history').lean();
            const login = await api.post('/api/auth/login', {
                login_id: 'mfa-admin', password: 'testpassword123',
            });
            const mutable = await User.findById(mfaAdminUser._id).select('+password_history');
            await setUserPasswordWithPolicy(mutable, 'GenerationReset@456');
            const response = await api.post('/api/auth/login/totp/verify', {
                challenge_id: login.data.data.challenge.challenge_id,
                code: generateTotpCode(mfaAdminSecret),
            });
            expect(response.status).toBe(410);
            expect(response.data.data?.token).toBeUndefined();
            await User.collection.updateOne({ _id: mfaAdminUser._id }, {
                $set: {
                    password: before.password,
                    salt: before.salt,
                    password_history: before.password_history,
                    password_changed_at: before.password_changed_at,
                    must_change_password: before.must_change_password,
                    security_version: before.security_version,
                },
            });
            await AdminMfaChallenge.deleteMany({ user_id: mfaAdminUser._id });
        });

        test('should reject an old-factor verification paused across supervised MFA reset', async () => {
            await User.updateOne({ _id: mfaAdminUser._id }, {
                $unset: { 'admin_mfa.totp.last_verified_time_step': 1 },
            });
            const login = await api.post('/api/auth/login', {
                login_id: 'mfa-admin', password: 'testpassword123',
            });
            const challengeId = login.data.data.challenge.challenge_id;
            const sessionsBefore = await AuthSession.countDocuments({ user_id: mfaAdminUser._id });

            let resume!: () => void;
            let reached!: () => void;
            const reachedCas = new Promise<void>(resolve => { reached = resolve; });
            const resumeCas = new Promise<void>(resolve => { resume = resolve; });
            const original = User.findOneAndUpdate.bind(User);
            let paused = false;
            const spy = jest.spyOn(User, 'findOneAndUpdate').mockImplementation(((...args: any[]) => {
                if (!paused && args[1]?.$set?.last_login_at) {
                    paused = true;
                    return (async () => {
                        reached();
                        await resumeCas;
                        return original(...args) as any;
                    })() as any;
                }
                return original(...args) as any;
            }) as any);
            try {
                const verification = api.post('/api/auth/login/totp/verify', {
                    challenge_id: challengeId,
                    code: generateTotpCode(mfaAdminSecret),
                });
                await reachedCas;
                const adminLogin = await api.post('/api/auth/login', {
                    login_id: 'admin-user', password: 'testpassword123',
                });
                expect(adminLogin.status).toBe(200);
                const reset = await api.post(`/api/admin/users/${mfaAdminUser._id}/mfa/reset`, {}, {
                    headers: { Authorization: `Bearer ${adminLogin.data.data.token}` },
                });
                expect(reset.status).toBe(200);
                resume();
                const response = await verification;
                expect(response.status).toBe(410);
                expect(await AuthSession.countDocuments({ user_id: mfaAdminUser._id })).toBe(sessionsBefore);
                const retiredChallenge = await AdminMfaChallenge.findById(challengeId).lean();
                expect(retiredChallenge?.status).toBe(AdminMfaChallengeStatus.CANCELLED);
            } finally {
                resume?.();
                spy.mockRestore();
            }
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
                code: '123456',
            });

            expect(response.status).toBe(200);
            expect(response.data.data.token).toBeDefined();
            expect(response.data.data.refresh_token).toBeDefined();
            expect(response.data.data.user.login_id).toBe('unverified-patient');
            expect(mockCheckVerification).toHaveBeenCalledWith('+919000004444', '123456');

            const patientProfile = await PatientProfile.findById(unverifiedPatientProfile._id);
            expect(patientProfile?.demographics?.phone_verification?.status).toBe('VERIFIED');
            expect(patientProfile?.demographics?.phone_verification?.verified_at).toBeDefined();
        });

        test('should not mark phone verified after Twilio rejects login OTP', async () => {
            await DoctorProfile.findByIdAndUpdate(unverifiedDoctorProfile._id, {
                $set: {
                    'phone_verification.status': 'PENDING',
                    'phone_verification.verified_at': undefined,
                },
            });
            mockCheckVerification.mockResolvedValueOnce({
                status: 'pending',
                valid: false,
            });

            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'unverified-doctor',
                password: 'testpassword123'
            });
            const response = await api.post('/api/auth/login/otp/verify', {
                challenge_id: loginResponse.data.data.challenge.challenge_id,
                code: '123456',
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
                code: '123456',
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
                code: '123456',
            });
            expect(lockedResponse.status).toBe(423);
            expect(mockCheckVerification).not.toHaveBeenCalledWith('+919000004444', '123456');
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
                code: '123456',
            });

            expect(response.status).toBe(403);
            expect(mockCheckVerification).not.toHaveBeenCalled();

            await DoctorProfile.findByIdAndUpdate(unverifiedDoctorProfile._id, {
                $set: { contact_number: '+919000003333' },
            });
        });

        test('should not issue a token if the phone changes after Twilio approves but before profile verification update', async () => {
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

            mockCheckVerification.mockImplementationOnce(async () => {
                await PatientProfile.findByIdAndUpdate(unverifiedPatientProfile._id, {
                    $set: { 'demographics.phone': '+919000008888' },
                });
                return {
                    status: 'approved',
                    valid: true,
                };
            });

            const response = await api.post('/api/auth/login/otp/verify', {
                challenge_id: challengeId,
                code: '123456',
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
            mockStartVerification.mockClear();

            const response = await api.post('/api/auth/login/otp/resend', {
                challenge_id: challengeId,
            });

            expect(response.status).toBe(200);
            expect(response.data.data.auth_status).toBe('OTP_REQUIRED');
            expect(mockStartVerification).toHaveBeenCalledWith('+919000003333', 'sms');
        });

        test('should normalize a legacy patient phone number for first-login OTP', async () => {
            await PatientProfile.findByIdAndUpdate(unverifiedPatientProfile._id, {
                $set: {
                    'demographics.phone': '9000004444',
                    'demographics.phone_verification.status': 'PENDING',
                },
                $unset: { 'demographics.phone_verification.verified_at': 1 },
            });

            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'unverified-patient',
                password: 'testpassword123',
            });

            expect(loginResponse.status).toBe(202);
            expect(loginResponse.data.data.auth_status).toBe('OTP_REQUIRED');
            expect(mockStartVerification).toHaveBeenCalledWith('+919000004444', 'sms');

            const verificationResponse = await api.post('/api/auth/login/otp/verify', {
                challenge_id: loginResponse.data.data.challenge.challenge_id,
                code: '123456',
            });
            expect(verificationResponse.status).toBe(200);

            const patientProfile = await PatientProfile.findById(unverifiedPatientProfile._id);
            expect(patientProfile?.demographics?.phone).toBe('9000004444');
            expect(patientProfile?.demographics?.phone_verification?.status).toBe('VERIFIED');

            await PatientProfile.findByIdAndUpdate(unverifiedPatientProfile._id, {
                $set: {
                    'demographics.phone': '+919000004444',
                    'demographics.phone_verification.status': 'PENDING',
                },
                $unset: { 'demographics.phone_verification.verified_at': 1 },
            });
        });

        test('should return an actionable conflict for an unusable legacy patient phone number', async () => {
            await PatientProfile.findByIdAndUpdate(unverifiedPatientProfile._id, {
                $set: {
                    'demographics.phone': 'not-a-phone',
                    'demographics.phone_verification.status': 'PENDING',
                },
            });

            const response = await api.post('/api/auth/login', {
                login_id: 'unverified-patient',
                password: 'testpassword123',
            });

            expect(response.status).toBe(409);
            expect(response.data.message).toBe('Registered phone number must be updated before OTP verification');
            expect(mockStartVerification).not.toHaveBeenCalled();

            await PatientProfile.findByIdAndUpdate(unverifiedPatientProfile._id, {
                $set: { 'demographics.phone': '+919000004444' },
            });
        });

        test('should fail with invalid login_id', async () => {
            const response = await api.post('/api/auth/login', {
                login_id: 'nonexistentuser',
                password: 'testpassword123'
            });

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
            expect(response.data.message).toBe('Invalid credentials');
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

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
            expect(response.data.message).toBe('Invalid credentials');

            const wrongPasswordResponse = await api.post('/api/auth/login', {
                login_id: 'testuser',
                password: 'definitely-wrong',
            });
            expect(wrongPasswordResponse.status).toBe(response.status);
            expect(wrongPasswordResponse.data.message).toBe(response.data.message);

            await User.findByIdAndUpdate(testUser._id, {
                $set: { is_active: true, failed_login_attempts: 0 },
                $unset: { locked_until: 1 },
            });
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

            const revokedFamilyResponse = await api.get('/api/auth/me', {
                headers: { Authorization: `Bearer ${refreshResponse.data.data.token}` }
            });
            expect(revokedFamilyResponse.status).toBe(401);
        });

        test('does not accept a phone-login challenge after the password generation changes', async () => {
            const profile = await DoctorProfile.create({
                name: 'Challenge Reset Doctor', department: 'General', contact_number: '+919000008881',
                hospital_id: authHospital._id,
                phone_verification: { status: 'PENDING' },
            });
            const account = await User.create({
                login_id: 'challenge-reset-doctor', password: 'Challenge@123', user_type: 'DOCTOR',
                profile_id: profile._id, is_active: true,
            });
            const login = await api.post('/api/auth/login', {
                login_id: account.login_id, password: 'Challenge@123',
            });
            const fresh = await User.findById(account._id).select('+password_history');
            await setUserPasswordWithPolicy(fresh, 'Challenge@456');
            const verification = await api.post('/api/auth/login/otp/verify', {
                challenge_id: login.data.data.challenge.challenge_id,
                code: '123456',
            });
            expect(verification.status).toBe(404);
            expect(verification.data.data?.token).toBeUndefined();
            expect(await AuthSession.countDocuments({ user_id: account._id })).toBe(0);
            await Promise.all([User.deleteOne({ _id: account._id }), DoctorProfile.deleteOne({ _id: profile._id })]);
        });

        test('does not reveal password correctness for locked or suspended-hospital accounts', async () => {
            await User.findByIdAndUpdate(testUser._id, {
                $set: { locked_until: new Date(Date.now() + 60_000) },
            });
            const lockedCorrect = await api.post('/api/auth/login', {
                login_id: 'testuser',
                password: 'testpassword123',
            });
            const lockedWrong = await api.post('/api/auth/login', {
                login_id: 'testuser',
                password: 'definitely-wrong',
            });
            expect(lockedCorrect.status).toBe(401);
            expect(lockedWrong.status).toBe(lockedCorrect.status);
            expect(lockedWrong.data.message).toBe(lockedCorrect.data.message);
            await User.findByIdAndUpdate(testUser._id, {
                $set: { failed_login_attempts: 0 },
                $unset: { locked_until: 1 },
            });

            const hospital = await Hospital.create({
                code: `AUTH_SUSPENDED_${Date.now()}`,
                name: 'Suspended Login Hospital',
                location: 'Test',
                admin_email: `suspended-${Date.now()}@example.com`,
                status: 'suspended',
            });
            const doctorProfile = await DoctorProfile.create({
                name: 'Suspended Hospital Doctor',
                department: 'General',
                hospital_id: hospital._id,
            });
            const doctor = await User.create({
                login_id: `suspended-doctor-${Date.now()}`,
                password: 'testpassword123',
                user_type: 'DOCTOR',
                profile_id: doctorProfile._id,
                is_active: true,
            });
            const suspendedCorrect = await api.post('/api/auth/login', {
                login_id: doctor.login_id,
                password: 'testpassword123',
            });
            const suspendedWrong = await api.post('/api/auth/login', {
                login_id: doctor.login_id,
                password: 'definitely-wrong',
            });
            expect(suspendedCorrect.status).toBe(401);
            expect(suspendedWrong.status).toBe(suspendedCorrect.status);
            expect(suspendedWrong.data.message).toBe(suspendedCorrect.data.message);
        });

        test('accepts one concurrent refresh then revokes the family when the duplicate token is reused', async () => {
            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'testuser',
                password: 'testpassword123'
            });
            const refreshToken = loginResponse.data.data.refresh_token;

            const responses = await Promise.all([
                api.post('/api/auth/refresh', { refresh_token: refreshToken }),
                api.post('/api/auth/refresh', { refresh_token: refreshToken }),
            ]);

            const successful = responses.filter(response => response.status === 200);
            const rejected = responses.filter(response => response.status === 401);
            expect(successful).toHaveLength(1);
            expect(rejected).toHaveLength(1);

            const accessResponse = await api.get('/api/auth/me', {
                headers: { Authorization: `Bearer ${successful[0].data.data.token}` }
            });
            expect(accessResponse.status).toBe(401);

            const session = await AuthSession.findById(successful[0].data.data.session.session_id);
            expect(session?.revoked_reason).toBe('REFRESH_TOKEN_REUSE');
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

        test('does not let audit persistence failure prevent committed logout', async () => {
            const login = await api.post('/api/auth/login', { login_id: 'testuser', password: 'testpassword123' });
            const auditSpy = jest.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('audit unavailable') as never);
            try {
                const response = await api.post('/api/auth/logout', {}, {
                    headers: { Authorization: `Bearer ${login.data.data.token}` },
                });
                expect(response.status).toBe(200);
                expect((await AuthSession.findById(login.data.data.session.session_id).lean())?.revoked_at).toBeDefined();
            } finally { auditSpy.mockRestore(); }
        });

        test('records logout failure only when session revocation fails', async () => {
            const login = await api.post('/api/auth/login', { login_id: 'testuser', password: 'testpassword123' });
            const attemptedAt = new Date();
            const revokeSpy = jest.spyOn(AuthSession, 'findOneAndUpdate').mockRejectedValueOnce(new Error('session store unavailable'));
            try {
                const response = await api.post('/api/auth/logout', {}, {
                    headers: { Authorization: `Bearer ${login.data.data.token}` },
                });
                expect(response.status).toBe(500);
                expect((await AuthSession.findById(login.data.data.session.session_id).lean())?.revoked_at).toBeUndefined();
                expect(await AuditLog.exists({
                    user_id: testUser._id, action: 'LOGOUT', success: false,
                    error_message: 'session_revocation_failed',
                })).toBeTruthy();
                expect(await AuditLog.exists({
                    user_id: testUser._id, action: 'LOGOUT', success: true,
                    createdAt: { $gte: attemptedAt },
                })).toBeNull();
            } finally { revokeSpy.mockRestore(); }
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

        test('should not revive an expired access session when timeout configuration changes', async () => {
            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'testuser',
                password: 'testpassword123'
            });
            const sessionId = loginResponse.data.data.session.session_id;
            await AuthSession.updateOne(
                { _id: sessionId },
                { $set: { access_expires_at: new Date(Date.now() - 1_000) } },
            );

            await updateSystemConfig({ session_timeout_minutes: 45 });
            const session = await AuthSession.findById(sessionId).lean();
            expect(session?.access_expires_at?.getTime()).toBeLessThan(Date.now());

            const response = await api.get('/api/auth/me', {
                headers: { Authorization: `Bearer ${loginResponse.data.data.token}` },
            });
            expect(response.status).toBe(401);
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
                hospital_id: authHospital._id,
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

            const clinicalResponse = await api.get('/api/doctors/profile', {
                headers: { Authorization: `Bearer ${loginResponse.data.data.token}` },
            });
            expect(clinicalResponse.status).toBe(403);
            expect(clinicalResponse.data.message).toMatch(/password.*expired/i);

            await AuthSession.updateOne(
                { _id: loginResponse.data.data.session.session_id },
                { $set: { revoked_at: new Date(), revoked_reason: 'USER_REVOKED' } },
            );
            const revokedRestrictedResponse = await api.get('/api/doctors/profile', {
                headers: { Authorization: `Bearer ${loginResponse.data.data.token}` },
            });
            expect(revokedRestrictedResponse.status).toBe(401);

            const recoveryLogin = await api.post('/api/auth/login', {
                login_id: 'expired-password-user', password: 'Expired@123',
            });

            const recoveryResponse = await api.post('/api/auth/change-password/', {
                current_password: 'Expired@123',
                new_password: 'Expired@456',
            }, {
                headers: { Authorization: `Bearer ${recoveryLogin.data.data.token}` },
            });
            expect(recoveryResponse.status).toBe(200);
        });

        test('keeps old sessions invalid when physical revocation cleanup fails after password change', async () => {
            const profile = await DoctorProfile.create({
                name: 'Versioned Password Doctor', department: 'General', contact_number: '+919000005556',
                hospital_id: authHospital._id,
                phone_verification: { status: 'VERIFIED', verified_at: new Date() },
            });
            await User.create({
                login_id: 'versioned-password-user', password: 'Versioned@123', user_type: 'DOCTOR',
                profile_id: profile._id, is_active: true,
            });
            const login = await api.post('/api/auth/login', {
                login_id: 'versioned-password-user', password: 'Versioned@123',
            });
            const spy = jest.spyOn(AuthSession, 'updateMany').mockRejectedValueOnce(new Error('revocation unavailable'));
            const changed = await api.post('/api/auth/change-password', {
                current_password: 'Versioned@123', new_password: 'Versioned@456',
            }, { headers: { Authorization: `Bearer ${login.data.data.token}` } });
            spy.mockRestore();
            expect(changed.status).toBe(200);
            expect(changed.data.data.revocation_cleanup_completed).toBe(false);
            const oldSession = await api.get('/api/auth/me', {
                headers: { Authorization: `Bearer ${login.data.data.token}` },
            });
            expect(oldSession.status).toBe(401);
        });

        test('accepts a rolling-deployment session missing generation only for a generation-zero user', async () => {
            const login = await api.post('/api/auth/login', {
                login_id: 'testuser', password: 'testpassword123',
            });
            await AuthSession.collection.updateOne(
                { _id: new mongoose.Types.ObjectId(login.data.data.session.session_id) },
                { $unset: { security_version: 1 } },
            );
            const access = await api.get('/api/auth/me', {
                headers: { Authorization: `Bearer ${login.data.data.token}` },
            });
            expect(access.status).toBe(200);
            const refreshed = await api.post('/api/auth/refresh', {
                refresh_token: login.data.data.refresh_token,
            });
            expect(refreshed.status).toBe(200);
        });

        test('allows only one stale concurrent password mutation to advance the security generation', async () => {
            const profile = await DoctorProfile.create({
                name: 'Concurrent Password Doctor', department: 'General', contact_number: '+919000005557',
                hospital_id: authHospital._id,
                phone_verification: { status: 'VERIFIED', verified_at: new Date() },
            });
            const created = await User.create({
                login_id: 'concurrent-password-user', password: 'Concurrent@123', user_type: 'DOCTOR',
                profile_id: profile._id, is_active: true,
            });
            const [firstCopy, secondCopy] = await Promise.all([
                User.findById(created._id).select('+password_history'),
                User.findById(created._id).select('+password_history'),
            ]);
            const results = await Promise.allSettled([
                setUserPasswordWithPolicy(firstCopy, 'Concurrent@456'),
                setUserPasswordWithPolicy(secondCopy, 'Concurrent@789'),
            ]);
            expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
            expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
            expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.statusCode).toBe(409);
            const stored = await User.findById(created._id).lean();
            expect(stored?.security_version).toBe(Number(created.security_version) + 1);
        });

        test('should reject password reuse from recent password history', async () => {
            const profile = await DoctorProfile.create({
                name: 'History Doctor',
                department: 'General',
                contact_number: '+919000006666',
                hospital_id: authHospital._id,
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
                hospital_id: authHospital._id,
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
            const passwordAudit: any = await AuditLog.findOne({
                user_id: firstLogin.data.data.user._id,
                action: 'PASSWORD_CHANGE', success: true,
            }).sort({ createdAt: -1 }).lean();
            expect(passwordAudit).toBeDefined();
            expect(passwordAudit.metadata.revocation_cleanup_completed).toBe(true);
            expect(JSON.stringify(passwordAudit)).not.toContain('Session@123');
            expect(JSON.stringify(passwordAudit)).not.toContain('Session@456');

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
