import { config } from '@alias/config'
import { FileAsset, PatientProfile, User } from '@alias/models'
import { FileAssetPurpose, FileAssetStatus } from '@alias/models/fileasset.model'
import { readStoredFileMetadata } from '@alias/utils/fileUpload'
import {
  createMigrationStats,
  findOrCreateAsset,
  migratePatients,
} from '@alias/scripts/backfillFileAssets'

const input = {
  objectKey: 'legacy/report.pdf',
  hospitalId: '507f1f77bcf86cd799439011',
  ownerUserId: '507f1f77bcf86cd799439012',
  patientProfileId: '507f1f77bcf86cd799439013',
  purpose: FileAssetPurpose.INR_REPORT,
}

describe('FileAsset backfill', () => {
  beforeEach(() => {
    config.bucketName = 'mock-filebase-bucket'
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('dry run validates stored bytes and performs zero writes', async () => {
    jest.spyOn(FileAsset, 'findOne').mockResolvedValueOnce(null)
    const createSpy = jest.spyOn(FileAsset, 'create')
    const stats = createMigrationStats()

    const result = await findOrCreateAsset({ ...input, execute: false }, stats)

    expect(readStoredFileMetadata).toHaveBeenCalledWith(input.objectKey, config.bucketName)
    expect(result.validated).toBe(true)
    expect(stats.wouldCreate).toBe(1)
    expect(createSpy).not.toHaveBeenCalled()
  })

  test('dry run surfaces unreadable or unsupported stored objects', async () => {
    jest.spyOn(FileAsset, 'findOne').mockResolvedValueOnce(null)
    ;(readStoredFileMetadata as jest.Mock).mockRejectedValueOnce(new Error('unsupported byte signature'))
    const createSpy = jest.spyOn(FileAsset, 'create')

    await expect(findOrCreateAsset({ ...input, execute: false }, createMigrationStats()))
      .rejects.toThrow('unsupported byte signature')
    expect(createSpy).not.toHaveBeenCalled()
  })

  test('rerun reuses an existing matching active asset without reading or creating', async () => {
    const existing = {
      _id: '507f1f77bcf86cd799439014',
      hospital_id: input.hospitalId,
      owner_user_id: input.ownerUserId,
      patient_profile_id: input.patientProfileId,
      purpose: input.purpose,
      status: FileAssetStatus.ACTIVE,
    }
    jest.spyOn(FileAsset, 'findOne').mockResolvedValueOnce(existing as any)
    const createSpy = jest.spyOn(FileAsset, 'create')

    const result = await findOrCreateAsset({ ...input, execute: true }, createMigrationStats())

    expect(result).toBe(existing)
    expect(readStoredFileMetadata).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
  })

  test('rejects an existing asset with conflicting ownership', async () => {
    jest.spyOn(FileAsset, 'findOne').mockResolvedValueOnce({
      hospital_id: '507f1f77bcf86cd799439099',
      owner_user_id: input.ownerUserId,
      patient_profile_id: input.patientProfileId,
      purpose: input.purpose,
      status: FileAssetStatus.ACTIVE,
    } as any)
    await expect(findOrCreateAsset({ ...input, execute: true }, createMigrationStats()))
      .rejects.toThrow('ownership/status conflicts')
  })

  test('recovers a partial migration by attaching an existing matching asset', async () => {
    const report: any = { _id: 'report-id', file_url: input.objectKey }
    const profile: any = {
      _id: input.patientProfileId,
      hospital_id: input.hospitalId,
      inr_history: [report],
      save: jest.fn(async () => undefined),
    }
    jest.spyOn(PatientProfile, 'find').mockReturnValueOnce({
      cursor: () => (async function* () { yield profile })(),
    } as any)
    jest.spyOn(User, 'findOne').mockReturnValueOnce({
      select: async () => ({ _id: input.ownerUserId }),
    } as any)
    jest.spyOn(FileAsset, 'findOne').mockResolvedValueOnce({
      _id: '507f1f77bcf86cd799439014',
      hospital_id: input.hospitalId,
      owner_user_id: input.ownerUserId,
      patient_profile_id: input.patientProfileId,
      purpose: input.purpose,
      status: FileAssetStatus.ACTIVE,
    } as any)

    const stats = createMigrationStats()
    await migratePatients({ execute: true }, stats)

    expect(String(report.file_asset_id)).toBe('507f1f77bcf86cd799439014')
    expect(profile.save).toHaveBeenCalledTimes(1)
    expect(stats.created).toBe(0)
    expect(stats.attached).toBe(1)
  })

  test('dry-run migration reports would-create and would-attach without saving', async () => {
    const report: any = { _id: 'report-id', file_url: input.objectKey }
    const profile: any = {
      _id: input.patientProfileId,
      hospital_id: input.hospitalId,
      inr_history: [report],
      save: jest.fn(async () => undefined),
    }
    jest.spyOn(PatientProfile, 'find').mockReturnValueOnce({
      cursor: () => (async function* () { yield profile })(),
    } as any)
    jest.spyOn(User, 'findOne').mockReturnValueOnce({
      select: async () => ({ _id: input.ownerUserId }),
    } as any)
    jest.spyOn(FileAsset, 'findOne').mockResolvedValueOnce(null)
    const createSpy = jest.spyOn(FileAsset, 'create')

    const stats = createMigrationStats()
    await migratePatients({ execute: false }, stats)

    expect(profile.save).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
    expect(stats.wouldCreate).toBe(1)
    expect(stats.wouldAttach).toBe(1)
    expect(report.file_asset_id).toBeUndefined()
  })
})
