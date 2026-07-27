import { AuditLog, DoctorProfile, PatientProfile, User } from '@alias/models'
import { DEFAULT_ADMIN_ROLE_POLICIES, createRoleCapabilityMap } from '@alias/constants/admin-capabilities'
import {
  getAdminDashboardStats,
  getDoctorWorkloadStats,
  getInrComplianceStats,
  getPeriodStatistics,
  getRegistrationTrends,
} from '@alias/services/statistics.service'
import type { AdminAccessContext } from '@alias/types/admin-access'

const globalAccess: AdminAccessContext = {
  userId: '507f1f77bcf86cd799439011',
  role: 'app_admin',
  scope: 'global',
  permissions: DEFAULT_ADMIN_ROLE_POLICIES.app_admin,
  policyVersion: 3,
  readOnly: false,
}

const tenantAccess: AdminAccessContext = {
  userId: '507f1f77bcf86cd799439012',
  role: 'hospital_admin',
  scope: 'tenant',
  hospitalId: '507f1f77bcf86cd799439013',
  hospitalCode: 'PSG',
  permissions: DEFAULT_ADMIN_ROLE_POLICIES.hospital_admin,
  policyVersion: 7,
  readOnly: false,
}

describe('Wave 2 statistics access context', () => {
  afterEach(() => jest.restoreAllMocks())

  test('global dashboard returns non-clinical aggregate counts', async () => {
    jest.spyOn(User, 'countDocuments')
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(40)
      .mockResolvedValueOnce(35)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(6)
    jest.spyOn(AuditLog, 'countDocuments').mockResolvedValue(12)

    await expect(getAdminDashboardStats(globalAccess)).resolves.toMatchObject({
      scope: 'global',
      doctors: { total: 8, active: 7, recent: 2 },
      patients: { total: 40, active: 35, recent: 6 },
      audit_logs: 12,
    })
  })

  test('tenant dashboard scopes via hospital-profile aggregation without id materialization', async () => {
    const doctorFind = jest.spyOn(DoctorProfile, 'find')
    const patientFind = jest.spyOn(PatientProfile, 'find')
    const userFind = jest.spyOn(User, 'find')

    // Concurrent DoctorProfile.aggregate calls (dashboard counts + audit) — dispatch by pipeline.
    jest.spyOn(DoctorProfile, 'aggregate').mockImplementation(((pipeline: any) => {
      const serialized = JSON.stringify(pipeline)
      if (serialized.includes(AuditLog.collection.name) || serialized.includes('$unionWith')) {
        return Promise.resolve([{ total: 5 }])
      }
      return Promise.resolve([{ total: 3, active: 2, recent: 1 }])
    }) as any)
    jest.spyOn(PatientProfile, 'aggregate').mockResolvedValue([{ total: 10, active: 8, recent: 3 }] as any)

    await expect(getAdminDashboardStats(tenantAccess)).resolves.toEqual({
      scope: 'tenant',
      doctors: { total: 3, active: 2, inactive: 1, recent: 1 },
      patients: { total: 10, active: 8, inactive: 2, recent: 3 },
      audit_logs: 5,
    })

    // Must not load every profile/user _id into Node for $in filters.
    expect(doctorFind).not.toHaveBeenCalled()
    expect(patientFind).not.toHaveBeenCalled()
    expect(userFind).not.toHaveBeenCalled()
  })

  test('tenant dashboard fails closed without hospital scope', async () => {
    const missingHospital: AdminAccessContext = {
      ...tenantAccess,
      hospitalId: undefined,
    }
    await expect(getAdminDashboardStats(missingHospital)).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining('hospital administrator scope'),
    })
  })

  test('global analytics cannot expose clinical INR compliance', async () => {
    const find = jest.spyOn(PatientProfile, 'find')
    await expect(getInrComplianceStats(globalAccess)).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining('do not expose clinical INR'),
    })
    expect(find).not.toHaveBeenCalled()
  })

  test('global workload is an anonymous platform aggregate without doctor identity', async () => {
    const aggregate = jest.spyOn(PatientProfile, 'aggregate').mockResolvedValue([{
      doctors_with_active_patients: 4,
      active_patient_assignments: 18,
      maximum_assignments_per_doctor: 7,
      average_assignments_per_doctor: 4.5,
    }])
    const result = await getDoctorWorkloadStats(globalAccess)
    expect(result).toEqual({
      scope: 'global',
      doctors_with_active_patients: 4,
      active_patient_assignments: 18,
      maximum_assignments_per_doctor: 7,
      average_assignments_per_doctor: 4.5,
    })
    expect(JSON.stringify(aggregate.mock.calls[0][0])).not.toContain('doctor_name')
    expect(JSON.stringify(result)).not.toContain('doctor_name')
  })

  test('tenant workload returns per-doctor items envelope scoped by hospital_id', async () => {
    const aggregate = jest.spyOn(PatientProfile, 'aggregate').mockResolvedValue([
      {
        doctor_id: '507f1f77bcf86cd799439020',
        doctor_name: 'Dr. Tenant',
        department: 'Cardiology',
        patient_count: 4,
      },
    ])
    const doctorFind = jest.spyOn(DoctorProfile, 'find')
    const userFind = jest.spyOn(User, 'find')

    await expect(getDoctorWorkloadStats(tenantAccess)).resolves.toEqual({
      scope: 'tenant',
      items: [
        {
          doctor_id: '507f1f77bcf86cd799439020',
          doctor_name: 'Dr. Tenant',
          department: 'Cardiology',
          patient_count: 4,
        },
      ],
    })

    const pipeline = aggregate.mock.calls[0][0] as unknown as Array<Record<string, unknown>>
    const matchStage = pipeline.find(stage => stage.$match) as { $match: Record<string, unknown> }
    expect(String(matchStage.$match.hospital_id)).toBe(tenantAccess.hospitalId)
    expect(doctorFind).not.toHaveBeenCalled()
    expect(userFind).not.toHaveBeenCalled()
  })

  test('tenant analytics fails closed when its persisted capability is disabled', async () => {
    const denied: AdminAccessContext = {
      ...tenantAccess,
      permissions: createRoleCapabilityMap('hospital_admin', ['tenant.dashboard.read']),
    }
    await expect(getInrComplianceStats(denied)).rejects.toMatchObject({
      statusCode: 403,
      requiredCapability: 'tenant.analytics.read',
    })
  })

  test('tenant registration trends aggregate from hospital profiles without user id lists', async () => {
    const userFind = jest.spyOn(User, 'find')
    jest.spyOn(DoctorProfile, 'aggregate').mockResolvedValue([
      { _id: '2026-07-01', count: 2 },
    ])
    jest.spyOn(PatientProfile, 'aggregate').mockResolvedValue([
      { _id: '2026-07-02', count: 5 },
    ])

    await expect(getRegistrationTrends(tenantAccess, '7d')).resolves.toEqual({
      scope: 'tenant',
      period: '7d',
      doctors: [{ date: '2026-07-01', count: 2 }],
      patients: [{ date: '2026-07-02', count: 5 }],
    })
    expect(userFind).not.toHaveBeenCalled()
  })

  test('tenant period statistics keep response shape without materializing tenant user ids', async () => {
    const userFind = jest.spyOn(User, 'find')
    jest.spyOn(DoctorProfile, 'aggregate').mockImplementation(((pipeline: any) => {
      const serialized = JSON.stringify(pipeline)
      if (serialized.includes(AuditLog.collection.name) || serialized.includes('$unionWith')) {
        return Promise.resolve([{ _id: 'LOGIN', count: 4 }])
      }
      return Promise.resolve([{ n: 2 }])
    }) as any)
    jest.spyOn(PatientProfile, 'aggregate').mockResolvedValue([{ n: 7 }] as any)

    const result = await getPeriodStatistics(tenantAccess, '2026-07-01', '2026-07-15')
    expect(result).toMatchObject({
      scope: 'tenant',
      new_doctors: 2,
      new_patients: 7,
      audit_summary: [{ action: 'LOGIN', count: 4 }],
    })
    expect(result.period.start).toContain('2026-07-01')
    expect(userFind).not.toHaveBeenCalled()
  })
})
