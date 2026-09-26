import { randomUUID } from "node:crypto"
import { parentPort } from "node:worker_threads"
import type {
  LiveWorkerRequest,
  LiveWorkerResponse,
  LiveWorkerResultMap
} from "@heron/project-db/live-protocol"
import type { LiveDatabase as LiveDatabaseInstance } from "@heron/project-db/live-node"

if (!parentPort) throw new Error("Live worker requires a parent port")
const port = parentPort
let database: LiveDatabaseInstance | null = null
let liveDatabaseModule: Promise<typeof import("@heron/project-db/live-node")> | null = null

async function closeCurrent(): Promise<void> {
  const current = database
  database = null
  await current?.close()
}

function requireDatabase(): LiveDatabaseInstance {
  if (!database) throw new Error("No Live document is open")
  return database
}

async function handle(
  request: LiveWorkerRequest
): Promise<LiveWorkerResultMap[keyof LiveWorkerResultMap]> {
  switch (request.type) {
    case "create":
      await closeCurrent()
      liveDatabaseModule ??= import("@heron/project-db/live-node")
      database = await (
        await liveDatabaseModule
      ).LiveDatabase.create(request.dataDir, request.configuration)
      return
    case "open":
      await closeCurrent()
      liveDatabaseModule ??= import("@heron/project-db/live-node")
      database = await (
        await liveDatabaseModule
      ).LiveDatabase.open(request.dataDir, request.archivePath)
      return
    case "configuration":
      return requireDatabase().configuration()
    case "update-configuration":
      return requireDatabase().updateConfiguration(request.configuration, request.expectedRevision)
    case "revision":
      return requireDatabase().revision()
    case "mixer-snapshot":
      return requireDatabase().mixerSnapshot()
    case "midi-bindings":
      return requireDatabase().midiBindings()
    case "plugin-parameters":
      return requireDatabase().pluginParameterValues()
    case "replace-baseline":
      return requireDatabase().replaceBaseline(
        request.snapshot,
        request.bindings,
        request.expectedRevision
      )
    case "dump":
      return requireDatabase().dump(request.outputPath)
    case "close":
      return closeCurrent()
  }
}

let queue = Promise.resolve()
port.on("message", (request: LiveWorkerRequest) => {
  queue = queue.then(async () => {
    try {
      const value = await handle(request)
      port.postMessage({
        id: request.id,
        type: request.type,
        ok: true,
        value
      } satisfies LiveWorkerResponse)
    } catch (error) {
      const correlationId = randomUUID()
      console.error(`[live-worker] ${correlationId} request failed`, error)
      port.postMessage({
        id: request.id,
        type: request.type,
        ok: false,
        error: {
          code:
            error && typeof error === "object" && "code" in error && typeof error.code === "string"
              ? error.code
              : "live-worker-failed",
          message: correlationId
        }
      } satisfies LiveWorkerResponse)
    }
  })
})
