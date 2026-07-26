import { AuditLog, PatientProfile, User } from '@alias/models'
import { DEFAULT_ADMIN_ROLE_POLICIES, createRoleCapabilityMap } from '@alias/constants/admin-capabilities'
import {
  getAdminDashboardStats,
  getDoctorWorkloadStats,
  getInrComplianceStats,
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
})
