import path from 'path';
import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { createHash } from 'crypto';

process.env.FIREBASE_AUTH_ENABLED = 'true';

const TEST_BUCKET = 'mock-filebase-bucket';
let keyCounter = 0;
const sanitizeBaseName = (filename: string): string => {
    const ext = path.extname(filename).toLowerCase();
    return path
        .basename(filename, ext)
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'file';
};

const buildKey = (folder: string, filename: string): string => {
    const ext = path.extname(filename).toLowerCase() || '.bin';
    const base = sanitizeBaseName(filename);
    keyCounter += 1;
    return `${folder}/${base}/${String(keyCounter).padStart(5, '0')}${ext}`;
};

const buildPresignedUrl = (key: string, operation: 'GetObject' | 'PutObject'): string => {
    const encodedKey = key
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');

    const params = new URLSearchParams({
        'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
        'X-Amz-Credential': 'mock-access-key/20260222/us-east-1/s3/aws4_request',
        'X-Amz-Date': '20260222T000000Z',
        'X-Amz-Expires': '3600',
        'X-Amz-SignedHeaders': 'host',
        'X-Amz-Signature': `mock-signature-${operation.toLowerCase()}`,
        'x-id': operation,
    });

    return `https://s3.filebase.com/${TEST_BUCKET}/${encodedKey}?${params.toString()}`;
};

const sendMock = jest.fn(async (command: any) => ({
    $metadata: { httpStatusCode: 200 },
    key: command?.input?.Key,
    bucket: command?.input?.Bucket,
}));

jest.mock('@alias/config/s3-client', () => ({
    __esModule: true,
    default: {
        send: sendMock,
    },
}));

jest.mock('@alias/services/firebase-phone-auth.service', () => ({
    __esModule: true,
    toFirebaseE164: (phoneNumber: string) => phoneNumber.startsWith('+')
        ? phoneNumber
        : `+91${phoneNumber.replace(/\D/g, '')}`,
    verifyFirebasePhoneIdToken: jest.fn(async (_token: string, phoneNumber: string) => ({
        uid: `test-firebase-${phoneNumber.replace(/\D/g, '')}`,
        phone_number: phoneNumber,
    })),
}));

jest.mock('@alias/utils/fileUpload', () => {
    class FileValidationError extends Error {}
    const describe = (file: Express.Multer.File) => {
        const buffer = file.buffer;
        let detectedMime = '';
        if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') detectedMime = 'application/pdf';
        else if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) detectedMime = 'image/png';
        else if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) detectedMime = 'image/jpeg';
        else if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') detectedMime = 'image/webp';
        if (!detectedMime) throw new FileValidationError('File content is not a supported PDF, PNG, JPEG, or WEBP file');
        const declared = file.mimetype === 'image/jpg' ? 'image/jpeg' : file.mimetype;
        if (declared !== detectedMime) throw new FileValidationError(`File content does not match declared MIME type ${file.mimetype}`);
        return {
            detectedMime,
            byteSize: buffer.length,
            sha256Checksum: createHash('sha256').update(buffer).digest('hex'),
        };
    };

    const getUploadUrl = jest.fn(async (folder: string, file: Express.Multer.File) => {
        const key = buildKey(folder, file.originalname);
        const metadata = describe(file);
        return {
            key,
            uploadUrl: buildPresignedUrl(key, 'PutObject'),
            ...metadata,
        };
    });

    const getDownloadUrl = jest.fn(async (key: string) => buildPresignedUrl(key, 'GetObject'));

    const uploadFile = jest.fn(async (folder: string, file: Express.Multer.File) => {
        const originalname = file?.originalname || 'upload.bin';
        const metadata = describe(file);
        return {
            bucket: TEST_BUCKET,
            key: buildKey(folder, originalname),
            originalFilename: originalname,
            ...metadata,
        };
    });
    const deleteFile = jest.fn(async () => undefined);
    const readStoredFileMetadata = jest.fn(async (key: string) => ({
        bucket: TEST_BUCKET,
        key,
        detectedMime: 'application/pdf',
        byteSize: 16,
        sha256Checksum: 'a'.repeat(64),
    }));
    const isLegacyFileReferenceEligible = jest.fn((value: Date | string | undefined | null) => {
        if (!value) return false;
        return new Date(value) < new Date('2026-07-11T00:00:00.000Z');
    });

    return {
        __esModule: true,
        FileValidationError,
        getUploadUrl,
        getDownloadUrl,
        uploadFile,
        deleteFile,
        readStoredFileMetadata,
        isLegacyFileReferenceEligible,
    };
});

const realAxiosCreate = axios.create.bind(axios);
jest.spyOn(axios, 'create').mockImplementation((...args: Parameters<typeof axios.create>): AxiosInstance => {
    const instance = realAxiosCreate(...args);
    const realInstancePost = instance.post.bind(instance);

    jest.spyOn(instance, 'post').mockImplementation(async (url: string, ...postArgs: any[]) => {
        const response = await realInstancePost(url, ...postArgs);
        const testPath = expect.getState().testPath || '';
        const shouldCompleteLegacyRouteLogin = (
            /controller\.test\.ts$/.test(testPath) ||
            /patient_file_upload\.test\.ts$/.test(testPath)
        ) && !/authcontroller\.test\.ts$/.test(testPath);

        if (
            shouldCompleteLegacyRouteLogin &&
            url === '/api/auth/login' &&
            response?.status === 202 &&
            response?.data?.data?.auth_status === 'OTP_REQUIRED'
        ) {
            return realInstancePost('/api/auth/login/otp/verify', {
                challenge_id: response.data.data.challenge.challenge_id,
                firebase_id_token: 'test-firebase-id-token',
            });
        }

        return response;
    });

    return instance;
});
