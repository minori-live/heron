import { Worker } from "node:worker_threads"
import type {
  LiveDocumentConfiguration,
  LiveMidiBinding,
  LivePluginParameterValue,
  LiveRuntimeSnapshot,
  MixerGraphSnapshot
} from "@heron/contracts"
import type { LiveWorkerRequest, LiveWorkerResponse } from "@heron/project-db/live-protocol"

type Request = LiveWorkerRequest extends infer R
  ? R extends LiveWorkerRequest
    ? Omit<R, "id">
    : never
  : never

export class LiveWorkerClient {
  private readonly worker: Worker
  private nextId = 1
  private closed = false
  private readonly pending = new Map<
    number,
    {
      resolve(value: unknown): void
      reject(reason: Error): void
    }
  >()

  constructor(workerUrl: URL) {
    this.worker = new Worker(workerUrl, { execArgv: [] })
    this.worker.on("message", (response: LiveWorkerResponse) => {
      const call = this.pending.get(response.id)
      if (!call) return
      this.pending.delete(response.id)
      if (response.ok) call.resolve(response.value)
      else call.reject(Object.assign(new Error(response.error.code), { code: response.error.code }))
    })
    this.worker.on("error", (error: Error) => this.fail(error))
    this.worker.on("exit", (code: number) => {
      if (!this.closed) this.fail(new Error(`Live worker exited with code ${code}`))
    })
  }

  private fail(error: Error): void {
    this.closed = true
    for (const call of this.pending.values()) call.reject(error)
    this.pending.clear()
  }

  private call<T>(request: Request): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Live worker is closed"))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject })
      try {
        this.worker.postMessage({ ...request, id })
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  create(dataDir: string, configuration: LiveDocumentConfiguration): Promise<void> {
    return this.call({ type: "create", dataDir, configuration })
  }

  open(dataDir: string, archivePath?: string): Promise<void> {
    return this.call({ type: "open", dataDir, archivePath })
  }

  configuration(): Promise<LiveDocumentConfiguration> {
    return this.call({ type: "configuration" })
  }

  updateConfiguration(
    configuration: LiveDocumentConfiguration,
    expectedRevision: number
  ): Promise<number> {
    return this.call({ type: "update-configuration", configuration, expectedRevision })
  }

  revision(): Promise<number> {
    return this.call({ type: "revision" })
  }

  mixerSnapshot(): Promise<MixerGraphSnapshot> {
    return this.call({ type: "mixer-snapshot" })
  }

  midiBindings(): Promise<LiveMidiBinding[]> {
    return this.call({ type: "midi-bindings" })
  }

  pluginParameterValues(): Promise<LivePluginParameterValue[]> {
    return this.call({ type: "plugin-parameters" })
  }

  replaceBaseline(
    snapshot: LiveRuntimeSnapshot,
    bindings: LiveMidiBinding[],
    expectedRevision: number
  ): Promise<number> {
    return this.call({ type: "replace-baseline", snapshot, bindings, expectedRevision })
  }

  dump(outputPath: string): Promise<void> {
    return this.call({ type: "dump", outputPath })
  }

  close(): Promise<void> {
    return this.call({ type: "close" })
  }

  async terminate(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.fail(new Error("Live worker was terminated"))
    await this.worker.terminate()
  }
}
