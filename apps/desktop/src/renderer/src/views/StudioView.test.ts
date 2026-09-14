import { flushPromises, mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { createMemoryHistory, createRouter } from "vue-router"
import { defineComponent } from "vue"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ProjectSession } from "@heron/contracts"
import { useEngineStore } from "../stores/engine"
import { useLowLatencyModeStore } from "../stores/lowLatencyMode"
import { useMixerStore } from "../stores/mixer"
import { usePianoRollStore } from "../stores/pianoRoll"
import { useProjectStore } from "../stores/project"
import { useStudioWorkflowStore } from "../stores/studioWorkflow"
import { useTransportStore } from "../stores/transport"
import StudioView from "./StudioView.vue"

const session: ProjectSession = {
  id: "project",
  path: "/project.heron",
  configuration: {
    name: "Project",
    sampleRate: 48_000,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    waveformDisplayMode: "separate"
  },
  dirty: false,
  recoveredWorkingCopy: false
}

function router() {
  const Empty = defineComponent({ template: "<div />" })
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "welcome", component: Empty },
      { path: "/studio", name: "studio", component: Empty }
    ]
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function mountStudio(
  options: {
    initialize?: () => Promise<void>
    refresh?: () => Promise<boolean>
  } = {}
) {
  const navigation = router()
  const project = useProjectStore()
  project.applyLifecycleState({ status: "open", session, error: null })
  const engine = useEngineStore()
  const lowLatency = useLowLatencyModeStore()
  const mixer = useMixerStore()
  const transport = useTransportStore()
  const workflow = useStudioWorkflowStore()
  vi.spyOn(engine, "initialize").mockImplementation(options.initialize ?? (() => Promise.resolve()))
  vi.spyOn(lowLatency, "refresh").mockImplementation(
    options.refresh ?? (() => Promise.resolve(true))
  )
  vi.spyOn(mixer, "startMetering").mockImplementation(() => undefined)
  vi.spyOn(mixer, "stopMetering").mockImplementation(() => undefined)
  vi.spyOn(transport, "startPolling").mockImplementation(() => undefined)
  vi.spyOn(transport, "stopPolling").mockImplementation(() => undefined)
  vi.spyOn(lowLatency, "reset").mockImplementation(() => undefined)

  const wrapper = mount(StudioView, {
    global: {
      plugins: [navigation],
      stubs: {
        StudioTopbar: {
          emits: [
            "update-tempo",
            "update-meter",
            "update-key",
            "preview-master",
            "update-master",
            "toggle-metronome",
            "toggle-recording",
            "toggle-cycle"
          ],
          template:
            '<div class="topbar"><button class="tempo" @click="$emit(\'update-tempo\', 132)"/><button class="meter" @click="$emit(\'update-meter\', { numerator: 7, denominator: 8 })"/><button class="key" @click="$emit(\'update-key\', { fifths: 2, mode: \'minor\' })"/><button class="preview" @click="$emit(\'preview-master\', { channelId: \'master\', parameter: \'gainDb\', value: -3 })"/><button class="update" @click="$emit(\'update-master\', \'master\', { gainDb: -4 })"/><button class="metro" @click="$emit(\'toggle-metronome\')"/><button class="record" @click="$emit(\'toggle-recording\')"/><button class="cycle" @click="$emit(\'toggle-cycle\')"/></div>'
        },
        TrackInspector: true,
        StudioWorkspace: true,
        NotesPanel: true,
        StudioStatusbar: true,
        MidiImportDialog: true
      }
    }
  })
  return { wrapper, navigation, engine, lowLatency, mixer, transport, workflow }
}

describe("StudioView", () => {
  beforeEach(() => setActivePinia(createPinia()))

  it("initializes and tears down studio-owned polling", async () => {
    const { wrapper, engine, lowLatency, mixer, transport } = mountStudio()
    await flushPromises()
    expect(engine.initialize).toHaveBeenCalledOnce()
    expect(lowLatency.refresh).toHaveBeenCalledOnce()
    expect(mixer.startMetering).toHaveBeenCalledOnce()
    expect(transport.startPolling).toHaveBeenCalledOnce()

    wrapper.unmount()
    expect(mixer.stopMetering).toHaveBeenCalledOnce()
    expect(transport.stopPolling).toHaveBeenCalledOnce()
    expect(lowLatency.reset).toHaveBeenCalledOnce()
  })

  it("continues deferred initialization while the project is saving", async () => {
    const initialization = deferred<void>()
    const { wrapper, engine, lowLatency, mixer, transport } = mountStudio({
      initialize: () => initialization.promise
    })
    await vi.waitFor(() => expect(engine.initialize).toHaveBeenCalledOnce())
    useProjectStore().applyLifecycleState({ status: "saving", session, error: null })

    initialization.resolve(undefined)
    await flushPromises()

    expect(lowLatency.refresh).toHaveBeenCalledOnce()
    expect(mixer.startMetering).toHaveBeenCalledOnce()
    expect(transport.startPolling).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it("does not start studio services after unmount during engine initialization", async () => {
    const initialization = deferred<void>()
    const { wrapper, engine, lowLatency, mixer, transport } = mountStudio({
      initialize: () => initialization.promise
    })
    await vi.waitFor(() => expect(engine.initialize).toHaveBeenCalledOnce())

    wrapper.unmount()
    initialization.resolve(undefined)
    await flushPromises()

    expect(lowLatency.refresh).not.toHaveBeenCalled()
    expect(mixer.startMetering).not.toHaveBeenCalled()
    expect(transport.startPolling).not.toHaveBeenCalled()
    expect(mixer.stopMetering).toHaveBeenCalledOnce()
    expect(transport.stopPolling).toHaveBeenCalledOnce()
    expect(lowLatency.reset).toHaveBeenCalledOnce()
  })

  it("does not start studio services after unmount during low-latency refresh", async () => {
    const refresh = deferred<boolean>()
    const { wrapper, lowLatency, mixer, transport } = mountStudio({
      refresh: () => refresh.promise
    })
    await vi.waitFor(() => expect(lowLatency.refresh).toHaveBeenCalledOnce())

    wrapper.unmount()
    refresh.resolve(true)
    await flushPromises()

    expect(mixer.startMetering).not.toHaveBeenCalled()
    expect(transport.startPolling).not.toHaveBeenCalled()
    expect(mixer.stopMetering).toHaveBeenCalledOnce()
    expect(transport.stopPolling).toHaveBeenCalledOnce()
    expect(lowLatency.reset).toHaveBeenCalledOnce()
  })

  it("translates topbar edits into mixer, transport, and workflow commands", async () => {
    const { wrapper, mixer, transport, workflow } = mountStudio()
    const execute = vi.spyOn(mixer, "execute").mockResolvedValue(true)
    const preview = vi.spyOn(mixer, "preview")
    const update = vi.spyOn(mixer, "updateChannel").mockResolvedValue(true)
    const metronome = vi.spyOn(mixer, "toggleMetronome").mockResolvedValue(true)
    const setLoop = vi.spyOn(transport, "setLoop").mockResolvedValue()
    vi.spyOn(workflow, "toggleRecording").mockResolvedValue({ id: "recorded-clip" } as never)
    const reveal = vi.spyOn(transport, "selectAndRevealClip")

    for (const selector of [
      ".tempo",
      ".meter",
      ".key",
      ".preview",
      ".update",
      ".metro",
      ".cycle",
      ".record"
    ]) {
      await wrapper.find(selector).trigger("click")
    }
    await flushPromises()

    expect(execute).toHaveBeenCalledTimes(3)
    expect(execute.mock.calls.map(([command]) => command.type)).toEqual([
      "replace-tempo-map",
      "replace-tempo-map",
      "replace-key-signature-map"
    ])
    expect(preview).toHaveBeenCalledWith({ channelId: "master", parameter: "gainDb", value: -3 })
    expect(update).toHaveBeenCalledWith("master", { gainDb: -4 })
    expect(metronome).toHaveBeenCalledOnce()
    expect(setLoop).toHaveBeenCalledWith(true, expect.any(Object))
    expect(reveal).toHaveBeenCalledWith("recorded-clip")
  })

  it("deletes arrangement selections and clears stale audio selections from shortcuts", async () => {
    const { wrapper, mixer, transport } = mountStudio()
    const pianoRoll = usePianoRollStore()
    pianoRoll.arrangementClipIds = ["midi-1", "midi-2"]
    const execute = vi.spyOn(mixer, "execute").mockResolvedValue(true)

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Delete" }))
    await flushPromises()
    expect(execute).toHaveBeenCalledWith({
      type: "batch",
      commands: [
        { type: "delete-midi-clip", clipId: "midi-1" },
        { type: "delete-midi-clip", clipId: "midi-2" }
      ]
    })
    expect(pianoRoll.arrangementClipIds).toEqual([])

    transport.selectedClipId = "stale-audio"
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Backspace" }))
    expect(transport.selectedClipId).toBeNull()

    const input = document.createElement("input")
    document.body.append(input)
    input.dispatchEvent(new KeyboardEvent("keydown", { code: "Delete", bubbles: true }))
    expect(execute).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it("redirects to welcome when the project session disappears", async () => {
    const navigation = router()
    await navigation.push("/studio")
    const engine = useEngineStore()
    vi.spyOn(engine, "initialize").mockResolvedValue()
    vi.spyOn(useLowLatencyModeStore(), "refresh").mockResolvedValue(true)
    const wrapper = mount(StudioView, { global: { plugins: [navigation] } })
    await flushPromises()
    expect(navigation.currentRoute.value.name).toBe("welcome")
    wrapper.unmount()
  })
})
