import axios, { AxiosInstance } from 'axios';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import mongoose from 'mongoose';
import app from '@alias/app';
import { AdminProfile, AuditLog, DoctorProfile, PatientProfile, User, Hospital } from '@alias/models';
import { AdminRole } from '@alias/models/adminprofile.model';
import { AuditAction } from '@alias/models/auditlog.model';
import { Server } from 'http';

describe('Statistics Routes', () => {
    let mongoContainer: StartedTestContainer;
    let server: Server;
    let api: AxiosInstance;
    let adminToken: string;
    let hospitalAdminToken: string;
    let doctorToken: string;

    let doctorOneUser: any;
    let doctorTwoUser: any;
    let primaryHospital: any;
    let secondaryHospital: any;

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

        primaryHospital = await Hospital.create({
            code: 'STATS_A',
            name: 'Stats Tenant A',
            location: 'Coimbatore',
            admin_email: 'stats-a@example.com'
        });
        secondaryHospital = await Hospital.create({
            code: 'STATS_B',
            name: 'Stats Tenant B',
            location: 'Chennai',
            admin_email: 'stats-b@example.com'
        });

        const adminProfile = await AdminProfile.create({});
        const adminUser = await User.create({
            login_id: 'stats_admin',
            password: 'Admin@123',
            user_type: 'ADMIN',
            profile_id: adminProfile._id,
            is_active: true
        });

        const hospitalAdminProfile = await AdminProfile.create({
            name: 'Stats Hospital Admin',
            admin_role: AdminRole.HOSPITAL_ADMIN,
            hospital_id: primaryHospital._id
        });
        await User.create({
            login_id: 'stats_hospital_admin',
            password: 'Admin@123',
            user_type: 'ADMIN',
            profile_id: hospitalAdminProfile._id,
            is_active: true
        });

        const doctorOneProfile = await DoctorProfile.create({
            name: 'Dr. Workload One',
            department: 'Cardiology',
            contact_number: '9555555551',
            hospital_id: primaryHospital._id,
            phone_verification: { status: 'VERIFIED', verified_at: new Date() },
        });

        doctorOneUser = await User.create({
            login_id: 'stats_doctor_1',
            password: 'Doctor@123',
            user_type: 'DOCTOR',
            profile_id: doctorOneProfile._id,
            is_active: true,
            createdAt: new Date('2026-02-20T10:00:00.000Z')
        });

        const doctorTwoProfile = await DoctorProfile.create({
            name: 'Dr. Workload Two',
            department: 'Neurology',
            contact_number: '9555555552',
            hospital_id: secondaryHospital._id,
            phone_verification: { status: 'VERIFIED', verified_at: new Date() },
        });

        doctorTwoUser = await User.create({
            login_id: 'stats_doctor_2',
            password: 'Doctor@123',
            user_type: 'DOCTOR',
            profile_id: doctorTwoProfile._id,
            is_active: true,
            createdAt: new Date('2026-02-21T10:00:00.000Z')
        });

        const patientProfiles = await PatientProfile.create([
            {
                assigned_doctor_id: doctorOneUser._id,
                hospital_id: primaryHospital._id,
                demographics: { name: 'Compliance InRange', age: 40, gender: 'Male', phone: '9666666601' },
                medical_config: { target_inr: { min: 2.0, max: 3.0 } },
                inr_history: [{ test_date: new Date('2026-02-18'), inr_value: 2.5, is_critical: false }],
                account_status: 'Active'
            },
            {
                assigned_doctor_id: doctorOneUser._id,
                hospital_id: primaryHospital._id,
                demographics: { name: 'Compliance Below', age: 41, gender: 'Female', phone: '9666666602' },
                medical_config: { target_inr: { min: 2.0, max: 3.0 } },
                inr_history: [{ test_date: new Date('2026-02-18'), inr_value: 1.4, is_critical: false }],
                account_status: 'Active'
            },
            {
                assigned_doctor_id: doctorTwoUser._id,
                hospital_id: secondaryHospital._id,
                demographics: { name: 'Compliance Above', age: 42, gender: 'Male', phone: '9666666603' },
                medical_config: { target_inr: { min: 2.0, max: 3.0 } },
                inr_history: [{ test_date: new Date('2026-02-18'), inr_value: 3.8, is_critical: false }],
                account_status: 'Active'
            },
            {
                assigned_doctor_id: doctorTwoUser._id,
                hospital_id: secondaryHospital._id,
                demographics: { name: 'Compliance NoData', age: 43, gender: 'Female', phone: '9666666604' },
                medical_config: { target_inr: { min: 2.0, max: 3.0 } },
                account_status: 'Active'
            },
            {
                assigned_doctor_id: doctorOneUser._id,
                hospital_id: primaryHospital._id,
                demographics: { name: 'Discharged Patient', age: 44, gender: 'Male', phone: '9666666605' },
                medical_config: { target_inr: { min: 2.0, max: 3.0 } },
                account_status: 'Discharged'
            }
        ]);

        await User.create([
            {
                login_id: 'stats_patient_1',
                password: 'Patient@111',
                user_type: 'PATIENT',
                profile_id: patientProfiles[0]._id,
                is_active: true,
                createdAt: new Date('2026-02-20T11:00:00.000Z')
            },
            {
                login_id: 'stats_patient_2',
                password: 'Patient@111',
                user_type: 'PATIENT',
                profile_id: patientProfiles[1]._id,
                is_active: true,
                createdAt: new Date('2026-02-21T11:00:00.000Z')
            },
            {
                login_id: 'stats_patient_3',
                password: 'Patient@111',
                user_type: 'PATIENT',
                profile_id: patientProfiles[2]._id,
                is_active: true,
                createdAt: new Date('2026-02-21T12:00:00.000Z')
            },
            {
                login_id: 'stats_patient_4',
                password: 'Patient@111',
                user_type: 'PATIENT',
                profile_id: patientProfiles[3]._id,
                is_active: true,
                createdAt: new Date('2026-02-22T10:00:00.000Z')
            },
            {
                login_id: 'stats_patient_5',
                password: 'Patient@111',
                user_type: 'PATIENT',
                profile_id: patientProfiles[4]._id,
                is_active: false,
                createdAt: new Date('2026-02-22T11:00:00.000Z')
            }
        ]);

        await AuditLog.create([
            {
                user_id: adminUser._id,
                user_type: 'ADMIN',
                action: AuditAction.USER_CREATE,
                description: 'Created users in seed',
                resource_type: 'User',
                success: true,
                createdAt: new Date('2026-02-20T10:00:00.000Z')
            },
            {
                user_id: adminUser._id,
                user_type: 'ADMIN',
                action: AuditAction.USER_UPDATE,
                description: 'Updated user in seed',
                resource_type: 'User',
                success: true,
                createdAt: new Date('2026-02-21T10:00:00.000Z')
            },
            {
                user_id: adminUser._id,
                user_type: 'ADMIN',
                action: AuditAction.PASSWORD_RESET,
                description: 'Reset password in seed',
                resource_type: 'User',
                success: true,
                createdAt: new Date('2026-02-21T11:00:00.000Z')
            }
        ]);

        const adminLogin = await api.post('/api/auth/login', {
            login_id: 'stats_admin',
            password: 'Admin@123'
        });
        adminToken = adminLogin.data.data.token;

        const hospitalAdminLogin = await api.post('/api/auth/login', {
            login_id: 'stats_hospital_admin',
            password: 'Admin@123'
        });
        hospitalAdminToken = hospitalAdminLogin.data.data.token;

        const doctorLogin = await api.post('/api/auth/login', {
            login_id: 'stats_doctor_1',
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
            const response = await api.get('/api/statistics/admin');

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });

        test('should fail for non-admin users', async () => {
            const response = await api.get('/api/statistics/admin', {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(403);
            expect(response.data.success).toBe(false);
        });
    });

    describe('GET /api/statistics/admin', () => {
        test('should return dashboard counts for doctors, patients, and audit logs', async () => {
            const response = await api.get('/api/statistics/admin', {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.doctors.total).toBe(2);
            expect(response.data.data.doctors.active).toBe(2);
            expect(response.data.data.patients.total).toBe(5);
            expect(response.data.data.patients.active).toBe(4);
            expect(response.data.data.audit_logs).toBeGreaterThanOrEqual(3);
        });

        test('should scope dashboard counts for hospital admins', async () => {
            const response = await api.get('/api/statistics/admin', {
                headers: { Authorization: `Bearer ${hospitalAdminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.doctors.total).toBe(1);
            expect(response.data.data.patients.total).toBe(3);
            expect(response.data.data.patients.active).toBe(2);
        });
    });

    describe('GET /api/statistics/trends', () => {
        test('should return registration trends for a valid period', async () => {
            const response = await api.get('/api/statistics/trends?period=7d', {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.period).toBe('7d');
            expect(Array.isArray(response.data.data.doctors)).toBe(true);
            expect(Array.isArray(response.data.data.patients)).toBe(true);
        });

        test('should fail validation for unsupported period', async () => {
            const response = await api.get('/api/statistics/trends?period=14d', {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });
    });

    describe('GET /api/statistics/compliance', () => {
        test('should return INR compliance distribution', async () => {
            const response = await api.get('/api/statistics/compliance', {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.total_patients).toBe(5);
            expect(response.data.data.in_range).toBeGreaterThanOrEqual(1);
            expect(response.data.data.below_range).toBeGreaterThanOrEqual(1);
            expect(response.data.data.above_range).toBeGreaterThanOrEqual(1);
            expect(response.data.data.no_data).toBeGreaterThanOrEqual(1);

            const total =
                response.data.data.in_range +
                response.data.data.below_range +
                response.data.data.above_range +
                response.data.data.no_data;

            expect(total).toBe(response.data.data.total_patients);
        });

        test('should scope INR compliance to hospital admin tenant', async () => {
            const response = await api.get('/api/statistics/compliance', {
                headers: { Authorization: `Bearer ${hospitalAdminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.total_patients).toBe(3);
            expect(response.data.data.in_range).toBe(1);
            expect(response.data.data.below_range).toBe(1);
            expect(response.data.data.above_range).toBe(0);
        });
    });

    describe('GET /api/statistics/workload', () => {
        test('should return active patient workload grouped by doctor', async () => {
            const response = await api.get('/api/statistics/workload', {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(Array.isArray(response.data.data)).toBe(true);

            const byDoctorName = new Map(
                response.data.data.map((entry: any) => [entry.doctor_name, entry.patient_count])
            );

            expect(byDoctorName.get('Dr. Workload One')).toBe(2);
            expect(byDoctorName.get('Dr. Workload Two')).toBe(2);
        });

        test('should scope workload statistics to hospital admin tenant', async () => {
            const response = await api.get('/api/statistics/workload', {
                headers: { Authorization: `Bearer ${hospitalAdminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            const doctorNames = response.data.data.map((entry: any) => entry.doctor_name);
            expect(doctorNames).toContain('Dr. Workload One');
            expect(doctorNames).not.toContain('Dr. Workload Two');
        });
    });

    describe('GET /api/statistics/period', () => {
        test('should return period statistics with valid date range', async () => {
            const start = new Date('2026-02-19T00:00:00.000Z').toISOString();
            const end = new Date('2026-02-22T23:59:59.999Z').toISOString();

            const response = await api.get(`/api/statistics/period?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}`, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.new_doctors).toBe(2);
            expect(response.data.data.new_patients).toBe(5);
            expect(Array.isArray(response.data.data.audit_summary)).toBe(true);

            const actions = response.data.data.audit_summary.map((item: any) => item.action);
            expect(actions).toContain('USER_CREATE');
        });

        test('should fail validation when end_date is before start_date', async () => {
            const response = await api.get('/api/statistics/period?start_date=2026-02-22&end_date=2026-02-20', {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });
    });
});
