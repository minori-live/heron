import fs from "node:fs"
import fsPromises from "node:fs/promises"
import { syncBuiltinESMExports } from "node:module"
import { basename, join } from "node:path"
import { monitorEventLoopDelay } from "node:perf_hooks"
import { fileURLToPath } from "node:url"

// Cache artifact writers before profiling can replace the filesystem methods.
const writeArtifact = fs.writeFileSync
const makeArtifactDirectory = fs.mkdirSync
const syncMethods = [
  "existsSync",
  "lstatSync",
  "statSync",
  "fstatSync",
  "mkdirSync",
  "writeFileSync",
  "openSync",
  "writeSync",
  "readSync",
  "readFileSync",
  "closeSync",
  "utimesSync",
  "chmodSync",
  "truncateSync",
  "renameSync",
  "unlinkSync",
  "rmdirSync",
  "readdirSync",
  "readlinkSync",
  "statfsSync",
  "fsyncSync",
  "fdatasyncSync"
] as const

type Method = (this: unknown, ...args: unknown[]) => unknown
type Operation = { phase: string; operation: string; startedAt: number }
type Aggregate = {
  phase: string
  operation: string
  count: number
  failures: number
  totalMs: number
  maxMs: number
}
type SlowCall = { phase: string; operation: string; elapsedMs: number; durationMs: number }

const round = (value: number): number => Math.round(value * 1000) / 1000
function cpuMilliseconds(start: NodeJS.CpuUsage): number {
  const used = process.cpuUsage(start)
  return round((used.user + used.system) / 1000)
}

function artifactName(value: unknown): string {
  const path = value instanceof URL ? fileURLToPath(value) : typeof value === "string" ? value : ""
  const name = basename(path)
  return name === "pglite.data" || name === "pglite.wasm" || name === "initdb.wasm" ? name : "other"
}

/** Diagnostic instrumentation for one root Mixer test; never imported by production. */
export function createLiveRootMixerProfile() {
  if (process.env.HERON_PROFILE_LIVE_ROOT_MIXER !== "1") return undefined

  const aggregates = new Map<string, Aggregate>()
  const pending = new Map<number, Operation>()
  const slowCalls: SlowCall[] = []
  const restorers: Array<() => void> = []
  const instrumentationErrors: string[] = []
  const loopDelay = monitorEventLoopDelay({ resolution: 10 })
  const loopStartedAt = performance.now()
  loopDelay.enable()
  let phase = "open archive and migrate"
  let nextId = 0
  let syncDepth = 0
  let nestedSyncCalls = 0
  let active = false
  let stopped = false
  let archiveBlobWrapped = false
  let openStartedAt: number | undefined
  let openStartedCpu: NodeJS.CpuUsage | undefined
  let openDurationMs: number | undefined
  let openCpuMs: number | undefined
  let snapshot: ReturnType<typeof capture> | undefined

  function record(start: Operation, failed: boolean): void {
    if (!active) return
    const durationMs = performance.now() - start.startedAt
    const key = `${start.phase}\n${start.operation}`
    let aggregate = aggregates.get(key)
    if (!aggregate) {
      aggregate = {
        phase: start.phase,
        operation: start.operation,
        count: 0,
        failures: 0,
        totalMs: 0,
        maxMs: 0
      }
      aggregates.set(key, aggregate)
    }
    aggregate.count++
    aggregate.failures += Number(failed)
    aggregate.totalMs += durationMs
    aggregate.maxMs = Math.max(aggregate.maxMs, durationMs)
    // A bounded list locates unusually slow calls without logging every file operation.
    if (durationMs >= 10) {
      slowCalls.push({
        phase: start.phase,
        operation: start.operation,
        elapsedMs: round(start.startedAt - (openStartedAt ?? start.startedAt)),
        durationMs: round(durationMs)
      })
      slowCalls.sort((a, b) => b.durationMs - a.durationMs)
      if (slowCalls.length > 8) slowCalls.pop()
    }
  }

  function wrapAsync(original: Method, label: (...args: unknown[]) => string): Method {
    return function (this: unknown, ...args: unknown[]) {
      if (!active) return original.apply(this, args)
      const operation = { phase, operation: label(...args), startedAt: performance.now() }
      const id = ++nextId
      pending.set(id, operation)
      let result: unknown
      try {
        result = original.apply(this, args)
      } catch (error) {
        pending.delete(id)
        record(operation, true)
        throw error
      }
      return Promise.resolve(result).then(
        (value: unknown) => {
          pending.delete(id)
          record(operation, false)
          return value
        },
        (error: unknown) => {
          pending.delete(id)
          record(operation, true)
          throw error
        }
      )
    }
  }

  function patch(object: object, name: string, wrap: (original: Method) => Method): void {
    const descriptor = Object.getOwnPropertyDescriptor(object, name)
    const original: unknown = descriptor?.value
    if (!descriptor || typeof original !== "function") {
      throw new Error(`Cannot instrument ${name}`)
    }
    Object.defineProperty(object, name, { ...descriptor, value: wrap(original as Method) })
    restorers.push(() => {
      Object.defineProperty(object, name, descriptor)
    })
  }

  function restoreHooks(): void {
    active = false
    while (restorers.length) {
      const restore = restorers.pop()
      try {
        restore?.()
      } catch {
        instrumentationErrors.push("Could not restore a profiling hook")
      }
    }
    try {
      syncBuiltinESMExports()
    } catch {
      instrumentationErrors.push("Could not refresh restored builtin exports")
    }
  }

  function installHooks(): void {
    try {
      for (const name of syncMethods) {
        patch(
          fs,
          name,
          (original) =>
            function (this: unknown, ...args: unknown[]) {
              if (!active || syncDepth > 0) {
                if (active) nestedSyncCalls++
                return original.apply(this, args)
              }
              const operation = { phase, operation: `fs.${name}`, startedAt: performance.now() }
              let failed = true
              syncDepth++
              try {
                const result = original.apply(this, args)
                failed = false
                return result
              } finally {
                syncDepth--
                record(operation, failed)
              }
            }
        )
      }
      patch(fsPromises, "readFile", (original) =>
        wrapAsync(original, (path) => `fs.promises.readFile: ${artifactName(path)}`)
      )
      for (const name of ["compile", "instantiate"] as const) {
        patch(WebAssembly, name, (original) =>
          wrapAsync(
            original,
            (input) =>
              `WebAssembly.${name}: ${input instanceof WebAssembly.Module ? "module" : "bytes"}`
          )
        )
      }
      syncBuiltinESMExports()
      active = true
    } catch {
      instrumentationErrors.push(
        "Profiling hook installation failed; archive open continues without hooks"
      )
      restoreHooks()
    }
  }

  function wrapArchiveBlob(blob: Blob): void {
    const original = blob.arrayBuffer.bind(blob)
    const descriptor = Object.getOwnPropertyDescriptor(blob, "arrayBuffer")
    try {
      Object.defineProperty(blob, "arrayBuffer", {
        configurable: true,
        writable: true,
        value: wrapAsync(original, () => "archive Blob.arrayBuffer")
      })
      restorers.push(() => {
        if (descriptor) Object.defineProperty(blob, "arrayBuffer", descriptor)
        else Reflect.deleteProperty(blob, "arrayBuffer")
      })
      archiveBlobWrapped = true
    } catch {
      instrumentationErrors.push("Could not instrument the archive Blob arrayBuffer method")
    }
  }

  function capture() {
    const now = performance.now()
    return {
      enabled: true,
      scope:
        "Filesystem and WASM hooks cover archive open only; event-loop sampling covers the root test until stop",
      archiveBlobWrapped,
      instrumentationErrors: [...instrumentationErrors],
      archiveOpen:
        openStartedAt === undefined
          ? null
          : {
              durationMs: openDurationMs ?? round(now - openStartedAt),
              cpuMs: openCpuMs ?? (openStartedCpu ? cpuMilliseconds(openStartedCpu) : null)
            },
      memory: process.memoryUsage(),
      nestedSyncCallsExcluded: nestedSyncCalls,
      operations: [...aggregates.values()].map((item) => ({
        ...item,
        totalMs: round(item.totalMs),
        maxMs: round(item.maxMs)
      })),
      slowCalls: slowCalls.map((item) => ({ ...item })),
      pending: [...pending.values()].map((item) => ({
        phase: item.phase,
        operation: item.operation,
        elapsedMs: round(now - item.startedAt)
      })),
      eventLoop: {
        resolutionMs: 10,
        windowMs: round(now - loopStartedAt),
        samples: loopDelay.count,
        maxDelayMs: loopDelay.count ? round(loopDelay.max / 1e6) : null,
        meanDelayMs: loopDelay.count ? round(loopDelay.mean / 1e6) : null,
        bounds:
          "No added waits or yields. Sampling includes earlier root-test stages, has no phase attribution, and can miss a final uninterrupted stall."
      },
      measurementNotes:
        "Hooks add clock reads, bookkeeping, and Promise continuations. Sync totals count outermost calls only; async spans and phases overlap and must not be summed. Filesystem failure counts include expected missing-file checks, not just test failures. CPU is process-wide. Blob internals and methods cached before installation can bypass filesystem hooks. No operating-system cache flush is performed."
    }
  }

  function stop(): ReturnType<typeof capture> {
    if (snapshot) return snapshot
    stopped = true
    restoreHooks()
    loopDelay.disable()
    snapshot = capture()
    return snapshot
  }

  return {
    stop,
    async measureArchiveOpen<T>(operation: () => Promise<T>): Promise<T> {
      if (stopped) return operation()
      installHooks()
      openStartedAt = performance.now()
      openStartedCpu = process.cpuUsage()
      try {
        return await operation()
      } finally {
        if (!stopped) {
          openDurationMs = round(performance.now() - openStartedAt)
          openCpuMs = cpuMilliseconds(openStartedCpu)
        }
        restoreHooks()
      }
    },
    async step<T>(name: string, operation: () => Promise<T>): Promise<T> {
      const previousPhase = phase
      phase = name
      try {
        const result = await operation()
        if (active && result instanceof Blob) wrapArchiveBlob(result)
        return result
      } finally {
        phase = previousPhase
      }
    }
  }
}

/** Called only after profiling has stopped, including on timeout. */
export function writeLiveRootMixerTrace(
  report: { sampleId: string; pid: number } & Record<string, unknown>
): void {
  const directory = process.env.HERON_LIVE_ROOT_MIXER_TRACE_DIR
  const path = directory
    ? join(directory, `live-root-mixer-${report.pid}-${report.sampleId}.json`)
    : null
  const artifact: { status: "disabled" | "written" | "failed"; path: string | null } = {
    status: path ? "written" : "disabled",
    path
  }
  const payload = { ...report, artifact }
  if (directory && path) {
    try {
      makeArtifactDirectory(directory, { recursive: true })
      writeArtifact(path, `${JSON.stringify(payload)}\n`, { flag: "wx" })
    } catch {
      artifact.status = "failed"
      console.error("Could not write Live root Mixer diagnostic artifact")
    }
  }
  console.error("Live root Mixer phase trace", JSON.stringify(payload))
}
