import { describe, expect, it } from "vitest"
import { ref } from "vue"
import type { AudioDeviceRecoverySnapshot } from "@heron/contracts"
import { useAudioDeviceRecoveryDraft } from "./useAudioDeviceRecoveryDraft"

function snapshot(backend: "mock" | "asio" = "mock"): AudioDeviceRecoverySnapshot {
  const device = (id: string) => ({
    id,
    name: id,
    isDefault: false,
    defaultSampleRate: 48_000,
    minBufferSize: 32,
    maxBufferSize: 2048,
    channelCount: 2
  })
  return {
    recovery: {
      kind: "audio-device-recovery",
      id: "recovery",
      epoch: "host",
      generation: 1
    },
    decisionRevision: 1,
    attemptGeneration: 2,
    phase: "waiting-for-change",
    previousPreferences: {
      backend,
      inputDeviceId: "lost",
      outputDeviceId: "lost",
      bufferSize: 128
    },
    candidates: { inputs: [device("replacement")], outputs: [device("replacement")] },
    candidateRevision: 1,
    lostDirections: ["input", "output"],
    fault: "device-not-available",
    recordingStatus: "not-active",
    failure: null
  }
}

describe("useAudioDeviceRecoveryDraft", () => {
  it("preserves the unavailable original without silently choosing a candidate", () => {
    const recovery = ref<AudioDeviceRecoverySnapshot | null>(snapshot())
    const draft = useAudioDeviceRecoveryDraft(recovery)

    expect(draft.inputDeviceId.value).toBe("lost")
    expect(draft.inputOptions.value[0]).toMatchObject({ value: "lost", disabled: true })
    expect(draft.valid.value).toBe(false)

    recovery.value = { ...snapshot(), candidateRevision: 2 }
    expect(draft.inputDeviceId.value).toBe("lost")
  })

  it("keeps ASIO input and output on the same driver", () => {
    const recovery = ref<AudioDeviceRecoverySnapshot | null>(snapshot("asio"))
    const draft = useAudioDeviceRecoveryDraft(recovery)
    draft.selectInput("replacement")
    expect(draft.outputDeviceId.value).toBe("replacement")
    expect(draft.valid.value).toBe(true)

    draft.selectOutput("lost")
    expect(draft.inputDeviceId.value).toBe("lost")
    expect(draft.valid.value).toBe(false)
  })

  it("preserves a user draft when candidates disappear and only returns valid preferences", () => {
    const recovery = ref<AudioDeviceRecoverySnapshot | null>(snapshot())
    const draft = useAudioDeviceRecoveryDraft(recovery)
    draft.selectInput("replacement")
    draft.selectOutput("replacement")

    expect(draft.preferences()).toMatchObject({
      inputDeviceId: "replacement",
      outputDeviceId: "replacement"
    })

    recovery.value = {
      ...snapshot(),
      candidates: { inputs: [], outputs: [] },
      candidateRevision: 2
    }
    expect(draft.inputDeviceId.value).toBe("replacement")
    expect(draft.outputOptions.value[0]).toMatchObject({
      value: "replacement",
      disabled: true
    })
    expect(draft.preferences()).toBeNull()

    recovery.value = null
    expect(draft.valid.value).toBe(false)
  })
})
