import { DoctorProfile, FileAsset, PatientProfile, User } from '@alias/models'
import { FileAssetStatus } from '@alias/models/fileasset.model'
import {
  acquirePatientFileOperationLease,
  PatientFilePurgeError,
  getPatientFilePurgePlan,
  purgePatientFileAssets,
} from '@alias/services/patient-file-purge.service'
import { purgeFilePermanently } from '@alias/utils/fileUpload'
import { config } from '@alias/config'

const target = {
  patientProfileId: '507f1f77bcf86cd799439011',
  ownerUserId: '507f1f77bcf86cd799439012',
}

function context(options: { active?: boolean; assets?: any[] } = {}) {
  jest.spyOn(PatientProfile, 'findById').mockReturnValue({
    lean: async () => ({
      _id: target.patientProfileId,
      hospital_id: '507f1f77bcf86cd799439013',
      account_status: options.active ? 'Active' : 'Discharged',
      profile_picture_url: 'legacy/profile.jpg',
      inr_history: [
        { file_url: 'legacy/report.pdf' },
        { file_url: 'tracked/report.pdf', file_asset_id: '507f1f77bcf86cd799439099' },
      ],
    }),
  } as any)
  jest.spyOn(User, 'findOne').mockReturnValue({
    lean: async () => ({ _id: target.ownerUserId, profile_id: target.patientProfileId, is_active: options.active ?? false }),
  } as any)
  jest.spyOn(FileAsset, 'find').mockResolvedValue(options.assets ?? [] as any)
  jest.spyOn(FileAsset, 'findOne').mockReturnValue({ select: () => ({ lean: async () => null }) } as any)
  jest.spyOn(PatientProfile, 'findOne').mockReturnValue({ select: () => ({ lean: async () => null }) } as any)
  jest.spyOn(DoctorProfile, 'findOne').mockReturnValue({ select: () => ({ lean: async () => null }) } as any)
  jest.spyOn(PatientProfile, 'updateOne').mockResolvedValue({ matchedCount: 1, modifiedCount: 1 } as any)
  jest.spyOn(PatientProfile, 'findOneAndUpdate').mockReturnValue({ select: async () => ({ _id: target.patientProfileId }) } as any)
  jest.spyOn(FileAsset, 'countDocuments').mockResolvedValue(0)
  jest.spyOn(FileAsset, 'updateOne').mockResolvedValue({ matchedCount: 1, modifiedCount: 1 } as any)
}

describe('patient file purge workflow', () => {
  afterEach(() => jest.restoreAllMocks())

  test('refuses to purge files for an active patient', async () => {
    context({ active: true })
    await expect(getPatientFilePurgePlan(target)).rejects.toMatchObject({ statusCode: 409 })
    expect(purgeFilePermanently).not.toHaveBeenCalled()
  })

  test('uses an atomic expiring upload lease and releases it idempotently', async () => {
    context()
    const lease = await acquirePatientFileOperationLease(target.patientProfileId)
    expect(PatientProfile.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: target.patientProfileId, account_status: 'Active' }),
      expect.objectContaining({ $push: expect.any(Object) }),
    )
    await lease.release()
    await lease.release()
    expect(PatientProfile.updateOne).toHaveBeenCalledTimes(2)
  })

  test('relies on lease expiry instead of failing an upload when release persistence is unavailable', async () => {
    context()
    ;(PatientProfile.updateOne as jest.Mock)
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 })
      .mockRejectedValueOnce(new Error('database unavailable'))
    const lease = await acquirePatientFileOperationLease(target.patientProfileId)
    await expect(lease.release()).resolves.toBeUndefined()
  })

  test('prevents a second purge runner from entering an existing PURGING state', async () => {
    context()
    ;(PatientProfile.findOneAndUpdate as jest.Mock).mockReturnValueOnce({ select: async () => null })
    await expect(purgePatientFileAssets(target)).rejects.toMatchObject({ statusCode: 409 })
    expect(purgeFilePermanently).not.toHaveBeenCalled()
  })

  test('deletes tracked and legacy objects before removing file metadata', async () => {
    const asset: any = {
      _id: 'asset-1',
      object_key: 'tracked/report.pdf',
      bucket: config.bucketName,
      status: FileAssetStatus.ACTIVE,
      save: jest.fn(async () => undefined),
    }
    context({ assets: [asset] })
    const deleteMany = jest.spyOn(FileAsset, 'deleteMany').mockResolvedValue({ deletedCount: 1 } as any)

    await expect(purgePatientFileAssets(target)).resolves.toEqual({
      trackedObjectsDeleted: 1,
      legacyObjectsDeleted: 2,
      metadataRecordsDeleted: 1,
      failures: 0,
    })
    expect(purgeFilePermanently).toHaveBeenCalledWith('tracked/report.pdf', config.bucketName)
    expect(purgeFilePermanently).toHaveBeenCalledWith('legacy/profile.jpg')
    expect(purgeFilePermanently).toHaveBeenCalledWith('legacy/report.pdf')
    expect(FileAsset.updateOne).toHaveBeenCalledWith(
      { _id: 'asset-1' },
      expect.objectContaining({ $set: expect.objectContaining({ status: FileAssetStatus.DELETED }) }),
    )
    expect(deleteMany).toHaveBeenCalled()
  })

  test('records a retryable failure and preserves metadata when any object deletion fails', async () => {
    const asset: any = {
      _id: 'asset-1',
      object_key: 'tracked/report.pdf',
      bucket: config.bucketName,
      status: FileAssetStatus.ACTIVE,
      save: jest.fn(async () => undefined),
    }
    context({ assets: [asset] })
    const deleteMany = jest.spyOn(FileAsset, 'deleteMany')
    ;(purgeFilePermanently as jest.Mock).mockRejectedValueOnce(new Error('storage unavailable'))

    await expect(purgePatientFileAssets(target)).rejects.toBeInstanceOf(PatientFilePurgeError)
    expect(FileAsset.updateOne).toHaveBeenCalledWith(
      { _id: 'asset-1', status: { $ne: FileAssetStatus.DELETED } },
      expect.objectContaining({ $set: expect.objectContaining({ status: FileAssetStatus.FAILED }) }),
    )
    expect(deleteMany).not.toHaveBeenCalled()
  })

  test('retry removes already-deleted metadata without deleting its object again', async () => {
    const asset = {
      _id: 'asset-1',
      object_key: 'tracked/report.pdf',
      bucket: config.bucketName,
      status: FileAssetStatus.DELETED,
      save: jest.fn(),
    }
    context({ assets: [asset] })
    jest.spyOn(FileAsset, 'deleteMany').mockResolvedValue({ deletedCount: 1 } as any)

    await purgePatientFileAssets(target)
    expect(purgeFilePermanently).not.toHaveBeenCalledWith('tracked/report.pdf', config.bucketName)
    expect(asset.save).not.toHaveBeenCalled()
  })

  test('treats embedded keys as legacy when their referenced metadata is missing or stale', async () => {
    context({ assets: [] })
    await expect(getPatientFilePurgePlan(target)).resolves.toEqual({
      trackedObjects: 0,
      trackedMetadataRecords: 0,
      legacyObjects: 3,
    })
  })
})
