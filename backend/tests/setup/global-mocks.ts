import path from 'path';
import axios from 'axios';
import type { AxiosInstance } from 'axios';

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

jest.mock('@alias/utils/fileUpload', () => {
    const getUploadUrl = jest.fn(async (folder: string, filename: string) => {
        const key = buildKey(folder, filename);
        return {
            key,
            uploadUrl: buildPresignedUrl(key, 'PutObject'),
        };
    });

    const getDownloadUrl = jest.fn(async (key: string) => buildPresignedUrl(key, 'GetObject'));

    const uploadFile = jest.fn(async (folder: string, file: Express.Multer.File) => {
        const originalname = file?.originalname || 'upload.bin';
        return buildKey(folder, originalname);
    });

    return {
        __esModule: true,
        getUploadUrl,
        getDownloadUrl,
        uploadFile,
    };
});

const mockTwilioVerifyPost = async (url: string) => {
    if (url.includes('verify.twilio.com/v2') && url.includes('/Verifications')) {
        return {
            data: {
                sid: 'test-verification-id',
                status: 'pending',
                channel: 'sms',
                to: 'test-recipient',
            },
        };
    }

    if (url.includes('verify.twilio.com/v2') && url.includes('/VerificationCheck')) {
        return {
            data: {
                sid: 'test-verification-id',
                status: 'approved',
                valid: true,
                to: 'test-recipient',
            },
        };
    }

    throw new Error(`Unexpected axios.post call in tests: ${url}`);
};

const realAxiosCreate = axios.create.bind(axios);
jest.spyOn(axios, 'create').mockImplementation((...args: Parameters<typeof axios.create>): AxiosInstance => {
    const instance = realAxiosCreate(...args);
    const realInstancePost = instance.post.bind(instance);

    jest.spyOn(instance, 'post').mockImplementation(async (url: string, ...postArgs: any[]) => {
        if (url.includes('verify.twilio.com/v2')) {
            return mockTwilioVerifyPost(url);
        }

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
                code: '000000',
            });
        }

        return response;
    });

    return instance;
});
