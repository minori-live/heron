import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import type { AudioDeviceRecoverySnapshot } from "@heron/contracts"
import AudioDeviceRecoveryDialog from "./AudioDeviceRecoveryDialog.vue"

function device(id: string) {
  return {
    id,
    name: id === "replacement" ? "Replacement device" : id,
    isDefault: false,
    defaultSampleRate: 48_000,
    minBufferSize: 32,
    maxBufferSize: 2_048,
    channelCount: 2
  }
}

function recovery(
  overrides: Partial<AudioDeviceRecoverySnapshot> = {}
): AudioDeviceRecoverySnapshot {
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
    candidates: { inputs: [device("replacement")], outputs: [device("replacement")] },
    candidateRevision: 1,
    lostDirections: ["input", "output"],
    fault: "device-not-available",
    recordingStatus: "not-active",
    failure: null,
    ...overrides
  }
}

describe("AudioDeviceRecoveryDialog", () => {
  it("cannot be dismissed and disables device decisions while recording is finalized", async () => {
    const wrapper = mount(AudioDeviceRecoveryDialog, {
      attachTo: document.body,
      props: { recovery: recovery({ phase: "finalizing-recording" }), busy: false }
    })
    await wrapper.vm.$nextTick()

    expect(document.body.querySelector('[aria-label="Close dialog"]')).toBeNull()
    expect(document.body.textContent).toContain("Safely saving the recording")
    const selects = [...document.body.querySelectorAll<HTMLSelectElement>("select")]
    expect(selects).toHaveLength(2)
    expect(selects.every((select) => select.disabled)).toBe(true)
    expect(
      [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
        button.textContent?.includes("Use selected devices")
      )?.disabled
    ).toBe(true)
    wrapper.unmount()
  })

  it("emits the stable explicit selection without silently replacing the lost device", async () => {
    const wrapper = mount(AudioDeviceRecoveryDialog, {
      attachTo: document.body,
      props: { recovery: recovery(), busy: false }
    })
    await wrapper.vm.$nextTick()
    const selects = [...document.body.querySelectorAll<HTMLSelectElement>("select")]

    expect(selects.map((select) => select.value)).toEqual(["original", "original"])
    selects[0]!.value = "replacement"
    selects[0]!.dispatchEvent(new Event("change", { bubbles: true }))
    selects[1]!.value = "replacement"
    selects[1]!.dispatchEvent(new Event("change", { bubbles: true }))
    await wrapper.vm.$nextTick()
    const submit = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Use selected devices")
    )!
    submit.click()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted("select")).toEqual([["replacement", "replacement"]])
    wrapper.unmount()
  })

  it("offers keep after original restoration and preserves a visible typed failure", async () => {
    const failure = {
      code: "resource-unavailable" as const,
      category: "unavailable" as const,
      outcome: "not-committed" as const,
      retry: "safe" as const,
      correlationId: "failure",
      userMessageKey: "errors.audioDeviceRecoveryFailed",
      details: {
        type: "resource-unavailable" as const,
        component: "audio-host" as const,
        dispatched: true
      }
    }
    const wrapper = mount(AudioDeviceRecoveryDialog, {
      attachTo: document.body,
      props: {
        recovery: recovery({ phase: "original-restored", failure }),
        busy: false
      }
    })
    await wrapper.vm.$nextTick()

    expect(document.body.textContent).toContain("Audio has been restored")
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
      "The selected devices could not be opened"
    )
    const keep = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Keep restored devices")
    )!
    keep.click()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted("keep")).toHaveLength(1)
    wrapper.unmount()
  })
})
