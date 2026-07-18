import axios, { AxiosInstance } from 'axios';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import mongoose from 'mongoose';
import app from '@alias/app';
import { AdminMfaChallenge, AdminProfile, AuthSession, DoctorProfile, PatientProfile, User, Hospital, Notification, NotificationDelivery, AuditLog, Invoice, FileAsset } from '@alias/models';
import { AdminRole } from '@alias/models/adminprofile.model';
import { AuditAction } from '@alias/models/auditlog.model';
import { Server } from 'http';
import * as adminService from '@alias/services/admin.service';
import { acquireDoctorAssignmentGuard, acquireDoctorMoveGuard, acquireHospitalMembershipGuard, acquireHospitalTransitionGuard, stampDoctorProfileFence } from '@alias/services/doctor-assignment.service';
import { findActiveSessionForAccessToken } from '@alias/services/auth-session.service';
import { hasActiveHospitalAccess } from '@alias/services/hospital-access.service';
import { createAdminMfaLoginChallenge, generateTotpCode, verifyAdminMfaLoginChallenge } from '@alias/services/admin-totp.service';
import * as configService from '@alias/services/config.service';
import * as realtimeNotifications from '@alias/services/realtime-notification.service';
import { purgePatientFileAssets } from '@alias/services/patient-file-purge.service';
import { purgeFilePermanently } from '@alias/utils/fileUpload';

describe('Admin Routes', () => {
    let mongoContainer: StartedTestContainer;
    let server: Server;
    let api: AxiosInstance;
    let adminToken: string;
    let hospitalAdminToken: string;
    let auditorToken: string;
    let doctorToken: string;

    let adminUser: any;
    let hospitalAdminUser: any;
    let primaryDoctorUser: any;
    let secondaryDoctorUser: any;
    let crossTenantDoctorUser: any;
    let baselinePatientUser: any;
    let crossTenantPatientUser: any;
    let primaryHospital: any;
    let secondaryHospital: any;
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

        primaryHospital = await Hospital.create({
            code: 'ADMIN_A',
            name: 'Admin Tenant A',
            location: 'Coimbatore',
            admin_email: 'admin-a@example.com'
        });

        secondaryHospital = await Hospital.create({
            code: 'ADMIN_B',
            name: 'Admin Tenant B',
            location: 'Chennai',
            admin_email: 'admin-b@example.com'
        });

        const adminProfile = await AdminProfile.create({});
        adminUser = await User.create({
            login_id: 'admin001',
            password: 'Admin@123',
            user_type: 'ADMIN',
            profile_id: adminProfile._id,
            is_active: true
        });

        const hospitalAdminProfile = await AdminProfile.create({
            name: 'Tenant A Admin',
            admin_role: AdminRole.HOSPITAL_ADMIN,
            hospital_id: primaryHospital._id
        });
        hospitalAdminUser = await User.create({
            login_id: 'hospital_admin_a',
            password: 'Admin@123',
            user_type: 'ADMIN',
            profile_id: hospitalAdminProfile._id,
            is_active: true
        });

        const auditorProfile = await AdminProfile.create({
            name: 'Read-only Auditor',
            admin_role: AdminRole.AUDITOR,
            hospital_id: primaryHospital._id,
        });
        await User.create({
            login_id: 'auditor001',
            password: 'Auditor@123',
            user_type: 'ADMIN',
            profile_id: auditorProfile._id,
            is_active: true,
        });

        const doctorProfile = await DoctorProfile.create({
            name: 'Dr. Primary',
            department: 'Cardiology',
            contact_number: '9000000001',
            hospital_id: primaryHospital._id,
            phone_verification: {
                status: 'VERIFIED',
                verified_at: new Date()
            }
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
            contact_number: '9000000002',
            hospital_id: primaryHospital._id,
            phone_verification: {
                status: 'VERIFIED',
                verified_at: new Date()
            }
        });

        secondaryDoctorUser = await User.create({
            login_id: 'doctor_admin_02',
            password: 'Doctor@123',
            user_type: 'DOCTOR',
            profile_id: secondDoctorProfile._id,
            is_active: true
        });

        const crossTenantDoctorProfile = await DoctorProfile.create({
            name: 'Dr. Cross Tenant',
            department: 'Cardiology',
            contact_number: '9000000005',
            hospital_id: secondaryHospital._id,
            phone_verification: {
                status: 'VERIFIED',
                verified_at: new Date()
            }
        });

        crossTenantDoctorUser = await User.create({
            login_id: 'doctor_admin_cross',
            password: 'Doctor@123',
            user_type: 'DOCTOR',
            profile_id: crossTenantDoctorProfile._id,
            is_active: true
        });

        const patientProfile = await PatientProfile.create({
            assigned_doctor_id: primaryDoctorUser._id,
            hospital_id: primaryHospital._id,
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

        const crossTenantPatientProfile = await PatientProfile.create({
            assigned_doctor_id: primaryDoctorUser._id,
            hospital_id: secondaryHospital._id,
            demographics: {
                name: 'Cross Tenant Patient',
                age: 50,
                gender: 'Female',
                phone: '9111111112'
            }
        });

        crossTenantPatientUser = await User.create({
            login_id: 'PAT_ADMIN_CROSS',
            password: 'Patient@123',
            user_type: 'PATIENT',
            profile_id: crossTenantPatientProfile._id,
            is_active: true
        });

        const adminLogin = await api.post('/api/auth/login', {
            login_id: 'admin001',
            password: 'Admin@123'
        });
        adminToken = adminLogin.data.data.token;

        const hospitalAdminLogin = await api.post('/api/auth/login', {
            login_id: 'hospital_admin_a',
            password: 'Admin@123'
        });
        hospitalAdminToken = hospitalAdminLogin.data.data.token;

        const auditorLogin = await api.post('/api/auth/login', {
            login_id: 'auditor001',
            password: 'Auditor@123'
        });
        auditorToken = auditorLogin.data.data.token;

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
        await new Promise<void>((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
    }, 120000);

    describe('Authorization', () => {
        test('should fail closed when the authenticated admin profile is missing', async () => {
            const profile = await AdminProfile.collection.findOne({ _id: hospitalAdminUser.profile_id });
            expect(profile).not.toBeNull();
            await AdminProfile.collection.deleteOne({ _id: hospitalAdminUser.profile_id });

            try {
                const response = await api.get('/api/admin/hospitals', {
                    headers: { Authorization: `Bearer ${hospitalAdminToken}` }
                });

                expect(response.status).toBe(403);
                expect(response.data.success).toBe(false);
            } finally {
                await AdminProfile.collection.insertOne(profile!);
            }
        });
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

        test('should prevent auditors from updating system configuration', async () => {
            const response = await api.put('/api/admin/config', {
                session_timeout_minutes: 120,
            }, {
                headers: { Authorization: `Bearer ${auditorToken}` }
            });

            expect(response.status).toBe(403);
            expect(response.data.success).toBe(false);
            expect(String(response.data.message)).toMatch(/read-only|manage_system/i);
        });

        test('should prevent auditors from broadcasting notifications', async () => {
            const response = await api.post('/api/admin/notifications/broadcast', {
                title: 'Auditor broadcast attempt',
                message: 'This must not be delivered.',
                target: 'PATIENTS',
                priority: 'MEDIUM',
            }, {
                headers: { Authorization: `Bearer ${auditorToken}` }
            });

            expect(response.status).toBe(403);
            expect(response.data.success).toBe(false);
            expect(String(response.data.message)).toMatch(/read-only|manage_system/i);
            expect(await Notification.countDocuments({ title: 'Auditor broadcast attempt' })).toBe(0);
        });

        test('should persist role edits and enforce the edited permission', async () => {
            const rolesResponse = await api.get('/api/admin/roles', {
                headers: { Authorization: `Bearer ${adminToken}` },
            });
            expect(rolesResponse.status).toBe(200);
            expect(rolesResponse.data.data.roles.app_admin.permissions.manage_roles).toBe(true);
            expect(rolesResponse.data.data.roles.app_admin.permissions.manage_system).toBe(true);

            const lockoutAttempt = await api.put('/api/admin/roles/app_admin', {
                permissions: { manage_roles: false, manage_users: false },
            }, {
                headers: { Authorization: `Bearer ${adminToken}` },
            });
            expect(lockoutAttempt.status).toBe(200);
            expect(lockoutAttempt.data.data.role.permissions.manage_roles).toBe(true);
            expect(lockoutAttempt.data.data.role.permissions.manage_users).toBe(false);

            const deniedUsersResponse = await api.post('/api/admin/users', {
                name: 'Denied by role policy',
                email: 'role-policy-denied@example.com',
                role: 'hospital_admin',
                hospital_id: primaryHospital._id.toString(),
            }, {
                headers: { Authorization: `Bearer ${adminToken}` },
            });
            expect(deniedUsersResponse.status).toBe(403);
            expect(String(deniedUsersResponse.data.message)).toMatch(/manage_users/i);

            const deniedUsersList = await api.get('/api/admin/users', {
                headers: { Authorization: `Bearer ${adminToken}` },
            });
            expect(deniedUsersList.status).toBe(403);

            // Role management must remain available for recovery after manage_users is revoked.
            const refreshedRoles = await api.get('/api/admin/roles', {
                headers: { Authorization: `Bearer ${adminToken}` },
            });
            expect(refreshedRoles.status).toBe(200);
            expect(refreshedRoles.data.data.roles.app_admin.permissions.manage_users).toBe(false);
            expect(refreshedRoles.data.data.roles.app_admin.permissions.manage_roles).toBe(true);

            const restoreResponse = await api.put('/api/admin/roles/app_admin', {
                permissions: { manage_users: true },
            }, {
                headers: { Authorization: `Bearer ${adminToken}` },
            });
            expect(restoreResponse.status).toBe(200);
            expect(restoreResponse.data.data.role.permissions.manage_users).toBe(true);

            const allowedUsersResponse = await api.post('/api/admin/users', {
                name: 'Allowed after restore',
                email: 'role-policy-restored@example.com',
                role: 'hospital_admin',
                hospital_id: primaryHospital._id.toString(),
            }, {
                headers: { Authorization: `Bearer ${adminToken}` },
            });
            expect(allowedUsersResponse.status).toBe(201);

            // Seed path must not overwrite saved permission edits on subsequent reads.
            const hospitalAdminRoles = await api.get('/api/admin/roles', {
                headers: { Authorization: `Bearer ${adminToken}` },
            });
            expect(hospitalAdminRoles.status).toBe(200);
            expect(hospitalAdminRoles.data.data.roles.app_admin.permissions.manage_users).toBe(true);

            await api.put('/api/admin/roles/hospital_admin', {
                permissions: { manage_billing: false },
            }, {
                headers: { Authorization: `Bearer ${adminToken}` },
            });
            const reReadHospitalAdmin = await api.get('/api/admin/roles', {
                headers: { Authorization: `Bearer ${adminToken}` },
            });
            expect(reReadHospitalAdmin.data.data.roles.hospital_admin.permissions.manage_billing).toBe(false);

            // Restore hospital_admin billing for later suite tests that may rely on defaults.
            await api.put('/api/admin/roles/hospital_admin', {
                permissions: { manage_billing: true },
            }, {
                headers: { Authorization: `Bearer ${adminToken}` },
            });
        });

        test('should deny hospital admin role policy updates', async () => {
            const response = await api.put('/api/admin/roles/doctor', {
                permissions: { manage_patients: false },
            }, {
                headers: { Authorization: `Bearer ${hospitalAdminToken}` },
            });
            expect(response.status).toBe(403);
            expect(response.data.success).toBe(false);
        });

        test('should reject unknown roles and malformed role permissions', async () => {
            const invalidRole = await api.put(`/api/admin/users/${adminUser._id}`, {
                role: 'super_admin',
            }, {
                headers: { Authorization: `Bearer ${adminToken}` },
            });
            expect(invalidRole.status).toBe(400);
            expect(invalidRole.data.success).toBe(false);

            const invalidPermission = await api.put('/api/admin/roles/hospital_admin', {
                permissions: { arbitrary_permission: true },
            }, {
                headers: { Authorization: `Bearer ${adminToken}` },
            });
            expect(invalidPermission.status).toBe(400);
            expect(invalidPermission.data.success).toBe(false);
        });

        test('should reject unknown fields on sensitive admin mutations', async () => {
            const headers = { Authorization: `Bearer ${adminToken}` };
            const hospital = await api.post('/api/admin/hospitals', {
                name: 'Strict Schema Hospital', location: 'Chennai', admin_email: 'strict@example.com', unexpected: true,
            }, { headers });
            expect(hospital.status).toBe(400);

            const invitation = await api.post('/api/admin/users', {
                name: 'Strict Invite', email: 'strict-invite@example.com', role: 'hospital_admin',
                hospital_id: primaryHospital._id.toString(), password: 'not-accepted',
            }, { headers });
            expect(invitation.status).toBe(400);

            const invoice = await api.post('/api/admin/billing/invoices', {
                billing_period: '2031-01', force: true,
            }, { headers });
            expect(invoice.status).toBe(400);
        });

        test('should let auditors read billing when manage_billing is granted', async () => {
            await Invoice.create([
                {
                    invoice_number: 'AUDIT-A-2035', hospital_id: primaryHospital._id,
                    billing_period: '2035-01', plan: 'A', amount: 100, due_date: new Date('2035-02-01'),
                },
                {
                    invoice_number: 'AUDIT-B-2035', hospital_id: secondaryHospital._id,
                    billing_period: '2035-01', plan: 'B', amount: 100, due_date: new Date('2035-02-01'),
                },
            ]);
            const response = await api.get('/api/admin/billing/invoices', {
                headers: { Authorization: `Bearer ${auditorToken}` },
            });
            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(Array.isArray(response.data.data.invoices)).toBe(true);
            expect(response.data.data.invoices.some((invoice: any) => invoice.id === 'AUDIT-A-2035')).toBe(true);
            expect(response.data.data.invoices.some((invoice: any) => invoice.id === 'AUDIT-B-2035')).toBe(false);
        });

        test('should generate a unique temporary password and require invited admins to change it', async () => {
            const invite = async (email: string) => api.post('/api/admin/users', {
                name: `Invited ${email}`,
                email,
                role: 'hospital_admin',
                hospital_id: primaryHospital._id.toString(),
            }, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            const [firstResponse, secondResponse] = await Promise.all([
                invite('invited-admin-one@example.com'),
                invite('invited-admin-two@example.com'),
            ]);

            expect(firstResponse.status).toBe(201);
            expect(secondResponse.status).toBe(201);
            expect(firstResponse.data.data.temporary_password).toBeDefined();
            expect(firstResponse.data.data.temporary_password).not.toBe(secondResponse.data.data.temporary_password);
            expect(firstResponse.data.data.must_change_password).toBe(true);

            const invitedUser = await User.findOne({ login_id: 'invited-admin-one@example.com' });
            expect(invitedUser?.must_change_password).toBe(true);

            const defaultPasswordLogin = await api.post('/api/auth/login', {
                login_id: 'invited-admin-one@example.com',
                password: 'Default@123',
            });
            expect(defaultPasswordLogin.status).toBe(401);

            const temporaryPasswordLogin = await api.post('/api/auth/login', {
                login_id: 'invited-admin-one@example.com',
                password: firstResponse.data.data.temporary_password,
            });
            expect(temporaryPasswordLogin.status).toBe(200);
            expect(temporaryPasswordLogin.data.data.user.must_change_password).toBe(true);
        });

        test('should require an active, existing hospital when inviting a Hospital Admin', async () => {
            const headers = { Authorization: `Bearer ${adminToken}` };
            const missingHospital = await api.post('/api/admin/users', {
                name: 'Unknown Hospital Admin',
                email: 'unknown-hospital-admin@example.com',
                role: 'hospital_admin',
                hospital_id: new mongoose.Types.ObjectId().toString(),
            }, { headers });
            expect(missingHospital.status).toBe(400);
            expect(missingHospital.data.message).toMatch(/hospital not found/i);

            const noHospital = await api.post('/api/admin/users', {
                name: 'Unassigned Hospital Admin',
                email: 'unassigned-hospital-admin@example.com',
                role: 'hospital_admin',
            }, { headers });
            expect(noHospital.status).toBe(400);
            expect(noHospital.data.message).toMatch(/assigned to an active hospital/i);

            const roleChangeWithoutHospital = await api.put(`/api/admin/users/${adminUser._id}`, {
                role: 'hospital_admin',
            }, { headers });
            expect(roleChangeWithoutHospital.status).toBe(400);
            expect(roleChangeWithoutHospital.data.message).toMatch(/assigned to an active hospital/i);

            const roleChangeProfile = await AdminProfile.create({ name: 'Role Change Candidate' });
            const roleChangeUser = await User.create({
                login_id: 'role-change-candidate@example.com',
                password: 'RoleChange@123',
                user_type: 'ADMIN',
                profile_id: roleChangeProfile._id,
                is_active: true,
            });
            const successfulRoleChange = await api.put(`/api/admin/users/${roleChangeUser._id}`, {
                role: 'hospital_admin',
                hospital_id: primaryHospital._id.toString(),
            }, { headers });
            expect(successfulRoleChange.status).toBe(200);
            const updatedRoleProfile = await AdminProfile.findById(roleChangeProfile._id).lean();
            expect(updatedRoleProfile?.admin_role).toBe(AdminRole.HOSPITAL_ADMIN);
            expect(String(updatedRoleProfile?.hospital_id)).toBe(primaryHospital._id.toString());

            const unknownUpdateHospital = await api.put(`/api/admin/users/${roleChangeUser._id}`, {
                role: 'hospital_admin',
                hospital_id: new mongoose.Types.ObjectId().toString(),
            }, { headers });
            expect(unknownUpdateHospital.status).toBe(400);
            expect(unknownUpdateHospital.data.message).toMatch(/hospital not found/i);

            await Hospital.findByIdAndUpdate(secondaryHospital._id, { status: 'suspended' });
            const inactiveHospital = await api.post('/api/admin/users', {
                name: 'Suspended Hospital Admin',
                email: 'suspended-hospital-admin@example.com',
                role: 'hospital_admin',
                hospital_id: secondaryHospital._id.toString(),
            }, { headers });
            expect(inactiveHospital.status).toBe(400);
            expect(inactiveHospital.data.message).toMatch(/hospital must be active/i);

            const inactiveUpdateHospital = await api.put(`/api/admin/users/${roleChangeUser._id}`, {
                role: 'hospital_admin',
                hospital_id: secondaryHospital._id.toString(),
            }, { headers });
            expect(inactiveUpdateHospital.status).toBe(400);
            expect(inactiveUpdateHospital.data.message).toMatch(/hospital must be active/i);
            await Hospital.findByIdAndUpdate(secondaryHospital._id, { status: 'active' });
        });
    });

    describe('Doctor Management', () => {
        test('should delete a created profile when user creation fails without transaction support', async () => {
            const startSessionSpy = jest.spyOn(mongoose, 'startSession').mockResolvedValue({
                withTransaction: jest.fn().mockRejectedValue(new Error('Transaction numbers are only allowed on a replica set member')),
                endSession: jest.fn(),
            } as any);
            const createUserSpy = jest.spyOn(User, 'create').mockRejectedValue(new Error('Simulated user creation failure'));
            const profileName = 'Dr. Cleanup Verification';

            try {
                await expect(adminService.registerDoctor({
                    login_id: 'doctor_cleanup_verification',
                    password: 'Doctor@456',
                    name: profileName,
                    contact_number: '9000000009',
                    hospital_id: primaryHospital._id.toString(),
                }, String(adminUser._id))).rejects.toThrow('Simulated user creation failure');

                expect(await DoctorProfile.countDocuments({ name: profileName })).toBe(0);
            } finally {
                createUserSpy.mockRestore();
                startSessionSpy.mockRestore();
            }
        });

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

        test('should paginate hospital-admin doctors after tenant filtering', async () => {
            const response = await api.get('/api/admin/doctors?search=doctor_admin&page=1&limit=1', {
                headers: { Authorization: `Bearer ${hospitalAdminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.data.doctors).toHaveLength(1);
            expect(response.data.data.pagination).toMatchObject({ total: 2, page: 1, limit: 1, pages: 2, hasNext: true });
            expect(String(response.data.data.doctors[0].profile_id.hospital_id)).toBe(primaryHospital._id.toString());
            expect(response.data.data.doctors[0].password).toBeUndefined();
            expect(response.data.data.doctors[0].salt).toBeUndefined();
            expect(response.data.data.doctors[0].password_history).toBeUndefined();
        });

        test('should apply an app-admin hospital filter before doctor pagination', async () => {
            const response = await api.get(`/api/admin/doctors?hospital_id=${primaryHospital._id}&page=1&limit=10`, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.data.pagination.total).toBe(2);
            expect(response.data.data.doctors).toHaveLength(2);
            expect(response.data.data.doctors.every((doctor: any) =>
                String(doctor.profile_id.hospital_id) === primaryHospital._id.toString()
            )).toBe(true);
        });

        test('should create a doctor successfully', async () => {
            const response = await api.post('/api/admin/doctors', {
                login_id: 'doctor_admin_03',
                password: 'Doctor@456',
                name: 'Dr. Newly Added',
                department: 'Oncology',
                contact_number: '9000000003',
                hospital_id: primaryHospital._id.toString()
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
                contact_number: '9000000004',
                hospital_id: primaryHospital._id.toString()
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

        test('restores an admin membership move when post-write ownership is lost', async () => {
            const profileId = hospitalAdminUser.profile_id;
            const original = AdminProfile.findOneAndUpdate.bind(AdminProfile);
            const spy = jest.spyOn(AdminProfile, 'findOneAndUpdate').mockImplementationOnce((async (...args: any[]) => {
                const updated = await original(...args);
                await Hospital.updateOne({ _id: secondaryHospital._id }, {
                    $set: { 'lifecycle_lock.expires_at': new Date(Date.now() - 1_000) },
                });
                return updated as any;
            }) as any);
            try {
                const response = await api.put(`/api/admin/users/${hospitalAdminUser._id}`, {
                    hospital_id: secondaryHospital._id.toString(),
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(response.status).toBe(409);
                const [afterProfile, afterUser] = await Promise.all([
                    AdminProfile.findById(profileId).lean(), User.findById(hospitalAdminUser._id).lean(),
                ]);
                expect(String(afterProfile?.hospital_id)).toBe(String(primaryHospital._id));
                expect(afterUser?.is_active).toBe(true);
            } finally {
                spy.mockRestore();
                await Hospital.updateOne({ _id: secondaryHospital._id }, {
                    $set: { status: 'active', lifecycle_state: 'STABLE', accepting_assignments: true },
                    $unset: { lifecycle_lock: 1 },
                });
            }
        });

        test('metadata update cannot apply lifecycle semantics from a stale hospital status', async () => {
            const original = Hospital.findOne.bind(Hospital);
            let entered!: () => void;
            let resume!: () => void;
            const reached = new Promise<void>(resolve => { entered = resolve; });
            const blocked = new Promise<void>(resolve => { resume = resolve; });
            const spy = jest.spyOn(Hospital, 'findOne').mockImplementationOnce((async (...args: any[]) => {
                const hospital = await original(...args as any);
                entered();
                await blocked;
                return hospital;
            }) as any);
            try {
                const updating = adminService.updateHospital(
                    String(secondaryHospital._id), { metadata: { source: 'stale-request' } }, String(adminUser._id),
                );
                await reached;
                await Hospital.updateOne({ _id: secondaryHospital._id }, {
                    $set: { status: 'suspended', lifecycle_state: 'STABLE', accepting_assignments: false },
                });
                resume();
                await expect(updating).rejects.toThrow(/lifecycle operation is in progress/i);
                const final = await Hospital.findById(secondaryHospital._id).lean();
                expect(final?.status).toBe('suspended');
                expect(final?.lifecycle_state).toBe('STABLE');
                expect(final?.accepting_assignments).toBe(false);
            } finally {
                resume?.();
                spy.mockRestore();
                await Hospital.updateOne({ _id: secondaryHospital._id }, {
                    $set: { status: 'active', lifecycle_state: 'STABLE', accepting_assignments: true },
                    $unset: { lifecycle_lock: 1 },
                });
            }
        });

        test('should not move a doctor who still has assigned patients', async () => {
            const response = await api.put(`/api/admin/doctors/${primaryDoctorUser._id}`, {
                hospital_id: secondaryHospital._id.toString(),
            }, {
                headers: { Authorization: `Bearer ${adminToken}` },
            });

            expect(response.status).toBe(409);
            expect(response.data.message).toMatch(/still has assigned patients/i);
            const profile = await DoctorProfile.findById(primaryDoctorUser.profile_id);
            expect(String(profile?.hospital_id)).toBe(primaryHospital._id.toString());
        });

        test('should not deactivate a doctor who still has active assigned patients', async () => {
            const response = await api.delete(`/api/admin/doctors/${primaryDoctorUser._id}`, {
                headers: { Authorization: `Bearer ${adminToken}` },
            });

            expect(response.status).toBe(409);
            expect(response.data.message).toMatch(/reassign active patients/i);
            expect((await User.findById(primaryDoctorUser._id))?.is_active).toBe(true);
        });

        test('should roll back profile edits when combined doctor deactivation is rejected', async () => {
            const before = await DoctorProfile.findById(primaryDoctorUser.profile_id).lean();
            const response = await api.put(`/api/admin/doctors/${primaryDoctorUser._id}`, {
                name: 'Should Not Persist',
                is_active: false,
            }, { headers: { Authorization: `Bearer ${adminToken}` } });

            expect(response.status).toBe(409);
            expect((await DoctorProfile.findById(primaryDoctorUser.profile_id).lean())?.name).toBe(before?.name);
            expect((await User.findById(primaryDoctorUser._id).lean())?.is_active).toBe(true);
        });

        test('should not deactivate while a patient assignment is in flight', async () => {
            const release = await acquireDoctorAssignmentGuard(secondaryDoctorUser._id);
            try {
                const response = await api.delete(`/api/admin/doctors/${secondaryDoctorUser._id}`, {
                    headers: { Authorization: `Bearer ${adminToken}` },
                });
                expect(response.status).toBe(409);
                expect(response.data.message).toMatch(/operation.*progress/i);
                expect((await User.findById(secondaryDoctorUser._id).lean())?.is_active).toBe(true);
            } finally {
                await release();
            }
        });

        test('should retry a failed guard release and recover an expired orphan lease', async () => {
            const release = await acquireDoctorAssignmentGuard(secondaryDoctorUser._id);
            const spy = jest.spyOn(User, 'updateOne').mockRejectedValueOnce(new Error('transient release failure'));
            await expect(release()).resolves.toBeUndefined();
            spy.mockRestore();
            expect((await User.findById(secondaryDoctorUser._id).lean())?.doctor_operation_lock).toBeUndefined();

            await User.updateOne({ _id: secondaryDoctorUser._id }, {
                $set: {
                    doctor_operation_lock: {
                        lease_id: 'abandoned',
                        mode: 'ASSIGNING',
                        expires_at: new Date(Date.now() - 1_000),
                    },
                },
            });
            const releaseRecovered = await acquireDoctorAssignmentGuard(secondaryDoctorUser._id);
            await releaseRecovered();
            expect((await User.findById(secondaryDoctorUser._id).lean())?.doctor_operation_lock).toBeUndefined();
        });

        test('should fence a stale assignment owner after its lease is replaced', async () => {
            const staleGuard = await acquireDoctorAssignmentGuard(secondaryDoctorUser._id);
            await User.updateOne({ _id: secondaryDoctorUser._id }, {
                $set: { 'doctor_operation_lock.expires_at': new Date(Date.now() - 1_000) },
            });
            const replacementGuard = await acquireDoctorMoveGuard(secondaryDoctorUser._id);
            try {
                await expect(staleGuard.assertOwned()).rejects.toThrow(/lease was lost/i);
            } finally {
                await staleGuard();
                await replacementGuard.release();
            }
        });

        test('should return success after a committed assignment when lease cleanup fails', async () => {
            const loginId = `RELEASE_SAFE_${Date.now()}`;
            const originalUpdateOne = User.updateOne.bind(User);
            const releaseSpy = jest.spyOn(User, 'updateOne').mockImplementation((async (filter: any, update: any, options?: any) => {
                if (update?.$unset?.doctor_operation_lock) throw new Error('lease store unavailable');
                return originalUpdateOne(filter, update, options);
            }) as any);
            try {
                const response = await api.post('/api/admin/patients', {
                    login_id: loginId,
                    password: 'Patient@123',
                    assigned_doctor_id: secondaryDoctorUser._id.toString(),
                    hospital_id: primaryHospital._id.toString(),
                    demographics: { name: 'Release Safe', age: 45, gender: 'Female', phone: '9000000088' },
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(response.status).toBe(201);
                expect(await User.countDocuments({ login_id: loginId })).toBe(1);
            } finally {
                releaseSpy.mockRestore();
                const created = await User.findOne({ login_id: loginId }).lean();
                if (created) {
                    await Promise.all([
                        User.deleteOne({ _id: created._id }),
                        PatientProfile.deleteOne({ _id: created.profile_id }),
                    ]);
                }
                await User.updateOne({ _id: secondaryDoctorUser._id }, {
                    $set: { is_active: true },
                    $unset: { doctor_operation_lock: 1 },
                });
            }
        });

        test('should serialize doctor hospital moves with assignment writers in both directions', async () => {
            const releaseAssignment = await acquireDoctorAssignmentGuard(secondaryDoctorUser._id);
            try {
                const move = await api.put(`/api/admin/doctors/${secondaryDoctorUser._id}`, {
                    hospital_id: secondaryHospital._id.toString(),
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(move.status).toBe(409);
            } finally {
                await releaseAssignment();
            }

            const moveGuard = await acquireDoctorMoveGuard(secondaryDoctorUser._id);
            try {
                const onboard = await api.post('/api/admin/patients', {
                    login_id: `MOVE_RACE_${Date.now()}`,
                    password: 'Patient@123',
                    assigned_doctor_id: secondaryDoctorUser._id.toString(),
                    hospital_id: primaryHospital._id.toString(),
                    demographics: { name: 'Move Race', age: 50, gender: 'Male', phone: '9000000098' },
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(onboard.status).toBe(409);
            } finally {
                await moveGuard.release();
            }
        });

        test('should not let stale move compensation overwrite a successor assignment fence', async () => {
            const before = await DoctorProfile.findById(secondaryDoctorUser.profile_id).lean();
            let successorGuard: Awaited<ReturnType<typeof acquireDoctorAssignmentGuard>> | undefined;
            let successorProfile: any;
            const saveSpy = jest.spyOn(User.prototype, 'save').mockImplementationOnce((async function (this: any) {
                await User.updateOne({ _id: secondaryDoctorUser._id }, {
                    $set: { 'doctor_operation_lock.expires_at': new Date(Date.now() - 1_000) },
                });
                successorGuard = await acquireDoctorAssignmentGuard(secondaryDoctorUser._id);
                await stampDoctorProfileFence(secondaryDoctorUser.profile_id, {
                    fenceToken: successorGuard.fenceToken,
                    assertOwned: successorGuard.assertOwned,
                });
                successorProfile = await PatientProfile.create({
                    assigned_doctor_id: secondaryDoctorUser._id,
                    hospital_id: secondaryHospital._id,
                    demographics: { name: 'Successor Fence Patient', phone: '9000000055' },
                });
                throw new Error('stale mover failed after successor committed');
            }) as any);
            try {
                const response = await api.put(`/api/admin/doctors/${secondaryDoctorUser._id}`, {
                    hospital_id: secondaryHospital._id.toString(),
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(response.status).toBe(500);
                const after = await DoctorProfile.findById(secondaryDoctorUser.profile_id).lean();
                expect(String(after?.hospital_id)).toBe(secondaryHospital._id.toString());
                expect(Number(after?.doctor_operation_fence)).toBe(successorGuard?.fenceToken);
                expect(String(successorProfile.assigned_doctor_id)).toBe(secondaryDoctorUser._id.toString());
            } finally {
                saveSpy.mockRestore();
                if (successorGuard) await successorGuard();
                if (successorProfile) await PatientProfile.deleteOne({ _id: successorProfile._id });
                await DoctorProfile.updateOne({ _id: secondaryDoctorUser.profile_id }, {
                    $set: {
                        hospital_id: before?.hospital_id,
                        doctor_operation_fence: before?.doctor_operation_fence ?? 0,
                    },
                });
                await User.updateOne({ _id: secondaryDoctorUser._id }, {
                    $set: { is_active: true },
                    $unset: { doctor_operation_lock: 1 },
                });
            }
        });

        test('should drain in-flight assignment before completing hospital suspension', async () => {
            const hospital = await Hospital.create({
                code: `DRAIN_${Date.now()}`,
                name: 'Drain Hospital', location: 'Test', admin_email: `drain-${Date.now()}@example.com`,
            });
            const doctorProfile = await DoctorProfile.create({ name: 'Dr Drain', hospital_id: hospital._id });
            const doctor = await User.create({
                login_id: `drain-doctor-${Date.now()}`, password: 'Doctor@123', user_type: 'DOCTOR',
                profile_id: doctorProfile._id, is_active: true,
            });
            const moverProfile = await DoctorProfile.create({ name: 'Dr Incoming', hospital_id: secondaryHospital._id });
            const mover = await User.create({
                login_id: `incoming-doctor-${Date.now()}`, password: 'Doctor@123', user_type: 'DOCTOR',
                profile_id: moverProfile._id, is_active: true,
            });
            const heldGuard = await acquireDoctorAssignmentGuard(doctor._id);
            let patientProfile: any;
            let patient: any;
            try {
                const suspensionPromise = api.patch(`/api/admin/hospitals/${hospital._id}/status`, {
                    status: 'suspended',
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                for (let attempt = 0; attempt < 100; attempt += 1) {
                    if ((await Hospital.findById(hospital._id).lean())?.accepting_assignments === false) break;
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
                expect(await hasActiveHospitalAccess(doctor)).toBe(false);
                await expect(acquireDoctorAssignmentGuard(doctor._id)).rejects.toThrow(/operation|accepting/i);
                const incomingCreate = await api.post('/api/admin/doctors', {
                    login_id: `blocked-incoming-${Date.now()}`,
                    password: 'Doctor@123', name: 'Blocked Incoming', contact_number: '9000000043',
                    hospital_id: hospital._id.toString(),
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect([400, 409]).toContain(incomingCreate.status);
                const incomingMove = await api.put(`/api/admin/doctors/${mover._id}`, {
                    hospital_id: hospital._id.toString(),
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect([400, 409]).toContain(incomingMove.status);
                expect(String((await DoctorProfile.findById(moverProfile._id).lean())?.hospital_id))
                    .toBe(secondaryHospital._id.toString());
                const concurrentActivation = await api.patch(`/api/admin/hospitals/${hospital._id}/status`, {
                    status: 'active',
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(concurrentActivation.status).toBe(409);
                patientProfile = await PatientProfile.create({
                    assigned_doctor_id: doctor._id, hospital_id: hospital._id,
                    demographics: { name: 'Drained Patient', phone: '9000000044' },
                });
                patient = await User.create({
                    login_id: `drain-patient-${Date.now()}`, password: 'Patient@123', user_type: 'PATIENT',
                    profile_id: patientProfile._id, is_active: true,
                });
                await heldGuard();
                const response = await suspensionPromise;
                expect(response.status).toBe(200);
                expect((await Hospital.findById(hospital._id).lean())?.status).toBe('suspended');
                expect((await User.findById(doctor._id).lean())?.is_active).toBe(false);
                expect((await User.findById(patient._id).lean())?.is_active).toBe(false);
            } finally {
                await heldGuard();
                await Promise.all([
                    patient ? User.deleteOne({ _id: patient._id }) : Promise.resolve(),
                    patientProfile ? PatientProfile.deleteOne({ _id: patientProfile._id }) : Promise.resolve(),
                    User.deleteOne({ _id: mover._id }), DoctorProfile.deleteOne({ _id: moverProfile._id }),
                    User.deleteOne({ _id: doctor._id }), DoctorProfile.deleteOne({ _id: doctorProfile._id }),
                    Hospital.deleteOne({ _id: hospital._id }),
                ]);
            }
        });

        test('should serialize suspension behind a pre-transition incoming membership writer', async () => {
            const hospital = await Hospital.create({
                code: `MEMBER_DRAIN_${Date.now()}`, name: 'Member Drain Hospital', location: 'Test',
                admin_email: `member-drain-${Date.now()}@example.com`,
            });
            const membership = await acquireHospitalMembershipGuard(hospital._id);
            let profile: any;
            let doctor: any;
            try {
                const blockedSuspend = await api.patch(`/api/admin/hospitals/${hospital._id}/status`, {
                    status: 'suspended',
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(blockedSuspend.status).toBe(409);
                const beforeCommit = await Hospital.findById(hospital._id).lean();
                expect(beforeCommit?.status).toBe('active');
                expect(beforeCommit?.lifecycle_state).toBe('STABLE');
                expect(beforeCommit?.accepting_assignments).toBe(true);

                profile = await DoctorProfile.create({ name: 'Dr Incoming Before Barrier', hospital_id: hospital._id });
                doctor = await User.create({
                    login_id: `member-before-barrier-${Date.now()}`, password: 'Doctor@123', user_type: 'DOCTOR',
                    profile_id: profile._id, is_active: true,
                });
                await membership.assertOwned();
                await membership.release();

                const suspended = await api.patch(`/api/admin/hospitals/${hospital._id}/status`, {
                    status: 'suspended',
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(suspended.status).toBe(200);
                expect((await User.findById(doctor._id).lean())?.is_active).toBe(false);
                expect((await Hospital.findById(hospital._id).lean())?.status).toBe('suspended');
            } finally {
                await membership.release();
                await Promise.all([
                    doctor ? User.deleteOne({ _id: doctor._id }) : Promise.resolve(),
                    profile ? DoctorProfile.deleteOne({ _id: profile._id }) : Promise.resolve(),
                    Hospital.deleteOne({ _id: hospital._id }),
                ]);
            }
        });

        test('should not deactivate a member that completed a source-guarded move before suspension', async () => {
            const source = await Hospital.create({
                code: `SOURCE_MOVE_${Date.now()}`, name: 'Source Move Hospital', location: 'Test',
                admin_email: `source-move-${Date.now()}@example.com`,
            });
            const profile = await AdminProfile.create({
                name: 'Moving Admin', admin_role: AdminRole.HOSPITAL_ADMIN,
                permission: 'FULL_ACCESS', hospital_id: source._id,
            });
            const movingUser = await User.create({
                login_id: `moving-admin-${Date.now()}@example.com`, password: 'Admin@123', user_type: 'ADMIN',
                profile_id: profile._id, is_active: true,
            });
            const sourceMembership = await acquireHospitalMembershipGuard(source._id);
            try {
                const staleSuspension = await api.patch(`/api/admin/hospitals/${source._id}/status`, {
                    status: 'suspended',
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(staleSuspension.status).toBe(409);
                await AdminProfile.updateOne(
                    { _id: profile._id, hospital_id: source._id },
                    { $set: { hospital_id: secondaryHospital._id } },
                );
                await sourceMembership.assertOwned();
                await sourceMembership.release();

                const suspended = await api.patch(`/api/admin/hospitals/${source._id}/status`, {
                    status: 'suspended',
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(suspended.status).toBe(200);
                expect((await User.findById(movingUser._id).lean())?.is_active).toBe(true);
                expect(String((await AdminProfile.findById(profile._id).lean())?.hospital_id))
                    .toBe(secondaryHospital._id.toString());
            } finally {
                await sourceMembership.release();
                await Promise.all([
                    User.deleteOne({ _id: movingUser._id }), AdminProfile.deleteOne({ _id: profile._id }),
                    Hospital.deleteOne({ _id: source._id }),
                ]);
            }
        });

        test('should renew hospital transition ownership before lifecycle side effects', async () => {
            const hospital = await Hospital.create({
                code: `RENEW_TRANSITION_${Date.now()}`, name: 'Renew Transition Hospital', location: 'Test',
                admin_email: `renew-transition-${Date.now()}@example.com`,
            });
            const guard = await acquireHospitalTransitionGuard(hospital._id, false);
            try {
                await Hospital.updateOne(
                    { _id: hospital._id, 'lifecycle_lock.lease_id': guard.leaseId },
                    { $set: { 'lifecycle_lock.expires_at': new Date(Date.now() + 1_000) } },
                );
                await guard.assertOwned();
                const renewed = await Hospital.findById(hospital._id).lean();
                expect(new Date(renewed?.lifecycle_lock?.expires_at as Date).getTime())
                    .toBeGreaterThan(Date.now() + 60_000);
            } finally {
                await guard.release();
                await Hospital.deleteOne({ _id: hospital._id });
            }
        });

        test('should not let a stale suspender deactivate over a successor doctor fence', async () => {
            const hospital = await Hospital.create({
                code: `STALE_SUSPEND_${Date.now()}`, name: 'Stale Suspend Hospital', location: 'Test',
                admin_email: `stale-suspend-${Date.now()}@example.com`,
            });
            const profile = await DoctorProfile.create({ name: 'Dr Suspension Fence', hospital_id: hospital._id });
            const doctor = await User.create({
                login_id: `suspension-fence-${Date.now()}`, password: 'Doctor@123', user_type: 'DOCTOR',
                profile_id: profile._id, is_active: true,
            });
            const originalUpdateOne = User.updateOne.bind(User);
            let successor: Awaited<ReturnType<typeof acquireDoctorMoveGuard>> | undefined;
            const spy = jest.spyOn(User, 'updateOne').mockImplementation((async (filter: any, update: any, ...rest: any[]) => {
                if (!successor && String(filter?._id) === String(doctor._id) && update?.$set?.is_active === false &&
                    filter?.['doctor_operation_lock.lease_id']) {
                    await originalUpdateOne({ _id: doctor._id }, {
                        $set: { 'doctor_operation_lock.expires_at': new Date(Date.now() - 1_000) },
                    });
                    successor = await acquireDoctorMoveGuard(doctor._id);
                    await stampDoctorProfileFence(profile._id, successor);
                    await DoctorProfile.updateOne(
                        { _id: profile._id, doctor_operation_fence: successor.fenceToken },
                        { $set: { hospital_id: secondaryHospital._id } },
                    );
                }
                return originalUpdateOne(filter, update, ...rest as any) as any;
            }) as any);
            try {
                const response = await api.patch(`/api/admin/hospitals/${hospital._id}/status`, {
                    status: 'suspended',
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(response.status).toBe(409);
                const afterHospital = await Hospital.findById(hospital._id).lean();
                expect(afterHospital?.status).toBe('active');
                expect(afterHospital?.lifecycle_state).toBe('SUSPENDING');
                expect(afterHospital?.accepting_assignments).toBe(false);
                expect((await User.findById(doctor._id).lean())?.is_active).toBe(true);
                expect(String((await DoctorProfile.findById(profile._id).lean())?.hospital_id))
                    .toBe(secondaryHospital._id.toString());
            } finally {
                spy.mockRestore();
                if (successor) await successor.release();
                await Promise.all([
                    User.deleteOne({ _id: doctor._id }), DoctorProfile.deleteOne({ _id: profile._id }),
                    Hospital.deleteOne({ _id: hospital._id }),
                ]);
            }
        });

        test('should support combined move and deactivation and allow later inactive moves', async () => {
            const profile = await DoctorProfile.create({
                name: 'Dr. Lifecycle', department: 'Cardiology', contact_number: '9000000087',
                hospital_id: primaryHospital._id,
            });
            const doctor = await User.create({
                login_id: `lifecycle-doctor-${Date.now()}`, password: 'Doctor@123', user_type: 'DOCTOR',
                profile_id: profile._id, is_active: true,
            });
            try {
                const combined = await api.put(`/api/admin/doctors/${doctor._id}`, {
                    hospital_id: secondaryHospital._id.toString(),
                    is_active: false,
                    password: 'MovedDoctor@456',
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(combined.status).toBe(200);
                expect((await User.findById(doctor._id).lean())?.is_active).toBe(false);
                expect(String((await DoctorProfile.findById(profile._id).lean())?.hospital_id))
                    .toBe(secondaryHospital._id.toString());

                const inactiveMove = await api.put(`/api/admin/doctors/${doctor._id}`, {
                    hospital_id: primaryHospital._id.toString(),
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(inactiveMove.status).toBe(200);
                expect((await User.findById(doctor._id).lean())?.is_active).toBe(false);
                expect(String((await DoctorProfile.findById(profile._id).lean())?.hospital_id))
                    .toBe(primaryHospital._id.toString());
            } finally {
                await Promise.all([User.deleteOne({ _id: doctor._id }), DoctorProfile.deleteOne({ _id: profile._id })]);
            }
        });

        test('stale combined move/deactivate/password never reactivates or rolls security generation backward', async () => {
            const profile = await DoctorProfile.create({
                name: 'Dr Irreversible Security', department: 'Cardiology', contact_number: '9000000086',
                hospital_id: primaryHospital._id,
            });
            const doctor = await User.create({
                login_id: `irreversible-doctor-${Date.now()}`, password: 'Doctor@123', user_type: 'DOCTOR',
                profile_id: profile._id, is_active: true,
            });
            const beforeVersion = Number(doctor.security_version || 0);
            const original = User.findOneAndUpdate.bind(User);
            let successor: Awaited<ReturnType<typeof acquireDoctorMoveGuard>> | undefined;
            const spy = jest.spyOn(User, 'findOneAndUpdate').mockImplementation(((filter: any, update: any, ...rest: any[]) => {
                const query: any = original(filter, update, ...rest as any);
                if (!successor && String(filter?._id) === String(doctor._id) && update?.$inc?.security_version === 1) {
                    const originalExec = query.exec.bind(query);
                    query.exec = async () => {
                        const result = await originalExec();
                        await User.updateOne({ _id: doctor._id }, {
                            $set: { 'doctor_operation_lock.expires_at': new Date(Date.now() - 1_000) },
                        });
                        successor = await acquireDoctorMoveGuard(doctor._id);
                        await stampDoctorProfileFence(profile._id, successor);
                        return result;
                    };
                }
                return query;
            }) as any);
            try {
                const response = await api.put(`/api/admin/doctors/${doctor._id}`, {
                    hospital_id: secondaryHospital._id.toString(), is_active: false,
                    password: 'IrreversibleDoctor@456',
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(response.status).toBe(409);
                const [afterUser, afterProfile] = await Promise.all([
                    User.findById(doctor._id).lean(), DoctorProfile.findById(profile._id).lean(),
                ]);
                expect(afterUser?.is_active).toBe(false);
                expect(Number(afterUser?.security_version)).toBe(beforeVersion + 1);
                expect(Number(afterProfile?.doctor_operation_fence)).toBe(successor?.fenceToken);
                expect(String(afterProfile?.hospital_id)).toBe(String(secondaryHospital._id));
            } finally {
                spy.mockRestore();
                if (successor) await successor.release();
                await Promise.all([User.deleteOne({ _id: doctor._id }), DoctorProfile.deleteOne({ _id: profile._id })]);
            }
        });

        test('post-create membership loss preserves linked doctor and admin account pairs', async () => {
            const originalCreate = User.create.bind(User);
            const expireMembershipAfterCreate = () => jest.spyOn(User, 'create').mockImplementationOnce((async (...args: any[]) => {
                const created = await originalCreate(...args as any);
                await Hospital.updateOne({ _id: primaryHospital._id }, {
                    $set: { 'lifecycle_lock.expires_at': new Date(Date.now() - 1_000) },
                });
                return created as any;
            }) as any);
            const doctorLogin = `pair-doctor-${Date.now()}`;
            const adminLogin = `pair-admin-${Date.now()}@example.com`;
            let spy = expireMembershipAfterCreate();
            try {
                const doctorResponse = await api.post('/api/admin/doctors', {
                    login_id: doctorLogin, password: 'PairDoctor@123', name: 'Dr Pair Integrity',
                    contact_number: '9000000085', hospital_id: primaryHospital._id.toString(),
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(doctorResponse.status).toBe(201);
            } finally {
                spy.mockRestore();
            }

            spy = expireMembershipAfterCreate();
            try {
                const adminResponse = await api.post('/api/admin/users', {
                    email: adminLogin, name: 'Pair Integrity Admin', role: AdminRole.HOSPITAL_ADMIN,
                    hospital_id: primaryHospital._id.toString(),
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(adminResponse.status).toBe(201);
            } finally {
                spy.mockRestore();
            }

            const [doctorUser, adminPairUser] = await Promise.all([
                User.findOne({ login_id: doctorLogin }).lean(), User.findOne({ login_id: adminLogin }).lean(),
            ]);
            expect(doctorUser).toBeTruthy();
            expect(adminPairUser).toBeTruthy();
            expect(await DoctorProfile.exists({ _id: doctorUser?.profile_id })).toBeTruthy();
            expect(await AdminProfile.exists({ _id: adminPairUser?.profile_id })).toBeTruthy();
            if (doctorUser) await Promise.all([
                User.deleteOne({ _id: doctorUser._id }), DoctorProfile.deleteOne({ _id: doctorUser.profile_id }),
            ]);
            if (adminPairUser) await Promise.all([
                User.deleteOne({ _id: adminPairUser._id }), AdminProfile.deleteOne({ _id: adminPairUser.profile_id }),
            ]);
        });

        test('tenantless hospital admins and clinical users fail general access while global roles remain allowed', async () => {
            const [hospitalAdminProfile, auditorProfile, doctorProfile, patientProfile] = await Promise.all([
                AdminProfile.create({ name: 'No Tenant Hospital Admin', admin_role: AdminRole.HOSPITAL_ADMIN }),
                AdminProfile.create({ name: 'Global Auditor', admin_role: AdminRole.AUDITOR }),
                DoctorProfile.create({ name: 'No Tenant Doctor' }),
                PatientProfile.create({ demographics: { name: 'No Tenant Patient' } }),
            ]);
            const users = await User.create([
                { login_id: `no-tenant-ha-${Date.now()}`, password: 'Admin@123', user_type: 'ADMIN', profile_id: hospitalAdminProfile._id },
                { login_id: `global-auditor-${Date.now()}`, password: 'Auditor@123', user_type: 'ADMIN', profile_id: auditorProfile._id },
                { login_id: `no-tenant-doctor-${Date.now()}`, password: 'Doctor@123', user_type: 'DOCTOR', profile_id: doctorProfile._id },
                { login_id: `no-tenant-patient-${Date.now()}`, password: 'Patient@123', user_type: 'PATIENT', profile_id: patientProfile._id },
            ]);
            try {
                await expect(hasActiveHospitalAccess(users[0])).resolves.toBe(false);
                await expect(hasActiveHospitalAccess(users[1])).resolves.toBe(true);
                await expect(hasActiveHospitalAccess(users[2])).resolves.toBe(false);
                await expect(hasActiveHospitalAccess(users[3])).resolves.toBe(false);
                const globalAuditorListing = await adminService.listUsers(String(users[1]._id));
                expect(globalAuditorListing.users.map(user => user.loginId)).toContain(adminUser.login_id);
            } finally {
                await Promise.all([
                    User.deleteMany({ _id: { $in: users.map(user => user._id) } }),
                    AdminProfile.deleteMany({ _id: { $in: [hospitalAdminProfile._id, auditorProfile._id] } }),
                    DoctorProfile.deleteOne({ _id: doctorProfile._id }), PatientProfile.deleteOne({ _id: patientProfile._id }),
                ]);
            }
        });

        test('should not reactivate a discharged patient whose retained doctor became inactive', async () => {
            const doctorProfile = await DoctorProfile.create({
                name: 'Dr. Reactivation', department: 'Cardiology', contact_number: '9000000097',
                hospital_id: primaryHospital._id,
            });
            const doctor = await User.create({
                login_id: `reactivation-doctor-${Date.now()}`, password: 'Doctor@123', user_type: 'DOCTOR',
                profile_id: doctorProfile._id, is_active: true,
            });
            const profile = await PatientProfile.create({
                assigned_doctor_id: doctor._id, hospital_id: primaryHospital._id,
                account_status: 'Discharged', demographics: { name: 'Reactivate Me', phone: '9000000096' },
            });
            const patient = await User.create({
                login_id: `reactivation-patient-${Date.now()}`, password: 'Patient@123', user_type: 'PATIENT',
                profile_id: profile._id, is_active: true,
            });
            const deactivated = await api.delete(`/api/admin/doctors/${doctor._id}`, {
                headers: { Authorization: `Bearer ${adminToken}` },
            });
            expect(deactivated.status).toBe(200);

            const response = await api.put(`/api/admin/patients/${patient._id}`, {
                account_status: 'Active',
            }, { headers: { Authorization: `Bearer ${adminToken}` } });
            expect(response.status).toBe(409);
            expect((await PatientProfile.findById(profile._id).lean())?.account_status).toBe('Discharged');
            await Promise.all([
                User.deleteMany({ _id: { $in: [patient._id, doctor._id] } }),
                PatientProfile.deleteOne({ _id: profile._id }),
                DoctorProfile.deleteOne({ _id: doctorProfile._id }),
            ]);
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
        test('should paginate hospital-admin patients after tenant filtering', async () => {
            const response = await api.get('/api/admin/patients?search=PAT_ADMIN&page=1&limit=1', {
                headers: { Authorization: `Bearer ${hospitalAdminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.data.patients).toHaveLength(1);
            expect(response.data.data.pagination).toMatchObject({ total: 1, page: 1, limit: 1, pages: 1, hasNext: false });
            expect(String(response.data.data.patients[0].profile_id.hospital_id)).toBe(primaryHospital._id.toString());
            expect(response.data.data.patients[0].password).toBeUndefined();
            expect(response.data.data.patients[0].salt).toBeUndefined();
            expect(response.data.data.patients[0].password_history).toBeUndefined();
        });

        test('should apply an app-admin hospital filter before patient pagination', async () => {
            const response = await api.get(`/api/admin/patients?hospital_id=${primaryHospital._id}&page=1&limit=10`, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.data.pagination.total).toBe(1);
            expect(response.data.data.patients).toHaveLength(1);
            expect(String(response.data.data.patients[0].profile_id.hospital_id)).toBe(primaryHospital._id.toString());
        });

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

        test('should prevent hospital admin onboarding with a cross-tenant assigned doctor', async () => {
            const response = await api.post('/api/admin/patients', {
                login_id: 'PAT_ADMIN_CROSS_DOCTOR',
                password: 'Patient@456',
                assigned_doctor_id: crossTenantDoctorUser.login_id,
                demographics: {
                    name: 'Cross Doctor Patient',
                    age: 39,
                    gender: 'Female',
                    phone: '9444444445'
                }
            }, {
                headers: { Authorization: `Bearer ${hospitalAdminToken}` }
            });

            expect(response.status).toBe(403);
            expect(response.data.success).toBe(false);
            expect(response.data.message).toContain('Assigned doctor must belong to the same hospital');
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

        test('should reject conflicting assigned doctor and hospital updates without a partial write', async () => {
            const before = await PatientProfile.findById(baselinePatientUser.profile_id).lean();
            const response = await api.put(`/api/admin/patients/${baselinePatientUser._id}`, {
                assigned_doctor_id: primaryDoctorUser._id.toString(),
                hospital_id: secondaryHospital._id.toString(),
            }, {
                headers: { Authorization: `Bearer ${adminToken}` },
            });

            expect(response.status).toBe(403);
            expect(response.data.message).toMatch(/same hospital/i);
            const after = await PatientProfile.findById(baselinePatientUser.profile_id).lean();
            expect(String(after?.assigned_doctor_id)).toBe(String(before?.assigned_doctor_id));
            expect(String(after?.hospital_id)).toBe(String(before?.hospital_id));
        });

        test('should accept matching assigned doctor and hospital updates', async () => {
            const response = await api.put(`/api/admin/patients/${baselinePatientUser._id}`, {
                assigned_doctor_id: primaryDoctorUser._id.toString(),
                hospital_id: primaryHospital._id.toString(),
            }, {
                headers: { Authorization: `Bearer ${adminToken}` },
            });

            expect(response.status).toBe(200);
            const profile = await PatientProfile.findById(baselinePatientUser.profile_id).lean();
            expect(String(profile?.assigned_doctor_id)).toBe(primaryDoctorUser._id.toString());
            expect(String(profile?.hospital_id)).toBe(primaryHospital._id.toString());
        });

        test('should reject a hospital-only move that conflicts with the retained doctor', async () => {
            const before = await PatientProfile.findById(baselinePatientUser.profile_id).lean();
            const response = await api.put(`/api/admin/patients/${baselinePatientUser._id}`, {
                hospital_id: secondaryHospital._id.toString(),
            }, {
                headers: { Authorization: `Bearer ${adminToken}` },
            });

            expect(response.status).toBe(403);
            expect(response.data.message).toMatch(/same hospital/i);
            const after = await PatientProfile.findById(baselinePatientUser.profile_id).lean();
            expect(String(after?.assigned_doctor_id)).toBe(String(before?.assigned_doctor_id));
            expect(String(after?.hospital_id)).toBe(String(before?.hospital_id));
        });

        test('should preserve adherence and clinician fields during a partial medical config update', async () => {
            await PatientProfile.updateOne(
                { _id: baselinePatientUser.profile_id },
                {
                    $set: {
                        'medical_config.instructions': ['Keep dose stable'],
                        'medical_config.next_review_date': new Date('2030-02-01'),
                        'medical_config.taken_doses': [new Date('2026-02-10')],
                    },
                },
            );

            const response = await api.put(`/api/admin/patients/${baselinePatientUser._id}`, {
                medical_config: { diagnosis: 'Updated diagnosis' },
            }, { headers: { Authorization: `Bearer ${adminToken}` } });

            expect(response.status).toBe(200);
            const profile = await PatientProfile.findById(baselinePatientUser.profile_id).lean();
            expect(profile?.medical_config?.diagnosis).toBe('Updated diagnosis');
            expect(profile?.medical_config?.instructions).toEqual(['Keep dose stable']);
            expect(profile?.medical_config?.taken_doses).toHaveLength(1);
            expect(profile?.medical_config?.next_review_date).toEqual(new Date('2030-02-01'));
        });

        test('should not persist patient profile edits when password policy rejects the update', async () => {
            const before = await PatientProfile.findById(baselinePatientUser.profile_id).lean();
            const response = await api.put(`/api/admin/patients/${baselinePatientUser._id}`, {
                demographics: { name: 'Should Not Persist' },
                password: 'Patient@123',
            }, { headers: { Authorization: `Bearer ${adminToken}` } });

            expect(response.status).toBe(400);
            expect(response.data.message).toMatch(/recently used password/i);
            expect((await PatientProfile.findById(baselinePatientUser.profile_id).lean())?.demographics?.name)
                .toBe(before?.demographics?.name);
        });

        test('field-scoped compensation preserves a concurrent clinical write after a late user-save failure', async () => {
            const before = await PatientProfile.findById(baselinePatientUser.profile_id).lean();
            const concurrentDose = new Date('2027-01-15T00:00:00.000Z');
            const spy = jest.spyOn(User.prototype, 'save').mockImplementationOnce((async function (this: any) {
                await PatientProfile.updateOne({ _id: baselinePatientUser.profile_id }, {
                    $addToSet: { 'medical_config.taken_doses': concurrentDose },
                });
                throw new Error('late user save failure');
            }) as any);
            try {
                const response = await api.put(`/api/admin/patients/${baselinePatientUser._id}`, {
                    demographics: { name: 'Transient Admin Name' },
                    is_active: false,
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(response.status).toBe(500);
                const after = await PatientProfile.findById(baselinePatientUser.profile_id).lean();
                expect(after?.demographics?.name).toBe(before?.demographics?.name);
                expect(after?.medical_config?.taken_doses?.map(date => new Date(date as any).toISOString()))
                    .toContain(concurrentDose.toISOString());
            } finally {
                spy.mockRestore();
            }
        });

        test('compensates coupled phone fields atomically without overwriting a concurrent tuple', async () => {
            const before = await DoctorProfile.findById(secondaryDoctorUser.profile_id).lean();
            const concurrentVerifiedAt = new Date('2031-04-05T06:07:08.000Z');
            const originalProfileUpdateOne = DoctorProfile.updateOne.bind(DoctorProfile);
            const passwordSpy = jest.spyOn(User, 'findOneAndUpdate').mockImplementationOnce((() => ({
                select: () => Promise.reject(new Error('late doctor credential failure')),
            })) as any);
            const compensationSpy = jest.spyOn(DoctorProfile, 'updateOne').mockImplementationOnce((async (
                filter: any, update: any, options?: any,
            ) => {
                await originalProfileUpdateOne({ _id: secondaryDoctorUser.profile_id }, {
                    $set: {
                        contact_number: '9000000077',
                        phone_verification: { status: 'VERIFIED', verified_at: concurrentVerifiedAt },
                    },
                });
                return originalProfileUpdateOne(filter, update, options);
            }) as any);
            try {
                const response = await api.put(`/api/admin/doctors/${secondaryDoctorUser._id}`, {
                    name: 'Should Roll Back Independently',
                    contact_number: '9000000076',
                    password: 'NewDoctor@456',
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(response.status).toBe(500);
                const after = await DoctorProfile.findById(secondaryDoctorUser.profile_id).lean();
                expect(after?.contact_number).toBe('9000000077');
                expect(after?.phone_verification?.status).toBe('VERIFIED');
                expect(after?.phone_verification?.verified_at).toEqual(concurrentVerifiedAt);
                expect(after?.name).toBe(before?.name);
            } finally {
                passwordSpy.mockRestore();
                compensationSpy.mockRestore();
            }
        });

        test('should reject moving therapy start after a recorded dose', async () => {
            const before = await PatientProfile.findById(baselinePatientUser.profile_id).lean();
            const response = await api.put(`/api/admin/patients/${baselinePatientUser._id}`, {
                medical_config: { therapy_start_date: '11-02-2026' },
            }, { headers: { Authorization: `Bearer ${adminToken}` } });

            expect(response.status).toBe(409);
            expect(response.data.message).toMatch(/recorded dose/i);
            const after = await PatientProfile.findById(baselinePatientUser.profile_id).lean();
            expect(after?.medical_config?.therapy_start_date).toEqual(before?.medical_config?.therapy_start_date);
        });

        test('should atomically reject therapy-start changes racing with dose and review writes', async () => {
            await PatientProfile.updateOne(
                { _id: baselinePatientUser.profile_id },
                {
                    $set: {
                        'medical_config.taken_doses': [],
                        'medical_config.next_review_date': null,
                        'medical_config.therapy_start_date': new Date('2025-01-10T00:00:00.000Z'),
                    },
                },
            );
            const originalFindOneAndUpdate = PatientProfile.findOneAndUpdate.bind(PatientProfile);
            const spy = jest.spyOn(PatientProfile, 'findOneAndUpdate').mockImplementationOnce((async (...args: any[]) => {
                await PatientProfile.updateOne(
                    { _id: baselinePatientUser.profile_id },
                    {
                        $set: {
                            'medical_config.taken_doses': [new Date('2026-02-10T00:00:00.000Z')],
                            'medical_config.next_review_date': new Date('2026-02-10T00:00:00.000Z'),
                        },
                    },
                );
                return originalFindOneAndUpdate(...args) as any;
            }) as any);
            try {
                const response = await api.put(`/api/admin/patients/${baselinePatientUser._id}`, {
                    medical_config: { therapy_start_date: '11-02-2026' },
                }, { headers: { Authorization: `Bearer ${adminToken}` } });

                expect(response.status).toBe(409);
                const profile = await PatientProfile.findById(baselinePatientUser.profile_id).lean();
                expect(profile?.medical_config?.therapy_start_date).toEqual(new Date('2025-01-10T00:00:00.000Z'));
                expect(profile?.medical_config?.taken_doses).toHaveLength(1);
                expect(profile?.medical_config?.next_review_date).toEqual(new Date('2026-02-10T00:00:00.000Z'));
            } finally {
                spy.mockRestore();
            }
        });

        test('generic patient update returns truthful success after a valid reassignment commit loses its lease', async () => {
            const [targetUserState, targetProfileState, targetHospitalState] = await Promise.all([
                User.findById(secondaryDoctorUser._id).lean(),
                DoctorProfile.findById(secondaryDoctorUser.profile_id).lean(),
                Hospital.findById(primaryHospital._id).lean(),
            ]);
            expect(targetUserState?.is_active).toBe(true);
            expect(String(targetProfileState?.hospital_id)).toBe(String(primaryHospital._id));
            expect(targetHospitalState).toMatchObject({
                status: 'active', lifecycle_state: 'STABLE', accepting_assignments: true,
            });
            const original = PatientProfile.findOneAndUpdate.bind(PatientProfile);
            const spy = jest.spyOn(PatientProfile, 'findOneAndUpdate').mockImplementationOnce((async (...args: any[]) => {
                const updated = await original(...args);
                await User.updateOne({ _id: secondaryDoctorUser._id }, {
                    $set: { 'doctor_operation_lock.expires_at': new Date(Date.now() - 1_000) },
                });
                return updated as any;
            }) as any);
            try {
                const response = await api.put(`/api/admin/patients/${baselinePatientUser._id}`, {
                    assigned_doctor_id: secondaryDoctorUser.login_id,
                    demographics: { name: 'Committed Generic Reassignment' },
                }, { headers: { Authorization: `Bearer ${adminToken}` } });

                expect(response.status).toBe(200);
                const after = await PatientProfile.findById(baselinePatientUser.profile_id).lean();
                expect(String(after?.assigned_doctor_id)).toBe(String(secondaryDoctorUser._id));
                expect(after?.demographics?.name).toBe('Committed Generic Reassignment');
                const reassignmentNotification = await Notification.findOne({
                    user_id: baselinePatientUser._id,
                    'data.change_type': 'DOCTOR_REASSIGNED',
                }).lean();
                expect(reassignmentNotification).toBeTruthy();
                expect(await NotificationDelivery.exists({
                    notification_id: reassignmentNotification?._id,
                })).toBeTruthy();
                expect(await AuditLog.exists({
                    action: AuditAction.PATIENT_REASSIGN,
                    resource_id: String(baselinePatientUser.profile_id),
                    success: true,
                })).toBeTruthy();
            } finally {
                spy.mockRestore();
                await PatientProfile.updateOne({ _id: baselinePatientUser.profile_id }, {
                    $set: {
                        assigned_doctor_id: primaryDoctorUser._id,
                        'demographics.name': 'Baseline Patient',
                    },
                });
            }
        });

        test('generic patient update rejects reassignment combined with account or password mutation', async () => {
            const beforeUser = await User.findById(baselinePatientUser._id).select('+password').lean();
            const beforeProfile = await PatientProfile.findById(baselinePatientUser.profile_id).lean();

            const accountResponse = await api.put(`/api/admin/patients/${baselinePatientUser._id}`, {
                assigned_doctor_id: secondaryDoctorUser.login_id,
                is_active: false,
            }, { headers: { Authorization: `Bearer ${adminToken}` } });
            expect(accountResponse.status).toBe(409);
            expect(accountResponse.data.message).toMatch(/submit them separately/i);

            const passwordResponse = await api.put(`/api/admin/patients/${baselinePatientUser._id}`, {
                assigned_doctor_id: secondaryDoctorUser.login_id,
                password: 'SeparateMutation@456',
            }, { headers: { Authorization: `Bearer ${adminToken}` } });
            expect(passwordResponse.status).toBe(409);

            const sameDoctorPassword = await api.put(`/api/admin/patients/${baselinePatientUser._id}`, {
                assigned_doctor_id: primaryDoctorUser.login_id,
                password: 'SameDoctorMustSeparate@456',
            }, { headers: { Authorization: `Bearer ${adminToken}` } });
            expect(sameDoctorPassword.status).toBe(409);

            const sameDoctorStatus = await api.put(`/api/admin/patients/${baselinePatientUser._id}`, {
                assigned_doctor_id: primaryDoctorUser.login_id,
                is_active: false,
            }, { headers: { Authorization: `Bearer ${adminToken}` } });
            expect(sameDoctorStatus.status).toBe(409);

            const [afterUser, afterProfile] = await Promise.all([
                User.findById(baselinePatientUser._id).select('+password').lean(),
                PatientProfile.findById(baselinePatientUser.profile_id).lean(),
            ]);
            expect(String(afterProfile?.assigned_doctor_id)).toBe(String(beforeProfile?.assigned_doctor_id));
            expect(afterUser?.is_active).toBe(beforeUser?.is_active);
            expect(afterUser?.password).toBe(beforeUser?.password);
            expect(afterUser?.security_version).toBe(beforeUser?.security_version);
        });

        test('does not terminalize a stale assignment after a successor stamps the target lifecycle fence', async () => {
            const original = PatientProfile.findOneAndUpdate.bind(PatientProfile);
            let successor: Awaited<ReturnType<typeof acquireDoctorMoveGuard>> | undefined;
            const spy = jest.spyOn(PatientProfile, 'findOneAndUpdate').mockImplementationOnce((async (...args: any[]) => {
                const updated = await original(...args);
                await User.updateOne({ _id: secondaryDoctorUser._id }, {
                    $set: { 'doctor_operation_lock.expires_at': new Date(Date.now() - 1_000) },
                });
                successor = await acquireDoctorMoveGuard(secondaryDoctorUser._id);
                await stampDoctorProfileFence(secondaryDoctorUser.profile_id, successor);
                return updated as any;
            }) as any);
            try {
                const response = await api.put(`/api/admin/patients/${baselinePatientUser._id}`, {
                    assigned_doctor_id: secondaryDoctorUser.login_id,
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(response.status).toBe(409);

                await DoctorProfile.updateOne(
                    { _id: secondaryDoctorUser.profile_id, doctor_operation_fence: successor!.fenceToken },
                    { $set: { hospital_id: secondaryHospital._id } },
                );
                const patientAfter = await PatientProfile.findById(baselinePatientUser.profile_id).lean();
                expect(patientAfter?.assigned_doctor_id).toBeUndefined();
                expect(patientAfter?.account_status).toBe('AssignmentConflict');
            } finally {
                spy.mockRestore();
                if (successor) await successor.release();
                await Promise.all([
                    DoctorProfile.updateOne({ _id: secondaryDoctorUser.profile_id }, {
                        $set: { hospital_id: primaryHospital._id },
                    }),
                    PatientProfile.updateOne({ _id: baselinePatientUser.profile_id }, {
                        $set: {
                            assigned_doctor_id: primaryDoctorUser._id,
                            account_status: 'Active',
                        },
                        $unset: { assignment_conflict: 1 },
                    }),
                ]);
            }
        });

        test('reconciles assignment-conflict metadata only with a guarded active assignment', async () => {
            await PatientProfile.updateOne({ _id: baselinePatientUser.profile_id }, {
                $unset: { assigned_doctor_id: 1 },
                $set: {
                    account_status: 'AssignmentConflict',
                    assignment_conflict: {
                        detected_at: new Date(), reason: 'test conflict',
                        attempted_doctor_id: secondaryDoctorUser._id,
                    },
                },
            });
            const response = await api.put(`/api/admin/patients/${baselinePatientUser._id}`, {
                assigned_doctor_id: primaryDoctorUser.login_id,
                account_status: 'Active',
            }, { headers: { Authorization: `Bearer ${adminToken}` } });
            expect(response.status).toBe(200);
            const after = await PatientProfile.findById(baselinePatientUser.profile_id).lean();
            expect(after?.account_status).toBe('Active');
            expect(after?.assignment_conflict).toBeUndefined();
            expect(String(after?.assigned_doctor_id)).toBe(String(primaryDoctorUser._id));
        });

        test('should quarantine rather than fabricate discharge when a committed target becomes invalid', async () => {
            const loginId = `FENCED_REASSIGN_${Date.now()}`;
            const patientProfile = await PatientProfile.create({
                assigned_doctor_id: primaryDoctorUser._id,
                hospital_id: primaryHospital._id,
                demographics: { name: 'Fenced Reassign', phone: '9000000066' },
            });
            const patientUser = await User.create({
                login_id: loginId, password: 'Patient@123', user_type: 'PATIENT', profile_id: patientProfile._id,
            });
            const originalFindOneAndUpdate = PatientProfile.findOneAndUpdate.bind(PatientProfile);
            let replacementGuard: Awaited<ReturnType<typeof acquireDoctorMoveGuard>> | undefined;
            const spy = jest.spyOn(PatientProfile, 'findOneAndUpdate').mockImplementationOnce((async (...args: any[]) => {
                await User.updateOne({ _id: secondaryDoctorUser._id }, {
                    $set: { 'doctor_operation_lock.expires_at': new Date(Date.now() - 1_000) },
                });
                replacementGuard = await acquireDoctorMoveGuard(secondaryDoctorUser._id);
                await DoctorProfile.updateOne(
                    { _id: secondaryDoctorUser.profile_id },
                    { $set: { hospital_id: secondaryHospital._id } },
                );
                const updated = await originalFindOneAndUpdate(...args);
                return updated as any;
            }) as any);
            try {
                const response = await api.put(`/api/admin/reassign/${loginId}`, {
                    new_doctor_id: secondaryDoctorUser.login_id,
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(response.status).toBe(409);
                const after = await PatientProfile.findById(patientUser.profile_id).lean();
                expect(after?.assigned_doctor_id).toBeUndefined();
                expect(after?.account_status).toBe('AssignmentConflict');
                expect(after?.assignment_conflict?.reason).toMatch(/lifecycle changed/i);
            } finally {
                spy.mockRestore();
                if (replacementGuard) {
                    await DoctorProfile.updateOne(
                        { _id: secondaryDoctorUser.profile_id },
                        { $set: { hospital_id: primaryHospital._id } },
                    );
                    await replacementGuard.release();
                }
                await Promise.all([
                    User.deleteOne({ _id: patientUser._id }),
                    PatientProfile.deleteOne({ _id: patientProfile._id }),
                ]);
            }
        });

        test('should retain a valid committed target and report success after the previous doctor moves tenants', async () => {
            const previousProfile = await DoctorProfile.create({
                name: 'Dr Previous Fence', hospital_id: primaryHospital._id,
            });
            const previousDoctor = await User.create({
                login_id: `previous-fence-${Date.now()}`, password: 'Doctor@123', user_type: 'DOCTOR',
                profile_id: previousProfile._id, is_active: true,
            });
            const patientProfile = await PatientProfile.create({
                assigned_doctor_id: previousDoctor._id, hospital_id: primaryHospital._id,
                demographics: { name: 'Previous Fence Patient', phone: '9000000065' },
            });
            const patientUser = await User.create({
                login_id: `PREVIOUS_FENCE_${Date.now()}`, password: 'Patient@123', user_type: 'PATIENT',
                profile_id: patientProfile._id,
            });
            const original = PatientProfile.findOneAndUpdate.bind(PatientProfile);
            let successor: Awaited<ReturnType<typeof acquireDoctorMoveGuard>> | undefined;
            const spy = jest.spyOn(PatientProfile, 'findOneAndUpdate').mockImplementationOnce((async (...args: any[]) => {
                const updated = await original(...args);
                await User.updateOne({ _id: previousDoctor._id }, {
                    $set: { 'doctor_operation_lock.expires_at': new Date(Date.now() - 1_000) },
                });
                successor = await acquireDoctorMoveGuard(previousDoctor._id);
                await stampDoctorProfileFence(previousProfile._id, successor);
                await DoctorProfile.updateOne(
                    { _id: previousProfile._id, doctor_operation_fence: successor.fenceToken },
                    { $set: { hospital_id: secondaryHospital._id } },
                );
                return updated as any;
            }) as any);
            try {
                const response = await api.put(`/api/admin/reassign/${patientUser.login_id}`, {
                    new_doctor_id: secondaryDoctorUser.login_id,
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(response.status).toBe(200);
                const after = await PatientProfile.findById(patientProfile._id).lean();
                expect(String(after?.assigned_doctor_id)).toBe(secondaryDoctorUser._id.toString());
                expect(after?.account_status).toBe('Active');
                expect(String((await DoctorProfile.findById(previousProfile._id).lean())?.hospital_id))
                    .toBe(secondaryHospital._id.toString());
            } finally {
                spy.mockRestore();
                if (successor) await successor.release();
                await Promise.all([
                    User.deleteMany({ _id: { $in: [previousDoctor._id, patientUser._id] } }),
                    DoctorProfile.deleteOne({ _id: previousProfile._id }),
                    PatientProfile.deleteOne({ _id: patientProfile._id }),
                ]);
            }
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

        test('should reject cross-hospital reassignment without moving the patient tenant', async () => {
            const before = await PatientProfile.findById(baselinePatientUser.profile_id).lean();
            const response = await api.put('/api/admin/reassign/PAT_ADMIN_BASE', {
                new_doctor_id: crossTenantDoctorUser.login_id,
            }, { headers: { Authorization: `Bearer ${adminToken}` } });

            expect(response.status).toBe(403);
            const after = await PatientProfile.findById(baselinePatientUser.profile_id).lean();
            expect(String(after?.hospital_id)).toBe(String(before?.hospital_id));
            expect(String(after?.assigned_doctor_id)).toBe(String(before?.assigned_doctor_id));
        });

        test('should reject reactivation while patient file purge owns the lifecycle fence', async () => {
            const profile = await PatientProfile.create({
                assigned_doctor_id: primaryDoctorUser._id,
                hospital_id: primaryHospital._id,
                demographics: { name: 'Purging Reactivation Patient', phone: '9000000098' },
                account_status: 'Discharged',
                file_purge: {
                    state: 'PURGING',
                    execution_id: 'purge-reactivation-test',
                    lease_expires_at: new Date(Date.now() + 60_000),
                    started_at: new Date(),
                },
            });
            const user = await User.create({
                login_id: `purging-reactivation-${Date.now()}`,
                password: 'Patient@123',
                user_type: 'PATIENT',
                profile_id: profile._id,
                is_active: false,
            });

            const response = await api.put(`/api/admin/patients/${user._id}`, {
                account_status: 'Active',
                is_active: true,
            }, { headers: { Authorization: `Bearer ${adminToken}` } });

            expect(response.status).toBe(409);
            expect((await User.findById(user._id).lean())?.is_active).toBe(false);
            expect((await PatientProfile.findById(profile._id).lean())?.account_status).toBe('Discharged');
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

        test('should invalidate active sessions after doctor deactivation', async () => {
            const profile = await DoctorProfile.create({
                name: 'Deactivate Session Doctor',
                department: 'Cardiology',
                contact_number: '9000000091',
                hospital_id: primaryHospital._id,
                phone_verification: {
                    status: 'VERIFIED',
                    verified_at: new Date(),
                },
            });
            const target = await User.create({
                login_id: 'doctor_disable_session',
                password: 'Doctor@789',
                user_type: 'DOCTOR',
                profile_id: profile._id,
                is_active: true,
            });

            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'doctor_disable_session',
                password: 'Doctor@789',
            });
            expect(loginResponse.status).toBe(200);
            const token = loginResponse.data.data.token;
            const refreshToken = loginResponse.data.data.refresh_token;
            const sessionId = loginResponse.data.data.session.session_id;

            const deactivateResponse = await api.delete(`/api/admin/doctors/${target._id.toString()}`, {
                headers: { Authorization: `Bearer ${adminToken}` },
            });
            expect(deactivateResponse.status).toBe(200);
            expect(deactivateResponse.data.data.invalidated_sessions).toBeGreaterThanOrEqual(1);

            const meResponse = await api.get('/api/auth/me', {
                headers: { Authorization: `Bearer ${token}` },
            });
            expect([401, 403]).toContain(meResponse.status);

            const refreshResponse = await api.post('/api/auth/refresh', {
                refresh_token: refreshToken,
            });
            expect(refreshResponse.status).toBe(401);

            const session = await AuthSession.findById(sessionId).lean();
            expect(session?.revoked_at).toBeDefined();
            expect(session?.revoked_reason).toBe('ACCOUNT_DISABLED');
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
            expect(response.data.data.status).toBe('healthy');
            expect(response.data.data.database).toBeDefined();
            expect(response.data.data.memory).toBeUndefined();
            expect(response.data.data.database.host).toBeUndefined();
            expect(response.data.data.database.name).toBeUndefined();
        });

        test('should redact database connection details from hospital-admin health responses', async () => {
            const response = await api.get('/api/admin/system/health', {
                headers: { Authorization: `Bearer ${hospitalAdminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.data.database.host).toBeUndefined();
            expect(response.data.data.database.name).toBeUndefined();
            expect(response.data.data.memory).toBeUndefined();
        });

        test('should return aggregated hospital user counts and support status changes', async () => {
            const listResponse = await api.get('/api/admin/hospitals', {
                headers: { Authorization: `Bearer ${adminToken}` }
            });
            expect(listResponse.status).toBe(200);
            const primary = listResponse.data.data.hospitals.find((hospital: any) => hospital._id === primaryHospital._id.toString());
            const secondary = listResponse.data.data.hospitals.find((hospital: any) => hospital._id === secondaryHospital._id.toString());
            const [primaryDoctors, primaryPatients, secondaryDoctors, secondaryPatients] = await Promise.all([
                DoctorProfile.countDocuments({ hospital_id: primaryHospital._id }),
                PatientProfile.countDocuments({ hospital_id: primaryHospital._id }),
                DoctorProfile.countDocuments({ hospital_id: secondaryHospital._id }),
                PatientProfile.countDocuments({ hospital_id: secondaryHospital._id }),
            ]);
            expect(primary).toMatchObject({ doctors: primaryDoctors, patients: primaryPatients });
            expect(secondary).toMatchObject({ doctors: secondaryDoctors, patients: secondaryPatients });

            const hospital = await Hospital.create({
                code: 'P2_STATUS', name: 'P2 Status Hospital', location: 'Erode', admin_email: 'p2-status@example.com'
            });
            const suspend = await api.patch(`/api/admin/hospitals/${hospital._id}/status`, { status: 'suspended' }, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });
            expect(suspend.status).toBe(200);
            expect(suspend.data.data.hospital.status).toBe('suspended');

            const deactivate = await api.delete(`/api/admin/hospitals/${hospital._id}`, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });
            expect(deactivate.status).toBe(200);
            expect(deactivate.data.data.hospital.status).toBe('inactive');
        });

        test('should return the temporary password when reset audit persistence fails', async () => {
            const profile = await AdminProfile.create({ name: 'Audit Failure Reset' });
            const target = await User.create({
                login_id: `audit-reset-${Date.now()}`, password: 'AuditReset@123', user_type: 'ADMIN',
                profile_id: profile._id, is_active: true,
            });
            const spy = jest.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('audit store unavailable') as never);
            const response = await api.post('/api/admin/users/reset-password', {
                target_user_id: target._id.toString(),
            }, { headers: { Authorization: `Bearer ${adminToken}` } });
            spy.mockRestore();
            expect(response.status).toBe(200);
            expect(response.data.data.temporary_password).toBeDefined();
            expect(response.data.data.audit_recorded).toBe(false);
            expect((await User.findById(target._id).lean())?.must_change_password).toBe(true);
        });

        test('should allocate distinct default hospital codes under concurrent creation', async () => {
            const headers = { Authorization: `Bearer ${adminToken}` };
            const responses = await Promise.all([
                api.post('/api/admin/hospitals', {
                    name: 'Concurrent Hospital A', location: 'Chennai', admin_email: 'concurrent-a@example.com',
                }, { headers }),
                api.post('/api/admin/hospitals', {
                    name: 'Concurrent Hospital B', location: 'Chennai', admin_email: 'concurrent-b@example.com',
                }, { headers }),
            ]);

            expect(responses.map(response => response.status)).toEqual([201, 201]);
            const allocatedCodes = responses.map(response => response.data.data.hospital.id);
            expect(new Set(allocatedCodes).size).toBe(2);
            expect(allocatedCodes.every(code => /^H\d{3,}$/.test(code))).toBe(true);
        });

        test('should require a billing period and generate each period only once', async () => {
            const before = await Invoice.countDocuments();
            const missingPeriod = await api.post('/api/admin/billing/invoices', {}, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });
            expect(missingPeriod.status).toBe(400);

            const response = await api.post('/api/admin/billing/invoices', { billing_period: '2030-01' }, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(response.status).toBe(201);
            expect(response.data.data.created).toBeGreaterThan(0);
            expect(await Invoice.countDocuments()).toBe(before + response.data.data.created);

            const retry = await api.post('/api/admin/billing/invoices', { billing_period: '2030-01' }, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });
            expect(retry.status).toBe(201);
            expect(retry.data.data.created).toBe(0);
            expect(retry.data.data.already_existing).toBe(response.data.data.created);
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

        test('should not expose global admin metadata in hospital admin user listing', async () => {
            const fullUserRead = jest.spyOn(User, 'find');
            try {
                const response = await api.get('/api/admin/users', {
                    headers: { Authorization: `Bearer ${hospitalAdminToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.success).toBe(true);
                expect(fullUserRead).not.toHaveBeenCalled();
                const loginIds = response.data.data.users.map((user: any) => user.loginId);
                expect(loginIds).toContain('hospital_admin_a');
                expect(loginIds).toContain(primaryDoctorUser.login_id);
                expect(loginIds).toContain(baselinePatientUser.login_id);
                expect(loginIds).not.toContain(adminUser.login_id);
                expect(loginIds).not.toContain(crossTenantDoctorUser.login_id);
                expect(loginIds).not.toContain(crossTenantPatientUser.login_id);
            } finally {
                fullUserRead.mockRestore();
            }
        });

        test('should scope legacy patient listing to hospital admin tenant', async () => {
            const response = await api.get('/api/admin/legacy/patients', {
                headers: { Authorization: `Bearer ${hospitalAdminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            const loginIds = response.data.data.patients.map((patient: any) => patient.login_id);
            expect(loginIds).toContain(baselinePatientUser.login_id);
            expect(loginIds).not.toContain(crossTenantPatientUser.login_id);
        });

        test('should deny hospital admin legacy patient detail across tenants', async () => {
            const response = await api.get(`/api/admin/legacy/patient/${crossTenantPatientUser.login_id}`, {
                headers: { Authorization: `Bearer ${hospitalAdminToken}` }
            });

            expect(response.status).toBe(403);
            expect(response.data.success).toBe(false);
            expect(response.data.message).toContain('Cross-tenant');
        });

        test('should deny hospital admin legacy doctor detail across tenants', async () => {
            const response = await api.get(`/api/admin/legacy/doctor/${crossTenantDoctorUser._id.toString()}`, {
                headers: { Authorization: `Bearer ${hospitalAdminToken}` }
            });

            expect(response.status).toBe(403);
            expect(response.data.success).toBe(false);
            expect(response.data.message).toContain('Cross-tenant');
        });

        test('should prevent hospital admin password reset across tenants', async () => {
            const response = await api.post('/api/admin/users/reset-password', {
                target_user_id: crossTenantPatientUser._id.toString(),
                new_password: 'CrossTenant@123'
            }, {
                headers: { Authorization: `Bearer ${hospitalAdminToken}` }
            });

            expect(response.status).toBe(403);
            expect(response.data.success).toBe(false);
            expect(response.data.message).toContain('Cross-tenant');
        });

        test('should scope hospital admin audit logs to same-tenant users', async () => {
            await AuditLog.create([
                {
                    user_id: baselinePatientUser._id,
                    user_type: 'PATIENT',
                    action: AuditAction.PROFILE_UPDATE,
                    description: 'Tenant A patient update',
                    success: true
                },
                {
                    user_id: crossTenantPatientUser._id,
                    user_type: 'PATIENT',
                    action: AuditAction.PROFILE_UPDATE,
                    description: 'Tenant B patient update',
                    success: true
                }
            ]);

            const response = await api.get('/api/admin/audit-logs?page=1&limit=50', {
                headers: { Authorization: `Bearer ${hospitalAdminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            const userIds = response.data.data.logs.map((log: any) => log.user_id?._id ?? log.user_id).map(String);
            expect(userIds).toContain(baselinePatientUser._id.toString());
            expect(userIds).not.toContain(crossTenantPatientUser._id.toString());
        });

        test('should scope hospital admin broadcasts to same-tenant patients', async () => {
            await Notification.deleteMany({
                user_id: { $in: [baselinePatientUser._id, crossTenantPatientUser._id] },
                title: 'Tenant scoped notice'
            });

            const response = await api.post('/api/admin/notifications/broadcast', {
                title: 'Tenant scoped notice',
                message: 'Visible only inside tenant A',
                target: 'PATIENTS',
                priority: 'MEDIUM'
            }, {
                headers: { Authorization: `Bearer ${hospitalAdminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.recipients).toBeGreaterThanOrEqual(1);

            const sameTenantNotice = await Notification.findOne({
                user_id: baselinePatientUser._id,
                title: 'Tenant scoped notice'
            });
            const crossTenantNotice = await Notification.findOne({
                user_id: crossTenantPatientUser._id,
                title: 'Tenant scoped notice'
            });

            expect(response.data.data.push_outbox_persisted).toBe(response.data.data.created);
            expect(await NotificationDelivery.exists({ notification_id: sameTenantNotice?._id })).toBeTruthy();

            expect(sameTenantNotice).toBeTruthy();
            expect(crossTenantNotice).toBeNull();
        });

        test('does not persist a broadcast when notifications pause after recipient resolution', async () => {
            const title = `Pre-persist paused broadcast ${Date.now()}`;
            const featureSpy = jest.spyOn(configService, 'isFeatureEnabled')
                .mockResolvedValueOnce(true)
                .mockResolvedValue(false);
            try {
                const response = await api.post('/api/admin/notifications/broadcast', {
                    title,
                    message: 'Must not be persisted after the pause boundary',
                    target: 'PATIENTS',
                    priority: 'MEDIUM',
                }, { headers: { Authorization: `Bearer ${hospitalAdminToken}` } });
                expect(response.status).toBe(503);
                expect(await Notification.countDocuments({ title })).toBe(0);
                expect(await NotificationDelivery.countDocuments({ title })).toBe(0);
            } finally {
                featureSpy.mockRestore();
            }
        });

        test('retains persisted broadcast intent but suppresses SSE when pause begins before enqueue', async () => {
            const title = `Post-persist paused broadcast ${Date.now()}`;
            await configService.updateSystemConfig({ feature_flags: { notifications_enabled: true } });
            const originalInsertMany = Notification.insertMany.bind(Notification);
            const insertSpy = jest.spyOn(Notification, 'insertMany').mockImplementationOnce((async (...args: any[]) => {
                const rows = await originalInsertMany(...args as any);
                await configService.updateSystemConfig({ feature_flags: { notifications_enabled: false } });
                return rows as any;
            }) as any);
            const rawPublish = jest.spyOn(realtimeNotifications, 'publishNotificationToUser');
            try {
                const response = await api.post('/api/admin/notifications/broadcast', {
                    title,
                    message: 'Persisted but not disclosed in realtime',
                    target: 'SPECIFIC',
                    user_ids: [String(baselinePatientUser._id)],
                    priority: 'MEDIUM',
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(response.status).toBe(200);
                const persisted = await Notification.findOne({ title }).lean();
                expect(persisted).toBeTruthy();
                expect(persisted?.push_delivery_required).toBe(true);
                expect(await NotificationDelivery.countDocuments({ notification_id: persisted?._id })).toBe(0);
                expect(rawPublish).not.toHaveBeenCalled();
            } finally {
                rawPublish.mockRestore();
                insertSpy.mockRestore();
                await configService.updateSystemConfig({ feature_flags: { notifications_enabled: true } });
            }
        });

        test('should let an App Admin replace an admin authenticator and revoke their sessions', async () => {
            const replacementProfile = await AdminProfile.create({
                name: 'Replacement MFA Admin',
                admin_role: AdminRole.HOSPITAL_ADMIN,
                hospital_id: primaryHospital._id,
            });
            const replacementUser = await User.create({
                login_id: 'replacement_mfa_admin',
                password: 'Admin@123',
                user_type: 'ADMIN',
                profile_id: replacementProfile._id,
                is_active: true,
            });
            const session = await AuthSession.create({
                user_id: replacementUser._id,
                user_type: 'ADMIN',
                access_token_id: `mfa-reset-access-${replacementUser._id}`,
                refresh_token_hash: `mfa-reset-refresh-${replacementUser._id}`,
                expires_at: new Date(Date.now() + 60_000),
            });

            const response = await api.post(
                `/api/admin/users/${replacementUser._id}/mfa/reset`,
                {},
                { headers: { Authorization: `Bearer ${adminToken}` } }
            );

            expect(response.status).toBe(200);
            expect(response.data.data.factor_type).toBe('AUTHENTICATOR_APP');
            expect(response.data.data.setup.secret).toMatch(/^[A-Z2-7]+$/);
            expect(response.data.data.setup.otpauth_url).toContain('otpauth://totp/');
            expect(response.data.data.challenge_cleanup_completed).toBe(true);
            expect(response.data.data.audit_recorded).toBe(true);
            const mfaAudit: any = await AuditLog.findOne({
                action: 'MFA_RESET', resource_id: String(replacementUser._id), success: true,
            }).sort({ createdAt: -1 }).lean();
            expect(mfaAudit).toBeDefined();
            expect(mfaAudit.user_id.toString()).toBe(adminUser._id.toString());
            expect(mfaAudit.metadata.target_user_id).toBe(String(replacementUser._id));
            expect(JSON.stringify(mfaAudit)).not.toContain(response.data.data.setup.secret);
            expect(JSON.stringify(mfaAudit)).not.toContain(response.data.data.setup.otpauth_url);

            const updatedUser = await User.findById(replacementUser._id).lean();
            expect(updatedUser?.admin_mfa?.totp?.status).toBe('ENABLED');
            expect(updatedUser?.admin_mfa?.totp?.secret_ciphertext).toBeDefined();
            expect(updatedUser?.admin_mfa?.totp?.secret_ciphertext).not.toBe(response.data.data.setup.secret);

            const revokedSession = await AuthSession.findById(session._id).lean();
            expect(revokedSession?.revoked_reason).toBe('MFA_RESET');
            expect(revokedSession?.revoked_at).toBeDefined();
        });

        test('returns committed MFA recovery setup when physical session cleanup fails', async () => {
            const profile = await AdminProfile.create({
                name: 'MFA Cleanup Failure Admin',
                admin_role: AdminRole.HOSPITAL_ADMIN,
                hospital_id: primaryHospital._id,
            });
            const user = await User.create({
                login_id: `mfa_cleanup_failure_${Date.now()}`,
                password: 'Admin@123',
                user_type: 'ADMIN',
                profile_id: profile._id,
                is_active: true,
            });
            const session = await AuthSession.create({
                user_id: user._id,
                user_type: 'ADMIN',
                security_version: user.security_version,
                access_token_id: `mfa-cleanup-access-${user._id}`,
                refresh_token_hash: `mfa-cleanup-refresh-${user._id}`,
                expires_at: new Date(Date.now() + 60_000),
            });
            const cleanupSpy = jest.spyOn(AuthSession, 'updateMany').mockRejectedValueOnce(new Error('cleanup unavailable'));
            const auditSpy = jest.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('audit unavailable') as never);

            try {
                const response = await api.post(
                    `/api/admin/users/${user._id}/mfa/reset`,
                    {},
                    { headers: { Authorization: `Bearer ${adminToken}` } },
                );
                expect(response.status).toBe(200);
                expect(response.data.data.setup.secret).toMatch(/^[A-Z2-7]+$/);
                expect(response.data.data.revocation_cleanup_completed).toBe(false);
                expect(response.data.data.audit_recorded).toBe(false);

                const updatedUser = await User.findById(user._id).lean();
                expect(updatedUser?.security_version).toBeGreaterThan(Number(user.security_version || 0));
                expect(updatedUser?.admin_mfa?.totp?.secret_ciphertext).toBeDefined();
                expect((await AuthSession.findById(session._id).lean())?.revoked_at).toBeUndefined();
                expect(await findActiveSessionForAccessToken({
                    sessionId: String(session._id),
                    tokenId: session.access_token_id,
                    userId: String(user._id),
                    userType: 'ADMIN' as any,
                    securityVersion: Number(updatedUser?.security_version || 0),
                })).toBeNull();
            } finally {
                cleanupSpy.mockRestore();
                auditSpy.mockRestore();
                await Promise.all([
                    AuthSession.deleteMany({ user_id: user._id }),
                    User.deleteOne({ _id: user._id }),
                    AdminProfile.deleteOne({ _id: profile._id }),
                ]);
            }
        });

        test('returns the committed MFA recovery secret when post-commit user enrichment fails', async () => {
            const profile = await AdminProfile.create({
                name: 'MFA Enrichment Failure Admin',
                admin_role: AdminRole.HOSPITAL_ADMIN,
                hospital_id: primaryHospital._id,
            });
            const user = await User.create({
                login_id: `mfa_enrichment_failure_${Date.now()}`,
                password: 'Admin@123',
                user_type: 'ADMIN',
                profile_id: profile._id,
                is_active: true,
            });
            const originalSecurityVersion = Number(user.security_version || 0);
            const originalFactorGeneration = Number(user.admin_mfa?.totp?.factor_generation || 0);
            const oldChallenge = await AdminMfaChallenge.create({
                user_id: user._id,
                user_type: 'ADMIN',
                status: 'PENDING',
                expires_at: new Date(Date.now() + 60_000),
                max_attempts: 5,
                factor_generation: originalFactorGeneration,
                security_version: originalSecurityVersion,
            });
            const oldSession = await AuthSession.create({
                user_id: user._id,
                user_type: 'ADMIN',
                security_version: originalSecurityVersion,
                access_token_id: `mfa-enrichment-access-${user._id}`,
                refresh_token_hash: `mfa-enrichment-refresh-${user._id}`,
                expires_at: new Date(Date.now() + 60_000),
            });

            const originalFindById = User.findById.bind(User);
            let targetReads = 0;
            const enrichmentSpy = jest.spyOn(User, 'findById').mockImplementation(((id: any, ...args: any[]) => {
                if (String(id) === String(user._id)) {
                    targetReads += 1;
                    if (targetReads === 2) {
                        return {
                            populate: jest.fn().mockRejectedValue(new Error('response enrichment unavailable')),
                        } as any;
                    }
                }
                return originalFindById(id, ...args) as any;
            }) as any);

            let response: any;
            try {
                response = await api.post(
                    `/api/admin/users/${user._id}/mfa/reset`,
                    {},
                    { headers: { Authorization: `Bearer ${adminToken}` } },
                );
            } finally {
                enrichmentSpy.mockRestore();
            }

            try {
                expect(response.status).toBe(200);
                expect(response.data.data.setup.secret).toMatch(/^[A-Z2-7]+$/);
                expect(response.data.data.user_enrichment_completed).toBe(false);

                const updatedUser: any = await User.findById(user._id);
                expect(updatedUser.security_version).toBe(originalSecurityVersion + 1);
                expect(updatedUser.admin_mfa.totp.factor_generation).toBe(originalFactorGeneration + 1);
                expect((await AuthSession.findById(oldSession._id).lean())?.revoked_reason).toBe('MFA_RESET');
                expect((await AdminMfaChallenge.findById(oldChallenge._id).lean())?.status).toBe('CANCELLED');
                await expect(verifyAdminMfaLoginChallenge(
                    String(oldChallenge._id),
                    generateTotpCode(response.data.data.setup.secret),
                )).rejects.toBeDefined();

                const newChallenge = await createAdminMfaLoginChallenge(updatedUser);
                const verified = await verifyAdminMfaLoginChallenge(
                    String(newChallenge._id),
                    generateTotpCode(response.data.data.setup.secret),
                );
                expect(String(verified._id)).toBe(String(user._id));
            } finally {
                await Promise.all([
                    AdminMfaChallenge.deleteMany({ user_id: user._id }),
                    AuthSession.deleteMany({ user_id: user._id }),
                    User.deleteOne({ _id: user._id }),
                    AdminProfile.deleteOne({ _id: profile._id }),
                ]);
            }
        });

        test('returns committed batch temporary password when physical session cleanup fails', async () => {
            const profile = await PatientProfile.create({
                hospital_id: primaryHospital._id,
                assigned_doctor_id: primaryDoctorUser._id,
                demographics: {
                    name: 'Batch Cleanup Failure Patient',
                    phone: '9333333399',
                    phone_verification: { status: 'VERIFIED', verified_at: new Date() },
                },
            });
            const user = await User.create({
                login_id: `batch_cleanup_${Date.now()}`,
                password: 'Patient@123',
                user_type: 'PATIENT',
                profile_id: profile._id,
                is_active: true,
            });
            const session = await AuthSession.create({
                user_id: user._id,
                user_type: 'PATIENT',
                security_version: user.security_version,
                access_token_id: `batch-cleanup-access-${user._id}`,
                refresh_token_hash: `batch-cleanup-refresh-${user._id}`,
                expires_at: new Date(Date.now() + 60_000),
            });
            const cleanupSpy = jest.spyOn(AuthSession, 'updateMany').mockRejectedValueOnce(new Error('cleanup unavailable'));

            try {
                const response = await api.post('/api/admin/users/batch', {
                    operation: 'reset_password',
                    user_ids: [String(user._id)],
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(response.status).toBe(200);
                expect(response.data.data.successful).toBe(1);
                const result = response.data.data.results[0];
                expect(result.success).toBe(true);
                expect(result.temporary_password).toBeDefined();
                expect(result.revocation_cleanup_completed).toBe(false);

                const login = await api.post('/api/auth/login', {
                    login_id: user.login_id,
                    password: result.temporary_password,
                });
                expect(login.status).toBe(200);
                const updatedUser = await User.findById(user._id).lean();
                expect(await findActiveSessionForAccessToken({
                    sessionId: String(session._id),
                    tokenId: session.access_token_id,
                    userId: String(user._id),
                    userType: 'PATIENT' as any,
                    securityVersion: Number(updatedUser?.security_version || 0),
                })).toBeNull();
            } finally {
                cleanupSpy.mockRestore();
                await Promise.all([
                    AuthSession.deleteMany({ user_id: user._id }),
                    User.deleteOne({ _id: user._id }),
                    PatientProfile.deleteOne({ _id: profile._id }),
                ]);
            }
        });

        test('does not activate a tenant user while hospital suspension owns the lifecycle', async () => {
            await User.updateOne({ _id: baselinePatientUser._id }, { $set: { is_active: false } });
            const transition = await acquireHospitalTransitionGuard(primaryHospital._id, false);
            try {
                const response = await api.post('/api/admin/users/batch', {
                    operation: 'activate', user_ids: [String(baselinePatientUser._id)],
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(response.status).toBe(200);
                expect(response.data.data.successful).toBe(0);
                expect(response.data.data.results[0].message).toMatch(/lifecycle|active hospital/i);
                expect((await User.findById(baselinePatientUser._id).lean())?.is_active).toBe(false);
            } finally {
                await transition.release();
                await Hospital.updateOne({ _id: primaryHospital._id }, {
                    $set: { lifecycle_state: 'STABLE', accepting_assignments: true, status: 'active' },
                    $unset: { lifecycle_lock: 1 },
                });
                await User.updateOne({ _id: baselinePatientUser._id }, { $set: { is_active: true } });
            }
        });

        test('does not batch-activate a patient after purge has passed its inactivity check', async () => {
            const profile = await PatientProfile.create({
                hospital_id: primaryHospital._id,
                demographics: { name: 'Batch Purge Fence Patient' },
                account_status: 'Discharged',
            });
            const user = await User.create({
                login_id: `batch-purge-fence-${Date.now()}`,
                password: 'Patient@123',
                user_type: 'PATIENT',
                profile_id: profile._id,
                is_active: false,
            });
            await FileAsset.create({
                hospital_id: primaryHospital._id,
                owner_user_id: user._id,
                patient_profile_id: profile._id,
                purpose: 'INR_REPORT',
                storage_provider: 'S3_COMPATIBLE',
                bucket: 'test-bucket',
                object_key: `purge/batch-activation-race-${Date.now()}.pdf`,
                original_filename: 'race.pdf',
                detected_mime: 'application/pdf',
                byte_size: 10,
                sha256_checksum: 'd'.repeat(64),
                status: 'ACTIVE',
                created_by: user._id,
            });

            let allowDeletion!: () => void;
            let deletionStarted!: () => void;
            const started = new Promise<void>(resolve => { deletionStarted = resolve; });
            (purgeFilePermanently as jest.Mock).mockImplementationOnce(() => new Promise<void>(resolve => {
                allowDeletion = resolve;
                deletionStarted();
            }));

            const purge = purgePatientFileAssets({ patientProfileId: profile._id, ownerUserId: user._id });
            try {
                await started;
                const response = await api.post('/api/admin/users/batch', {
                    operation: 'activate', user_ids: [String(user._id)],
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(response.status).toBe(200);
                expect(response.data.data.successful).toBe(0);
                expect((await User.findById(user._id).lean())?.is_active).toBe(false);
                allowDeletion();
                await expect(purge).resolves.toMatchObject({ failures: 0 });
            } finally {
                allowDeletion?.();
                await purge.catch(() => undefined);
                await Promise.all([
                    FileAsset.deleteMany({ patient_profile_id: profile._id }),
                    User.deleteOne({ _id: user._id }),
                    PatientProfile.deleteOne({ _id: profile._id }),
                ]);
            }
        });

        test('compensates a batch activation that loses its hospital lease after commit', async () => {
            await User.updateOne({ _id: baselinePatientUser._id }, { $set: { is_active: false } });
            const originalFindOneAndUpdate = User.findOneAndUpdate.bind(User);
            const spy = jest.spyOn(User, 'findOneAndUpdate').mockImplementation((async (filter: any, update: any, ...rest: any[]) => {
                const result = await originalFindOneAndUpdate(filter, update, ...rest as any);
                if (String(filter?._id) === String(baselinePatientUser._id) && update?.$set?.is_active === true) {
                    await Hospital.updateOne({ _id: primaryHospital._id }, {
                        $set: { 'lifecycle_lock.expires_at': new Date(Date.now() - 1_000) },
                    });
                }
                return result as any;
            }) as any);
            try {
                const response = await api.post('/api/admin/users/batch', {
                    operation: 'activate', user_ids: [String(baselinePatientUser._id)],
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(response.status).toBe(200);
                expect(response.data.data.successful).toBe(0);
                expect((await User.findById(baselinePatientUser._id).lean())?.is_active).toBe(false);
            } finally {
                spy.mockRestore();
                await Hospital.updateOne({ _id: primaryHospital._id }, {
                    $set: { lifecycle_state: 'STABLE', accepting_assignments: true, status: 'active' },
                    $unset: { lifecycle_lock: 1 },
                });
                await User.updateOne({ _id: baselinePatientUser._id }, { $set: { is_active: true } });
            }
        });

        test.each([
            ['doctor', () => primaryDoctorUser, (id: string) => `/api/admin/doctors/${id}`],
            ['patient', () => baselinePatientUser, (id: string) => `/api/admin/patients/${id}`],
        ])('keeps a %s inactive when password activation loses its hospital lease after credential commit', async (_kind, getTarget, endpoint) => {
            const target: any = getTarget();
            await User.updateOne({ _id: target._id }, { $set: { is_active: false } });
            const before = await User.findById(target._id).lean();
            const originalFindOneAndUpdate = User.findOneAndUpdate.bind(User);
            const spy = jest.spyOn(User, 'findOneAndUpdate').mockImplementation(((filter: any, update: any, ...rest: any[]) => {
                const query: any = originalFindOneAndUpdate(filter, update, ...rest as any);
                if (String(filter?._id) !== String(target._id) || update?.$inc?.security_version !== 1) return query;
                const originalSelect = query.select.bind(query);
                query.select = (...selectArgs: any[]) => originalSelect(...selectArgs).then(async (result: any) => {
                    await Hospital.updateOne({ _id: primaryHospital._id }, {
                        $set: { 'lifecycle_lock.expires_at': new Date(Date.now() - 1_000) },
                    });
                    return result;
                });
                return query;
            }) as any);
            try {
                const response = await api.put(endpoint(String(target._id)), {
                    is_active: true,
                    password: `LeaseLost@${_kind === 'doctor' ? '456' : '789'}`,
                }, { headers: { Authorization: `Bearer ${adminToken}` } });
                expect(response.status).toBe(409);
                const after = await User.findById(target._id).lean();
                expect(after?.is_active).toBe(false);
                expect(Number(after?.security_version)).toBe(Number(before?.security_version || 0) + 1);
            } finally {
                spy.mockRestore();
                await Hospital.updateOne({ _id: primaryHospital._id }, {
                    $set: { lifecycle_state: 'STABLE', accepting_assignments: true, status: 'active' },
                    $unset: { lifecycle_lock: 1 },
                });
                await User.updateOne({ _id: target._id }, { $set: { is_active: true } });
            }
        });

        test('should deactivate hospital users and revoke access when a hospital is suspended', async () => {
            const suspensionPatientProfile = await PatientProfile.create({
                assigned_doctor_id: primaryDoctorUser._id,
                hospital_id: primaryHospital._id,
                demographics: {
                    name: 'Suspension Test Patient',
                    age: 55,
                    gender: 'Female',
                    phone: '9222222222',
                    phone_verification: {
                        status: 'VERIFIED',
                        verified_at: new Date(),
                    },
                },
            });
            const suspensionPatientUser = await User.create({
                login_id: 'suspension_test_patient',
                password: 'Patient@123',
                user_type: 'PATIENT',
                profile_id: suspensionPatientProfile._id,
                is_active: true,
            });
            const patientLogin = await api.post('/api/auth/login', {
                login_id: suspensionPatientUser.login_id,
                password: 'Patient@123',
            });
            expect(patientLogin.status).toBe(200);

            const suspendResponse = await api.patch(
                `/api/admin/hospitals/${primaryHospital._id}/status`,
                { status: 'suspended' },
                { headers: { Authorization: `Bearer ${adminToken}` } }
            );

            expect(suspendResponse.status).toBe(200);
            expect(suspendResponse.data.data.hospital.status).toBe('suspended');
            expect(suspendResponse.data.data.users_deactivated).toBeGreaterThanOrEqual(1);
            expect(suspendResponse.data.data.invalidated_sessions).toBeGreaterThanOrEqual(2);

            const [patient, hospitalAdmin] = await Promise.all([
                User.findById(suspensionPatientUser._id).lean(),
                User.findOne({ login_id: 'hospital_admin_a' }).lean(),
            ]);
            expect(patient?.is_active).toBe(false);
            expect(hospitalAdmin?.is_active).toBe(false);

            const existingPatientSession = await api.get('/api/patient/profile', {
                headers: { Authorization: `Bearer ${patientLogin.data.data.token}` },
            });
            expect([401, 403]).toContain(existingPatientSession.status);

            const existingHospitalAdminSession = await api.get('/api/admin/users', {
                headers: { Authorization: `Bearer ${hospitalAdminToken}` },
            });
            expect([401, 403]).toContain(existingHospitalAdminSession.status);

            await User.findByIdAndUpdate(suspensionPatientUser._id, { $set: { is_active: true } });
            const reactivatedUserLogin = await api.post('/api/auth/login', {
                login_id: suspensionPatientUser.login_id,
                password: 'Patient@123',
            });
            expect(reactivatedUserLogin.status).toBe(401);
            expect(reactivatedUserLogin.data.message).toBe('Invalid credentials');
        });
    });
});
