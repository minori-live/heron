import { beforeEach, describe, expect, it, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { createPinia, setActivePinia } from "pinia"
import { createMemoryHistory, createRouter } from "vue-router"
import type { LiveWorkspaceSnapshot } from "@heron/contracts"
import LiveView from "./LiveView.vue"
import { useLiveStore } from "../stores/live"
import { useAudioRuntimeStore } from "../stores/audioRuntime"
import { useLiveWorkspaceStore } from "../stores/liveWorkspace"
import { i18n } from "../i18n"
import MixerSurface from "../components/mixer/MixerSurface.vue"
import { rpcFailure, rpcSuccess } from "../test/ipc"

function workspace(): LiveWorkspaceSnapshot {
  return {
    kind: "live",
    hierarchy: { sets: [], patches: [] },
    parameterValues: [],
    mode: "edit",
    revision: 1,
    project: { kind: "project-session", id: "stage", epoch: "epoch", generation: 1 },
    projectGraph: { kind: "project-graph", id: "graph", epoch: "epoch", generation: 1 },
    history: { canUndo: true, canRedo: true },
    bindings: [],
    graph: { sampleRate: 48000, channels: [], sends: [], plugins: [] },
    session: {
      kind: "live",
      id: "stage",
      path: "Stage.hrl",
      dirty: false,
      recoveredWorkingCopy: false,
      configuration: {
        name: "Stage",
        sampleRate: 48000,
        enabledMidiDeviceIds: [],
        audio: {
          backend: "mock",
          inputDeviceId: "input",
          outputDeviceId: "output",
          bufferSize: 128
        }
      }
    }
  }
}
async function fixture(open = true) {
  const live = useLiveStore()
  if (open) live.applyWorkspace(workspace())
  const audio = useAudioRuntimeStore()
  const listDevices = vi.spyOn(audio, "listDevices").mockResolvedValue({
    inputs: [{ id: "input", name: "Input", channelCount: 4 }],
    outputs: [{ id: "output", name: "Output", channelCount: 8 }]
  } as never)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "welcome", component: { template: "<div />" } },
      { path: "/live", name: "live", component: { template: "<div />" } }
    ]
  })
  await router.push("/live")
  const wrapper = mount(LiveView, {
    attachTo: document.body,
    global: {
      plugins: [router],
      stubs: {
        WorkspaceStatusbar: true,
        MixerSurface: {
          props: ["hardwareInputCount", "hardwareOutputCount", "error", "meterSource"],
          emits: ["undo", "redo", "select", "updateChannel"],
          template:
            '<div role="region" aria-label="Mixer controls"><output>{{ hardwareInputCount }}/{{ hardwareOutputCount }}</output><p role="alert">{{ error }}</p><button @click="$emit(\'undo\')">Undo</button><button @click="$emit(\'redo\')">Redo</button><button @click="$emit(\'select\', \'audio\')">Select Audio</button><span>{{ meterSource(\'audio\') }}</span></div>'
        },
        LiveDeviceSettings: {
          props: ["configuration", "pending", "error"],
          emits: ["configure"],
          template:
            '<div><p role="alert">{{ error }}</p><button :disabled="pending" @click="$emit(\'configure\', configuration)">Apply rig</button></div>'
        }
      }
    }
  })
  await flushPromises()
  return { wrapper, router, live, listDevices }
}
const label = (key: string) => `[aria-label="${i18n.global.t(key)}"]`

beforeEach(() => setActivePinia(createPinia()))

describe("Live workspace composition", () => {
  it("preserves a quarantined document through the explicit close-and-recover action", async () => {
    const { wrapper, live, router } = await fixture()
    window.heron.executeLiveEdit = vi.fn(async () =>
      rpcFailure("errors.projectUnavailable", { outcome: "quarantined" })
    )
    const close = vi.fn(async () => rpcSuccess(true))
    window.heron.closeLiveDocument = close
    expect(await live.edit({ type: "set-midi-bindings", bindings: [] })).toBe(false)
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toContain(
      i18n.global.t("live.layers.quarantined")
    )
    const recover = wrapper
      .findAll("button")
      .find((button) => button.text() === i18n.global.t("live.layers.closeForRecovery"))!
    await recover.trigger("click")
    await flushPromises()
    expect(close).toHaveBeenCalledWith(
      expect.objectContaining({ target: workspace().project }),
      "preserve"
    )
    expect(router.currentRoute.value.name).toBe("welcome")
    expect(live.workspace).toBeNull()
    wrapper.unmount()
  })

  it("reopens navigation and offers reconciliation while further edits are locked", async () => {
    const { wrapper, live } = await fixture()
    const reconcile = vi.spyOn(live, "reconcile").mockResolvedValue(true)
    useLiveWorkspaceStore().leftPanelOpen = false
    window.heron.executeLiveEdit = vi.fn(async () =>
      rpcFailure("errors.projectUnavailable", { outcome: "unknown" })
    )
    expect(await live.edit({ type: "set-midi-bindings", bindings: [] })).toBe(false)
    await flushPromises()
    expect(useLiveWorkspaceStore().leftPanelOpen).toBe(true)
    const retry = wrapper
      .findAll("button")
      .find((button) => button.text() === i18n.global.t("live.layers.reconcile"))!
    expect(retry.attributes("disabled")).toBeUndefined()
    const create = wrapper
      .findAll("button")
      .find((button) => button.text() === i18n.global.t("live.layers.createSet"))!
    expect(create.attributes("disabled")).toBeDefined()
    await retry.trigger("click")
    expect(reconcile).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it("settles Live pan edits after the document command completes or fails", async () => {
    const { wrapper, live } = await fixture()
    let complete!: (value: boolean) => void
    const edit = vi.spyOn(live, "edit").mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        complete = resolve
      })
    )
    const surface = wrapper.getComponent(MixerSurface)
    const accepted = vi.fn()
    surface.vm.$emit("updateChannel", "audio", { pan: 0.5 }, accepted)
    expect(edit).toHaveBeenCalledWith({
      type: "update-channel",
      channelId: "audio",
      patch: { pan: 0.5 }
    })
    expect(accepted).not.toHaveBeenCalled()
    complete(true)
    await flushPromises()
    expect(accepted).toHaveBeenCalledOnce()

    edit.mockRejectedValueOnce(new Error("edit rejected"))
    const rejected = vi.fn()
    surface.vm.$emit("updateChannel", "audio", { pan: -0.5 }, rejected)
    await flushPromises()
    expect(rejected).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it("redirects when the document is closed", async () => {
    const { wrapper, router } = await fixture(false)
    expect(router.currentRoute.value.name).toBe("welcome")
    expect(wrapper.find(".live-shell").exists()).toBe(false)
    wrapper.unmount()
  })

  it("shares the shell, toggles panels, reports failures, and routes history controls", async () => {
    const { wrapper, live, listDevices } = await fixture()
    expect(listDevices).toHaveBeenCalledWith("mock")
    expect(wrapper.get("output").text()).toBe("4/8")
    expect(wrapper.find(".live-performance-workspace").exists()).toBe(true)
    const edit = vi.spyOn(live, "edit").mockResolvedValue(true)
    await wrapper.get('[aria-label="Mixer controls"] button').trigger("click")
    await wrapper.findAll('[aria-label="Mixer controls"] button')[1]!.trigger("click")
    await wrapper.findAll('[aria-label="Mixer controls"] button')[2]!.trigger("click")
    expect(edit.mock.calls).toEqual([["undo"], ["redo"]])
    await wrapper.get(`button${label("live.document")}`).trigger("click")
    expect(wrapper.find(".live-project-panel").exists()).toBe(false)
    await wrapper.get(`button${label("live.document")}`).trigger("click")
    expect(wrapper.find(".live-project-panel").exists()).toBe(true)
    await wrapper.get(`button${label("live.mixer")}`).trigger("click")
    expect(wrapper.find('[aria-label="Mixer controls"]').exists()).toBe(false)
    live.error = "Failed to save"
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe("Failed to save")
    expect(useLiveWorkspaceStore().mixerOpen).toBe(true)
    wrapper.unmount()
  })

  it("retains failed device edits and returns focus after a successful commit", async () => {
    const { wrapper, live } = await fixture()
    const configure = vi
      .spyOn(live, "configure")
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const trigger = wrapper.get<HTMLButtonElement>(`button${label("live.devices")}`)
    trigger.element.focus()
    await trigger.trigger("click")
    await flushPromises()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    const apply = () =>
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "Apply rig"
      )!
    apply().click()
    await flushPromises()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    apply().click()
    await flushPromises()
    expect(configure).toHaveBeenCalledTimes(2)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger.element)
    wrapper.unmount()
  })

  it("ignores stale device discovery after changing the selected rig", async () => {
    const { wrapper, live, listDevices } = await fixture()
    let resolve!: (value: never) => void
    listDevices.mockImplementationOnce(
      () =>
        new Promise((settle) => {
          resolve = settle
        })
    )
    const first = workspace()
    first.session.configuration.audio!.inputDeviceId = "old"
    live.applyWorkspace(first)
    await flushPromises()
    live.applyWorkspace({
      ...workspace(),
      session: {
        ...workspace().session,
        configuration: { ...workspace().session.configuration, audio: null }
      }
    })
    await flushPromises()
    resolve({ inputs: [{ id: "old", channelCount: 99 }], outputs: [] } as never)
    await flushPromises()
    expect(wrapper.get("output").text()).toBe("0/0")
    wrapper.unmount()
  })
})
