import axios, { AxiosInstance } from 'axios';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import mongoose from 'mongoose';
import app from '@alias/app';
import { AdminProfile, AuthSession, DoctorProfile, PatientProfile, User, Hospital, Notification, AuditLog, Invoice } from '@alias/models';
import { AdminRole } from '@alias/models/adminprofile.model';
import { AuditAction } from '@alias/models/auditlog.model';
import { Server } from 'http';
import * as adminService from '@alias/services/admin.service';

describe('Admin Routes', () => {
    let mongoContainer: StartedTestContainer;
    let server: Server;
    let api: AxiosInstance;
    let adminToken: string;
    let hospitalAdminToken: string;
    let auditorToken: string;
    let doctorToken: string;

    let adminUser: any;
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
        const hospitalAdminUser = await User.create({
            login_id: 'hospital_admin_a',
            password: 'Admin@123',
            user_type: 'ADMIN',
            profile_id: hospitalAdminProfile._id,
            is_active: true
        });

        const auditorProfile = await AdminProfile.create({
            name: 'Read-only Auditor',
            admin_role: AdminRole.AUDITOR,
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
        server.close();
    }, 120000);

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
            const response = await api.get('/api/admin/billing/invoices', {
                headers: { Authorization: `Bearer ${auditorToken}` },
            });
            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(Array.isArray(response.data.data.invoices)).toBe(true);
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

        test('should invalidate active sessions after doctor deactivation', async () => {
            const profile = await DoctorProfile.create({
                name: 'Deactivate Session Doctor',
                department: 'Cardiology',
                contact_number: '9000000091',
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
            expect(primary).toMatchObject({ doctors: 2, patients: 2 });
            expect(secondary).toMatchObject({ doctors: 1, patients: 1 });

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
            const response = await api.get('/api/admin/users', {
                headers: { Authorization: `Bearer ${hospitalAdminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            const loginIds = response.data.data.users.map((user: any) => user.loginId);
            expect(loginIds).toContain('hospital_admin_a');
            expect(loginIds).toContain(primaryDoctorUser.login_id);
            expect(loginIds).toContain(baselinePatientUser.login_id);
            expect(loginIds).not.toContain(adminUser.login_id);
            expect(loginIds).not.toContain(crossTenantDoctorUser.login_id);
            expect(loginIds).not.toContain(crossTenantPatientUser.login_id);
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

            expect(sameTenantNotice).toBeTruthy();
            expect(crossTenantNotice).toBeNull();
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

            const updatedUser = await User.findById(replacementUser._id).lean();
            expect(updatedUser?.admin_mfa?.totp?.status).toBe('ENABLED');
            expect(updatedUser?.admin_mfa?.totp?.secret_ciphertext).toBeDefined();
            expect(updatedUser?.admin_mfa?.totp?.secret_ciphertext).not.toBe(response.data.data.setup.secret);

            const revokedSession = await AuthSession.findById(session._id).lean();
            expect(revokedSession?.revoked_reason).toBe('MFA_RESET');
            expect(revokedSession?.revoked_at).toBeDefined();
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
            expect(reactivatedUserLogin.status).toBe(403);
            expect(reactivatedUserLogin.data.message).toContain('Hospital is suspended');
        });
    });
});
