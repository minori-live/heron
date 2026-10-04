import fs from "node:fs"
import fsPromises from "node:fs/promises"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createLiveRootMixerProfile } from "./live-root-mixer-profile"

afterEach(() => vi.unstubAllEnvs())

function bindings() {
  return {
    open: fs.openSync,
    write: fs.writeSync,
    readFile: fsPromises.readFile,
    instantiate: WebAssembly.instantiate,
    compile: WebAssembly.compile
  }
}

function startProfile() {
  vi.stubEnv("HERON_PROFILE_LIVE_ROOT_MIXER", "1")
  const profile = createLiveRootMixerProfile()
  if (!profile) throw new Error("Profiling was not enabled")
  return profile
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe("Live root Mixer diagnostic lifecycle", () => {
  it("restores hooks after success and preserves the observed operation result", async () => {
    const originalBindings = bindings()
    const profile = startProfile()
    const bytes = new ArrayBuffer(4)
    const blob = new Blob()
    const read = () => Promise.resolve(bytes)
    Object.defineProperty(blob, "arrayBuffer", { configurable: true, value: read })
    try {
      const result = await profile.measureArchiveOpen(async () => {
        await profile.step("prepare archive", () => Promise.resolve(blob))
        expect(fs.openSync).not.toBe(originalBindings.open)
        return profile.step("read archive", () => blob.arrayBuffer())
      })
      expect(result).toBe(bytes)
      expect(bindings()).toEqual(originalBindings)
      expect(blob.arrayBuffer).toBe(read)
      const snapshot = profile.stop()
      expect(snapshot.instrumentationErrors).toEqual([])
      expect(snapshot.archiveBlobWrapped).toBe(true)
      expect(snapshot.operations).toContainEqual(
        expect.objectContaining({
          phase: "read archive",
          operation: "archive Blob.arrayBuffer",
          failures: 0
        })
      )
      expect(snapshot.pending).toEqual([])
    } finally {
      profile.stop()
    }
  })

  it("restores hooks and preserves an operation failure", async () => {
    const originalBindings = bindings()
    const profile = startProfile()
    const failure = new Error("owned diagnostic failure")
    try {
      await expect(
        profile.measureArchiveOpen(() => profile.step("open", () => Promise.reject(failure)))
      ).rejects.toBe(failure)
      expect(bindings()).toEqual(originalBindings)
      expect(profile.stop().instrumentationErrors).toEqual([])
    } finally {
      profile.stop()
    }
  })

  it("restores immediately on abort and retains a stable pending snapshot after late completion", async () => {
    const originalBindings = bindings()
    const profile = startProfile()
    const controller = new AbortController()
    const started = deferred<void>()
    const completion = deferred<ArrayBuffer>()
    const bytes = new ArrayBuffer(4)
    const blob = new Blob()
    const read = () => {
      started.resolve()
      return completion.promise
    }
    Object.defineProperty(blob, "arrayBuffer", { configurable: true, value: read })
    controller.signal.addEventListener(
      "abort",
      () => {
        profile.stop()
      },
      { once: true }
    )
    const opening = profile.measureArchiveOpen(async () => {
      await profile.step("prepare archive", () => Promise.resolve(blob))
      return profile.step("read archive", () => blob.arrayBuffer())
    })
    try {
      await started.promise
      controller.abort()
      const snapshot = profile.stop()
      const recorded = structuredClone(snapshot)
      expect(bindings()).toEqual(originalBindings)
      expect(blob.arrayBuffer).toBe(read)
      expect(snapshot.pending).toContainEqual(
        expect.objectContaining({
          phase: "read archive",
          operation: "archive Blob.arrayBuffer"
        })
      )
      completion.resolve(bytes)
      expect(await opening).toBe(bytes)
      expect(profile.stop()).toEqual(recorded)
      expect(bindings()).toEqual(originalBindings)
    } finally {
      completion.resolve(bytes)
      await opening
      profile.stop()
    }
  })
})
