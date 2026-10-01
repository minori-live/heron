import { computed, shallowRef, toRef, watch } from "vue"
import type {
  LiveChannelPatch,
  LiveMixerEditCommand,
  MixerChannelCoreState,
  MixerChannelKind,
  MixerChannelPatch,
  MixerGraphSnapshot,
  MixerParameterPreview,
  MixerRouteTarget,
  MixerSendPatch,
  PluginDescriptor,
  PluginRuntimeStatus,
  PluginInstanceState
} from "@heron/contracts"
import { DEFAULT_INSTRUMENT_COLOR, pluginLocator } from "@heron/contracts"
import {
  MIXER_BUSES,
  resolveLiveLayer,
  availableOutputTargets,
  availableSendTargets,
  sendsFor
} from "@heron/project-model"
import { UI_DOMAIN_COLORS } from "@heron/ui"
import {
  pluginAudioModeInputWidth,
  pluginAudioModeOutputWidth,
  type PluginSelection,
  type PluginSignalWidth
} from "../components/plugins/plugin-audio-mode"
import { t } from "../i18n"
import { rpcErrorMessage } from "../rpc"
import { useLiveStore } from "../stores/live"
import { useLiveWorkspaceStore } from "../stores/liveWorkspace"
import { useLiveDiscoveryStore } from "../stores/liveDiscovery"
import { useProjectStore } from "../stores/project"
import { useMixerConfirmations } from "./useMixerConfirmations"
import { livePerformanceGestures } from "./live-performance-gestures"

const EMPTY_GRAPH: MixerGraphSnapshot = { sampleRate: 48_000, channels: [], sends: [], plugins: [] }
const CHANNEL_COLORS = {
  audio: UI_DOMAIN_COLORS.audioChannel,
  instrument: DEFAULT_INSTRUMENT_COLOR,
  aux: UI_DOMAIN_COLORS.busChannel,
  output: UI_DOMAIN_COLORS.outputChannel
} as const
type CreatableChannelKind = Exclude<MixerChannelKind, "master">

/** Adapts shared Mixer gestures to the selected Live editing layer. */
export function useLiveMixer() {
  const live = useLiveStore()
  const presentation = useLiveWorkspaceStore()
  const discovery = useLiveDiscoveryStore()
  const projects = useProjectStore()
  const adjust = livePerformanceGestures(live)
  const { confirmChannelDeletion, confirmInstrumentReplacement } = useMixerConfirmations()
  const selectedChannelId = shallowRef<string | null>(null)
  const catalog = shallowRef<PluginDescriptor[]>([])
  const resolved = computed(() => {
    const workspace = live.workspace
    if (workspace?.performance) return workspace.performance.snapshot
    if (workspace && presentation.selectedLayerId === null)
      return { graph: workspace.graph, parameterValues: workspace.parameterValues }
    return workspace
      ? resolveLiveLayer(
          { graph: workspace.graph, parameterValues: workspace.parameterValues },
          workspace.hierarchy,
          presentation.selectedLayerId
        )
      : { graph: EMPTY_GRAPH, parameterValues: [] }
  })
  const graph = computed(() => resolved.value.graph)
  const channels = computed(() => graph.value.channels)
  const pluginRuntime = computed<Record<string, PluginRuntimeStatus>>(() =>
    Object.fromEntries(
      graph.value.plugins.map((plugin) => {
        const failure = live.pluginFailures[plugin.id]
        return [
          plugin.id,
          {
            instanceId: plugin.id,
            state:
              failure?.outcome ??
              (live.performing ? (plugin.enabled ? "active" : "bypassed") : "unloaded"),
            editorOpen: false,
            latencySamples: 0,
            tailSamples: null,
            error: failure ? t(`plugins.failure.${failure.category}`) : null,
            ...(failure
              ? {
                  failure,
                  failureStage:
                    failure.stage === "ara" || failure.stage === "parameter" ? null : failure.stage
                }
              : {})
          }
        ]
      })
    )
  )
  const orderedChannels = computed(() =>
    (["audio", "instrument", "aux", "master", "output"] as const).flatMap((kind) =>
      channels.value
        .filter((channel) => channel.kind === kind)
        .sort((a, b) => a.sortOrder - b.sortOrder)
    )
  )
  const outputs = computed(() =>
    orderedChannels.value.filter((channel) => channel.kind === "output")
  )
  const master = computed(() => channels.value.find((channel) => channel.kind === "master") ?? null)
  const selectedChannel = computed(
    () => channels.value.find((channel) => channel.id === selectedChannelId.value) ?? null
  )
  const effectPlugins = computed(() =>
    catalog.value.filter(
      (plugin) => plugin.kind === "effect" && plugin.compatibility === "compatible"
    )
  )
  const instrumentPlugins = computed(() =>
    catalog.value.filter(
      (plugin) => plugin.kind === "instrument" && plugin.compatibility === "compatible"
    )
  )

  function edit(command: LiveMixerEditCommand): Promise<boolean> {
    if (live.performing) return performEdit(command)
    const layerId = presentation.selectedLayerId
    if (layerId === null)
      return rejectDependentOverrides(command) ? Promise.resolve(false) : live.edit(command)
    const allowed =
      command.type === "update-channel"
        ? Object.keys(command.patch).every((field) =>
            ["gainDb", "pan", "muted", "soloed"].includes(field)
          )
        : command.type === "update-send"
          ? Object.keys(command.patch).every((field) => ["levelDb", "enabled"].includes(field))
          : command.type === "update-plugin" &&
            Object.keys(command.patch).every((field) => field === "enabled")
    if (!allowed) {
      live.error = t("live.layers.projectStructure")
      return Promise.resolve(false)
    }
    return live.edit({ type: "edit-live-layer", layerId, command })
  }

  async function performEdit(command: LiveMixerEditCommand): Promise<boolean> {
    if (command.type === "update-channel") {
      if (
        Object.keys(command.patch).some(
          (key) => !["gainDb", "pan", "muted", "soloed"].includes(key)
        )
      )
        return rejectPerformanceStructure()
      for (const parameter of ["gainDb", "pan", "muted", "soloed"] as const) {
        const value = command.patch[parameter]
        if (
          value !== undefined &&
          !(await adjust({ type: "channel", id: command.channelId, parameter, value }))
        )
          return false
      }
      return true
    }
    if (command.type === "update-send") {
      if (Object.keys(command.patch).some((key) => !["levelDb", "enabled"].includes(key)))
        return rejectPerformanceStructure()
      for (const parameter of ["levelDb", "enabled"] as const) {
        const value = command.patch[parameter]
        if (
          value !== undefined &&
          !(await adjust({ type: "send", id: command.sendId, parameter, value }))
        )
          return false
      }
      return true
    }
    if (
      command.type === "update-plugin" &&
      Object.keys(command.patch).every((key) => key === "enabled")
    ) {
      return command.patch.enabled === undefined
        ? false
        : adjust({
            type: "plugin",
            id: command.pluginId,
            parameter: "enabled",
            value: command.patch.enabled
          })
    }
    return rejectPerformanceStructure()
  }

  function rejectPerformanceStructure(): false {
    live.error = t("live.performance.structureLocked")
    return false
  }

  function rejectDependentOverrides(command: LiveMixerEditCommand): boolean {
    const workspace = live.workspace
    if (!workspace) return false
    const targets = new Set<string>()
    if (command.type === "delete-channel") {
      targets.add(`channel:${command.channelId}`)
      for (const send of workspace.graph.sends.filter(
        (value) => value.sourceChannelId === command.channelId
      ))
        targets.add(`send:${send.id}`)
      for (const plugin of workspace.graph.plugins.filter(
        (value) => value.channelId === command.channelId
      ))
        targets.add(`plugin:${plugin.id}`)
    } else if (command.type === "delete-send") targets.add(`send:${command.sendId}`)
    else if (command.type === "delete-plugin" || command.type === "replace-plugin")
      targets.add(`plugin:${command.pluginId}`)
    const layers = [...workspace.hierarchy.sets, ...workspace.hierarchy.patches].filter(
      (layer) =>
        layer.overrides.some((value) =>
          targets.has(`${value.type === "plugin-parameter" ? "plugin" : value.type}:${value.id}`)
        ) || layer.pluginStates?.some((state) => targets.has(`plugin:${state.pluginId}`))
    )
    if (!layers.length) return false
    live.error = t("live.layers.dependentOverrides", {
      names: layers.map((layer) => layer.name).join(", ")
    })
    return true
  }

  watch(
    channels,
    (current) => {
      if (!current.some((channel) => channel.id === selectedChannelId.value)) {
        selectedChannelId.value =
          current.find((channel) => channel.kind === "audio")?.id ?? current[0]?.id ?? null
      }
    },
    { immediate: true }
  )

  async function loadPlugins(): Promise<void> {
    const desktop = projects.desktopSession
    if (!desktop) return
    const result = await discovery.listPluginCatalog(desktop)
    if (result.ok) catalog.value = result.value.plugins
    else live.error = rpcErrorMessage(result.error)
  }

  function pluginsFor(channelId: string): PluginInstanceState[] {
    return graph.value.plugins
      .filter((plugin) => plugin.channelId === channelId)
      .sort((a, b) =>
        a.role !== b.role ? (a.role === "instrument" ? -1 : 1) : a.slotOrder - b.slotOrder
      )
  }

  async function createChannel(
    kind: CreatableChannelKind,
    inputFormat: "mono" | "stereo" = "stereo"
  ): Promise<boolean> {
    const peers = channels.value.filter((channel) => channel.kind === kind)
    const sortOrder = Math.max(-1, ...peers.map((channel) => channel.sortOrder)) + 1
    const hardwareOutputChannels: number[] = []
    if (kind === "output") {
      const used = new Set(outputs.value.map((output) => output.hardwareOutputChannels.join(",")))
      let first = 1
      while (first < 32 && used.has(`${first},${first + 1}`)) first += 2
      if (first > 31) {
        live.error = t("live.outputLimit")
        return false
      }
      hardwareOutputChannels.push(first, first + 1)
    }
    const labels = { audio: "Audio", instrument: "Instrument", aux: "Aux", output: "Output" }
    const channel: MixerChannelCoreState = {
      id: crypto.randomUUID(),
      kind,
      name:
        kind === "output"
          ? `Output ${hardwareOutputChannels.join("–")}`
          : `${labels[kind]} ${sortOrder + 1}`,
      color: CHANNEL_COLORS[kind],
      sortOrder,
      inputSource: kind === "audio" ? "hardware" : kind === "aux" ? "bus" : null,
      inputFormat: kind === "audio" || kind === "aux" ? inputFormat : null,
      ...(kind === "instrument"
        ? { midiInput: { portId: null, portName: null, channel: null } }
        : {}),
      gainDb: 0,
      pan: 0,
      muted: false,
      soloed: false,
      outputChannelId: kind === "output" ? null : (outputs.value[0]?.id ?? null),
      outputBus: null,
      inputMonitoring: kind === "instrument",
      inputChannels:
        kind === "audio" || kind === "aux" ? (inputFormat === "mono" ? [1] : [1, 2]) : [],
      hardwareOutputChannels
    }
    const committed = await edit({ type: "create-channel", channel })
    if (committed) selectedChannelId.value = channel.id
    return committed
  }

  function updateChannel(channelId: string, patch: MixerChannelPatch): Promise<boolean> {
    const { recordArmed: _recordArmed, ...livePatch } = patch
    if (Object.keys(livePatch).length === 0) return Promise.resolve(false)
    return edit({
      type: "update-channel",
      channelId,
      patch: livePatch satisfies LiveChannelPatch
    })
  }

  async function deleteChannel(channelId: string): Promise<boolean> {
    if (live.performing) return rejectPerformanceStructure()
    if (presentation.selectedLayerId !== null) {
      live.error = t("live.layers.projectStructure")
      return false
    }
    const channel = channels.value.find((candidate) => candidate.id === channelId)
    if (!channel || channel.kind === "master") return false
    if (rejectDependentOverrides({ type: "delete-channel", channelId })) return false
    const original = live.workspace
    const confirmed = await confirmChannelDeletion(channel.name)
    if (live.workspace !== original || presentation.selectedLayerId !== null) return false
    return confirmed ? edit({ type: "delete-channel", channelId }) : false
  }

  function updateSend(sendId: string, patch: MixerSendPatch): Promise<boolean> {
    return edit({ type: "update-send", sendId, patch })
  }

  function addSend(sourceChannelId: string, target: MixerRouteTarget): Promise<boolean> {
    return edit({
      type: "create-send",
      send: {
        id: crypto.randomUUID(),
        sourceChannelId,
        targetChannelId: target.kind === "output" ? target.channelId : null,
        targetBus: target.kind === "bus" ? target.bus : null,
        sortOrder:
          Math.max(
            -1,
            ...graph.value.sends
              .filter((send) => send.sourceChannelId === sourceChannelId)
              .map((send) => send.sortOrder)
          ) + 1,
        enabled: true,
        tap: "post-pan",
        levelDb: -90
      }
    })
  }

  function pluginInstance(
    channelId: string,
    selection: PluginSelection,
    role: PluginInstanceState["role"],
    slotOrder: number,
    current?: PluginInstanceState
  ): PluginInstanceState {
    return {
      id: current?.id ?? crypto.randomUUID(),
      channelId,
      role,
      slotOrder,
      locator: structuredClone(pluginLocator(selection.descriptor)),
      descriptor: structuredClone(selection.descriptor),
      audioMode: selection.audioMode,
      enabled: true,
      controlAlias: current?.controlAlias ?? null,
      sidechainInputs: [],
      state: { version: 1, chunks: [] }
    }
  }

  function insertPlugin(
    channelId: string,
    selection: PluginSelection,
    slotOrder: number
  ): Promise<boolean> {
    const channel = channels.value.find((candidate) => candidate.id === channelId)
    if (!channel || channel.kind === "master") {
      live.error = t("rendererErrors.selectChannel")
      return Promise.resolve(false)
    }
    const plugins = pluginsFor(channelId)
    const instrument = plugins.find((plugin) => plugin.role === "instrument")
    const inserts = plugins.filter((plugin) => plugin.role === "insert")
    const index = Math.max(0, Math.min(slotOrder, inserts.length))
    let width: PluginSignalWidth = instrument
      ? pluginAudioModeOutputWidth(instrument.audioMode)
      : channel.kind !== "instrument" && channel.inputChannels.length === 1
        ? "mono"
        : "stereo"
    for (const plugin of inserts.slice(0, index))
      width = pluginAudioModeOutputWidth(plugin.audioMode)
    if (
      selection.descriptor.kind !== "effect" ||
      pluginAudioModeInputWidth(selection.audioMode) !== width
    ) {
      live.error = t("rendererErrors.effectMode", { width })
      return Promise.resolve(false)
    }
    return edit({
      type: "insert-plugin",
      plugin: pluginInstance(channelId, selection, "insert", index)
    })
  }

  async function assignInstrument(channelId: string, selection: PluginSelection): Promise<boolean> {
    if (live.performing) return rejectPerformanceStructure()
    if (presentation.selectedLayerId !== null) {
      live.error = t("live.layers.projectStructure")
      return false
    }
    const channel = channels.value.find((candidate) => candidate.id === channelId)
    if (!channel || channel.kind !== "instrument" || selection.descriptor.kind !== "instrument") {
      live.error = t("rendererErrors.instrumentTrack")
      return false
    }
    const current = graph.value.plugins.find(
      (plugin) => plugin.channelId === channelId && plugin.role === "instrument"
    )
    if (current && rejectDependentOverrides({ type: "delete-plugin", pluginId: current.id }))
      return false
    const original = live.workspace
    if (
      current &&
      !(await confirmInstrumentReplacement(current.descriptor.name, selection.descriptor.name))
    )
      return false
    if (live.workspace !== original || presentation.selectedLayerId !== null) return false
    const plugin = pluginInstance(channelId, selection, "instrument", 0, current)
    return edit(
      current
        ? { type: "replace-plugin", pluginId: current.id, plugin }
        : { type: "create-plugin", plugin }
    )
  }

  function movePlugin(pluginId: string, channelId: string, slotOrder: number): Promise<boolean> {
    const plugin = graph.value.plugins.find((candidate) => candidate.id === pluginId)
    if (!plugin || plugin.role !== "insert") return Promise.resolve(false)
    return edit({ type: "move-plugin", pluginId, channelId, slotOrder })
  }

  function preview(value: MixerParameterPreview): void {
    if (!live.performing) return
    if (value.target === "channel" && (value.parameter === "gainDb" || value.parameter === "pan"))
      void adjust({ type: "channel", id: value.id, parameter: value.parameter, value: value.value })
    else if (value.target === "send" && value.parameter === "levelDb")
      void adjust({ type: "send", id: value.id, parameter: "levelDb", value: value.value })
  }

  return {
    graph,
    parameterValues: computed(() => resolved.value.parameterValues),
    orderedChannels,
    outputs,
    master,
    selectedChannelId,
    selectedChannel,
    error: toRef(live, "error"),
    loading: toRef(live, "pending"),
    buses: MIXER_BUSES,
    effectPlugins,
    instrumentPlugins,
    pluginRuntime,
    loadPlugins,
    pluginsFor,
    sendsFor: (channelId: string) => sendsFor(graph.value, channelId),
    availableOutputTargets: (channelId: string) => availableOutputTargets(graph.value, channelId),
    availableSendTargets: (channelId: string) => availableSendTargets(graph.value, channelId),
    createChannel,
    createAudioChannel: (format: "mono" | "stereo" = "stereo") => createChannel("audio", format),
    createInstrumentChannel: () => createChannel("instrument"),
    createAux: (format: "mono" | "stereo" = "stereo") => createChannel("aux", format),
    createOutput: () => createChannel("output"),
    updateChannel,
    deleteChannel,
    updateSend,
    addSend,
    deleteSend: (sendId: string) => edit({ type: "delete-send", sendId }),
    togglePlugin: (pluginId: string, enabled: boolean) =>
      edit({ type: "update-plugin", pluginId, patch: { enabled } }),
    removePlugin: (pluginId: string) => edit({ type: "delete-plugin", pluginId }),
    insertPlugin,
    assignInstrument,
    movePlugin,
    preview
  }
}
