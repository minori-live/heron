import { createPinia, setActivePinia } from "pinia"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MidiRuntimeResourceSnapshot, RpcEvent } from "@heron/contracts"
import { rpcEvent, rpcFailure, TEST_AUDIO_HOST_REF, TEST_MIDI_RUNTIME_REF } from "../test/ipc"
import { useLiveDiscoveryStore } from "./liveDiscovery"

describe("Live read-only discovery boundary", () => {
  beforeEach(() => setActivePinia(createPinia()))

  it("delivers MIDI discovery only for the named runtime generation", () => {
    let receive!: (event: RpcEvent<MidiRuntimeResourceSnapshot>) => void
    const unsubscribe = vi.fn()
    window.heron.subscribeMidiInput = vi.fn((listener) => {
      receive = listener
      return unsubscribe
    })
    const accepted = vi.fn()
    const stop = useLiveDiscoveryStore().subscribeMidiInput(TEST_MIDI_RUNTIME_REF, accepted)
    const current: MidiRuntimeResourceSnapshot = {
      runtime: TEST_MIDI_RUNTIME_REF,
      host: TEST_AUDIO_HOST_REF,
      revision: 1,
      snapshot: {
        ports: [{ id: "controller", name: "Controller", connected: true }],
        sync: {
          state: "internal",
          sourcePortId: null,
          sourcePortName: null,
          effectiveBpm: null,
          jitterMicroseconds: null,
          lastClockAgeMs: null,
          droppedEvents: 0,
          ignoredSystemMessages: 0,
          error: null
        },
        activeNotes: [],
        controlEvents: [],
        capturedAt: 0
      }
    }
    receive(rpcEvent({ ...current, runtime: { ...current.runtime, generation: 2 } }))
    receive(rpcEvent({ ...current, runtime: { ...current.runtime, epoch: "retired" } }))
    receive(rpcEvent({ ...current, runtime: { ...current.runtime, id: "another-runtime" } }))
    expect(accepted).not.toHaveBeenCalled()
    receive(rpcEvent(current))
    expect(accepted).toHaveBeenCalledExactlyOnceWith(current)
    stop()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it("preserves typed discovery failures for the owning Live surface", async () => {
    const failure = rpcFailure("rendererErrors.queryBackends")
    window.heron.listAudioBackends = vi.fn(async () => failure)
    expect(await useLiveDiscoveryStore().listAudioBackends(TEST_AUDIO_HOST_REF)).toBe(failure)
    expect(window.heron.listAudioBackends).toHaveBeenCalledWith(
      expect.objectContaining({ target: TEST_AUDIO_HOST_REF })
    )
  })
})
