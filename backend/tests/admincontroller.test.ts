import axios, { AxiosInstance } from 'axios';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import mongoose from 'mongoose';
import app from '@alias/app';
import { AdminProfile, AuthSession, DoctorProfile, PatientProfile, User } from '@alias/models';
import { Server } from 'http';

describe('Admin Routes', () => {
    let mongoContainer: StartedTestContainer;
    let server: Server;
    let api: AxiosInstance;
    let adminToken: string;
    let doctorToken: string;

    let adminUser: any;
    let primaryDoctorUser: any;
    let secondaryDoctorUser: any;
    let baselinePatientUser: any;
    let createdDoctorId: string;
    let createdPatientId: string;
    let createdPatientLoginId: string;

    beforeAll(async () => {
        mongoContainer = await new GenericContainer('mongo:7.0')
            .withExposedPorts(27017)
            .start();

        const mongoUri = `mongodb://${mongoContainer.getHost()}:${mongoContainer.getMappedPort(27017)}/test`;
        await mongoose.connect(mongoUri);

        server = app.listen(0);
        const address = server.address();
        const port = typeof address === 'object' && address !== null ? address.port : 3000;
        api = axios.create({
            baseURL: `http://localhost:${port}`,
            validateStatus: () => true
        });

        const adminProfile = await AdminProfile.create({});
        adminUser = await User.create({
            login_id: 'admin001',
            password: 'Admin@123',
            user_type: 'ADMIN',
            profile_id: adminProfile._id,
            is_active: true
        });

        const doctorProfile = await DoctorProfile.create({
            name: 'Dr. Primary',
            department: 'Cardiology',
            contact_number: '9000000001'
        });

        primaryDoctorUser = await User.create({
            login_id: 'doctor_admin_01',
            password: 'Doctor@123',
            user_type: 'DOCTOR',
            profile_id: doctorProfile._id,
            is_active: true
        });

        const secondDoctorProfile = await DoctorProfile.create({
            name: 'Dr. Secondary',
            department: 'Neurology',
            contact_number: '9000000002'
        });

        secondaryDoctorUser = await User.create({
            login_id: 'doctor_admin_02',
            password: 'Doctor@123',
            user_type: 'DOCTOR',
            profile_id: secondDoctorProfile._id,
            is_active: true
        });

        const patientProfile = await PatientProfile.create({
            assigned_doctor_id: primaryDoctorUser._id,
            demographics: {
                name: 'Baseline Patient',
                age: 52,
                gender: 'Male',
                phone: '9111111111'
            },
            medical_config: {
                therapy_drug: 'Warfarin',
                therapy_start_date: new Date('2025-01-10'),
                target_inr: { min: 2.0, max: 3.0 }
            }
        });

        baselinePatientUser = await User.create({
            login_id: 'PAT_ADMIN_BASE',
            password: 'Patient@123',
            user_type: 'PATIENT',
            profile_id: patientProfile._id,
            is_active: true
        });

        const adminLogin = await api.post('/api/auth/login', {
            login_id: 'admin001',
            password: 'Admin@123'
        });
        adminToken = adminLogin.data.data.token;

        const doctorLogin = await api.post('/api/auth/login', {
            login_id: 'doctor_admin_01',
            password: 'Doctor@123'
        });
        doctorToken = doctorLogin.data.data.token;
    }, 120000);

    afterAll(async () => {
        await mongoose.connection.dropDatabase();
        await mongoose.connection.close();
        await mongoContainer.stop();
        server.close();
    });

    describe('Authorization', () => {
        test('should fail without authentication token', async () => {
            const response = await api.get('/api/admin/doctors');

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });

        test('should fail for non-admin user', async () => {
            const response = await api.get('/api/admin/doctors', {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(403);
            expect(response.data.success).toBe(false);
        });
    });

    describe('Doctor Management', () => {
        test('should list doctors with pagination', async () => {
            const response = await api.get('/api/admin/doctors?page=1&limit=10', {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(Array.isArray(response.data.data.doctors)).toBe(true);
            expect(response.data.data.pagination).toBeDefined();
            expect(response.data.data.doctors.length).toBeGreaterThanOrEqual(2);
        });

        test('should create a doctor successfully', async () => {
            const response = await api.post('/api/admin/doctors', {
                login_id: 'doctor_admin_03',
                password: 'Doctor@456',
                name: 'Dr. Newly Added',
                department: 'Oncology',
                contact_number: '9000000003'
            }, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(201);
            expect(response.data.success).toBe(true);
            expect(response.data.data.user.login_id).toBe('doctor_admin_03');
            expect(response.data.data.user.profile_id.phone_verification.status).toBe('PENDING');
            createdDoctorId = response.data.data.user._id;
        });

        test('should fail creating doctor with duplicate login_id', async () => {
            const response = await api.post('/api/admin/doctors', {
                login_id: 'doctor_admin_03',
                password: 'Doctor@456',
                name: 'Dr. Duplicate',
                contact_number: '9000000004'
            }, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(409);
            expect(response.data.success).toBe(false);
        });

        test('should fail creating doctor without contact_number', async () => {
            const response = await api.post('/api/admin/doctors', {
                login_id: 'doctor_admin_no_phone',
                password: 'Doctor@456',
                name: 'Dr. No Phone'
            }, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should fail creating doctor with invalid contact_number', async () => {
            const response = await api.post('/api/admin/doctors', {
                login_id: 'doctor_admin_bad_phone',
                password: 'Doctor@456',
                name: 'Dr. Bad Phone',
                contact_number: '90000abc03'
            }, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should update doctor details', async () => {
            const response = await api.put(`/api/admin/doctors/${createdDoctorId}`, {
                department: 'Nephrology',
                is_active: false
            }, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.profile_id.department).toBe('Nephrology');
            expect(response.data.data.is_active).toBe(false);
        });

        test('should fail when deactivating non-existent doctor', async () => {
            const response = await api.delete(`/api/admin/doctors/${new mongoose.Types.ObjectId().toString()}`, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(404);
            expect(response.data.success).toBe(false);
        });
    });

    describe('Patient Management', () => {
        test('should create a patient successfully', async () => {
            createdPatientLoginId = 'PAT_ADMIN_NEW';

            const response = await api.post('/api/admin/patients', {
                login_id: createdPatientLoginId,
                password: 'Patient@456',
                assigned_doctor_id: primaryDoctorUser.login_id,
                demographics: {
                    name: 'Admin Onboarded Patient',
                    age: 43,
                    gender: 'Female',
                    phone: '9222222222',
                    next_of_kin: {
                        name: 'Relative',
                        relation: 'Sister',
                        phone: '9333333333'
                    }
                },
                medical_config: {
                    therapy_drug: 'Warfarin',
                    therapy_start_date: '2025-06-20',
                    target_inr: { min: 2.0, max: 3.0 }
                }
            }, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(201);
            expect(response.data.success).toBe(true);
            expect(response.data.data.user.user_type).toBe('PATIENT');
            expect(response.data.data.user.login_id).toBe(createdPatientLoginId);
            expect(response.data.data.user.profile_id.demographics.phone_verification.status).toBe('PENDING');
            createdPatientId = response.data.data.user._id;
        });

        test('should fail creating patient with invalid doctor identifier', async () => {
            const response = await api.post('/api/admin/patients', {
                login_id: 'PAT_ADMIN_INVALID',
                password: 'Patient@456',
                assigned_doctor_id: 'no_such_doctor',
                demographics: {
                    name: 'Invalid Assignment',
                    phone: '9444444444',
                }
            }, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should fail creating patient without demographics phone', async () => {
            const response = await api.post('/api/admin/patients', {
                login_id: 'PAT_ADMIN_NO_PHONE',
                password: 'Patient@456',
                assigned_doctor_id: primaryDoctorUser.login_id,
                demographics: {
                    name: 'Missing Phone Patient'
                }
            }, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should preserve patient phone and verification when updating demographics without phone', async () => {
            const createdPatient = await User.findById(createdPatientId);
            await PatientProfile.findByIdAndUpdate(createdPatient?.profile_id, {
                'demographics.phone_verification': {
                    status: 'VERIFIED',
                    verified_at: new Date('2026-01-01T00:00:00.000Z')
                }
            });

            const response = await api.put(`/api/admin/patients/${createdPatientId}`, {
                demographics: {
                    name: 'Renamed Admin Patient'
                }
            }, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.profile_id.demographics.name).toBe('Renamed Admin Patient');
            expect(response.data.data.profile_id.demographics.phone).toBe('+919222222222');
            expect(response.data.data.profile_id.demographics.phone_verification.status).toBe('VERIFIED');
            expect(response.data.data.profile_id.demographics.phone_verification.verified_at).toBeDefined();
        });

        test('should reassign patient to another doctor', async () => {
            const response = await api.put(`/api/admin/reassign/${createdPatientLoginId}`, {
                new_doctor_id: secondaryDoctorUser.login_id
            }, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.new_doctor_id).toBe(secondaryDoctorUser._id.toString());

            const reassignedUser = await User.findOne({ login_id: createdPatientLoginId });
            const reassignedProfile = await PatientProfile.findById(reassignedUser?.profile_id);
            expect(reassignedProfile?.assigned_doctor_id?.toString()).toBe(secondaryDoctorUser._id.toString());
        });

        test('should fail reassigning a missing patient', async () => {
            const response = await api.put('/api/admin/reassign/PATIENT_DOES_NOT_EXIST', {
                new_doctor_id: secondaryDoctorUser.login_id
            }, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(404);
            expect(response.data.success).toBe(false);
        });
    });

    describe('Admin Utilities', () => {
        test('should reset a user password', async () => {
            const response = await api.post('/api/admin/users/reset-password', {
                target_user_id: baselinePatientUser._id.toString()
            }, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.user_id).toBe(baselinePatientUser._id.toString());
            expect(response.data.data.must_change_password).toBe(true);
            expect(response.data.data.temporary_password).toBeDefined();
            expect(response.data.data.invalidated_sessions).toBeGreaterThanOrEqual(0);
        });

        test('should reject admin reset to a recently used password', async () => {
            const profile = await AdminProfile.create({ name: 'Reset History Admin' });
            const target = await User.create({
                login_id: 'reset-history-admin',
                password: 'ResetHist@123',
                user_type: 'ADMIN',
                profile_id: profile._id,
                is_active: true
            });

            const response = await api.post('/api/admin/users/reset-password', {
                target_user_id: target._id.toString(),
                new_password: 'ResetHist@123'
            }, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.message).toBe('New password cannot match a recently used password');
        });

        test('should invalidate active sessions after admin password reset', async () => {
            const profile = await AdminProfile.create({ name: 'Reset Session Admin' });
            const target = await User.create({
                login_id: 'reset-session-admin',
                password: 'ResetSess@123',
                user_type: 'ADMIN',
                profile_id: profile._id,
                is_active: true
            });

            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'reset-session-admin',
                password: 'ResetSess@123'
            });
            expect(loginResponse.status).toBe(200);
            const oldToken = loginResponse.data.data.token;
            const sessionId = loginResponse.data.data.session.session_id;

            const resetResponse = await api.post('/api/admin/users/reset-password', {
                target_user_id: target._id.toString(),
                new_password: 'ResetSess@456'
            }, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(resetResponse.status).toBe(200);
            expect(resetResponse.data.data.must_change_password).toBe(true);
            expect(resetResponse.data.data.invalidated_sessions).toBeGreaterThanOrEqual(1);

            const meResponse = await api.get('/api/auth/me', {
                headers: { Authorization: `Bearer ${oldToken}` }
            });
            expect(meResponse.status).toBe(401);

            const session = await AuthSession.findById(sessionId).lean();
            expect(session?.revoked_at).toBeDefined();
            expect(session?.revoked_reason).toBe('PASSWORD_RESET');
        });

        test('should fail resetting password for unknown user', async () => {
            const response = await api.post('/api/admin/users/reset-password', {
                target_user_id: new mongoose.Types.ObjectId().toString(),
                new_password: 'Strong@999'
            }, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(404);
            expect(response.data.success).toBe(false);
        });

        test('should return system health', async () => {
            const response = await api.get('/api/admin/system/health', {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.status).toBe('ok');
            expect(response.data.data.database).toBeDefined();
            expect(response.data.data.memory).toBeDefined();
        });

        test('should support patient search listing', async () => {
            const response = await api.get('/api/admin/patients?search=PAT_ADMIN&page=1&limit=20', {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(Array.isArray(response.data.data.patients)).toBe(true);
            expect(response.data.data.patients.length).toBeGreaterThanOrEqual(1);
        });
    });
});
