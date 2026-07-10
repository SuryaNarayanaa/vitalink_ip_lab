import axios, { AxiosInstance } from 'axios';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import mongoose from 'mongoose';
import app from '@alias/app';
import { User, DoctorProfile, PatientProfile, Hospital, FileAsset } from '@alias/models';
import { Server } from 'http';
import FormData from 'form-data';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import client from '@alias/config/s3-client';
import { config } from '@alias/config';
import { FileAssetStatus } from '@alias/models/fileasset.model';
import { deleteFile, getDownloadUrl } from '@alias/utils/fileUpload';

describe('Patient File Upload Routes', () => {
    let mongoContainer: StartedTestContainer;
    let server: Server;
    let api: AxiosInstance;
    let baseURL: string;
    let patientToken: string;
    let patientUser: any;
    let patientProfile: any;
    let doctorProfile: any;
    let hospital: any;
    let uploadedReportKeys: string[] = [];
    let uploadedProfilePicKey: string;

    // Helper function to delete S3 objects
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

        hospital = await Hospital.create({
            code: 'UPLOAD_TENANT',
            name: 'Upload Tenant Hospital',
            location: 'Coimbatore',
            admin_email: 'uploads@example.com'
        });

        doctorProfile = await DoctorProfile.create({
            name: 'Dr. Test Doctor',
            department: 'Cardiology',
            contact_number: '1234567890',
            hospital_id: hospital._id
        });

        patientProfile = await PatientProfile.create({
            assigned_doctor_id: doctorProfile._id,
            hospital_id: hospital._id,
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
                saturday: 0,
                sunday: 0
            }
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
        // Cleanup all uploaded files from S3
        for (const key of uploadedReportKeys) {
            await deleteS3Object(key);
        }
        await deleteS3Object(uploadedProfilePicKey);

        await mongoose.connection.dropDatabase();
        await mongoose.connection.close();
        await mongoContainer.stop();
        server.close();
    });

    describe('POST /api/patient/reports', () => {
        test('should submit report with PDF file', async () => {
            const pdfBuffer = Buffer.from('%PDF-1.4 test content');
            const form = new FormData();

            form.append('file', pdfBuffer, {
                filename: 'test-report.pdf',
                contentType: 'application/pdf'
            });
            form.append('inr_value', '2.5');
            form.append('test_date', '18-02-2026');

            const response = await api.post('/api/patient/reports', form, {
                headers: {
                    Authorization: `Bearer ${patientToken}`,
                    ...form.getHeaders()
                }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.message).toBe('Report submitted');
            expect(response.data.data.patient.inr_history).toBeDefined();

            // Store key for cleanup
            const updatedPatient = await PatientProfile.findById(patientProfile._id);
            const latestReport = updatedPatient.inr_history[updatedPatient.inr_history.length - 1];
            uploadedReportKeys.push(latestReport.file_url);

            // Verify file_url is stored
            expect(latestReport.file_url).toBeDefined();
            expect(latestReport.file_url).toContain(`hospitals/${hospital._id.toString()}/patients/${patientUser._id.toString()}/reports/`);
            expect(latestReport.file_url).toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}\.pdf$|\/\d{5}\.pdf$/);
            expect(latestReport.file_asset_id).toBeDefined();
            const asset = await FileAsset.findById(latestReport.file_asset_id);
            expect(asset).not.toBeNull();
            expect(asset?.status).toBe(FileAssetStatus.ACTIVE);
            expect(asset?.hospital_id.toString()).toBe(hospital._id.toString());
            expect(asset?.owner_user_id.toString()).toBe(patientUser._id.toString());
            expect(asset?.byte_size).toBe(pdfBuffer.length);
            expect(asset?.sha256_checksum).toMatch(/^[a-f0-9]{64}$/);
            expect(latestReport.inr_value).toBe(2.5);
            expect(latestReport.is_critical).toBe(false);
        });

        test('should submit report with PNG image', async () => {
            const imageBuffer = Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
                'base64'
            );
            const form = new FormData();

            form.append('file', imageBuffer, {
                filename: 'test-report.png',
                contentType: 'image/png'
            });
            form.append('inr_value', '3.2');
            form.append('test_date', '19-02-2026');

            const response = await api.post('/api/patient/reports', form, {
                headers: {
                    Authorization: `Bearer ${patientToken}`,
                    ...form.getHeaders()
                }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);

            // Store key for cleanup
            const updatedPatient = await PatientProfile.findById(patientProfile._id);
            const latestReport = updatedPatient.inr_history[updatedPatient.inr_history.length - 1];
            uploadedReportKeys.push(latestReport.file_url);
            expect(latestReport.is_critical).toBe(false);
        });

        test('should mark report as critical when INR is below configured low threshold', async () => {
            const response = await api.post('/api/patient/reports', {
                inr_value: '1.4',
                test_date: '20-02-2026'
            }, {
                headers: {
                    Authorization: `Bearer ${patientToken}`,
                }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);

            const updatedPatient = await PatientProfile.findById(patientProfile._id);
            const latestReport = updatedPatient.inr_history[updatedPatient.inr_history.length - 1];
            expect(latestReport.inr_value).toBe(1.4);
            expect(latestReport.is_critical).toBe(true);
        });

        test('should mark report as critical when INR is above configured high threshold', async () => {
            const response = await api.post('/api/patient/reports', {
                inr_value: '4.6',
                test_date: '21-02-2026'
            }, {
                headers: {
                    Authorization: `Bearer ${patientToken}`,
                }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);

            const updatedPatient = await PatientProfile.findById(patientProfile._id);
            const latestReport = updatedPatient.inr_history[updatedPatient.inr_history.length - 1];
            expect(latestReport.inr_value).toBe(4.6);
            expect(latestReport.is_critical).toBe(true);
        });

        test('should fail with invalid file type', async () => {
            const textBuffer = Buffer.from('This is not a valid report');
            const form = new FormData();

            form.append('file', textBuffer, {
                filename: 'test.txt',
                contentType: 'text/plain'
            });
            form.append('inr_value', '2.5');
            form.append('test_date', '18-02-2026');

            const response = await api.post('/api/patient/reports', form, {
                headers: {
                    Authorization: `Bearer ${patientToken}`,
                    ...form.getHeaders()
                }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
            expect(response.data.message).toContain('Invalid file type');
        });

        test('should reject a spoofed PDF MIME type before persistence', async () => {
            const pngBuffer = Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
                'base64'
            );
            const form = new FormData();
            form.append('file', pngBuffer, { filename: 'spoofed.pdf', contentType: 'application/pdf' });
            form.append('inr_value', '2.5');
            form.append('test_date', '18-02-2026');

            const before = await FileAsset.countDocuments();
            const response = await api.post('/api/patient/reports', form, {
                headers: { Authorization: `Bearer ${patientToken}`, ...form.getHeaders() }
            });

            expect(response.status).toBe(400);
            expect(response.data.message).toContain('does not match declared MIME type');
            expect(await FileAsset.countDocuments()).toBe(before);
        });

        test('should compensate the object and asset when the report write fails', async () => {
            const pdfBuffer = Buffer.from('%PDF-1.4 compensation test');
            const form = new FormData();
            form.append('file', pdfBuffer, { filename: 'compensate.pdf', contentType: 'application/pdf' });
            form.append('inr_value', '2.5');
            form.append('test_date', '18-02-2026');
            const updateSpy = jest.spyOn(PatientProfile, 'findOneAndUpdate').mockRejectedValueOnce(new Error('forced write failure'));
            const deleteMock = deleteFile as jest.Mock;

            const response = await api.post('/api/patient/reports', form, {
                headers: { Authorization: `Bearer ${patientToken}`, ...form.getHeaders() }
            });
            updateSpy.mockRestore();

            expect(response.status).toBe(500);
            expect(deleteMock).toHaveBeenCalled();
            const compensated = await FileAsset.findOne({ original_filename: 'compensate.pdf' });
            expect(compensated?.status).toBe(FileAssetStatus.DELETED);
            expect(compensated?.deleted_at).toBeDefined();
        });

        test('should fail without authentication', async () => {
            const response = await api.post('/api/patient/reports', {});

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });

        test('should retrieve reports with presigned URLs', async () => {
            // Retrieve the patient reports
            const response = await api.get('/api/patient/reports', {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.data.report.inr_history).toBeDefined();

            // Check if any report has a file_url and it's a presigned URL
            const reportsWithFiles = response.data.data.report.inr_history.filter((r: any) => r.file_url);

            if (reportsWithFiles.length > 0) {
                for (const report of reportsWithFiles) {
                    expect(report.file_url).toContain('https://');
                    expect(report.file_url).toContain('X-Amz-Algorithm');
                    expect(report.file_url).toContain('X-Amz-Signature');
                    // Ensure it's not just the S3 key
                    expect(report.file_url).not.toMatch(/^uploads\//);
                }
            }
        });

        test('should deny a FileAsset whose tenant does not match the owning report', async () => {
            const updatedPatient = await PatientProfile.findById(patientProfile._id);
            const report = updatedPatient.inr_history.find((item: any) => item.file_asset_id);
            expect(report).toBeDefined();
            const originalAssetId = report.file_asset_id;
            const foreignHospital = await Hospital.create({
                code: `FOREIGN_${Date.now()}`,
                name: 'Foreign Hospital',
                location: 'Chennai',
                admin_email: `foreign-${Date.now()}@example.com`,
            });
            const originalAsset = await FileAsset.findById(originalAssetId);
            const foreignAsset = await FileAsset.create({
                hospital_id: foreignHospital._id,
                owner_user_id: patientUser._id,
                patient_profile_id: patientProfile._id,
                purpose: originalAsset.purpose,
                storage_provider: originalAsset.storage_provider,
                bucket: originalAsset.bucket,
                object_key: `${originalAsset.object_key}.foreign`,
                original_filename: 'foreign.pdf',
                detected_mime: 'application/pdf',
                byte_size: 1,
                sha256_checksum: 'a'.repeat(64),
                status: FileAssetStatus.ACTIVE,
                created_by: patientUser._id,
            });
            report.file_asset_id = foreignAsset._id;
            await updatedPatient.save();
            const downloadMock = getDownloadUrl as jest.Mock;

            const response = await api.get('/api/patient/reports', {
                headers: { Authorization: `Bearer ${patientToken}` }
            });

            report.file_asset_id = originalAssetId;
            await updatedPatient.save();
            expect(response.status).toBe(404);
            expect(downloadMock).not.toHaveBeenCalled();
        });
    });

    describe('POST /api/patient/profile-pic', () => {
        test('should upload profile picture and return success', async () => {
            const imageBuffer = Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
                'base64'
            );
            const form = new FormData();
            form.append('file', imageBuffer, {
                filename: 'patient-profile.png',
                contentType: 'image/png'
            });

            const response = await api.post('/api/patient/profile-pic', form, {
                headers: {
                    Authorization: `Bearer ${patientToken}`,
                    ...form.getHeaders()
                }
            });

            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
            expect(response.data.message).toBe('Profile Picture successfully changed');

            // Store the key for cleanup
            const updatedUser = await User.findById(patientUser._id).populate('profile_id');
            const patientProfileData = updatedUser.profile_id as any;
            if (patientProfileData?.profile_picture_url) {
                uploadedProfilePicKey = patientProfileData.profile_picture_url;
            }
            expect(uploadedProfilePicKey).toContain(`hospitals/${hospital._id.toString()}/profiles/${patientUser._id.toString()}/`);
            expect(patientProfileData.profile_picture_file_asset_id).toBeDefined();
        });

        test('should fail with invalid file type', async () => {
            const textBuffer = Buffer.from('This is not an image');
            const form = new FormData();
            form.append('file', textBuffer, {
                filename: 'test.txt',
                contentType: 'text/plain'
            });

            const response = await api.post('/api/patient/profile-pic', form, {
                headers: {
                    Authorization: `Bearer ${patientToken}`,
                    ...form.getHeaders()
                }
            });

            expect(response.status).toBe(400);
            expect(response.data.success).toBe(false);
            expect(response.data.message).toContain('Invalid file type');
        });

        test('should fail without authentication', async () => {
            const response = await api.post('/api/patient/profile-pic', {});

            expect(response.status).toBe(401);
            expect(response.data.success).toBe(false);
        });
    });
});
