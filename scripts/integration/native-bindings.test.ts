import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

type NativeHostResponse = {
  body: Buffer
}

type AudioHostRuntime = {
  request: (request: Buffer) => Promise<NativeHostResponse>
  heartbeat: (request: Buffer) => Promise<NativeHostResponse>
  drainUiWork: () => boolean
  close: () => void
}

type NativeBindings = {
  AudioHostRuntime: new (
    workerThreads?: number,
    maxBlockingThreads?: number,
    editorOwnerWindowHandle?: Buffer,
    uiWakeCallback?: () => unknown
  ) => AudioHostRuntime
  analyzeWaveform: (path: string) => Promise<{
    channels: number
    frameCount: number
    sampleRate: number
    waveformLevels: unknown[]
  }>
  finalizeRecording: (config: {
    inputPath: string
    outputPath: string
    targetSampleRate: number
    bitDepth: string
    assetId: string
    originator: string
    originationDate: string
    originationTime: string
    timeReference: number
  }) => Promise<{
    path: string
    contentHash: string
    sampleRate: number
    channels: number
    bitDepth: string
    frameCount: number
    timeReference: number
    waveformLevels: unknown[]
  }>
  engineInfo: () => { backend: string; nodeApi: number; version: string }
  processGain: (samples: number[], gain: number) => { samples: number[]; peak: number }
  writeDeterministicTestRecording: (
    config: {
      path: string
      assetId: string
      originator: string
      originationDate: string
      originationTime: string
      timeReference: number
    },
    sampleRate: number,
    frameCount: number
  ) => { channels: number; frameCount: number; sampleRate: number }
}

const require = createRequire(import.meta.url)
const desktopRequire = createRequire(new URL("../../apps/desktop/package.json", import.meta.url))
const { decode, encode } = desktopRequire("@msgpack/msgpack") as {
  decode: (value: Uint8Array) => unknown
  encode: (value: unknown) => Uint8Array
}
const {
  AudioHostRuntime,
  analyzeWaveform,
  engineInfo,
  finalizeRecording,
  processGain,
  writeDeterministicTestRecording
} = require("../../crates/dsp-node") as NativeBindings
const expectedVersion = (await readFile(new URL("../../VERSION", import.meta.url), "utf8")).trim()

await test("native DSP binding processes values across the napi boundary", () => {
  assert.deepEqual(engineInfo(), {
    backend: "rust+napi-rs",
    nodeApi: 8,
    version: expectedVersion
  })
  assert.deepEqual(processGain([1, -0.5, 0], 2), { samples: [2, -1, 0], peak: 2 })
})

await test("native DSP binding writes, finalizes and analyzes a deterministic recording", async () => {
  const directory = await mkdtemp(join(tmpdir(), "heron-native-bindings-"))
  try {
    const path = join(directory, "recording.bwf")
    const recording = writeDeterministicTestRecording(
      {
        path,
        assetId: "coverage-fixture",
        originator: "Heron tests",
        originationDate: "2026-01-01",
        originationTime: "00:00:00",
        timeReference: 0
      },
      48_000,
      128
    )
    assert.equal(recording.channels, 2)
    assert.equal(recording.frameCount, 128)
    assert.equal(recording.sampleRate, 48_000)

    const waveform = await analyzeWaveform(path)
    assert.equal(waveform.channels, 2)
    assert.equal(waveform.frameCount, 128)
    assert.equal(waveform.sampleRate, 48_000)
    assert.ok(waveform.waveformLevels.length > 0)

    const outputPath = join(directory, "finalized.bwf")
    const finalized = await finalizeRecording({
      inputPath: path,
      outputPath,
      targetSampleRate: 48_000,
      bitDepth: "pcm24",
      assetId: "finalized-fixture",
      originator: "Heron tests",
      originationDate: "2026-01-01",
      originationTime: "00:00:00",
      timeReference: 42
    })
    assert.equal(finalized.path, outputPath)
    assert.equal(finalized.sampleRate, 48_000)
    assert.equal(finalized.channels, 2)
    assert.equal(finalized.frameCount, 128)
    assert.equal(finalized.bitDepth, "pcm24")
    assert.equal(finalized.timeReference, 42)
    assert.match(finalized.contentHash, /^[a-f0-9]{64}$/u)
    const persisted = await analyzeWaveform(outputPath)
    assert.equal(persisted.frameCount, finalized.frameCount)
    assert.deepEqual(persisted.waveformLevels, finalized.waveformLevels)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

await test("a pending UI request does not occupy the native async request path", async () => {
  const runtime = new AudioHostRuntime(2, 4)
  let requestId = 1
  const request = (command: unknown) =>
    runtime.request(Buffer.from(encode({ request_id: requestId++, command })))
  const pendingUiRequest = request({
    type: "configure-plugin-editor-appearance",
    appearance: { theme: "dark", locale: "en-US" }
  }).then(
    () => null,
    (error: unknown) => error
  )

  try {
    await new Promise((resolve) => setTimeout(resolve, 10))
    const echo = await Promise.race([
      request({
        type: "benchmark-echo",
        payload: { storage: "inline", bytes: new Uint8Array([1, 2, 3]) }
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("independent audio request was blocked")), 500)
      )
    ])
    const echoResponse = decode(echo.body) as { result: { type: string } }
    assert.equal(echoResponse.result.type, "benchmark-echo")

    const heartbeat = await Promise.race([
      runtime.heartbeat(
        Buffer.from(
          encode({
            request_id: requestId++,
            command: { type: "heartbeat" }
          })
        )
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("heartbeat was blocked by a control request")), 500)
      )
    ])
    const heartbeatResponse = decode(heartbeat.body) as { result: { type: string } }
    assert.equal(heartbeatResponse.result.type, "heartbeat")
  } finally {
    runtime.close()
  }

  assert.ok((await pendingUiRequest) instanceof Error)
})

await test("a missing VST3 module returns an operation error through the native wire", async () => {
  const directory = await mkdtemp(join(tmpdir(), "heron-native-vst3-error-"))
  const runtime = new AudioHostRuntime(2, 4)
  const uiPump = setInterval(() => runtime.drainUiWork(), 8)
  uiPump.unref()
  let requestId = 1
  const request = async (command: unknown) => {
    const id = requestId++
    const response = await runtime.request(Buffer.from(encode({ request_id: id, command })))
    const decoded = decode(response.body) as {
      request_id: number
      result: { type: string; error?: Record<string, unknown> }
    }
    assert.equal(decoded.request_id, id)
    return decoded.result
  }

  try {
    const result = await request({
      type: "load-plugin",
      instance_id: "missing-vst3",
      locator: {
        format: "vst3",
        artifact_path: join(directory, "missing.vst3"),
        native_id: "41347FD6FED64094AFBB12B7DBA1D441"
      },
      plugin_kind: "effect",
      audio_mode: "stereo",
      sample_rate: 48_000,
      state: { version: 1, chunks: [] }
    })
    assert.equal(result.type, "error")
    assert.ok(result.error)
    assert.equal(result.error.code, "dependency-failed")
    assert.equal(result.error.category, "dependency-failed")
    assert.equal(result.error.outcome, "not-committed")
    assert.equal(result.error.retry, "never")
    assert.equal(result.error.userMessageKey, "errors.pluginOperationFailed")
    assert.deepEqual(result.error.details, {
      type: "plugin-operation",
      format: "vst3",
      instanceId: "missing-vst3",
      stage: "initialize",
      operation: "load module"
    })

    // A discarded load candidate does not make the embedded runtime unavailable.
    const echo = await request({
      type: "benchmark-echo",
      payload: { storage: "inline", bytes: new Uint8Array([1, 2, 3]) }
    })
    assert.equal(echo.type, "benchmark-echo")
  } finally {
    clearInterval(uiPump)
    runtime.close()
    await rm(directory, { force: true, recursive: true })
  }
})

await test("Tokio wakes Electron to drain bounded UI work", async () => {
  let wakeCount = 0
  const runtime = new AudioHostRuntime(2, 4, undefined, () => {
    wakeCount += 1
    setImmediate(() => runtime.drainUiWork())
  })

  try {
    const response = await Promise.race([
      runtime.request(
        Buffer.from(
          encode({
            request_id: 1,
            command: {
              type: "configure-plugin-editor-appearance",
              appearance: { theme: "dark", locale: "en-US" }
            }
          })
        )
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("native UI wake did not drain the request")), 500)
      )
    ])
    const decoded = decode(response.body) as { result: { type: string } }
    assert.equal(decoded.result.type, "accepted")
    assert.ok(wakeCount > 0)
  } finally {
    runtime.close()
  }
})
