import { StatusCodes } from 'http-status-codes'
import { randomUUID } from 'crypto'
import { DoctorProfile, Hospital, PatientProfile, User } from '@alias/models'
import { HospitalStatus } from '@alias/models/hospital.model'
import { UserType } from '@alias/validators'
import { ApiError } from '@alias/utils'
import logger, { sanitizeLogText } from '@alias/utils/logger'

const LEASE_MS = 2 * 60 * 1000
const RENEW_INTERVAL_MS = Math.floor(LEASE_MS / 3)
type DoctorOperationMode = 'ASSIGNING' | 'MOVING' | 'DEACTIVATING'
type HospitalOperationMode = 'MEMBERSHIP' | 'SUSPENDING' | 'ACTIVATING'

export type DoctorOperationGuard = {
  doctor: any
  leaseId: string
  fenceToken: number
  assertOwned: () => Promise<void>
  release: () => Promise<void>
}

export type DoctorAssignmentGuard = (() => Promise<void>) & {
  assertOwned: () => Promise<void>
  leaseId: string
  fenceToken: number
}

export type HospitalLifecycleGuard = {
  hospital: any
  leaseId: string
  generation: number
  assertOwned: () => Promise<void>
  release: () => Promise<void>
}

export type AssignmentTerminalState = {
  state: 'COMMITTED' | 'SUPERSEDED' | 'QUARANTINED'
  patient: any
}

/**
 * Resolve a reassignment after a writer loses one of its lifecycle leases.
 * The patient row (including its fence) is the commit record: a stale writer
 * must never infer success merely because its intended doctor is still valid.
 */
export async function terminalizePatientAssignment(input: {
  patientProfileId: unknown
  targetDoctorUserId: unknown
  targetFence: number
  patientHospitalId: unknown
  previousDoctorId?: unknown
  reason: string
  targetGuard?: DoctorAssignmentGuard
}): Promise<AssignmentTerminalState> {
  const exactAssignment = await PatientProfile.findOne({
    _id: input.patientProfileId,
    assigned_doctor_id: input.targetDoctorUserId,
    assigned_doctor_fence: input.targetFence,
  })
  if (!exactAssignment) {
    return {
      state: 'SUPERSEDED',
      patient: await PatientProfile.findById(input.patientProfileId),
    }
  }

  let targetGuard: DoctorAssignmentGuard | undefined = input.targetGuard
  let ownsTargetGuard = false
  let membershipGuard: HospitalLifecycleGuard | undefined
  try {
    // A stale owner cannot certify a cross-document snapshot. Reacquire fresh
    // lifecycle ownership, validate while both guards are held, and move the
    // patient commit record to the new fence atomically.
    membershipGuard = await acquireHospitalMembershipGuard(input.patientHospitalId)
    if (targetGuard) {
      try {
        await targetGuard.assertOwned()
      } catch {
        // An expired but otherwise uncontested writer may be recovered by a
        // fresh fenced claim. If a successor owns the doctor, acquisition
        // fails and the patient is quarantined below.
        targetGuard = undefined
      }
    }
    if (!targetGuard) {
      targetGuard = await acquireDoctorAssignmentGuard(input.targetDoctorUserId)
      ownsTargetGuard = true
    }
    await membershipGuard.assertOwned()
    await targetGuard.assertOwned()
    const target = await User.findOne({
      _id: input.targetDoctorUserId,
      user_type: UserType.DOCTOR,
      is_active: true,
      doctor_operation_fence: targetGuard.fenceToken,
    }).select('profile_id').lean()
    const targetProfile = target
      ? !ownsTargetGuard
        ? await DoctorProfile.findOne({
            _id: target.profile_id,
            doctor_operation_fence: targetGuard.fenceToken,
          })
        : await stampDoctorProfileFence(target.profile_id, targetGuard)
      : null
    if (targetProfile && String(targetProfile.hospital_id) === String(input.patientHospitalId)) {
      await membershipGuard.assertOwned()
      await targetGuard.assertOwned()
      const recommitted = await PatientProfile.findOneAndUpdate(
        {
          _id: input.patientProfileId,
          assigned_doctor_id: input.targetDoctorUserId,
          assigned_doctor_fence: input.targetFence,
          hospital_id: input.patientHospitalId,
        },
        { $set: { assigned_doctor_fence: targetGuard.fenceToken } },
        { new: true, runValidators: true },
      )
      if (recommitted) {
        await membershipGuard.assertOwned()
        await targetGuard.assertOwned()
        return { state: 'COMMITTED', patient: recommitted }
      }
      return {
        state: 'SUPERSEDED',
        patient: await PatientProfile.findById(input.patientProfileId),
      }
    }
  } catch (error) {
    if (!(error instanceof ApiError) || error.statusCode !== StatusCodes.CONFLICT) throw error
    // Lifecycle contention means the stale writer cannot prove validity.
  } finally {
    if (targetGuard && ownsTargetGuard) await targetGuard()
    if (membershipGuard) await membershipGuard.release()
  }

  const quarantined = await PatientProfile.findOneAndUpdate(
    {
      _id: input.patientProfileId,
      assigned_doctor_id: input.targetDoctorUserId,
      assigned_doctor_fence: input.targetFence,
    },
    {
      $unset: { assigned_doctor_id: 1 },
      $set: {
        account_status: 'AssignmentConflict',
        assignment_conflict: {
          detected_at: new Date(),
          attempted_doctor_id: input.targetDoctorUserId,
          previous_doctor_id: input.previousDoctorId,
          reason: input.reason,
        },
      },
    },
    { new: true, runValidators: true },
  )
  if (quarantined) return { state: 'QUARANTINED', patient: quarantined }
  return {
    state: 'SUPERSEDED',
    patient: await PatientProfile.findById(input.patientProfileId),
  }
}

async function acquireHospitalOperationGuard(
  hospitalId: unknown,
  mode: HospitalOperationMode,
  expectedStatus?: HospitalStatus,
): Promise<HospitalLifecycleGuard> {
  const now = new Date()
  const leaseId = randomUUID()
  const transition = mode === 'SUSPENDING' ? 'SUSPENDING' : mode === 'ACTIVATING' ? 'ACTIVATING' : 'STABLE'
  const hospital = await Hospital.findOneAndUpdate(
    {
      _id: hospitalId,
      ...(expectedStatus !== undefined ? { status: expectedStatus } : {}),
      ...(mode === 'MEMBERSHIP' ? {
        status: HospitalStatus.ACTIVE,
        accepting_assignments: { $ne: false },
        lifecycle_state: { $in: ['STABLE', null] },
      } : mode === 'SUSPENDING'
        ? { lifecycle_state: { $in: ['STABLE', 'SUSPENDING', null] } }
        : { lifecycle_state: { $in: ['STABLE', 'ACTIVATING', null] } }),
      $or: [
        { 'lifecycle_lock.lease_id': { $exists: false } },
        { 'lifecycle_lock.expires_at': { $lte: now } },
      ],
    },
    {
      $inc: { lifecycle_generation: 1 },
      $set: {
        lifecycle_state: transition,
        ...(mode === 'MEMBERSHIP' ? {} : { accepting_assignments: false }),
        lifecycle_lock: { lease_id: leaseId, mode, expires_at: new Date(now.getTime() + LEASE_MS) },
      },
    },
    { new: true, runValidators: true },
  )
  if (!hospital) throw new ApiError(StatusCodes.CONFLICT, 'Hospital lifecycle operation is in progress')
  const generation = Number(hospital.lifecycle_generation)
  let released = false
  let ownershipLost = false
  const renew = async () => {
    if (released || ownershipLost) return false
    const renewalTime = new Date()
    try {
      const result = await Hospital.updateOne({
        _id: hospital._id,
        lifecycle_generation: generation,
        'lifecycle_lock.lease_id': leaseId,
        'lifecycle_lock.expires_at': { $gt: renewalTime },
      }, {
        $set: { 'lifecycle_lock.expires_at': new Date(renewalTime.getTime() + LEASE_MS) },
      })
      if (result.matchedCount === 0) ownershipLost = true
      return result.matchedCount > 0
    } catch (error) {
      ownershipLost = true
      logger.error('hospital_lifecycle.lease_renewal_failed', {
        hospital_id: String(hospital._id), mode, error: sanitizeLogText(error),
      })
      return false
    }
  }
  const renewalTimer = setInterval(() => { void renew() }, RENEW_INTERVAL_MS)
  renewalTimer.unref?.()
  const assertOwned = async () => {
    if (released || ownershipLost || !await renew()) {
      throw new ApiError(StatusCodes.CONFLICT, 'Hospital lifecycle operation was superseded')
    }
  }
  const release = async () => {
    if (released) return
    clearInterval(renewalTimer)
    try {
      await Hospital.updateOne(
        { _id: hospital._id, lifecycle_generation: generation, 'lifecycle_lock.lease_id': leaseId },
        { $unset: { lifecycle_lock: 1 } },
      )
    } catch (error) {
      logger.error('hospital_lifecycle.lease_release_failed', {
        hospital_id: String(hospital._id), mode, error: sanitizeLogText(error),
      })
    }
    released = true
  }
  return { hospital, leaseId, generation, assertOwned, release }
}

export async function acquireHospitalMembershipGuard(hospitalId: unknown) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await acquireHospitalOperationGuard(hospitalId, 'MEMBERSHIP')
    } catch (error) {
      if (!(error instanceof ApiError) || error.statusCode !== StatusCodes.CONFLICT) throw error
      const hospital = await Hospital.findById(hospitalId)
        .select('status accepting_assignments lifecycle_state')
        .lean()
      if (!hospital || hospital.status !== HospitalStatus.ACTIVE ||
        hospital.accepting_assignments === false ||
        !['STABLE', null, undefined].includes(hospital.lifecycle_state as any)) throw error
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  throw new ApiError(StatusCodes.CONFLICT, 'Hospital membership operation is busy')
}

/**
 * Lock all tenant membership sets touched by a move. Sorting prevents two
 * opposite-direction moves from deadlocking each other. Callers must retain
 * every guard until their profile commit (or compensation) is terminal.
 */
export async function acquireHospitalMembershipGuards(hospitalIds: unknown[]) {
  const uniqueIds = [...new Set(hospitalIds.filter(Boolean).map(String))].sort()
  const guards: HospitalLifecycleGuard[] = []
  try {
    for (const id of uniqueIds) guards.push(await acquireHospitalMembershipGuard(id))
    return guards
  } catch (error) {
    for (const guard of guards.reverse()) await guard.release()
    throw error
  }
}

export async function acquireHospitalTransitionGuard(
  hospitalId: unknown,
  activating: boolean,
  expectedStatus?: HospitalStatus,
) {
  return acquireHospitalOperationGuard(
    hospitalId,
    activating ? 'ACTIVATING' : 'SUSPENDING',
    expectedStatus,
  )
}

async function requireGuardedDoctorHospitalActive(doctor: any) {
  const profile = await DoctorProfile.findById(doctor.profile_id).select('hospital_id').lean()
  if (!profile?.hospital_id) {
    throw new ApiError(StatusCodes.CONFLICT, 'Doctor is not assigned to an active hospital')
  }
  const hospital = await Hospital.findOne({
    _id: profile.hospital_id,
    status: HospitalStatus.ACTIVE,
    accepting_assignments: { $ne: false },
    lifecycle_state: { $in: ['STABLE', null] },
  }).select('_id').lean()
  if (!hospital) throw new ApiError(StatusCodes.CONFLICT, 'Doctor hospital is not accepting assignments')
}

function availableLockFilter(now: Date) {
  return {
    $or: [
      { 'doctor_operation_lock.lease_id': { $exists: false } },
      { 'doctor_operation_lock.expires_at': { $lte: now } },
    ],
  }
}

async function acquireDoctorOperationGuard(
  doctorUserId: unknown,
  mode: DoctorOperationMode,
  requireActive = true,
) {
  const now = new Date()
  const leaseId = randomUUID()
  const expiresAt = new Date(now.getTime() + LEASE_MS)
  const doctor = await User.findOneAndUpdate(
    {
      _id: doctorUserId,
      user_type: UserType.DOCTOR,
      ...(requireActive ? { is_active: true } : {}),
      ...availableLockFilter(now),
    },
    {
      $inc: { doctor_operation_fence: 1 },
      $set: {
        doctor_operation_lock: {
          lease_id: leaseId,
          mode,
          expires_at: expiresAt,
        },
      },
    },
    { new: true, runValidators: true },
  )
  if (!doctor) {
    throw new ApiError(StatusCodes.CONFLICT, 'Doctor is inactive or another doctor operation is in progress')
  }

  const fenceToken = Number(doctor.doctor_operation_fence)
  let finished = false
  let ownershipLost = false

  const renew = async () => {
    if (finished || ownershipLost) return false
    const renewalTime = new Date()
    try {
      const result = await User.updateOne(
        {
          _id: doctor._id,
          'doctor_operation_lock.lease_id': leaseId,
          doctor_operation_fence: fenceToken,
          'doctor_operation_lock.expires_at': { $gt: renewalTime },
        },
        { $set: { 'doctor_operation_lock.expires_at': new Date(renewalTime.getTime() + LEASE_MS) } },
      )
      if (result.matchedCount === 0) ownershipLost = true
      return result.matchedCount > 0
    } catch (error) {
      ownershipLost = true
      logger.error('doctor_operation.lease_renewal_failed', {
        doctor_user_id: String(doctor._id),
        mode,
        error: sanitizeLogText(error),
      })
      return false
    }
  }

  const renewalTimer = setInterval(() => { void renew() }, RENEW_INTERVAL_MS)
  renewalTimer.unref?.()

  const assertOwned = async () => {
    if (finished || ownershipLost || !await renew()) {
      throw new ApiError(StatusCodes.CONFLICT, 'Doctor operation lease was lost; retry the request')
    }
  }

  const release = async () => {
    if (finished) return
    clearInterval(renewalTimer)
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await User.updateOne(
          {
            _id: doctor._id,
            'doctor_operation_lock.lease_id': leaseId,
            doctor_operation_fence: fenceToken,
          },
          { $unset: { doctor_operation_lock: 1 } },
        )
        finished = true
        return
      } catch (error) {
        if (attempt === 3) {
          logger.error('doctor_operation.lease_release_failed', {
            doctor_user_id: String(doctor._id),
            mode,
            error: sanitizeLogText(error),
          })
        }
      }
    }
    // The expiring lease is the recovery path. A committed clinical operation
    // must never be reported as failed solely because cleanup was unavailable.
    finished = true
  }
  return { doctor, leaseId, fenceToken, assertOwned, release }
}

/** Serializes assignment with deactivation and tenant changes. */
export async function acquireDoctorAssignmentGuard(doctorUserId: unknown) {
  const guard = await acquireDoctorOperationGuard(doctorUserId, 'ASSIGNING')
  try {
    await requireGuardedDoctorHospitalActive(guard.doctor)
  } catch (error) {
    await guard.release()
    throw error
  }
  const release = guard.release as DoctorAssignmentGuard
  release.assertOwned = guard.assertOwned
  release.leaseId = guard.leaseId
  release.fenceToken = guard.fenceToken
  return release
}

/**
 * Advance the fence on the resource shared by moves and assignments. Stale
 * owners include their older value in compensation CAS filters, so a successor
 * can never be overwritten by rollback from an expired operation.
 */
export async function stampDoctorProfileFence(
  doctorProfileId: unknown,
  guard: { fenceToken: number; assertOwned: () => Promise<void> },
) {
  await guard.assertOwned()
  const profile = await DoctorProfile.findOneAndUpdate(
    {
      _id: doctorProfileId,
      $or: [
        { doctor_operation_fence: { $lt: guard.fenceToken } },
        { doctor_operation_fence: { $exists: false } },
      ],
    },
    { $set: { doctor_operation_fence: guard.fenceToken } },
    { new: true, runValidators: true },
  )
  if (!profile) throw new ApiError(StatusCodes.CONFLICT, 'Doctor lifecycle fence was superseded')
  await guard.assertOwned()
  return profile
}

/** Serializes a doctor hospital move with every assignment writer. */
export async function acquireDoctorMoveGuard(doctorUserId: unknown) {
  return acquireDoctorOperationGuard(doctorUserId, 'MOVING', false)
}

/** Claim DEACTIVATING before checking assignments; acquisitions then fail closed. */
export async function deactivateDoctorWithAssignmentGuard(user: any, existingGuard?: DoctorOperationGuard) {
  if (user.user_type !== UserType.DOCTOR) {
    user.is_active = false
    await user.save()
    return user
  }

  if (!user.is_active) return user
  const guard = existingGuard ?? await acquireDoctorOperationGuard(user._id, 'DEACTIVATING')
  try {
    await guard.assertOwned()
    const assignedPatients = await PatientProfile.countDocuments({
      assigned_doctor_id: { $in: [user._id, user.profile_id] },
      account_status: 'Active',
    })
    if (assignedPatients > 0) {
      throw new ApiError(StatusCodes.CONFLICT, 'Reassign active patients before deactivating this doctor')
    }

    await guard.assertOwned()

    const deactivated = await User.findOneAndUpdate(
      {
        _id: user._id,
        is_active: true,
        'doctor_operation_lock.lease_id': guard.leaseId,
        doctor_operation_fence: guard.fenceToken,
        'doctor_operation_lock.expires_at': { $gt: new Date() },
      },
      existingGuard
        ? { $set: { is_active: false } }
        : { $set: { is_active: false }, $unset: { doctor_operation_lock: 1 } },
      { new: true, runValidators: true },
    )
    if (deactivated) return deactivated
    throw new ApiError(StatusCodes.CONFLICT, 'Doctor state changed while deactivation was being applied')
  } finally {
    if (!existingGuard) await guard.release()
  }
}
