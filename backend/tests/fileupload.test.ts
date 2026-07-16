describe('hardened file upload utility', () => {
    const actual = jest.requireActual<typeof import('@alias/utils/fileUpload')>('@alias/utils/fileUpload');

    const file = (buffer: Buffer, originalname: string, mimetype: string) => ({
        buffer, originalname, mimetype,
    } as Express.Multer.File);

    test('builds UUID keys using only the byte-detected safe extension', () => {
        const key = actual.buildS3Key('hospitals/tenant/reports', '.pdf');
        expect(key).toMatch(/^hospitals\/tenant\/reports\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/);
        expect(key).not.toContain('..');
        expect(() => actual.buildS3Key('hospitals/tenant/reports', '../evil' as any))
            .toThrow('Invalid detected file extension');
    });

    test.each([
        [Buffer.from('%PDF-1.7'), 'report.exe', 'application/pdf', 'application/pdf', '.pdf'],
        [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image.txt', 'image/png', 'image/png', '.png'],
        [Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'photo.bin', 'image/jpg', 'image/jpeg', '.jpg'],
        [Buffer.from('RIFF1234WEBP'), 'photo.any', 'image/webp', 'image/webp', '.webp'],
    ])('detects signatures and computes checksums', (buffer, originalname, mimetype, expectedMime, extension) => {
        const result = actual.validateAndDescribeFile(file(buffer, originalname, mimetype));
        expect(result.mime).toBe(expectedMime);
        expect(result.extension).toBe(extension);
        expect(result.byteSize).toBe(buffer.length);
        expect(result.sha256Checksum).toMatch(/^[a-f0-9]{64}$/);
    });

    test('rejects a MIME/content mismatch', () => {
        expect(() => actual.validateAndDescribeFile(file(Buffer.from('%PDF-1.7'), 'fake.png', 'image/png')))
            .toThrow('does not match declared MIME type');
    });

    test('does not create or upload an object when the malware gate rejects the bytes', async () => {
        const malware = require('@alias/services/malware-scan.service');
        const scanSpy = jest.spyOn(malware, 'scanUploadForMalware').mockRejectedValueOnce(
            new malware.MalwareScanError('Upload rejected by malware scanner', 'INFECTED'),
        );
        const storageFetch = jest.spyOn(global, 'fetch');
        try {
            await expect(actual.uploadFile(
                'hospitals/tenant/reports',
                file(Buffer.from('%PDF-1.7 infected test'), 'report.pdf', 'application/pdf'),
            )).rejects.toMatchObject({ code: 'INFECTED' });
            expect(scanSpy).toHaveBeenCalledWith(expect.objectContaining({
                buffer: Buffer.from('%PDF-1.7 infected test'),
                detectedMime: 'application/pdf',
                sha256Checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
            }));
            expect(storageFetch).not.toHaveBeenCalled();
        } finally {
            scanSpy.mockRestore();
            storageFetch.mockRestore();
        }
    });

    test('uses the immutable deployment cutoff for legacy eligibility', () => {
        const { config } = require('@alias/config');
        const previousCutoff = config.fileAssetLegacyCutoffAt;
        config.fileAssetLegacyCutoffAt = new Date('2026-07-11T00:00:00.000Z');
        try {
            expect(actual.isLegacyFileReferenceEligible('2026-07-10T23:59:59.999Z')).toBe(true);
            expect(actual.isLegacyFileReferenceEligible('2026-07-11T00:00:00.000Z')).toBe(false);
            expect(actual.isLegacyFileReferenceEligible(undefined)).toBe(false);
        } finally {
            config.fileAssetLegacyCutoffAt = previousCutoff;
        }
    });

    test('permanently deletes every object version and delete marker', async () => {
        const storageClient = require('@alias/config/s3-client').default;
        const send = storageClient.send as jest.Mock;
        send
            .mockResolvedValueOnce({
                Versions: [{ Key: 'patient/report.pdf', VersionId: 'v2' }],
                DeleteMarkers: [{ Key: 'patient/report.pdf', VersionId: 'marker' }],
                IsTruncated: true,
                NextKeyMarker: 'patient/report.pdf',
                NextVersionIdMarker: 'v2',
            })
            .mockResolvedValueOnce({
                Versions: [{ Key: 'patient/report.pdf', VersionId: 'v1' }],
                IsTruncated: false,
            })
            .mockResolvedValueOnce({ Errors: [] });

        await actual.purgeFilePermanently('patient/report.pdf', 'patient-bucket');
        expect(send.mock.calls.map(call => call[0].constructor.name)).toEqual([
            'ListObjectVersionsCommand',
            'ListObjectVersionsCommand',
            'DeleteObjectsCommand',
        ]);
    });

    test('rechecks the lifecycle fence after scanning and PUT and cleans an object if ownership is lost', async () => {
        const presigner = require('@aws-sdk/s3-request-presigner');
        const presignSpy = jest.spyOn(presigner, 'getSignedUrl').mockResolvedValue('https://storage.example/upload');
        const storageClient = require('@alias/config/s3-client').default;
        const send = storageClient.send as jest.Mock;
        const { config } = require('@alias/config');
        const previousBucket = config.bucketName;
        const previousScanning = config.malwareScanEnabled;
        config.bucketName = 'patient-bucket';
        config.malwareScanEnabled = false;
        const storageFetch = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
        const guard = {
            assertOwned: jest.fn()
                .mockResolvedValueOnce(undefined)
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce(new Error('lease superseded')),
        };
        try {
            await expect(actual.uploadFile(
                'hospitals/tenant/reports',
                file(Buffer.from('%PDF-1.7 guarded test'), 'report.pdf', 'application/pdf'),
                guard,
            )).rejects.toThrow('lease superseded');
            expect(guard.assertOwned).toHaveBeenCalledTimes(3);
            expect(storageFetch).toHaveBeenCalledTimes(1);
            expect(send.mock.calls.some(call => call[0].constructor.name === 'DeleteObjectCommand')).toBe(true);
        } finally {
            config.bucketName = previousBucket;
            config.malwareScanEnabled = previousScanning;
            presignSpy.mockRestore();
            storageFetch.mockRestore();
        }
    });
});

describe('FileAsset lifecycle and resolution', () => {
    const { FileAsset } = require('@alias/models');
    const { FileAssetPurpose, FileAssetStatus } = require('@alias/models/fileasset.model');
    const { compensateFileAsset, resolveAssetDownloadUrl, uploadTrackedFile } = require('@alias/services/fileasset.service');
    const { getDownloadUrl, prepareFileUpload, purgeFilePermanently, putPreparedFile } = require('@alias/utils/fileUpload');

    test('marks an asset deleted after successful compensation cleanup', async () => {
        const asset: any = {
            _id: 'asset-id', object_key: 'object.pdf', bucket: 'bucket', status: FileAssetStatus.ACTIVE,
            save: jest.fn(async () => undefined),
        };
        await compensateFileAsset(asset, new Error('owning write failed'));
        expect(purgeFilePermanently).toHaveBeenCalledWith('object.pdf', 'bucket');
        expect(asset.status).toBe(FileAssetStatus.DELETED);
        expect(asset.deleted_at).toBeInstanceOf(Date);
        expect(asset.save).toHaveBeenCalled();
    });

    test('marks an asset failed when compensation cleanup fails', async () => {
        (purgeFilePermanently as jest.Mock).mockRejectedValueOnce(new Error('storage unavailable'));
        const asset: any = {
            _id: 'asset-id', object_key: 'object.pdf', bucket: 'bucket', status: FileAssetStatus.ACTIVE,
            save: jest.fn(async () => undefined),
        };
        await compensateFileAsset(asset, new Error('owning write failed'));
        expect(asset.status).toBe(FileAssetStatus.FAILED);
        expect(asset.failure_reason).toContain('storage unavailable');
    });

    test('persists a pending intent before PUT and retains failed metadata when an ambiguous upload cannot be cleaned', async () => {
        const metadata = {
            bucket: 'patient-bucket', key: 'patient/ambiguous.pdf', originalFilename: 'ambiguous.pdf',
            detectedMime: 'application/pdf', byteSize: 20, sha256Checksum: 'a'.repeat(64),
        };
        (prepareFileUpload as jest.Mock).mockResolvedValueOnce({ ...metadata, uploadUrl: 'https://storage/upload' });
        (putPreparedFile as jest.Mock).mockRejectedValueOnce(new Error('connection reset after commit'));
        (purgeFilePermanently as jest.Mock).mockRejectedValueOnce(new Error('cleanup unavailable'));
        const asset: any = {
            _id: 'pending-asset', status: FileAssetStatus.PENDING, save: jest.fn(async () => undefined),
        };
        const createSpy = jest.spyOn(FileAsset, 'create').mockResolvedValueOnce(asset);

        await expect(uploadTrackedFile('patient', { buffer: Buffer.from('%PDF-1.7') } as any, {
            hospitalId: '507f1f77bcf86cd799439011',
            ownerUserId: '507f1f77bcf86cd799439012',
            patientProfileId: '507f1f77bcf86cd799439013',
            purpose: FileAssetPurpose.INR_REPORT,
            createdBy: '507f1f77bcf86cd799439012',
        })).rejects.toThrow('connection reset after commit');

        expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ status: FileAssetStatus.PENDING }));
        expect(createSpy.mock.invocationCallOrder[0]).toBeLessThan((putPreparedFile as jest.Mock).mock.invocationCallOrder[0]);
        expect(asset.status).toBe(FileAssetStatus.FAILED);
        expect(asset.failure_reason).toContain('cleanup unavailable');
        expect(asset.save).toHaveBeenCalled();
        createSpy.mockRestore();
    });

    test('denies a scoped asset mismatch without signing an object key', async () => {
        const findSpy = jest.spyOn(FileAsset, 'findOne').mockReturnValueOnce({ lean: async () => null } as any);
        await expect(resolveAssetDownloadUrl({
            fileAssetId: '507f1f77bcf86cd799439011',
            legacyObjectKey: 'must-not-be-used.pdf',
            hospitalId: '507f1f77bcf86cd799439012',
            requesterHospitalId: '507f1f77bcf86cd799439012',
            ownerUserId: '507f1f77bcf86cd799439013',
            purpose: FileAssetPurpose.INR_REPORT,
        })).rejects.toMatchObject({ statusCode: 404 });
        expect(getDownloadUrl).not.toHaveBeenCalled();
        findSpy.mockRestore();
    });

    test('keeps the isolated legacy fallback for records without an asset id', async () => {
        const url = await resolveAssetDownloadUrl({
            legacyObjectKey: 'legacy/report.pdf',
            hospitalId: '507f1f77bcf86cd799439012',
            requesterHospitalId: '507f1f77bcf86cd799439012',
            ownerUserId: '507f1f77bcf86cd799439013',
            purpose: FileAssetPurpose.INR_REPORT,
            legacyEligible: true,
        });
        expect(url).toContain('https://');
        expect(getDownloadUrl).toHaveBeenCalledWith('legacy/report.pdf');
    });

    test('rejects legacy fallback when requester tenant is missing or the cutoff gate is false', async () => {
        await expect(resolveAssetDownloadUrl({
            legacyObjectKey: 'legacy/report.pdf',
            hospitalId: '507f1f77bcf86cd799439012',
            requesterHospitalId: undefined,
            ownerUserId: '507f1f77bcf86cd799439013',
            purpose: FileAssetPurpose.INR_REPORT,
            legacyEligible: true,
        })).rejects.toMatchObject({ statusCode: 403 });
        await expect(resolveAssetDownloadUrl({
            legacyObjectKey: 'new/arbitrary-key.pdf',
            hospitalId: '507f1f77bcf86cd799439012',
            requesterHospitalId: '507f1f77bcf86cd799439012',
            ownerUserId: '507f1f77bcf86cd799439013',
            purpose: FileAssetPurpose.INR_REPORT,
            legacyEligible: false,
        })).rejects.toMatchObject({ statusCode: 404 });
        expect(getDownloadUrl).not.toHaveBeenCalled();
    });

    test('rejects a legacy key when requester and owning hospitals differ', async () => {
        await expect(resolveAssetDownloadUrl({
            legacyObjectKey: 'legacy/cross-tenant.pdf',
            hospitalId: '507f1f77bcf86cd799439012',
            requesterHospitalId: '507f1f77bcf86cd799439099',
            ownerUserId: '507f1f77bcf86cd799439013',
            purpose: FileAssetPurpose.INR_REPORT,
            legacyEligible: true,
        })).rejects.toMatchObject({ statusCode: 403 });
        expect(getDownloadUrl).not.toHaveBeenCalled();
    });

    test('signs an authorized FileAsset against its persisted bucket', async () => {
        const findSpy = jest.spyOn(FileAsset, 'findOne').mockReturnValueOnce({
            lean: async () => ({ object_key: 'scoped/report.pdf', bucket: 'original-bucket' }),
        } as any);
        await resolveAssetDownloadUrl({
            fileAssetId: '507f1f77bcf86cd799439011',
            hospitalId: '507f1f77bcf86cd799439012',
            requesterHospitalId: '507f1f77bcf86cd799439012',
            ownerUserId: '507f1f77bcf86cd799439013',
            purpose: FileAssetPurpose.INR_REPORT,
        });
        expect(getDownloadUrl).toHaveBeenCalledWith('scoped/report.pdf', 'original-bucket');
        findSpy.mockRestore();
    });
});

describe('admin profile-picture write contract', () => {
    const { createDoctorSchema, updateDoctorSchema } = require('@alias/validators/admin.validator');

    test('rejects caller-supplied profile picture URLs on create and update', () => {
        expect(createDoctorSchema.safeParse({ body: {
            login_id: 'doctor1', password: 'Strong1!', name: 'Doctor', contact_number: '9876543210',
            profile_picture_url: 'https://storage.example/arbitrary-key.jpg',
        } }).success).toBe(false);
        expect(updateDoctorSchema.safeParse({
            params: { id: 'doctor1' },
            body: { profile_picture_url: 'https://storage.example/arbitrary-key.jpg' },
        }).success).toBe(false);
    });
});
