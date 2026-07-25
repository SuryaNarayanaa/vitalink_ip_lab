import mongoose, { type ClientSession, type Model } from 'mongoose'
import AdminProfile from '../../src/models/adminprofile.model'
import AuditLog from '../../src/models/auditlog.model'
import AuthSession from '../../src/models/authsession.model'
import DeviceToken from '../../src/models/DeviceToken.model'
import DoctorProfile from '../../src/models/doctorprofile.model'
import Hospital from '../../src/models/hospital.model'
import Invoice from '../../src/models/invoice.model'
import Notification from '../../src/models/notification.model'
import PatientProfile from '../../src/models/patientprofile.model'
import SystemConfig from '../../src/models/systemconfig.model'
import User from '../../src/models/user.model'
import type { FixtureResourceKind, OwnershipSignature, PlannedFixture } from './types'

const models: Partial<Record<FixtureResourceKind, Model<any>>> = {
  hospital: Hospital,
  adminProfile: AdminProfile,
  doctorProfile: DoctorProfile,
  patientProfile: PatientProfile,
  user: User,
  authSession: AuthSession,
  systemConfig: SystemConfig,
  notification: Notification,
  deviceToken: DeviceToken,
  invoice: Invoice,
  auditLog: AuditLog,
}

export async function connectFixtureDatabase(uri: string): Promise<void> {
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    maxPoolSize: 10,
    autoIndex: true,
  })
}

export async function disconnectFixtureDatabase(): Promise<void> {
  await mongoose.disconnect()
}

function dottedFilter(signature: OwnershipSignature): Record<string, string | number | boolean> {
  return { [signature.path]: signature.value }
}

export async function findOwnedResource(resource: Pick<PlannedFixture, 'kind' | 'collection' | 'id' | 'signature'>): Promise<boolean> {
  const collection = mongoose.connection.collection(resource.collection)
  return Boolean(await collection.findOne({ _id: new mongoose.Types.ObjectId(resource.id), ...dottedFilter(resource.signature) }))
}

export async function resourceExists(resource: Pick<PlannedFixture, 'collection' | 'id'>): Promise<boolean> {
  const collection = mongoose.connection.collection(resource.collection)
  return Boolean(await collection.findOne({ _id: new mongoose.Types.ObjectId(resource.id) }, { projection: { _id: 1 } }))
}

export async function createResource(resource: PlannedFixture, session: ClientSession): Promise<void> {
  const document = { ...resource.document, _id: new mongoose.Types.ObjectId(resource.id) }
  if (resource.kind === 'runSentinel') {
    await mongoose.connection.collection(resource.collection).insertOne(document, { session })
    return
  }
  const model = models[resource.kind]
  if (!model) throw new Error(`No model registered for fixture kind ${resource.kind}`)
  const instance = new model(document)
  await instance.save({ session })
}

export async function deleteOwnedResource(entry: {
  collection: string
  id: string
  signature: OwnershipSignature
}): Promise<{ deleted: boolean; existsButNotOwned: boolean }> {
  const collection = mongoose.connection.collection(entry.collection)
  const id = new mongoose.Types.ObjectId(entry.id)
  const result = await collection.deleteOne({ _id: id, ...dottedFilter(entry.signature) })
  if (result.deletedCount === 1) return { deleted: true, existsButNotOwned: false }
  const exists = Boolean(await collection.findOne({ _id: id }, { projection: { _id: 1 } }))
  return { deleted: false, existsButNotOwned: exists }
}

export async function withFixtureTransaction(work: (session: ClientSession) => Promise<void>): Promise<void> {
  const session = await mongoose.startSession()
  try {
    await session.withTransaction(() => work(session), {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
    })
  } finally {
    await session.endSession()
  }
}
