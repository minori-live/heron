import { beforeEach, describe, expect, it, vi } from "vitest"
import { defineComponent, h, nextTick } from "vue"
import { mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import type { ApplicationSettings, OperationSnapshot, ProjectGraphSnapshot } from "@heron/contracts"
import { EMPTY_PROJECT_GRAPH, useProjectGraphStore } from "../../stores/projectGraph"
import { useApplicationSettingsStore } from "../../stores/applicationSettings"
import { useMixerStore } from "../../stores/mixer"
import { useOperationStore } from "../../stores/operations"
import { useProjectStore } from "../../stores/project"
import { useTrackFreeze } from "./useTrackFreeze"

const graph: ProjectGraphSnapshot = {
  ...structuredClone(EMPTY_PROJECT_GRAPH),
  tracks: [{ id: "track-vocal", channelId: "audio", sortOrder: 0 }],
  channels: [
    {
      id: "audio",
      kind: "audio",
      systemRole: null,
      name: "Vocal",
      color: "#fff",
      sortOrder: 0,
      inputSource: null,
      inputFormat: null,
      gainDb: 0,
      pan: 0,
      muted: false,
      soloed: false,
      outputChannelId: null,
      recordArmed: false,
      inputMonitoring: false,
      inputChannels: [],
      hardwareOutputChannels: []
    }
  ]
}

function operation(id: string, state: OperationSnapshot["state"]): OperationSnapshot {
  return {
    id,
    title: "Freezing Vocal",
    description: "Vocal",
    phase: "rendering-offline",
    state,
    completedUnits: 1,
    totalUnits: 2,
    cancellable: true,
    error: null,
    dropoutFrames: 0
  }
}

describe("useTrackFreeze", () => {
  beforeEach(() => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useProjectGraphStore().hydrate(graph)
    useProjectStore().projectGraphRef = {
      kind: "project-graph",
      id: "graph",
      epoch: "test",
      generation: 1
    }
    useProjectStore().projectRevision = 3
    Object.assign(window.heron, { startTrackFreeze: vi.fn() })
  })

  it("starts, ignores a second start, and clears the in-flight job when the operation ends", async () => {
    vi.mocked(window.heron.startTrackFreeze).mockResolvedValue({
      ok: true,
      requestId: "request",
      operationId: "rpc",
      warnings: [],
      value: { operationId: "freeze-1" }
    })
    const pinia = createPinia()
    setActivePinia(pinia)
    useProjectGraphStore().hydrate(graph)
    useProjectStore().projectGraphRef = {
      kind: "project-graph",
      id: "graph",
      epoch: "test",
      generation: 1
    }
    useProjectStore().projectRevision = 3
    const Host = defineComponent({
      setup() {
        return useTrackFreeze()
      },
      render() {
        return h("div")
      }
    })
    const wrapper = mount(Host, { global: { plugins: [pinia] } })
    const api = wrapper.vm as unknown as ReturnType<typeof useTrackFreeze>
    await api.toggle("track-vocal")
    await api.toggle("track-vocal")
    expect(window.heron.startTrackFreeze).toHaveBeenCalledOnce()
    useOperationStore().operations.push(operation("freeze-1", "running"))
    await nextTick()
    useOperationStore().operations.splice(0, 1)
    await nextTick()
    await api.toggle("track-vocal")
    expect(window.heron.startTrackFreeze).toHaveBeenCalledTimes(2)
  })

  it("unfreezes a frozen track, refuses a mode change, and restores a rejected button setting", async () => {
    const mixer = useMixerStore()
    mixer.graph.tracks[0]!.freeze = {
      mode: "pre-fader",
      status: "frozen",
      assetId: "asset",
      fingerprint: "fp",
      startFrame: 0,
      lengthFrames: 10,
      latencySamples: 0,
      tailFrames: 0,
      sampleRate: 48_000
    }
    const execute = vi.spyOn(mixer, "execute").mockResolvedValue(true)
    const settings = useApplicationSettingsStore()
    settings.settings = { trackHeaderFreezeVisible: true } as ApplicationSettings
    const update = vi.spyOn(settings, "update").mockResolvedValue(false)
    const api = useTrackFreeze()
    await api.toggle("track-vocal")
    expect(execute).toHaveBeenCalledWith({
      type: "set-track-freeze",
      trackId: "track-vocal",
      freeze: null
    })
    await expect(api.setMode("track-vocal", "source-only")).resolves.toBe(false)
    await api.setButtonVisible(false)
    expect(update).toHaveBeenCalledWith({ trackHeaderFreezeVisible: false })
    expect(settings.settings.trackHeaderFreezeVisible).toBe(true)
    await api.setButtonVisible(true)
    await api.unfreeze("missing")
    expect(execute).toHaveBeenCalledTimes(1)
    mixer.graph.tracks[0]!.freeze = undefined
    await expect(api.setMode("track-vocal", "source-only")).resolves.toBe(true)
    await api.toggle("missing")
    vi.mocked(window.heron.startTrackFreeze).mockResolvedValue({ ok: false } as never)
    await api.toggle("track-vocal")
    expect(window.heron.startTrackFreeze).toHaveBeenCalledOnce()
  })

  it("hides the freeze button when the setting is off", () => {
    useApplicationSettingsStore().settings = {
      trackHeaderFreezeVisible: false
    } as ApplicationSettings
    expect(useTrackFreeze().buttonVisible.value).toBe(false)
  })
})
