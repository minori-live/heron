import { createPinia, setActivePinia } from "pinia"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { INITIAL_AUDIO_RUNTIME_SNAPSHOT } from "@heron/contracts"
import type {
  AudioDeviceRecoverySnapshot,
  AudioEngineSessionSnapshot,
  AudioResourceSnapshot,
  AudioRuntimeSnapshot
} from "@heron/contracts"
import { rpcFailure, rpcSuccess } from "../test/ipc"
import { useAudioRuntimeStore } from "./audioRuntime"

const runtime: AudioRuntimeSnapshot = {
  ...INITIAL_AUDIO_RUNTIME_SNAPSHOT,
  state: "running",
  sampleRate: 48_000,
  inputSampleRate: 48_000,
  outputSampleRate: 48_000,
  requestedBufferSize: 128,
  inputBufferSize: 128,
  outputBufferSize: 128
}

const recoveryRef = {
  kind: "audio-device-recovery",
  id: "recovery",
  epoch: "audio-epoch",
  generation: 1
} as const

function resources(recovery = true): AudioResourceSnapshot {
  return {
    host: { kind: "audio-host", id: "host", epoch: "audio-epoch", generation: 1 },
    engine: { kind: "audio-engine", id: "engine", epoch: "audio-epoch", generation: 1 },
    recovery: recovery ? recoveryRef : null,
    transport: { kind: "transport", id: "transport", epoch: "audio-epoch", generation: 1 },
    midiRuntime: { kind: "midi-runtime", id: "midi", epoch: "audio-epoch", generation: 1 },
    revision: 1
  }
}

function recovery(): AudioDeviceRecoverySnapshot {
  return {
    recovery: recoveryRef,
    decisionRevision: 1,
    attemptGeneration: 2,
    phase: "waiting-for-change",
    previousPreferences: {
      backend: "mock",
      inputDeviceId: "original",
      outputDeviceId: "original",
      bufferSize: 128
    },
    candidates: {
      inputs: [
        {
          id: "replacement",
          name: "Replacement",
          isDefault: false,
          defaultSampleRate: 48_000,
          minBufferSize: 32,
          maxBufferSize: 2_048,
          channelCount: 2
        }
      ],
      outputs: [
        {
          id: "replacement",
          name: "Replacement",
          isDefault: false,
          defaultSampleRate: 48_000,
          minBufferSize: 32,
          maxBufferSize: 2_048,
          channelCount: 2
        }
      ]
    },
    candidateRevision: 1,
    lostDirections: ["input", "output"],
    fault: "device-not-available",
    recordingStatus: "not-active",
    failure: null
  }
}

function recoverySession(): AudioEngineSessionSnapshot {
  const active = resources(false)
  return { ...active, engine: active.engine!, transport: active.transport!, runtime }
}

function stubApi(overrides: Record<string, unknown>): void {
  Object.assign(window.heron as unknown as Record<string, unknown>, overrides)
}

beforeEach(() => {
  setActivePinia(createPinia())
  stubApi({
    audioEngineSnapshot: vi.fn(async () => rpcSuccess(runtime)),
    selectAudioRecoveryDevice: vi.fn(async () => rpcSuccess(recoverySession())),
    keepRestoredAudioDevice: vi.fn(async () => rpcSuccess(null))
  })
})

describe("audioRuntime device recovery", () => {
  it("preserves canonical recovery when a polling snapshot fails", async () => {
    const store = useAudioRuntimeStore()
    const snapshot = recovery()
    store.applyResources(resources())
    store.applyLifecycleState({ status: "recovering", runtime, recovery: snapshot, error: null })
    const audioEngineSnapshot = vi.fn(async () => rpcFailure("errors.audioSnapshotFailed"))
    stubApi({ audioEngineSnapshot })

    await store.refresh()

    expect(audioEngineSnapshot).toHaveBeenCalledOnce()
    expect(store.lifecycle.status).toBe("recovering")
    expect(store.recovery).toEqual(snapshot)
    expect(store.lastError).not.toBe("")
  })

  it("still reports a polling failure as error outside recovery", async () => {
    const store = useAudioRuntimeStore()
    store.applyResources(resources(false))
    store.applyLifecycleState({ status: "running", runtime, error: null })
    stubApi({
      audioEngineSnapshot: vi.fn(async () => rpcFailure("errors.audioSnapshotFailed"))
    })

    await store.refresh()

    expect(store.lifecycle.status).toBe("error")
    expect(store.lastError).not.toBe("")
  })

  it("applies replacement resources only after a successful selection", async () => {
    const store = useAudioRuntimeStore()
    store.applyResources(resources())
    store.applyLifecycleState({ status: "recovering", runtime, recovery: recovery(), error: null })
    const selectAudioRecoveryDevice = vi.fn(async () => rpcSuccess(recoverySession()))
    stubApi({ selectAudioRecoveryDevice })

    const selected = await store.selectRecoveryDevice({
      backend: "mock",
      inputDeviceId: "replacement",
      outputDeviceId: "replacement",
      bufferSize: 128
    })

    expect(selected).toEqual(runtime)
    expect(selectAudioRecoveryDevice).toHaveBeenCalledOnce()
    expect(store.audioRecoveryRef).toBeNull()
    expect(store.lifecycle.status).toBe("running")
  })

  it("keeps recovery resources when explicit selection fails", async () => {
    const store = useAudioRuntimeStore()
    store.applyResources(resources())
    store.applyLifecycleState({ status: "recovering", runtime, recovery: recovery(), error: null })
    stubApi({
      selectAudioRecoveryDevice: vi.fn(async () => rpcFailure("errors.audioDeviceRecoveryFailed"))
    })

    await expect(
      store.selectRecoveryDevice({
        backend: "mock",
        inputDeviceId: "replacement",
        outputDeviceId: "replacement",
        bufferSize: 128
      })
    ).rejects.toThrow()

    expect(store.audioRecoveryRef).toEqual(recoveryRef)
    expect(store.lifecycle.status).toBe("recovering")
  })

  it("closes recovery after keeping the restored device", async () => {
    const store = useAudioRuntimeStore()
    store.applyResources(resources())
    store.applyLifecycleState({
      status: "recovering",
      runtime,
      recovery: { ...recovery(), phase: "original-restored" },
      error: null
    })
    const keepRestoredAudioDevice = vi.fn(async () => rpcSuccess(null))
    stubApi({ keepRestoredAudioDevice })

    await store.keepRestoredDevice()

    expect(keepRestoredAudioDevice).toHaveBeenCalledOnce()
    expect(store.audioRecoveryRef).toBeNull()
    expect(store.lifecycle.status).toBe("running")
  })
})
