import axios, { AxiosInstance } from 'axios';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import mongoose from 'mongoose';
import app from '@alias/app';
import { User, DoctorProfile, PatientProfile, Notification, Hospital } from '@alias/models';
import { NotificationType } from '@alias/models/notification.model';
import { Server } from 'http';
import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import client from '@alias/config/s3-client'
import { config } from '@alias/config'
import * as notificationDeliveryService from '@alias/services/notification-delivery.service'

describe('Doctor Routes', () => {
    let mongoContainer: StartedTestContainer;
    let server: Server;
    let api: AxiosInstance;
    let baseURL: string;
    let doctorToken: string;
    let doctorUser: any;
    let doctorProfile: any;
    let secondDoctorToken: string;
    let secondDoctorUser: any;
    let crossTenantDoctorUser: any;
    let patientUser: any;
    let patientProfile: any;
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
        baseURL = `http://localhost:${port}`;
        api = axios.create({ baseURL, validateStatus: () => true });

        primaryHospital = await Hospital.create({
            code: 'TENANT_A',
            name: 'Tenant A Hospital',
            location: 'Coimbatore',
            admin_email: 'admin-a@example.com'
        });

        secondaryHospital = await Hospital.create({
            code: 'TENANT_B',
            name: 'Tenant B Hospital',
            location: 'Chennai',
            admin_email: 'admin-b@example.com'
        });

        doctorProfile = await DoctorProfile.create({
            name: 'Dr. John Doe',
            department: 'Cardiology',
            contact_number: '1234567890',
            hospital_id: primaryHospital._id,
            phone_verification: {
                status: 'VERIFIED',
                verified_at: new Date()
            }
        });

        doctorUser = await User.create({
            login_id: 'doctor001',
            password: 'doctor123',
            user_type: 'DOCTOR',
            profile_id: doctorProfile._id,
            is_active: true
        });

        const secondDoctorProfile = await DoctorProfile.create({
            name: 'Dr. Jane Smith',
            department: 'Neurology',
            contact_number: '0987654321',
            hospital_id: primaryHospital._id,
            phone_verification: {
                status: 'VERIFIED',
                verified_at: new Date()
            }
        });

        secondDoctorUser = await User.create({
            login_id: 'doctor002',
            password: 'doctor456',
            user_type: 'DOCTOR',
            profile_id: secondDoctorProfile._id,
            is_active: true
        });

        const crossTenantDoctorProfile = await DoctorProfile.create({
            name: 'Dr. Other Tenant',
            department: 'Cardiology',
            contact_number: '0987654322',
            hospital_id: secondaryHospital._id,
            phone_verification: {
                status: 'VERIFIED',
                verified_at: new Date()
            }
        });

        crossTenantDoctorUser = await User.create({
            login_id: 'doctor003',
            password: 'doctor789',
            user_type: 'DOCTOR',
            profile_id: crossTenantDoctorProfile._id,
            is_active: true
        });

        patientProfile = await PatientProfile.create({
            assigned_doctor_id: doctorProfile._id,
            hospital_id: primaryHospital._id,
            demographics: {
                name: 'Test Patient',
                age: 45,
                gender: 'Male',
                phone: '9876543210',
                next_of_kin: {
                    name: 'Emergency Contact',
                    relation: 'Spouse',
                    phone: '9876543211'
                }
            },
            medical_config: {
                therapy_drug: 'Warfarin',
                therapy_start_date: new Date('2024-01-01'),
                target_inr: { min: 2.0, max: 3.0 }
            },
            weekly_dosage: {
                monday: 5,
                tuesday: 5,
                wednesday: 5,
                thursday: 5,
                friday: 5,
                saturday: 5,
                sunday: 5
            }
        });

        patientUser = await User.create({
            login_id: 'PAT001',
            password: '9876543210',
            user_type: 'PATIENT',
            profile_id: patientProfile._id,
            is_active: true
        });

        const doctorLoginResponse = await api.post('/api/auth/login', {
            login_id: 'doctor001',
            password: 'doctor123'
        });
        doctorToken = doctorLoginResponse.data.data.token;

        const secondDoctorLoginResponse = await api.post('/api/auth/login', {
            login_id: 'doctor002',
            password: 'doctor456'
        });
        secondDoctorToken = secondDoctorLoginResponse.data.data.token;
    }, 120000);

    afterAll(async () => {
        await mongoose.connection.dropDatabase();
        await mongoose.connection.close();
        await mongoContainer.stop();
        server.close();
    });

    describe('GET /api/doctors/patients', () => {
        test('should get all patients assigned to doctor', async () => {
            const response = await api.get('/api/doctors/patients', {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.patients).toBeDefined();
            expect(Array.isArray(response.data.data.patients)).toBe(true);
            expect(response.data.data.patients.length).toBeGreaterThan(0);
            expect(response.data.data.patients[0].login_id).toBe('PAT001');
        });

        test('should return empty array if doctor has no patients', async () => {
            const response = await api.get('/api/doctors/patients', {
                headers: { Authorization: `Bearer ${secondDoctorToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.patients).toBeDefined();
            expect(Array.isArray(response.data.data.patients)).toBe(true);
            expect(response.data.data.patients.length).toBe(0);
        });

        test('should fail closed when the requesting doctor has no hospital', async () => {
            await DoctorProfile.findByIdAndUpdate(doctorProfile._id, { $unset: { hospital_id: 1 } });
            const response = await api.get('/api/doctors/patients', {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });
            await DoctorProfile.findByIdAndUpdate(doctorProfile._id, { hospital_id: primaryHospital._id });

            expect(response.status).toBe(403);
            expect(response.data.message).toContain('assigned to a hospital');
        });

        test('should fail without authentication token', async () => {
            const response = await api.get('/api/doctors/patients');

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });

        test('should fail with invalid token', async () => {
            const response = await api.get('/api/doctors/patients', {
                headers: { Authorization: 'Bearer invalidtoken123' }
            });

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });
    });

    describe('GET /api/doctors/patients/:op_num', () => {
        test('should get specific patient by op_num', async () => {
            const response = await api.get('/api/doctors/patients/PAT001', {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.patient).toBeDefined();
            expect(response.data.data.patient.demographics.name).toBe('Test Patient');
        });

        test('should fail when assigned doctor and patient hospital differ', async () => {
            await PatientProfile.findByIdAndUpdate(patientProfile._id, { hospital_id: secondaryHospital._id });

            const response = await api.get('/api/doctors/patients/PAT001', {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(403);
            expect(response.data.success).toBe(false);
            expect(response.data.message).toContain('Cross-tenant');

            await PatientProfile.findByIdAndUpdate(patientProfile._id, { hospital_id: primaryHospital._id });
        });

        test('should fail with non-existent op_num', async () => {
            const response = await api.get('/api/doctors/patients/INVALID001', {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(404);
            expect(response.data.success).toBe(false);
            expect(response.data.message).toBe('Patient not found');
        });

        test('should fail without authentication', async () => {
            const response = await api.get('/api/doctors/patients/PAT001');

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });
    });

    describe('POST /api/doctors/patients', () => {
        test('should create new patient with all required fields', async () => {
            const newPatient = {
                name: 'New Patient',
                op_num: 'PAT002',
                age: 50,
                gender: 'Female',
                contact_no: '8888888888',
                target_inr_min: 2.5,
                target_inr_max: 3.5,
                therapy: 'Warfarin',
                therapy_start_date: '2024-01-15',
                prescription: {
                    monday: 4,
                    tuesday: 4,
                    wednesday: 4,
                    thursday: 4,
                    friday: 4,
                    saturday: 4,
                    sunday: 4
                },
                medical_history: [{
                    diagnosis: 'Atrial Fibrillation',
                    duration_value: 2,
                    duration_unit: 'Years'
                }],
                kin_name: 'Family Contact',
                kin_relation: 'Sibling',
                kin_contact_number: '7777777777'
            };

            const response = await api.post('/api/doctors/patients', newPatient, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(201);
            expect(response.data.success).toBe(true);
            expect(response.data.data.patient).toBeDefined();
            expect(response.data.data.patient.demographics.name).toBe('New Patient');
            expect(response.data.data.patient.demographics.phone_verification.status).toBe('PENDING');
            expect(response.data.data.patient.hospital_id).toBe(primaryHospital._id.toString());
        });

        test('should create patient with minimum required fields', async () => {
            const minimalPatient = {
                name: 'Minimal Patient',
                op_num: 'PAT003',
                gender: 'Male',
                contact_no: '7777777777',
                kin_contact_number: '6666666666'
            };

            const response = await api.post('/api/doctors/patients', minimalPatient, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(201);
            expect(response.data.success).toBe(true);
            expect(response.data.data.patient).toBeDefined();
        });

        test('should fail with duplicate op_num', async () => {
            const duplicatePatient = {
                name: 'Duplicate Patient',
                op_num: 'PAT001',
                gender: 'Male',
                contact_no: '5555555555',
                kin_contact_number: '4444444444'
            };

            const response = await api.post('/api/doctors/patients', duplicatePatient, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(409);
            expect(response.data.success).toBe(false);
            expect(response.data.message).toBe('Patient with this OP number already exists');
        });

        test('should fail with missing required field - name', async () => {
            const invalidPatient = {
                op_num: 'PAT004',
                gender: 'Male',
                contact_no: '3333333333',
                kin_contact_number: '2222222222'
            };

            const response = await api.post('/api/doctors/patients', invalidPatient, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should fail with missing required field - op_num', async () => {
            const invalidPatient = {
                name: 'No OP Patient',
                gender: 'Male',
                contact_no: '3333333333',
                kin_contact_number: '2222222222'
            };

            const response = await api.post('/api/doctors/patients', invalidPatient, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should fail with invalid gender', async () => {
            const invalidPatient = {
                name: 'Invalid Gender Patient',
                op_num: 'PAT005',
                gender: 'InvalidGender',
                contact_no: '3333333333',
                kin_contact_number: '2222222222'
            };

            const response = await api.post('/api/doctors/patients', invalidPatient, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should fail with invalid contact_no length', async () => {
            const invalidPatient = {
                name: 'Invalid Contact Patient',
                op_num: 'PAT006',
                gender: 'Male',
                contact_no: '123',
                kin_contact_number: '2222222222'
            };

            const response = await api.post('/api/doctors/patients', invalidPatient, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should fail with non-numeric contact_no', async () => {
            const invalidPatient = {
                name: 'Invalid Contact Patient',
                op_num: 'PAT006A',
                gender: 'Male',
                contact_no: '12345abcde',
                kin_contact_number: '2222222222'
            };

            const response = await api.post('/api/doctors/patients', invalidPatient, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should fail without authentication', async () => {
            const newPatient = {
                name: 'Unauthorized Patient',
                op_num: 'PAT007',
                gender: 'Male',
                contact_no: '1111111111',
                kin_contact_number: '0000000000'
            };

            const response = await api.post('/api/doctors/patients', newPatient);

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });
    });

    describe('PATCH /api/doctors/patients/:op_num/reassign', () => {
        test('should reassign patient to another doctor', async () => {
            const response = await api.patch('/api/doctors/patients/PAT001/reassign', {
                new_doctor_id: 'doctor002'
            }, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.patient).toBeDefined();

            const updatedPatient = await PatientProfile.findById(patientProfile._id);
            expect(updatedPatient.assigned_doctor_id.toString()).toBe(secondDoctorUser._id.toString());

            await PatientProfile.findByIdAndUpdate(patientProfile._id, {
                assigned_doctor_id: doctorProfile._id
            });
        });

        test('should fail when reassigning patient to a doctor in another hospital', async () => {
            const response = await api.patch('/api/doctors/patients/PAT001/reassign', {
                new_doctor_id: 'doctor003'
            }, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(403);
            expect(response.data.success).toBe(false);
            expect(response.data.message).toContain('Cross-tenant');
        });

        test('should fail with non-existent patient', async () => {
            const response = await api.patch('/api/doctors/patients/INVALID001/reassign', {
                new_doctor_id: 'doctor002'
            }, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(404);
            expect(response.data.success).toBe(false);
            expect(response.data.message).toBe('Patient not found');
        });

        test('should fail with non-existent target doctor', async () => {
            const response = await api.patch('/api/doctors/patients/PAT001/reassign', {
                new_doctor_id: 'invalid_doctor'
            }, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
            expect(response.data.message).toBe('Target doctor not found');
        });

        test('should fail without authentication', async () => {
            const response = await api.patch('/api/doctors/patients/PAT001/reassign', {
                new_doctor_id: 'doctor002'
            });

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });
    });

    describe('PUT /api/doctors/patients/:op_num/dosage', () => {
        test('should update patient dosage successfully', async () => {
            const newDosage = {
                monday: 6,
                tuesday: 6,
                wednesday: 6,
                thursday: 6,
                friday: 6,
                saturday: 6,
                sunday: 6
            };

            const response = await api.put('/api/doctors/patients/PAT001/dosage', {
                prescription: newDosage
            }, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.patient).toBeDefined();
            expect(response.data.data.patient.weekly_dosage.monday).toBe(6);

            const latestNotification = await Notification.findOne({
                user_id: patientUser._id,
                type: NotificationType.DOCTOR_UPDATE
            }).sort({ createdAt: -1 });
            expect(latestNotification).toBeDefined();
            expect(latestNotification?.title).toBe('Dosage updated');
        });

        test('should update partial dosage schedule', async () => {
            const partialDosage = {
                monday: 7,
                friday: 7
            };

            const response = await api.put('/api/doctors/patients/PAT001/dosage', {
                prescription: partialDosage
            }, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
        });

        test('should fail with non-existent patient', async () => {
            const response = await api.put('/api/doctors/patients/INVALID001/dosage', {
                prescription: { monday: 5 }
            }, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(404);
            expect(response.data.success).toBe(false);
            expect(response.data.message).toBe('Patient not found');
        });

        test('should fail without authentication', async () => {
            const response = await api.put('/api/doctors/patients/PAT001/dosage', {
                prescription: { monday: 5 }
            });

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });
    });

    describe('GET /api/doctors/patients/:op_num/reports', () => {
        test('should get patient INR reports with presigned URLs', async () => {
            // First add a report with file_url
            const patient = await PatientProfile.findById(patientProfile._id);
            patient.inr_history.push({
                test_date: new Date('2024-01-15'),
                inr_value: 2.5,
                is_critical: false,
                uploaded_at: new Date('2024-01-15T00:00:00.000Z'),
                file_url: 'uploads/test-report/12345.pdf',
                notes: 'Test report'
            });
            await patient.save();

            const response = await api.get('/api/doctors/patients/PAT001/reports', {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.inr_history).toBeDefined();
            expect(Array.isArray(response.data.data.inr_history)).toBe(true);

            // Verify that file_url is converted to presigned URL
            const reportWithFile = response.data.data.inr_history.find((r: any) => r.file_url);
            if (reportWithFile) {
                expect(reportWithFile.file_url).toContain('https://');
                expect(reportWithFile.file_url).toContain('X-Amz-Algorithm');
                expect(reportWithFile.file_url).toContain('X-Amz-Signature');
                // Should not be the raw S3 key
                expect(reportWithFile.file_url).not.toBe('uploads/test-report/12345.pdf');
            }
        });

        test('should fail with non-existent patient', async () => {
            const response = await api.get('/api/doctors/patients/INVALID001/reports', {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(404);
            expect(response.data.success).toBe(false);
        });

        test('should fail without authentication', async () => {
            const response = await api.get('/api/doctors/patients/PAT001/reports');

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });
    });

    describe('PUT /api/doctors/patients/:op_num/reports/:report_id', () => {
        let reportId: string;

        beforeAll(async () => {
            const patient = await PatientProfile.findById(patientProfile._id);
            patient.inr_history.push({
                test_date: new Date('2024-01-15'),
                inr_value: 2.5,
                is_critical: false,
                uploaded_at: new Date('2024-01-15T00:00:00.000Z'),
                file_url: 'test-file-url',
                notes: 'Initial test'
            });
            await patient.save();
            reportId = patient.inr_history[patient.inr_history.length - 1]._id.toString();
        });

        test('should update report notes', async () => {
            const response = await api.put(`/api/doctors/patients/PAT001/reports/${reportId}`, {
                notes: 'Updated notes for the report'
            }, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.report.notes).toBe('Updated notes for the report');
        });

        test('should keep a persisted report update successful when FCM delivery fails', async () => {
            const enqueueSpy = jest
                .spyOn(notificationDeliveryService, 'enqueueNotificationPush')
                .mockRejectedValueOnce(new Error('queue unavailable'));

            try {
                const response = await api.put(`/api/doctors/patients/PAT001/reports/${reportId}`, {
                    notes: 'Persist despite push failure'
                }, {
                    headers: { Authorization: `Bearer ${doctorToken}` }
                });

                expect(response.status).toBe(200);
                expect(enqueueSpy).toHaveBeenCalled();
                const persistedPatient = await PatientProfile.findById(patientProfile._id);
                expect(persistedPatient?.inr_history.id(reportId)?.notes).toBe('Persist despite push failure');
                expect(await Notification.findOne({
                    user_id: patientUser._id,
                    type: NotificationType.DOCTOR_UPDATE,
                    'data.change_type': 'REPORT_UPDATED',
                })).not.toBeNull();
            } finally {
                enqueueSpy.mockRestore();
            }
        });

        test('should update report critical status', async () => {
            const response = await api.put(`/api/doctors/patients/PAT001/reports/${reportId}`, {
                is_critical: true
            }, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.report.is_critical).toBe(true);
        });

        test('should update both notes and critical status', async () => {
            const response = await api.put(`/api/doctors/patients/PAT001/reports/${reportId}`, {
                notes: 'Critical patient attention needed',
                is_critical: true
            }, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.report.notes).toBe('Critical patient attention needed');
            expect(response.data.data.report.is_critical).toBe(true);
        });

        test('should fail with invalid report_id format', async () => {
            const response = await api.put('/api/doctors/patients/PAT001/reports/invalid_id', {
                notes: 'Test'
            }, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect([400, 404]).toContain(response.status);
            expect(response.data.success).toBe(false);
        });

        test('should fail with non-existent report_id', async () => {
            const fakeId = new mongoose.Types.ObjectId().toString();
            const response = await api.put(`/api/doctors/patients/PAT001/reports/${fakeId}`, {
                notes: 'Test'
            }, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(404);
            if (response.data.success !== undefined) {
                expect(response.data.success).toBe(false);
            }
        });

        test('should fail without authentication', async () => {
            const response = await api.put(`/api/doctors/patients/PAT001/reports/${reportId}`, {
                notes: 'Test'
            });

            expect([401, 404]).toContain(response.status);
            if (response.data.success !== undefined) {
                expect(response.data.success).toBe(false);
            }
        });
    });

    describe('PUT /api/doctors/patients/:op_num/config', () => {
        test('should update next review date with valid DD-MM-YYYY format', async () => {
            const response = await api.put('/api/doctors/patients/PAT001/config', {
                date: '15-03-2024'
            }, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.patient).toBeDefined();
        });

        test('should fail with invalid date format', async () => {
            const response = await api.put('/api/doctors/patients/PAT001/config', {
                date: '2024-03-15'
            }, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
            expect(response.data.message).toBe('Validation failed');
        });

        test('should fail with non-string date', async () => {
            const response = await api.put('/api/doctors/patients/PAT001/config', {
                date: 12345
            }, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should fail with non-existent patient', async () => {
            const response = await api.put('/api/doctors/patients/INVALID001/config', {
                date: '15-03-2024'
            }, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(404);
            expect(response.data.success).toBe(false);
        });

        test('should fail without authentication', async () => {
            const response = await api.put('/api/doctors/patients/PAT001/config', {
                date: '15-03-2024'
            });

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });
    });

    describe('PUT /api/doctors/profile', () => {
        test('should update doctor name', async () => {
            const response = await api.put('/api/doctors/profile', {
                name: 'Dr. John Updated'
            }, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);

            const updated = await DoctorProfile.findById(doctorProfile._id);
            expect(updated.name).toBe('Dr. John Updated');
        });

        test('should update doctor department', async () => {
            const response = await api.put('/api/doctors/profile', {
                department: 'Neurology'
            }, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);

            const updated = await DoctorProfile.findById(doctorProfile._id);
            expect(updated.department).toBe('Neurology');
        });

        test('should update doctor contact number', async () => {
            await DoctorProfile.findByIdAndUpdate(doctorProfile._id, {
                phone_verification: {
                    status: 'VERIFIED',
                    verified_at: new Date()
                }
            });

            const response = await api.put('/api/doctors/profile', {
                contact_number: '9999999999'
            }, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);

            const updated = await DoctorProfile.findById(doctorProfile._id);
            expect(updated.contact_number).toBe('+919999999999');
            expect(updated.phone_verification.status).toBe('PENDING');
            expect(updated.phone_verification.verified_at).toBeUndefined();

            await DoctorProfile.findByIdAndUpdate(doctorProfile._id, {
                $set: {
                    phone_verification: {
                        status: 'VERIFIED',
                        verified_at: new Date()
                    }
                }
            });
        });

        test('should update multiple fields at once', async () => {
            const response = await api.put('/api/doctors/profile', {
                name: 'Dr. John Doe',
                department: 'Cardiology',
                contact_number: '1234567890'
            }, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
        });

        test('should fail with invalid contact_number length', async () => {
            const response = await api.put('/api/doctors/profile', {
                contact_number: '123'
            }, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should fail with empty name', async () => {
            const response = await api.put('/api/doctors/profile', {
                name: ''
            }, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should fail without authentication', async () => {
            const response = await api.put('/api/doctors/profile', {
                name: 'Test'
            });

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });
    });

    describe('GET /api/doctors/doctors', () => {
        test('should get all doctors', async () => {
            const response = await api.get('/api/doctors/doctors', {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.doctors).toBeDefined();
            expect(Array.isArray(response.data.data.doctors)).toBe(true);
            expect(response.data.data.doctors.length).toBeGreaterThanOrEqual(2);
            const ids = response.data.data.doctors.map((doctor: any) => doctor._id);
            expect(ids).toContain(doctorUser._id.toString());
            expect(ids).toContain(secondDoctorUser._id.toString());
            expect(ids).not.toContain(crossTenantDoctorUser._id.toString());
        });

        test('should not include password or salt in doctor data', async () => {
            const response = await api.get('/api/doctors/doctors', {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(200);
            response.data.data.doctors.forEach((doctor: any) => {
                expect(doctor.password).toBeUndefined();
                expect(doctor.salt).toBeUndefined();
            });
        });

        test('should fail without authentication', async () => {
            const response = await api.get('/api/doctors/doctors');

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });
    });

    describe('Doctor notifications', () => {
        beforeEach(async () => {
            await Notification.deleteMany({ user_id: doctorUser._id });
        });

        test('should list notifications with unread count', async () => {
            await Notification.create({
                user_id: doctorUser._id,
                type: NotificationType.SYSTEM_ANNOUNCEMENT,
                title: 'Doctor notice',
                message: 'Please check the updated policy.',
                is_read: false,
            });

            const response = await api.get('/api/doctors/notifications?page=1&limit=20', {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.unread_count).toBe(1);
            expect(Array.isArray(response.data.data.notifications)).toBe(true);
        });

        test('should mark a doctor notification as read', async () => {
            const created = await Notification.create({
                user_id: doctorUser._id,
                type: NotificationType.SYSTEM_ANNOUNCEMENT,
                title: 'Read me doctor',
                message: 'Mark this one as read',
                is_read: false,
            });

            const response = await api.patch(`/api/doctors/notifications/${created._id}/read`, {}, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);

            const fresh = await Notification.findById(created._id);
            expect(fresh?.is_read).toBe(true);
        });

        test('should reject notification stream with a revoked session token', async () => {
            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'doctor001',
                password: 'doctor123'
            });
            const token = loginResponse.data.data.token;

            await api.post('/api/auth/logout', {}, {
                headers: { Authorization: `Bearer ${token}` }
            });

            const response = await api.get(`/api/doctors/notifications/stream?token=${encodeURIComponent(token)}`);

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });

        test('should reject notification stream with a rotated session token', async () => {
            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'doctor001',
                password: 'doctor123'
            });
            const token = loginResponse.data.data.token;
            const refreshToken = loginResponse.data.data.refresh_token;

            const refreshResponse = await api.post('/api/auth/refresh', {
                refresh_token: refreshToken,
            });
            expect(refreshResponse.status).toBe(200);

            const response = await api.get(`/api/doctors/notifications/stream?token=${encodeURIComponent(token)}`);

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });
    });

    describe('File Upload Routes - S3/Filebase Integration', () => {
        let uploadedReportKey: string;
        let uploadedProfilePicKey: string;
        let reportId: string;

        const deleteS3Object = async (key: string) => {
            if (!key) return;
            try {
                await client.send(new DeleteObjectCommand({
                    Bucket: config.bucketName,
                    Key: key
                }));
            } catch (error) {
                console.error('Failed to delete S3 object:', key, error);
            }
        };

        afterAll(async () => {
            // Cleanup all uploaded files from S3
            await deleteS3Object(uploadedReportKey);
            await deleteS3Object(uploadedProfilePicKey);
        });

        describe('POST /api/doctors/profile-pic', () => {
            test('should upload profile picture and return success', async () => {
                // Create a simple test image buffer (1x1 PNG)
                const imageBuffer = Buffer.from(
                    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
                    'base64'
                );

                const FormData = require('form-data');
                const form = new FormData();
                form.append('file', imageBuffer, {
                    filename: 'test-profile.png',
                    contentType: 'image/png'
                });

                const response = await api.post('/api/doctors/profile-pic', form, {
                    headers: {
                        Authorization: `Bearer ${doctorToken}`,
                        ...form.getHeaders()
                    }
                });

                expect(response.status).toBe(200);
                expect(response.data.success).toBe(true);
                expect(response.data.message).toBe('Profile Picture successfully changed');

                // Verify the profile was updated in DB
                const updatedDoctor = await User.findById(doctorUser._id).populate('profile_id');
                const doctorProfile = updatedDoctor.profile_id as any;
                if (doctorProfile?.profile_picture_url) {
                    uploadedProfilePicKey = doctorProfile.profile_picture_url;
                }
                expect(uploadedProfilePicKey).toContain(`hospitals/${primaryHospital._id.toString()}/profiles/${doctorUser._id.toString()}/`);
            });

            test('should fail with invalid file type', async () => {
                const textBuffer = Buffer.from('This is not an image');
                const FormData = require('form-data');
                const form = new FormData();
                form.append('file', textBuffer, {
                    filename: 'test.txt',
                    contentType: 'text/plain'
                });

                const response = await api.post('/api/doctors/profile-pic', form, {
                    headers: {
                        Authorization: `Bearer ${doctorToken}`,
                        ...form.getHeaders()
                    }
                });

                expect(response.status).toBe(400);
                expect(response.data.success).toBe(false);
                expect(response.data.message).toContain('Invalid file type');
            });

            test('should fail without file', async () => {
                const response = await api.post('/api/doctors/profile-pic', {}, {
                    headers: { Authorization: `Bearer ${doctorToken}` }
                });

                expect(response.status).toBe(400);
                expect(response.data.success).toBe(false);
            });

            test('should fail without authentication', async () => {
                const response = await api.post('/api/doctors/profile-pic', {});

                expect(response.status).toBe(401);
                expect(response.data.success).toBe(false);
            });
        });

        describe('GET /api/doctors/profile (with profile picture)', () => {
            test('should return profile with presigned URL for profile picture', async () => {
                const response = await api.get('/api/doctors/profile', {
                    headers: { Authorization: `Bearer ${doctorToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.success).toBe(true);
                expect(response.data.data.doctor).toBeDefined();
                expect(response.data.data.patients_count).toBeDefined();

                // If profile picture exists, verify it's a presigned URL
                const profilePictureUrl = response.data.data.doctor?.profile_id?.profile_picture_url;
                if (profilePictureUrl) {
                    expect(profilePictureUrl).toContain('https://');
                    expect(profilePictureUrl).toContain('X-Amz-Algorithm');
                    expect(profilePictureUrl).toContain('X-Amz-Signature');
                }
            });
        });

        describe('GET /api/doctors/patients/:op_num/reports/:report_id', () => {
            beforeAll(async () => {
                // Upload a test report first via patient route or directly
                const { uploadFile } = require('@alias/utils/fileUpload');
                const testPdfBuffer = Buffer.from('%PDF-1.4 test content');

                const mockFile = {
                    buffer: testPdfBuffer,
                    originalname: 'test-report.pdf',
                    mimetype: 'application/pdf'
                } as Express.Multer.File;

                uploadedReportKey = (await uploadFile('uploads', mockFile)).key;

                // Add report to patient profile
                const patient = await PatientProfile.findById(patientProfile._id);
                patient.inr_history.push({
                    test_date: new Date('2024-02-15'),
                    inr_value: 2.8,
                    is_critical: false,
                    uploaded_at: new Date('2024-02-15T00:00:00.000Z'),
                    file_url: uploadedReportKey,
                    notes: 'Test report'
                });
                await patient.save();

                // Get the report ID
                const updatedPatient = await PatientProfile.findById(patientProfile._id);
                reportId = updatedPatient.inr_history[updatedPatient.inr_history.length - 1]._id.toString();
            });

            test('should get report with presigned download URL', async () => {
                const response = await api.get(`/api/doctors/patients/PAT001/reports/${reportId}`, {
                    headers: { Authorization: `Bearer ${doctorToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.success).toBe(true);
                expect(response.data.message).toBe('Report fetched successfully');
                expect(response.data.data.report).toBeDefined();

                const report = response.data.data.report;
                expect(report._id).toBe(reportId);
                expect(report.inr_value).toBe(2.8);
                expect(report.file_url).toBeDefined();

                // Verify it's a presigned URL
                expect(report.file_url).toContain('https://');
                expect(report.file_url).toContain('X-Amz-Algorithm');
                expect(report.file_url).toContain('X-Amz-Signature');
                expect(report.file_url).toContain('X-Amz-Credential');

                // The presigned URL should be downloadable
                expect(report.file_url).not.toBe(uploadedReportKey);
            });

            test('should fail with invalid report_id', async () => {
                const invalidId = new mongoose.Types.ObjectId().toString();
                const response = await api.get(`/api/doctors/patients/PAT001/reports/${invalidId}`, {
                    headers: { Authorization: `Bearer ${doctorToken}` }
                });

                expect(response.status).toBe(404);
                expect(response.data.success).toBe(false);
                expect(response.data.message).toBe('Report not found');
            });

            test('should fail with malformed report_id', async () => {
                const response = await api.get('/api/doctors/patients/PAT001/reports/invalid-id', {
                    headers: { Authorization: `Bearer ${doctorToken}` }
                });

                expect(response.status).toBe(400);
                expect(response.data.success).toBe(false);
                expect(response.data.message).toContain('Invalid report_id');
            });

            test('should fail when accessing another doctor\'s patient report', async () => {
                const response = await api.get(`/api/doctors/patients/PAT001/reports/${reportId}`, {
                    headers: { Authorization: `Bearer ${secondDoctorToken}` }
                });

                expect(response.status).toBe(403);
                expect(response.data.success).toBe(false);
                expect(response.data.message).toContain('Unauthorized');
            });

            test('should fail with non-existent patient', async () => {
                const response = await api.get(`/api/doctors/patients/INVALID001/reports/${reportId}`, {
                    headers: { Authorization: `Bearer ${doctorToken}` }
                });

                expect(response.status).toBe(404);
                expect(response.data.success).toBe(false);
                expect(response.data.message).toBe('Patient not found');
            });

            test('should fail without authentication', async () => {
                const response = await api.get(`/api/doctors/patients/PAT001/reports/${reportId}`);

                expect(response.status).toBe(401);
                expect(response.data.success).toBe(false);
            });
        });
    });
});
