import { beforeEach, describe, expect, it, vi } from "vitest"

const electronMocks = vi.hoisted(() => ({ getAllWindows: vi.fn(() => []) }))

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: electronMocks.getAllWindows }
}))

import { INITIAL_AUDIO_RUNTIME_SNAPSHOT } from "@heron/contracts"
import type { AudioDeviceRecoverySnapshot, AudioPreferences } from "@heron/contracts"
import type { TransportService } from "../audio"
import type { AudioHostService, NativeAudioDeviceRecoverySnapshot } from "../audio-host"
import { LifecycleCoordinator } from "../kernel"
import type { ProjectGraphService } from "../project"
import type { RecordingService } from "../recording"
import { AudioDeviceRecoveryCoordinator } from "./audio-device-recovery-coordinator"

type NativeAudioDeviceRecoveryResult = Awaited<
  ReturnType<AudioHostService["deviceRecoverySnapshot"]>
>

const runningRuntime = {
  ...INITIAL_AUDIO_RUNTIME_SNAPSHOT,
  state: "running" as const,
  sampleRate: 48_000,
  inputSampleRate: 48_000,
  outputSampleRate: 48_000,
  requestedBufferSize: 128,
  inputBufferSize: 128,
  outputBufferSize: 128
}

const replacement: AudioPreferences = {
  backend: "mock",
  inputDeviceId: "replacement",
  outputDeviceId: "replacement",
  bufferSize: 128
}

function device(id: string) {
  return {
    id,
    name: id,
    isDefault: false,
    defaultSampleRate: 48_000,
    minBufferSize: 32,
    maxBufferSize: 2_048,
    channelCount: 2
  }
}

function nativeRecovery(
  overrides: Partial<NativeAudioDeviceRecoverySnapshot> = {}
): NativeAudioDeviceRecoverySnapshot {
  return {
    recoveryId: 7,
    revision: 1,
    candidateRevision: 1,
    attemptGeneration: 2,
    phase: "waiting-for-authorization",
    originalPreferences: {
      backend: "mock",
      inputDeviceId: "original",
      outputDeviceId: "original",
      bufferSize: 128
    },
    candidates: { inputs: [device("replacement")], outputs: [device("replacement")] },
    lostDirections: ["input", "output"],
    fault: "device-not-available",
    ...overrides
  }
}

function publicRecovery(): Omit<AudioDeviceRecoverySnapshot, "recovery"> {
  const native = nativeRecovery()
  return {
    decisionRevision: native.revision,
    attemptGeneration: native.attemptGeneration,
    phase: "waiting-for-change",
    previousPreferences: native.originalPreferences,
    candidates: native.candidates,
    candidateRevision: native.candidateRevision,
    lostDirections: native.lostDirections,
    fault: native.fault,
    recordingStatus: "not-active",
    failure: null
  }
}

function setup() {
  let handler: (recovery: NativeAudioDeviceRecoverySnapshot | null) => void = () => {}
  const audioHost = {
    setDeviceRecoveryHandler: vi.fn(
      (next: (recovery: NativeAudioDeviceRecoverySnapshot | null) => void) => {
        handler = next
      }
    ),
    deviceRecoverySnapshot: vi.fn<() => Promise<NativeAudioDeviceRecoveryResult>>(async () => ({
      recovery: nativeRecovery(),
      runtime: null
    })),
    authorizeDeviceRecovery: vi.fn(async () =>
      nativeRecovery({ revision: 2, phase: "waiting-for-change" })
    ),
    selectDeviceRecovery: vi.fn(async () => ({ recovery: null, runtime: runningRuntime })),
    keepRestoredDevice: vi.fn(async () => ({ recovery: null, runtime: runningRuntime })),
    audioEngineSnapshot: vi.fn(async () => runningRuntime),
    deviceRecoveryTransportIntent: vi.fn(() => ({
      state: "playing" as const,
      positionFrames: 512,
      sampleRate: 48_000,
      loopEnabled: true,
      loopRange: { startTick: 120, endTick: 960 }
    }))
  }
  const lifecycle = new LifecycleCoordinator(null, runningRuntime)
  const recordings = { current: null, stop: vi.fn() }
  const projectGraph = { load: vi.fn(async () => undefined) }
  const transport = { command: vi.fn(async () => ({ state: "stopped" })) }
  const coordinator = new AudioDeviceRecoveryCoordinator(
    audioHost as unknown as AudioHostService,
    lifecycle,
    recordings as unknown as RecordingService,
    projectGraph as unknown as ProjectGraphService,
    transport as unknown as TransportService
  )
  return { audioHost, coordinator, handler: () => handler, lifecycle, projectGraph, transport }
}

describe("AudioDeviceRecoveryCoordinator", () => {
  beforeEach(() => electronMocks.getAllWindows.mockReturnValue([]))

  it("drops a persisted desktop recovery when native reconciliation returns null", async () => {
    const { audioHost, coordinator, lifecycle } = setup()
    const recovery = lifecycle.applicationState.beginAudioDeviceRecovery(publicRecovery())
    lifecycle.beginAudioDeviceRecovery(recovery)
    audioHost.deviceRecoverySnapshot.mockResolvedValueOnce({ recovery: null, runtime: null })
    audioHost.audioEngineSnapshot.mockRejectedValueOnce(new Error("host is shutting down"))

    await coordinator.initialize()

    expect(lifecycle.applicationState.currentAudioDeviceRecovery()).toBeNull()
    expect(lifecycle.snapshot().audio).toMatchObject({ status: "running" })
    expect(audioHost.audioEngineSnapshot).toHaveBeenCalledOnce()
  })

  it("clears an active recovery after a host-side null event", async () => {
    const { audioHost, coordinator, lifecycle } = setup()
    await coordinator.initialize()
    expect(lifecycle.snapshot().audio.status).toBe("recovering")
    audioHost.deviceRecoverySnapshot.mockResolvedValueOnce({ recovery: null, runtime: null })

    await coordinator.initialize()

    expect(lifecycle.applicationState.currentAudioDeviceRecovery()).toBeNull()
    expect(lifecycle.snapshot().audio.status).toBe("running")
  })

  it("rejects keep until the original device is restored", async () => {
    const { coordinator, lifecycle } = setup()
    await coordinator.initialize()

    await expect(coordinator.keepRestored()).rejects.toThrow(
      "the original audio device has not been restored"
    )
    expect(lifecycle.snapshot().audio.status).toBe("recovering")
  })

  it("reconciles original-restored events and detaches the native handler", async () => {
    const { audioHost, coordinator, handler, lifecycle, projectGraph } = setup()
    await coordinator.initialize()
    const restored = nativeRecovery({ revision: 3, phase: "original-restored" })

    handler()(restored)
    audioHost.deviceRecoverySnapshot.mockResolvedValueOnce({ recovery: restored, runtime: null })
    await coordinator.initialize()

    expect(projectGraph.load).toHaveBeenCalled()
    expect(lifecycle.snapshot().audio).toMatchObject({
      status: "recovering",
      recovery: { phase: "original-restored" },
      runtime: runningRuntime
    })

    coordinator.dispose()
    expect(audioHost.setDeviceRecoveryHandler).toHaveBeenCalledTimes(2)
  })

  it("rotates resources and restores project and transport after explicit selection", async () => {
    const { audioHost, coordinator, lifecycle, projectGraph, transport } = setup()
    const before = await lifecycle.applicationState.commitAudioEngine(runningRuntime)
    await coordinator.initialize()

    const session = await coordinator.select(replacement)

    expect(audioHost.selectDeviceRecovery).toHaveBeenCalledWith(7, replacement)
    expect(session.engine.generation).toBeGreaterThan(before.engine!.generation)
    expect(session.transport.generation).toBeGreaterThan(before.transport!.generation)
    expect(projectGraph.load).toHaveBeenCalledOnce()
    expect(transport.command).toHaveBeenNthCalledWith(1, {
      type: "set-loop",
      enabled: true,
      range: { startTick: 120, endTick: 960 }
    })
    expect(transport.command).toHaveBeenNthCalledWith(2, {
      type: "seek",
      positionFrames: 512
    })
    expect(transport.command).toHaveBeenNthCalledWith(3, { type: "play" })
    expect(lifecycle.snapshot().audio.status).toBe("running")
  })

  it("keeps the decision open with a typed failure when selection fails", async () => {
    const { audioHost, coordinator, lifecycle } = setup()
    audioHost.selectDeviceRecovery.mockRejectedValueOnce(new Error("device busy"))
    await coordinator.initialize()

    await expect(coordinator.select(replacement)).rejects.toThrow("device busy")

    const audio = lifecycle.snapshot().audio
    expect(audio.status).toBe("recovering")
    if (audio.status !== "recovering") throw new Error("expected recovery lifecycle")
    expect(audio.recovery.phase).toBe("selection-failed")
    expect(audio.recovery.failure).toMatchObject({ code: "resource-unavailable" })
  })

  it("keeps an original-restored runtime without rotating resources", async () => {
    const { audioHost, coordinator, lifecycle } = setup()
    const before = await lifecycle.applicationState.commitAudioEngine(runningRuntime)
    const restored = nativeRecovery({ phase: "original-restored" })
    audioHost.deviceRecoverySnapshot.mockResolvedValueOnce({ recovery: restored, runtime: null })
    audioHost.authorizeDeviceRecovery.mockResolvedValueOnce(restored)
    await coordinator.initialize()

    await coordinator.keepRestored()

    const after = lifecycle.applicationState.audioResourceSnapshot()
    expect(audioHost.keepRestoredDevice).toHaveBeenCalledWith(7)
    expect(after.engine).toEqual(before.engine)
    expect(after.transport).toEqual(before.transport)
    expect(after.recovery).toBeNull()
  })
})
