import { createTestingPinia } from "@pinia/testing"
import { flushPromises, mount } from "@vue/test-utils"
import { describe, expect, it, vi } from "vitest"
import { INITIAL_AUDIO_RUNTIME_SNAPSHOT } from "@heron/contracts"
import type { AudioDeviceRecoverySnapshot } from "@heron/contracts"
import { useAudioPreferencesStore } from "../../stores/audioPreferences"
import { useAudioRuntimeStore } from "../../stores/audioRuntime"
import AudioDeviceRecoveryDialog from "./AudioDeviceRecoveryDialog.vue"
import AudioDeviceRecoveryHost from "./AudioDeviceRecoveryHost.vue"

const runningRuntime = { ...INITIAL_AUDIO_RUNTIME_SNAPSHOT, state: "running" as const }

function recovery(): AudioDeviceRecoverySnapshot {
  const device = {
    id: "replacement",
    name: "Replacement",
    isDefault: false,
    defaultSampleRate: 48_000,
    minBufferSize: 32,
    maxBufferSize: 2_048,
    channelCount: 2
  }
  return {
    recovery: {
      kind: "audio-device-recovery",
      id: "recovery",
      epoch: "audio-epoch",
      generation: 1
    },
    decisionRevision: 1,
    attemptGeneration: 2,
    phase: "waiting-for-change",
    previousPreferences: {
      backend: "mock",
      inputDeviceId: "original",
      outputDeviceId: "original",
      bufferSize: 128
    },
    candidates: { inputs: [device], outputs: [device] },
    candidateRevision: 1,
    lostDirections: ["input", "output"],
    fault: "device-not-available",
    recordingStatus: "not-active",
    failure: null
  }
}

function setup() {
  const pinia = createTestingPinia({ createSpy: vi.fn })
  const audio = useAudioRuntimeStore(pinia)
  const preferences = useAudioPreferencesStore(pinia)
  const snapshot = recovery()
  audio.$patch({
    lifecycle: { status: "recovering", runtime: runningRuntime, recovery: snapshot, error: null },
    audioRecoveryRef: snapshot.recovery
  })
  const wrapper = mount(AudioDeviceRecoveryHost, { global: { plugins: [pinia] } })
  return { audio, preferences, wrapper }
}

describe("AudioDeviceRecoveryHost", () => {
  it("commits preferences only after replacement selection succeeds", async () => {
    const { audio, preferences, wrapper } = setup()
    vi.mocked(audio.selectRecoveryDevice).mockResolvedValue(runningRuntime)

    wrapper.getComponent(AudioDeviceRecoveryDialog).vm.$emit("select", "replacement", "replacement")
    await flushPromises()

    expect(audio.selectRecoveryDevice).toHaveBeenCalledWith({
      backend: "mock",
      inputDeviceId: "replacement",
      outputDeviceId: "replacement",
      bufferSize: 128
    })
    expect(preferences.commitRecovered).toHaveBeenCalledWith(
      {
        backend: "mock",
        inputDeviceId: "replacement",
        outputDeviceId: "replacement",
        bufferSize: 128
      },
      runningRuntime.outputBufferSize
    )
  })

  it("does not persist a failed replacement and releases the busy state", async () => {
    const { audio, preferences, wrapper } = setup()
    vi.mocked(audio.selectRecoveryDevice).mockRejectedValue(new Error("device busy"))

    wrapper.getComponent(AudioDeviceRecoveryDialog).vm.$emit("select", "replacement", "replacement")
    await flushPromises()

    expect(preferences.commitRecovered).not.toHaveBeenCalled()
    expect(wrapper.getComponent(AudioDeviceRecoveryDialog).props("busy")).toBe(false)
  })

  it("forwards the explicit keep decision and releases the busy state", async () => {
    const { audio, wrapper } = setup()
    vi.mocked(audio.keepRestoredDevice).mockResolvedValue(undefined)

    wrapper.getComponent(AudioDeviceRecoveryDialog).vm.$emit("keep")
    await flushPromises()

    expect(audio.keepRestoredDevice).toHaveBeenCalledOnce()
    expect(wrapper.getComponent(AudioDeviceRecoveryDialog).props("busy")).toBe(false)
  })
})
