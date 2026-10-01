import { createPinia, setActivePinia } from "pinia"
import { effectScope, nextTick } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  LiveWorkspaceSnapshot,
  MixerChannelCoreState,
  PluginDescriptor
} from "@heron/contracts"
import { applyLiveLayerEdit } from "@heron/project-model"
import { useLiveStore } from "../stores/live"
import { useLiveWorkspaceStore } from "../stores/liveWorkspace"
import { useProjectStore } from "../stores/project"
import { rpcSuccess, TEST_DESKTOP_REF } from "../test/ipc"
import { useLiveMixer } from "./useLiveMixer"

const confirm = vi.hoisted(() => vi.fn(async () => true))
vi.mock("./useGlobalDialog", () => ({ useGlobalDialog: () => ({ confirm, showDialog: vi.fn() }) }))

function channel(id: string, kind: MixerChannelCoreState["kind"]): MixerChannelCoreState {
  return {
    id,
    kind,
    name: id,
    color: "#4F8CFF",
    sortOrder: 0,
    inputSource: kind === "audio" ? "hardware" : null,
    inputFormat: kind === "audio" ? "stereo" : null,
    gainDb: 0,
    pan: 0,
    muted: false,
    soloed: false,
    outputChannelId: kind === "audio" || kind === "instrument" ? "output" : null,
    outputBus: null,
    inputMonitoring: false,
    inputChannels: kind === "audio" ? [1, 2] : [],
    hardwareOutputChannels: kind === "output" ? [1, 2] : []
  }
}

function workspace(): LiveWorkspaceSnapshot {
  return {
    kind: "live",
    hierarchy: { sets: [], patches: [] },
    parameterValues: [],
    revision: 0,
    mode: "edit",
    history: { canUndo: false, canRedo: false },
    project: { kind: "project-session", id: "live", epoch: "test", generation: 1 },
    projectGraph: { kind: "project-graph", id: "live-graph", epoch: "test", generation: 1 },
    session: {
      kind: "live",
      id: "live",
      path: "/stage.hrl",
      dirty: false,
      recoveredWorkingCopy: false,
      configuration: { name: "Stage", sampleRate: 48_000, audio: null, enabledMidiDeviceIds: [] }
    },
    graph: {
      sampleRate: 48_000,
      channels: [
        channel("audio", "audio"),
        channel("master", "master"),
        channel("output", "output")
      ],
      sends: [],
      plugins: []
    },
    bindings: []
  }
}

function descriptor(kind: "effect" | "instrument" = "effect"): PluginDescriptor {
  return {
    source: { kind: "external" },
    locator: { format: "vst3", artifactPath: "/Effect.vst3", nativeId: kind },
    name: kind,
    vendor: "Heron",
    version: "1",
    categories: [kind],
    kind,
    supportedAudioModes: ["mono", "stereo"],
    architecture: "x86_64",
    buses: [],
    hasEditor: true,
    compatibility: "compatible",
    compatibilityReason: null
  }
}

const scopes: ReturnType<typeof effectScope>[] = []
function setup() {
  const live = useLiveStore()
  live.applyWorkspace(workspace())
  const edit = vi.spyOn(live, "edit").mockImplementation(async (command) => {
    if (typeof command === "string") return false
    const current = live.workspace!
    const edited = applyLiveLayerEdit(
      {
        snapshot: { graph: current.graph, parameterValues: current.parameterValues },
        bindings: current.bindings,
        hierarchy: current.hierarchy
      },
      command
    )
    live.applyWorkspace({
      ...current,
      graph: edited.snapshot.graph,
      parameterValues: edited.snapshot.parameterValues,
      bindings: edited.bindings,
      hierarchy: edited.hierarchy,
      revision: current.revision + 1,
      session: { ...current.session, dirty: true }
    })
    return true
  })
  const scope = effectScope()
  scopes.push(scope)
  const mixer = scope.run(useLiveMixer)!
  return { live, edit, mixer }
}

describe("Live Mixer adapter", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    confirm.mockResolvedValue(true)
  })
  afterEach(() => {
    scopes.splice(0).forEach((scope) => scope.stop())
    vi.restoreAllMocks()
  })

  it("resolves the selected Patch, scopes inherited scalar edits and rejects inherited structural changes", async () => {
    const { live, edit, mixer } = setup()
    await live.edit({ type: "create-set", setId: "set", name: "Set" })
    await live.edit({ type: "create-patch", patchId: "patch", setId: "set", name: "Patch" })
    await live.edit({
      type: "set-live-override",
      layerId: "set",
      override: { type: "channel", id: "audio", parameter: "gainDb", value: -6 }
    })
    useLiveWorkspaceStore().selectedLayerId = "patch"
    expect(mixer.graph.value.channels.find((channel) => channel.id === "audio")?.gainDb).toBe(-6)
    await mixer.updateChannel("audio", { gainDb: -9 })
    expect(edit).toHaveBeenLastCalledWith({
      type: "edit-live-layer",
      layerId: "patch",
      command: { type: "update-channel", channelId: "audio", patch: { gainDb: -9 } }
    })
    expect(live.workspace?.graph.channels.find((channel) => channel.id === "audio")?.gainDb).toBe(0)
    expect(live.workspace?.hierarchy.sets[0]?.overrides[0]?.value).toBe(-9)
    edit.mockClear()
    expect(await mixer.createAudioChannel()).toBe(false)
    expect(await mixer.updateChannel("audio", { name: "renamed" })).toBe(false)
    expect(await mixer.deleteChannel("audio")).toBe(false)
    expect(await mixer.addSend("audio", { kind: "bus", bus: 1 })).toBe(false)
    expect(edit).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
    expect(live.error).not.toBe("")
    useLiveWorkspaceStore().selectedLayerId = null
    expect(mixer.graph.value.channels.find((channel) => channel.id === "audio")?.gainDb).toBe(0)
  })

  it("creates root channels without Studio recording or Track fields and selects only committed channels", async () => {
    const { live, edit, mixer } = setup()
    expect(mixer.selectedChannelId.value).toBe("audio")
    for (const kind of ["audio", "instrument", "aux", "output"] as const) {
      expect(await mixer.createChannel(kind)).toBe(true)
      const created = edit.mock.calls.at(-1)![0]
      expect(created).toMatchObject({ type: "create-channel", channel: { kind } })
      if (typeof created === "string" || created.type !== "create-channel")
        throw new Error("wrong command")
      expect(created.channel).not.toHaveProperty("recordArmed")
      expect(created.channel).not.toHaveProperty("systemRole")
      expect(created).not.toHaveProperty("track")
      expect(mixer.selectedChannelId.value).toBe(created.channel.id)
      if (kind === "audio") expect(created.channel.inputMonitoring).toBe(false)
      if (kind === "output") expect(created.channel.hardwareOutputChannels).toEqual([3, 4])
    }
    expect(live.workspace?.graph).not.toHaveProperty("tracks")
    const previous = mixer.selectedChannelId.value
    edit.mockResolvedValueOnce(false)
    expect(await mixer.createAudioChannel()).toBe(false)
    expect(mixer.selectedChannelId.value).toBe(previous)
  })

  it("commits send gestures with original Mixer defaults and never routes previews to Studio", async () => {
    const { live, edit, mixer } = setup()
    const initial = structuredClone(live.workspace)
    mixer.preview({ target: "channel", id: "audio", parameter: "gainDb", value: -9 })
    expect(edit).not.toHaveBeenCalled()
    expect(live.workspace).toEqual(initial)
    await mixer.addSend("audio", { kind: "bus", bus: 2 })
    const send = mixer.sendsFor("audio")[0]!
    expect(send).toMatchObject({
      targetBus: 2,
      targetChannelId: null,
      enabled: true,
      tap: "post-pan",
      levelDb: -90
    })
    await mixer.updateSend(send.id, { levelDb: -6 })
    expect(mixer.sendsFor("audio")[0]?.levelDb).toBe(-6)
    await mixer.deleteSend(send.id)
    expect(mixer.sendsFor("audio")).toEqual([])
    await mixer.updateChannel("audio", { recordArmed: true })
    expect(edit).toHaveBeenCalledTimes(3)
  })

  it("uses single atomic plugin and channel commands and clears stale selection", async () => {
    const { edit, mixer } = setup()
    const selection = { descriptor: descriptor(), audioMode: "stereo" as const }
    await mixer.insertPlugin("audio", selection, 0)
    await mixer.insertPlugin("audio", selection, 0)
    expect(mixer.pluginsFor("audio").map((plugin) => plugin.slotOrder)).toEqual([0, 1])
    expect(
      edit.mock.calls.map(([command]) => (typeof command === "string" ? command : command.type))
    ).toEqual(["insert-plugin", "insert-plugin"])
    await mixer.addSend("audio", { kind: "bus", bus: 1 })
    edit.mockClear()
    confirm.mockResolvedValueOnce(false)
    expect(await mixer.deleteChannel("audio")).toBe(false)
    expect(edit).not.toHaveBeenCalled()
    expect(mixer.selectedChannelId.value).toBe("audio")
    expect(mixer.pluginsFor("audio")).toHaveLength(2)
    expect(mixer.sendsFor("audio")).toHaveLength(1)
    expect(await mixer.deleteChannel("audio")).toBe(true)
    expect(edit).toHaveBeenCalledExactlyOnceWith({ type: "delete-channel", channelId: "audio" })
    expect(mixer.graph.value.plugins).toEqual([])
    expect(mixer.graph.value.sends).toEqual([])
    await nextTick()
    expect(mixer.selectedChannelId.value).toBe("master")
  })

  it("keeps replacement cancelled and uses one stable-identity replacement when accepted", async () => {
    const { edit, mixer } = setup()
    await mixer.createInstrumentChannel()
    const id = mixer.selectedChannelId.value!
    const selection = { descriptor: descriptor("instrument"), audioMode: "stereo" as const }
    await mixer.assignInstrument(id, selection)
    const pluginId = mixer.pluginsFor(id)[0]!.id
    edit.mockClear()
    confirm.mockResolvedValueOnce(false)
    expect(await mixer.assignInstrument(id, selection)).toBe(false)
    expect(edit).not.toHaveBeenCalled()
    expect(await mixer.assignInstrument(id, selection)).toBe(true)
    expect(edit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: "replace-plugin",
        pluginId,
        plugin: expect.objectContaining({ id: pluginId, channelId: id })
      })
    )
  })

  it("explains dependent layer overrides before deleting a channel or its Send", async () => {
    const { live, edit, mixer } = setup()
    await mixer.addSend("audio", { kind: "bus", bus: 1 })
    const sendId = mixer.sendsFor("audio")[0]!.id
    await live.edit({ type: "create-set", setId: "set", name: "Acoustic" })
    await live.edit({
      type: "set-live-override",
      layerId: "set",
      override: { type: "send", id: sendId, parameter: "enabled", value: false }
    })
    edit.mockClear()
    expect(await mixer.deleteChannel("audio")).toBe(false)
    expect(await mixer.deleteSend(sendId)).toBe(false)
    expect(edit).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
    expect(live.error).toContain("Acoustic")
    expect(mixer.sendsFor("audio")).toHaveLength(1)
  })

  it("does not commit an old confirmation after the workspace changes", async () => {
    const { live, edit, mixer } = setup()
    let settle!: (confirmed: boolean) => void
    confirm.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          settle = resolve
        })
    )
    const deletion = mixer.deleteChannel("audio")
    await live.edit({ type: "create-set", setId: "set", name: "Acoustic" })
    edit.mockClear()
    settle(true)
    expect(await deletion).toBe(false)
    expect(edit).not.toHaveBeenCalled()
    expect(mixer.graph.value.channels.some((channel) => channel.id === "audio")).toBe(true)
  })

  it("loads the read-only plugin catalog through the desktop resource", async () => {
    const { mixer } = setup()
    useProjectStore().desktopSession = TEST_DESKTOP_REF
    const listPlugins = vi.fn(async () =>
      rpcSuccess({
        scannerVersion: 7,
        scanning: false,
        scannedAt: null,
        plugins: [descriptor(), descriptor("instrument")]
      })
    )
    window.heron.listPlugins = listPlugins
    await mixer.loadPlugins()
    expect(listPlugins).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ target: TEST_DESKTOP_REF })
    )
    expect(mixer.effectPlugins.value).toHaveLength(1)
    expect(mixer.instrumentPlugins.value).toHaveLength(1)
  })
})
