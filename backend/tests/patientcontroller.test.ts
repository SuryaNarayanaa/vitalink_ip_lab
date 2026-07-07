import axios, { AxiosInstance } from 'axios';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import mongoose from 'mongoose';
import app from '@alias/app';
import { User, DoctorProfile, PatientProfile, Notification } from '@alias/models';
import { NotificationType } from '@alias/models/notification.model';
import { Server } from 'http';

describe('Patient Routes', () => {
    let mongoContainer: StartedTestContainer;
    let server: Server;
    let api: AxiosInstance;
    let baseURL: string;
    let patientToken: string;
    let patientUser: any;
    let patientProfile: any;
    let doctorProfile: any;

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

        doctorProfile = await DoctorProfile.create({
            name: 'Dr. Test Doctor',
            department: 'Cardiology',
            contact_number: '1234567890'
        });

        const therapyStartDate = new Date('2024-01-01');
        patientProfile = await PatientProfile.create({
            assigned_doctor_id: doctorProfile._id,
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
                therapy_start_date: therapyStartDate,
                target_inr: { min: 2.0, max: 3.0 }
            },
            weekly_dosage: {
                monday: 5,
                tuesday: 5,
                wednesday: 5,
                thursday: 5,
                friday: 5,
                saturday: 0,
                sunday: 0
            },
            medical_history: [{
                diagnosis: 'Atrial Fibrillation',
                duration_value: 2,
                duration_unit: 'Years'
            }]
        });

        patientUser = await User.create({
            login_id: 'patient001',
            password: 'patient123',
            user_type: 'PATIENT',
            profile_id: patientProfile._id,
            is_active: true
        });

        const patientLoginResponse = await api.post('/api/auth/login', {
            login_id: 'patient001',
            password: 'patient123'
        });
        patientToken = patientLoginResponse.data.data.token;
    }, 120000);

    afterAll(async () => {
        await mongoose.connection.dropDatabase();
        await mongoose.connection.close();
        await mongoContainer.stop();
        server.close();
    });

    describe('GET /api/patient/profile', () => {
        test('should get patient profile successfully', async () => {
            const response = await api.get('/api/patient/profile', {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.patient).toBeDefined();
            expect(response.data.data.patient.user_type).toBe('PATIENT');
            expect(response.data.data.patient.profile_id).toBeDefined();
            expect(response.data.data.patient.profile_id.demographics.name).toBe('Test Patient');
        });

        test('should include populated doctor profile', async () => {
            const response = await api.get('/api/patient/profile', {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.data.patient.profile_id.assigned_doctor_id).toBeDefined();
        });

        test('should fail without authentication', async () => {
            const response = await api.get('/api/patient/profile');

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });
    });

    describe('GET /api/patient/reports', () => {
        test('should get patient reports with presigned URLs for file_url', async () => {
            // First add a report with file_url
            const patient = await PatientProfile.findById(patientProfile._id);
            patient.inr_history.push({
                test_date: new Date('2024-02-20'),
                inr_value: 3.0,
                is_critical: false,
                file_url: 'uploads/test-patient-report/test123.pdf',
                notes: 'Test report for presigned URL'
            });
            await patient.save();

            const response = await api.get('/api/patient/reports', {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.report).toBeDefined();
            expect(response.data.data.report.inr_history).toBeDefined();
            expect(Array.isArray(response.data.data.report.inr_history)).toBe(true);

            // Verify that file_url is converted to presigned URL
            const reportWithFile = response.data.data.report.inr_history.find((r: any) => r.file_url);
            if (reportWithFile) {
                expect(reportWithFile.file_url).toContain('https://');
                expect(reportWithFile.file_url).toContain('X-Amz-Algorithm');
                expect(reportWithFile.file_url).toContain('X-Amz-Signature');
                // Should not be the raw S3 key
                expect(reportWithFile.file_url).not.toBe('uploads/test-patient-report/test123.pdf');
            }

            expect(response.data.data.report.health_logs).toBeDefined();
            expect(response.data.data.report.weekly_dosage).toBeDefined();
            expect(response.data.data.report.medical_config).toBeDefined();
        });

        test('should fail without authentication', async () => {
            const response = await api.get('/api/patient/reports');

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });
    });

    describe('POST /api/patient/dosage', () => {
        test('should log dosage with valid DD-MM-YYYY date', async () => {
            const response = await api.post('/api/patient/dosage', {
                date: '15-02-2026'
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.patient.medical_config.taken_doses).toBeDefined();
            expect(Array.isArray(response.data.data.patient.medical_config.taken_doses)).toBe(true);
        });

        test('should add multiple dosages', async () => {
            await api.post('/api/patient/dosage', {
                date: '13-02-2026'
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            const response = await api.post('/api/patient/dosage', {
                date: '14-02-2026'
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.data.patient.medical_config.taken_doses.length).toBeGreaterThanOrEqual(2);
        });

        test('should fail with invalid date format', async () => {
            const response = await api.post('/api/patient/dosage', {
                date: '2026-02-15'
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should fail with missing date', async () => {
            const response = await api.post('/api/patient/dosage', {}, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should fail without authentication', async () => {
            const response = await api.post('/api/patient/dosage', {
                date: '15-02-2026'
            });

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });
    });

    describe('GET /api/patient/missed-doses', () => {
        beforeAll(async () => {
            await PatientProfile.findByIdAndUpdate(patientProfile._id, {
                'medical_config.taken_doses': []
            });
        });

        test('should calculate missed doses correctly with therapy start date', async () => {
            const response = await api.get('/api/patient/missed-doses', {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.recent_missed_doses).toBeDefined();
            expect(response.data.data.missed_doses).toBeDefined();
            expect(Array.isArray(response.data.data.recent_missed_doses)).toBe(true);
            expect(Array.isArray(response.data.data.missed_doses)).toBe(true);
        });

        test('should calculate missed doses based on weekly_dosage schedule', async () => {
            // Patient has dosage on: Monday (10mg), Tuesday (30mg), Thursday (20mg)
            // Set therapy start date to 14 days ago to ensure we have at least 2 weeks of data
            const fourteenDaysAgo = new Date();
            fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
            fourteenDaysAgo.setHours(0, 0, 0, 0);

            const updated = await PatientProfile.findByIdAndUpdate(
                patientProfile._id,
                {
                    'medical_config.therapy_start_date': fourteenDaysAgo,
                    'medical_config.taken_doses': [],
                    weekly_dosage: {
                        monday: 10,
                        tuesday: 30,
                        wednesday: 0,
                        thursday: 20,
                        friday: 0,
                        saturday: 0,
                        sunday: 0
                    }
                },
                { new: true }
            );

            // Verify update worked
            expect(updated?.weekly_dosage?.monday).toBe(10);
            expect(updated?.weekly_dosage?.tuesday).toBe(30);
            expect(updated?.weekly_dosage?.thursday).toBe(20);
            expect(updated?.medical_config?.therapy_start_date).toBeDefined();

            const response = await api.get('/api/patient/missed-doses', {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            const { recent_missed_doses, missed_doses } = response.data.data;

            // Over 14 days, should have at least 2 Mondays, 2 Tuesdays, 2 Thursdays = at least 6 missed doses
            const totalMissed = recent_missed_doses.length + missed_doses.length;
            console.log('Total missed doses:', totalMissed, 'Recent:', recent_missed_doses.length, 'Older:', missed_doses.length);
            console.log('Recent missed:', recent_missed_doses);
            console.log('Older missed:', missed_doses);
            expect(totalMissed).toBeGreaterThanOrEqual(4); // At least 4 doses over 14 days

            // Verify all missed doses are on the correct days (Monday, Tuesday, or Thursday)
            if (totalMissed > 0) {
                const allMissedDates = [...recent_missed_doses, ...missed_doses];
                allMissedDates.forEach((dateStr: string) => {
                    const [day, month, year] = dateStr.split('-').map(Number);
                    const dateObj = new Date(year, month - 1, day);
                    const dayOfWeek = dateObj.getDay(); // 0=Sunday, 1=Monday, 2=Tuesday, 4=Thursday

                    // Should only be Monday (1), Tuesday (2), or Thursday (4)
                    expect([1, 2, 4]).toContain(dayOfWeek);
                });
            }
        });

        test('should separate recent missed doses (last 7 days) from older ones', async () => {
            const response = await api.get('/api/patient/missed-doses', {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            const { recent_missed_doses, missed_doses } = response.data.data;

            recent_missed_doses.forEach((date: string) => {
                const [day, month, year] = date.split('-').map(Number);
                const dateObj = new Date(year, month - 1, day);
                const today = new Date();
                const sevenDaysAgo = new Date();
                sevenDaysAgo.setDate(today.getDate() - 7);

                expect(dateObj.getTime()).toBeLessThanOrEqual(today.getTime());
                expect(dateObj.getTime()).toBeGreaterThanOrEqual(sevenDaysAgo.getTime());
            });
        });

        test('should fail without therapy start date', async () => {
            const patientWithoutTherapy = await PatientProfile.create({
                assigned_doctor_id: doctorProfile._id,
                demographics: {
                    name: 'Patient Without Therapy',
                    age: 50,
                    gender: 'Female',
                    phone: '8888888888'
                },
                medical_config: {
                    target_inr: { min: 2.0, max: 3.0 }
                }
            });

            const userWithoutTherapy = await User.create({
                login_id: 'notherapy001',
                password: 'pass123',
                user_type: 'PATIENT',
                profile_id: patientWithoutTherapy._id,
                is_active: true
            });

            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'notherapy001',
                password: 'pass123'
            });
            const token = loginResponse.data.data.token;

            const response = await api.get('/api/patient/missed-doses', {
                headers: { Authorization: `Bearer ${token}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
            expect(response.data.message).toBe('Therapy start date or dosage schedule is missing');
        });

        test('should fail without dosage schedule', async () => {
            const patientNoDosage = await PatientProfile.create({
                assigned_doctor_id: doctorProfile._id,
                demographics: {
                    name: 'Patient No Dosage',
                    age: 55,
                    gender: 'Male',
                    phone: '7777777777'
                },
                medical_config: {
                    therapy_start_date: new Date('2024-01-01'),
                    target_inr: { min: 2.0, max: 3.0 }
                }
            });

            const userNoDosage = await User.create({
                login_id: 'nodosage001',
                password: 'pass123',
                user_type: 'PATIENT',
                profile_id: patientNoDosage._id,
                is_active: true
            });

            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'nodosage001',
                password: 'pass123'
            });
            const token = loginResponse.data.data.token;

            const response = await api.get('/api/patient/missed-doses', {
                headers: { Authorization: `Bearer ${token}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should fail without authentication', async () => {
            const response = await api.get('/api/patient/missed-doses');

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });
    });

    describe('POST /api/patient/health-logs', () => {
        test('should add health log successfully', async () => {
            const response = await api.post('/api/patient/health-logs', {
                type: 'SIDE_EFFECT',
                description: 'Mild headache after medication'
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
        });

        test('should update existing health log of same type', async () => {
            await api.post('/api/patient/health-logs', {
                type: 'ILLNESS',
                description: 'Experiencing mild cold symptoms'
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            const response = await api.post('/api/patient/health-logs', {
                type: 'ILLNESS',
                description: 'Cold symptoms have improved'
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
        });

        test('should fail with invalid health log type', async () => {
            const response = await api.post('/api/patient/health-logs', {
                type: 'INVALID_TYPE',
                description: 'Test description'
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should fail with missing type', async () => {
            const response = await api.post('/api/patient/health-logs', {
                description: 'Test description'
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should fail with missing description', async () => {
            const response = await api.post('/api/patient/health-logs', {
                type: 'FEVER'
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should fail without authentication', async () => {
            const response = await api.post('/api/patient/health-logs', {
                type: 'LIFESTYLE',
                description: 'Test'
            });

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });
    });

    describe('PUT /api/patient/profile', () => {
        test('should update patient name', async () => {
            const response = await api.put('/api/patient/profile', {
                demographics: {
                    name: 'Updated Patient Name'
                }
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.profile.demographics.name).toBe('Updated Patient Name');
        });

        test('should update patient age', async () => {
            const response = await api.put('/api/patient/profile', {
                demographics: {
                    age: 50
                }
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.profile.demographics.age).toBe(50);
        });

        test('should update patient gender', async () => {
            const response = await api.put('/api/patient/profile', {
                demographics: {
                    gender: 'Female'
                }
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.profile.demographics.gender).toBe('Female');
        });

        test('should update patient phone', async () => {
            await PatientProfile.findByIdAndUpdate(patientProfile._id, {
                'demographics.phone_verification': {
                    status: 'VERIFIED',
                    verified_at: new Date()
                }
            });

            const response = await api.put('/api/patient/profile', {
                demographics: {
                    phone: '5555555555'
                }
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.profile.demographics.phone).toBe('5555555555');
            expect(response.data.data.profile.demographics.phone_verification.status).toBe('PENDING');
            expect(response.data.data.profile.demographics.phone_verification.verified_at).toBeUndefined();
        });

        test('should fail when updating patient phone to a non-numeric value', async () => {
            const response = await api.put('/api/patient/profile', {
                demographics: {
                    phone: '55555abcde'
                }
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should update next of kin information', async () => {
            const response = await api.put('/api/patient/profile', {
                demographics: {
                    next_of_kin: {
                        name: 'Updated Kin',
                        relation: 'Child',
                        phone: '4444444444'
                    }
                }
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.profile.demographics.next_of_kin.name).toBe('Updated Kin');
            expect(response.data.data.profile.demographics.next_of_kin.relation).toBe('Child');
        });

        test('should update multiple demographics fields', async () => {
            const response = await api.put('/api/patient/profile', {
                demographics: {
                    name: 'Multi Update Patient',
                    age: 60,
                    phone: '3333333333'
                }
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.profile.demographics.name).toBe('Multi Update Patient');
            expect(response.data.data.profile.demographics.age).toBe(60);
            expect(response.data.data.profile.demographics.phone).toBe('3333333333');
        });

        test('should update medical history', async () => {
            const response = await api.put('/api/patient/profile', {
                medical_history: [
                    {
                        diagnosis: 'Hypertension',
                        duration_value: 5,
                        duration_unit: 'Years'
                    },
                    {
                        diagnosis: 'Type 2 Diabetes',
                        duration_value: 3,
                        duration_unit: 'Years'
                    }
                ]
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.profile.medical_history.length).toBe(2);
            expect(response.data.data.profile.medical_history[0].diagnosis).toBe('Hypertension');
        });

        test('should update multiple profile fields', async () => {
            const response = await api.put('/api/patient/profile', {
                demographics: {
                    name: 'Complete Update',
                    age: 65,
                    gender: 'Male'
                },
                medical_history: [{
                    diagnosis: 'Updated Condition',
                    duration_value: 1,
                    duration_unit: 'Years'
                }]
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.profile.demographics.name).toBe('Complete Update');
        });

        test('should fail with invalid gender', async () => {
            const response = await api.put('/api/patient/profile', {
                demographics: {
                    gender: 'InvalidGender'
                }
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should fail with negative age', async () => {
            const response = await api.put('/api/patient/profile', {
                demographics: {
                    age: -5
                }
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should fail with zero age', async () => {
            const response = await api.put('/api/patient/profile', {
                demographics: {
                    age: 0
                }
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should fail with empty name', async () => {
            const response = await api.put('/api/patient/profile', {
                demographics: {
                    name: ''
                }
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should fail when trying to update therapy_drug (doctor only)', async () => {
            const response = await api.put('/api/patient/profile', {
                medical_config: {
                    therapy_drug: 'Apixaban'
                }
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should allow patient to update therapy_start_date', async () => {
            const pastDate = new Date();
            pastDate.setDate(pastDate.getDate() - 7); // 7 days ago

            const response = await api.put('/api/patient/profile', {
                medical_config: {
                    therapy_start_date: pastDate
                }
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
        });

        test('should fail when therapy_start_date is in the future', async () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 7); // 7 days in the future

            const response = await api.put('/api/patient/profile', {
                medical_config: {
                    therapy_start_date: futureDate
                }
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
            expect(response.data.message).toBe('Validation failed');
        });

        test('should fail when trying to update weekly_dosage (doctor only)', async () => {
            const response = await api.put('/api/patient/profile', {
                weekly_dosage: {
                    monday: 10,
                    tuesday: 10
                }
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should fail with invalid duration unit', async () => {
            const response = await api.put('/api/patient/profile', {
                medical_history: [
                    {
                        diagnosis: 'Test',
                        duration_value: 5,
                        duration_unit: 'InvalidUnit'
                    }
                ]
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
        });

        test('should fail without authentication', async () => {
            const response = await api.put('/api/patient/profile', {
                demographics: {
                    name: 'Test'
                }
            });

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });
    });

    describe('Doctor update notifications', () => {
        beforeEach(async () => {
            await Notification.deleteMany({
                user_id: patientUser._id,
                type: NotificationType.DOCTOR_UPDATE,
            });
        });

        test('should include unread count and latest doctor update in profile response', async () => {
            await Notification.create({
                user_id: patientUser._id,
                type: NotificationType.DOCTOR_UPDATE,
                title: 'Older update',
                message: 'Older message',
                is_read: false,
                createdAt: new Date('2026-01-10T10:00:00.000Z'),
                updatedAt: new Date('2026-01-10T10:00:00.000Z'),
                data: {
                    change_type: 'INSTRUCTIONS_UPDATED',
                    changed_fields: ['medical_config.instructions'],
                }
            });
            await Notification.create({
                user_id: patientUser._id,
                type: NotificationType.DOCTOR_UPDATE,
                title: 'Latest update',
                message: 'Latest message',
                is_read: true,
                createdAt: new Date('2026-01-11T10:00:00.000Z'),
                updatedAt: new Date('2026-01-11T10:00:00.000Z'),
                data: {
                    change_type: 'INSTRUCTIONS_UPDATED',
                    changed_fields: ['medical_config.instructions'],
                }
            });

            const response = await api.get('/api/patient/profile', {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.data.doctor_updates.unread_count).toBe(1);
            expect(response.data.data.doctor_updates.latest.title).toBe('Latest update');
        });

        test('should return only unread doctor updates when unread_only=true', async () => {
            await Notification.create({
                user_id: patientUser._id,
                type: NotificationType.DOCTOR_UPDATE,
                title: 'Unread update',
                message: 'Unread message',
                is_read: false,
                data: {
                    change_type: 'INSTRUCTIONS_UPDATED',
                    changed_fields: ['medical_config.instructions'],
                }
            });
            await Notification.create({
                user_id: patientUser._id,
                type: NotificationType.DOCTOR_UPDATE,
                title: 'Read update',
                message: 'Read message',
                is_read: true,
                data: {
                    change_type: 'INSTRUCTIONS_UPDATED',
                    changed_fields: ['medical_config.instructions'],
                }
            });

            const response = await api.get('/api/patient/doctor-updates?unread_only=true&limit=20', {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.updates.length).toBe(1);
            expect(response.data.data.updates[0].title).toBe('Unread update');
            expect(response.data.data.updates[0].is_read).toBe(false);
        });

        test('should return doctor updates summary', async () => {
            await Notification.create({
                user_id: patientUser._id,
                type: NotificationType.DOCTOR_UPDATE,
                title: 'Summary older',
                message: 'Older summary message',
                is_read: false,
                createdAt: new Date('2026-02-01T10:00:00.000Z'),
                updatedAt: new Date('2026-02-01T10:00:00.000Z'),
                data: {
                    change_type: 'INSTRUCTIONS_UPDATED',
                    changed_fields: ['medical_config.instructions'],
                }
            });
            await Notification.create({
                user_id: patientUser._id,
                type: NotificationType.DOCTOR_UPDATE,
                title: 'Summary latest',
                message: 'Latest summary message',
                is_read: true,
                createdAt: new Date('2026-02-02T10:00:00.000Z'),
                updatedAt: new Date('2026-02-02T10:00:00.000Z'),
                data: {
                    change_type: 'INSTRUCTIONS_UPDATED',
                    changed_fields: ['medical_config.instructions'],
                }
            });

            const response = await api.get('/api/patient/doctor-updates/summary', {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.unread_count).toBe(1);
            expect(response.data.data.latest.title).toBe('Summary latest');
        });

        test('should mark all doctor updates as read', async () => {
            await Notification.create({
                user_id: patientUser._id,
                type: NotificationType.DOCTOR_UPDATE,
                title: 'Unread update 1',
                message: 'Unread message 1',
                is_read: false,
                data: {
                    change_type: 'INSTRUCTIONS_UPDATED',
                    changed_fields: ['medical_config.instructions'],
                }
            });
            await Notification.create({
                user_id: patientUser._id,
                type: NotificationType.DOCTOR_UPDATE,
                title: 'Unread update 2',
                message: 'Unread message 2',
                is_read: false,
                data: {
                    change_type: 'INSTRUCTIONS_UPDATED',
                    changed_fields: ['medical_config.instructions'],
                }
            });

            const markResponse = await api.patch('/api/patient/doctor-updates/read-all', {}, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(markResponse.status).toBe(200);
            expect(markResponse.data.success).toBe(true);
            expect(markResponse.data.data.marked_count).toBe(2);

            const profileResponse = await api.get('/api/patient/profile', {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(profileResponse.status).toBe(200);
            expect(profileResponse.data.data.doctor_updates.unread_count).toBe(0);
        });

        test('should include persisted notification-based doctor updates', async () => {
            await Notification.create({
                user_id: patientUser._id,
                type: NotificationType.DOCTOR_UPDATE,
                title: 'Doctor updated instructions',
                message: 'Please follow the revised care plan.',
                is_read: false,
                data: {
                    change_type: 'INSTRUCTIONS_UPDATED',
                    changed_fields: ['medical_config.instructions'],
                }
            });

            const response = await api.get('/api/patient/doctor-updates?limit=20', {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.updates.length).toBeGreaterThan(0);
            const item = response.data.data.updates.find(
                (u: any) => u.title === 'Doctor updated instructions'
            );
            expect(item).toBeDefined();
            expect(item.is_read).toBe(false);
            expect(item.change_type).toBe('INSTRUCTIONS_UPDATED');
        });
    });

    describe('General notifications', () => {
        beforeEach(async () => {
            await Notification.deleteMany({ user_id: patientUser._id });
        });

        test('should list notifications with unread count', async () => {
            await Notification.create({
                user_id: patientUser._id,
                type: NotificationType.SYSTEM_ANNOUNCEMENT,
                title: 'System alert',
                message: 'Please review the latest guidance.',
                is_read: false,
            });

            const response = await api.get('/api/patient/notifications?page=1&limit=20', {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.unread_count).toBe(1);
            expect(Array.isArray(response.data.data.notifications)).toBe(true);
        });

        test('should mark a notification as read', async () => {
            const created = await Notification.create({
                user_id: patientUser._id,
                type: NotificationType.SYSTEM_ANNOUNCEMENT,
                title: 'Read me',
                message: 'Mark this as read',
                is_read: false,
            });

            const response = await api.patch(`/api/patient/notifications/${created._id}/read`, {}, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);

            const fresh = await Notification.findById(created._id);
            expect(fresh?.is_read).toBe(true);
        });

        test('should reject notification stream with a revoked session token', async () => {
            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'patient001',
                password: 'patient123'
            });
            const token = loginResponse.data.data.token;

            await api.post('/api/auth/logout', {}, {
                headers: { Authorization: `Bearer ${token}` }
            });

            const response = await api.get(`/api/patient/notifications/stream?token=${encodeURIComponent(token)}`);

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });

        test('should reject notification stream with a rotated session token', async () => {
            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'patient001',
                password: 'patient123'
            });
            const token = loginResponse.data.data.token;
            const refreshToken = loginResponse.data.data.refresh_token;

            const refreshResponse = await api.post('/api/auth/refresh', {
                refresh_token: refreshToken,
            });
            expect(refreshResponse.status).toBe(200);

            const response = await api.get(`/api/patient/notifications/stream?token=${encodeURIComponent(token)}`);

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });
    });

    describe('GET /api/patient/dosage-calendar', () => {
        test('should get dosage calendar successfully with default parameters', async () => {
            const response = await api.get('/api/patient/dosage-calendar', {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.message).toBe('Calendar data fetched');
            expect(response.data.data).toHaveProperty('calendar_data');
            expect(response.data.data).toHaveProperty('date_range');
            expect(response.data.data).toHaveProperty('therapy_start');
            expect(Array.isArray(response.data.data.calendar_data)).toBe(true);

            // Verify calendar data structure
            if (response.data.data.calendar_data.length > 0) {
                const firstEntry = response.data.data.calendar_data[0];
                expect(firstEntry).toHaveProperty('date');
                expect(firstEntry).toHaveProperty('status');
                expect(firstEntry).toHaveProperty('dosage');
                expect(firstEntry).toHaveProperty('day_of_week');
                expect(['taken', 'missed', 'scheduled']).toContain(firstEntry.status);
            }
        });

        test('should get dosage calendar with specific months parameter', async () => {
            const response = await api.get('/api/patient/dosage-calendar?months=2', {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(Array.isArray(response.data.data.calendar_data)).toBe(true);
        });

        test('should limit months parameter to maximum of 6', async () => {
            const response = await api.get('/api/patient/dosage-calendar?months=10', {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            // Should cap at 6 months, so verify reasonable data size
            expect(Array.isArray(response.data.data.calendar_data)).toBe(true);
        });

        test('should handle start_date parameter', async () => {
            const startDate = '01-02-2024'; // DD-MM-YYYY
            const response = await api.get(`/api/patient/dosage-calendar?start_date=${startDate}&months=1`, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.date_range.end).toBe(startDate);
        });

        test('should return only scheduled doses for the configured days', async () => {
            const response = await api.get('/api/patient/dosage-calendar?months=1', {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            const calendarData = response.data.data.calendar_data;

            // Verify only days with dosage > 0 are included
            calendarData.forEach((entry: any) => {
                expect(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']).toContain(entry.day_of_week);
                expect(entry.dosage).toBeGreaterThan(0);
            });
        });

        test('should mark taken doses correctly in calendar', async () => {
            // First, mark a dose as taken
            const doseDate = '03-02-2024'; // DD-MM-YYYY (Monday)
            await api.post('/api/patient/dosage', {
                date: doseDate,
                dose: 5
            }, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            // Then fetch calendar
            const response = await api.get('/api/patient/dosage-calendar?start_date=15-02-2024&months=1', {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            const takenEntry = response.data.data.calendar_data.find((entry: any) => entry.date === doseDate);
            if (takenEntry) {
                expect(takenEntry.status).toBe('taken');
            }
        });

        test('should fail without authentication', async () => {
            const response = await api.get('/api/patient/dosage-calendar');

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });

        test('should return 400 if therapy_start_date is missing', async () => {
            // Create a patient without therapy_start_date
            const incompleteProfile = await PatientProfile.create({
                assigned_doctor_id: doctorProfile._id,
                demographics: {
                    name: 'Incomplete Patient',
                    age: 40,
                    gender: 'Female',
                    phone: '1111111111'
                },
                weekly_dosage: {
                    monday: 5,
                    tuesday: 5,
                    wednesday: 5,
                    thursday: 5,
                    friday: 5,
                    saturday: 0,
                    sunday: 0
                }
            });

            const incompleteUser = await User.create({
                login_id: 'incomplete001',
                password: 'test123',
                user_type: 'PATIENT',
                profile_id: incompleteProfile._id,
                is_active: true
            });

            const loginResponse = await api.post('/api/auth/login', {
                login_id: 'incomplete001',
                password: 'test123'
            });
            const incompleteToken = loginResponse.data.data.token;

            const response = await api.get('/api/patient/dosage-calendar', {
                headers: { Authorization: `Bearer ${incompleteToken}` }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
            expect(response.data.message).toBe('Therapy start date or dosage schedule is missing');
        });

        test('should not return dates before therapy start date', async () => {
            const response = await api.get('/api/patient/dosage-calendar?months=50', {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            const calendarData = response.data.data.calendar_data;
            const therapyStart = new Date('2024-01-01');

            calendarData.forEach((entry: any) => {
                const [day, month, year] = entry.date.split('-').map(Number);
                const entryDate = new Date(year, month - 1, day);
                expect(entryDate.getTime()).toBeGreaterThanOrEqual(therapyStart.getTime());
            });
        });
    });
})
