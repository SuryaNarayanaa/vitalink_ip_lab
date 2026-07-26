import mongoose, { type Connection, type ClientSession } from 'mongoose'
import { GenericContainer, type StartedTestContainer } from 'testcontainers'

const DEFAULT_IMAGE = 'mongo:7.0'
const DEFAULT_REPLICA_SET = 'rs0'
const MONGO_PORT = 27017

export class DockerUnavailableError extends Error {
  readonly blocked = true

  constructor(cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(
      'BLOCKED: Docker/Testcontainers is unavailable, so the MongoDB replica-set integration test did not run. ' +
      `Start a Docker-compatible Linux container runtime and retry. Original error: ${detail}`,
      { cause },
    )
    this.name = 'DockerUnavailableError'
  }
}

export type MongoReplicaSetHarness = {
  container: StartedTestContainer
  replicaSetName: string
  databaseName: string
  uri: string
  createConnection(): Promise<Connection>
  stop(): Promise<void>
}

export type MongoReplicaSetOptions = {
  databaseName?: string
  image?: string
  replicaSetName?: string
  startupTimeoutMs?: number
}

function dockerRuntimeIsUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /could not find a working container runtime strategy|no docker client strategy|docker.*(unavailable|not running|daemon)|connect .*docker|econnrefused|named pipe/i.test(message)
}

async function execOrThrow(container: StartedTestContainer, command: string[], label: string) {
  const result = await container.exec(command)
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${result.exitCode}: ${result.output}`)
  }
}

/**
 * Starts a real single-node replica set. Do not replace this with a standalone
 * mongod or an in-memory mock: policy, revision, and audit writes must be
 * exercised through transaction-capable MongoDB.
 */
export async function startMongoReplicaSet(
  options: MongoReplicaSetOptions = {},
): Promise<MongoReplicaSetHarness> {
  const image = options.image ?? DEFAULT_IMAGE
  const replicaSetName = options.replicaSetName ?? DEFAULT_REPLICA_SET
  const databaseName = options.databaseName ?? 'admin_rbac_wave1_test'
  let container: StartedTestContainer

  try {
    container = await new GenericContainer(image)
      .withCommand(['--replSet', replicaSetName, '--bind_ip_all'])
      .withExposedPorts(MONGO_PORT)
      .withStartupTimeout(options.startupTimeoutMs ?? 120_000)
      .start()
  } catch (error) {
    if (dockerRuntimeIsUnavailable(error)) throw new DockerUnavailableError(error)
    // Container startup failures (including image-pull/runtime failures) block
    // the integration environment; they must never be converted into a skip.
    throw new DockerUnavailableError(error)
  }

  try {
    const initiate = [
      'mongosh',
      '--quiet',
      '--eval',
      `rs.initiate({_id:${JSON.stringify(replicaSetName)},members:[{_id:0,host:'127.0.0.1:${MONGO_PORT}'}]})`,
    ]
    await execOrThrow(container, initiate, 'MongoDB replica-set initiation')
    await execOrThrow(container, [
      'bash',
      '-c',
      "until mongosh --quiet --eval 'if (!db.hello().isWritablePrimary) quit(1)' >/dev/null 2>&1; do sleep 0.2; done",
    ], 'MongoDB primary election')
  } catch (error) {
    await container.stop().catch(() => undefined)
    throw error
  }

  const host = container.getHost()
  const mappedPort = container.getMappedPort(MONGO_PORT)
  const uri = `mongodb://${host}:${mappedPort}/${databaseName}?replicaSet=${encodeURIComponent(replicaSetName)}&directConnection=true`
  let stopped = false

  return {
    container,
    replicaSetName,
    databaseName,
    uri,
    async createConnection() {
      return mongoose.createConnection(uri, {
        serverSelectionTimeoutMS: 10_000,
      }).asPromise()
    },
    async stop() {
      if (stopped) return
      stopped = true
      await container.stop()
    },
  }
}

export async function withMongoTransaction<T>(
  connection: Connection,
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await connection.startSession()
  try {
    let result: T | undefined
    await session.withTransaction(async () => {
      result = await work(session)
    })
    return result as T
  } finally {
    await session.endSession()
  }
}

/** Verifies both commit and rollback semantics on the supplied connection. */
export async function assertTransactionCapability(connection: Connection): Promise<void> {
  const collection = connection.db!.collection('__rbac_transaction_probe')
  await collection.deleteMany({})

  await withMongoTransaction(connection, async session => {
    await collection.insertOne({ outcome: 'committed' }, { session })
  })

  const rollbackMarker = new Error('intentional transaction rollback probe')
  await expect(withMongoTransaction(connection, async session => {
    await collection.insertOne({ outcome: 'rolled-back' }, { session })
    throw rollbackMarker
  })).rejects.toBe(rollbackMarker)

  await expect(collection.countDocuments({ outcome: 'committed' })).resolves.toBe(1)
  await expect(collection.countDocuments({ outcome: 'rolled-back' })).resolves.toBe(0)
  await collection.drop()
}
