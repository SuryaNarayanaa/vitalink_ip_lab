import { createHash, randomUUID } from 'crypto'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import client from '@alias/config/s3-client'
import { config } from '@alias/config'

export type DetectedFileType = {
  mime: 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp'
  extension: '.pdf' | '.png' | '.jpg' | '.webp'
}

export type UploadedFileMetadata = {
  bucket: string
  key: string
  originalFilename: string
  detectedMime: DetectedFileType['mime']
  byteSize: number
  sha256Checksum: string
}

export class FileValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileValidationError'
  }
}

const MIME_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
}

export function detectFileType(buffer: Buffer): DetectedFileType | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return { mime: 'application/pdf', extension: '.pdf' }
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', extension: '.png' }
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', extension: '.jpg' }
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mime: 'image/webp', extension: '.webp' }
  }
  return null
}

export function validateAndDescribeFile(file: Express.Multer.File) {
  const detected = detectFileType(file.buffer)
  if (!detected) {
    throw new FileValidationError('File content is not a supported PDF, PNG, JPEG, or WEBP file')
  }
  const declaredMime = MIME_ALIASES[file.mimetype.toLowerCase()] ?? file.mimetype.toLowerCase()
  if (declaredMime !== detected.mime) {
    throw new FileValidationError(`File content does not match declared MIME type ${file.mimetype}`)
  }
  return {
    ...detected,
    byteSize: file.buffer.length,
    sha256Checksum: createHash('sha256').update(file.buffer).digest('hex'),
  }
}

export function buildS3Key(folder: string, detectedExtension: DetectedFileType['extension']) {
  if (!['.pdf', '.png', '.jpg', '.webp'].includes(detectedExtension)) {
    throw new FileValidationError('Invalid detected file extension')
  }
  const normalizedFolder = folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!normalizedFolder || normalizedFolder.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new FileValidationError('Invalid upload folder')
  }
  return `${normalizedFolder}/${randomUUID()}${detectedExtension}`
}

async function createUploadUrl(key: string, type: string) {
  if (!config.bucketName) throw new Error('S3_BUCKET_NAME is not configured')
  const command = new PutObjectCommand({ Bucket: config.bucketName, Key: key, ContentType: type })
  return getSignedUrl(client, command, { expiresIn: 3600 })
}

export async function getUploadUrl(folder: string, file: Express.Multer.File) {
  const description = validateAndDescribeFile(file)
  const key = buildS3Key(folder, description.extension)
  return {
    uploadUrl: await createUploadUrl(key, description.mime),
    key,
    detectedMime: description.mime,
    extension: description.extension,
    byteSize: description.byteSize,
    sha256Checksum: description.sha256Checksum,
  }
}

export async function getDownloadUrl(key: string, bucket = config.bucketName) {
  if (!bucket) throw new Error('S3_BUCKET_NAME is not configured')
  const command = new GetObjectCommand({ Bucket: bucket, Key: key })
  return getSignedUrl(client, command, { expiresIn: 3600 })
}

export function isLegacyFileReferenceEligible(referenceCreatedAt: Date | string | undefined | null) {
  if (!referenceCreatedAt || Number.isNaN(config.fileAssetLegacyCutoffAt.getTime())) return false
  const createdAt = new Date(referenceCreatedAt)
  return !Number.isNaN(createdAt.getTime()) && createdAt < config.fileAssetLegacyCutoffAt
}

export async function uploadFile(folder: string, file: Express.Multer.File): Promise<UploadedFileMetadata> {
  const { uploadUrl, key, detectedMime, byteSize, sha256Checksum } = await getUploadUrl(folder, file)
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    body: file.buffer,
    headers: { 'Content-Type': detectedMime },
  })
  if (!response.ok) throw new Error(`File upload failed with status ${response.status}`)
  return {
    bucket: config.bucketName!,
    key,
    originalFilename: file.originalname,
    detectedMime,
    byteSize,
    sha256Checksum,
  }
}

export async function deleteFile(key: string, bucket = config.bucketName) {
  if (!bucket) throw new Error('S3_BUCKET_NAME is not configured')
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}

export async function readStoredFileMetadata(key: string, bucket = config.bucketName) {
  if (!bucket) throw new Error('S3_BUCKET_NAME is not configured')
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const body = response.Body
  if (!body || typeof (body as any).transformToByteArray !== 'function') {
    throw new Error(`Storage provider returned no readable body for ${key}`)
  }
  const buffer = Buffer.from(await (body as any).transformToByteArray())
  const detected = detectFileType(buffer)
  if (!detected) throw new FileValidationError(`Stored object ${key} has an unsupported byte signature`)
  return {
    bucket,
    key,
    detectedMime: detected.mime,
    byteSize: buffer.length,
    sha256Checksum: createHash('sha256').update(buffer).digest('hex'),
  }
}
