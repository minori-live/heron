import { AssetAuditionService, AssetMaterializer } from "../project"
import { AudioImportService } from "../project"
import { AudioGraphCompiler } from "../project"
import { AudioGraphPublisher } from "../project"
import { bindAudioHostApplicationEvents } from "./audio-host-application-events"
import type { ApplicationEventTarget } from "./audio-host-application-events"
import type { AudioHostService } from "../audio-host"
import type { ApplicationSettingsStore } from "../settings"
import { commitExternalProjectDirty } from "../project"
import { LifecycleCoordinator } from "../kernel"
import { MidiImportService } from "../project"
import { MixerRuntimeService } from "../audio"
import { OperationRegistry } from "../kernel"
import { OperationService } from "../kernel"
import type { PluginCatalogService } from "../plugins"
import { ProjectCommandService } from "../project"
import { ProjectGraphService } from "../project"
import type { ProjectService } from "../project"
import { RecordingService } from "../recording"
import { TransportService } from "../audio"
import { normalizeAudioRuntime } from "../ipc"
import { WaveformService } from "../project"
import { pluginTypeKey } from "@heron/contracts"
import { MidiControlService } from "./midi-control-service"
import { sendApplicationCommand } from "./application-command-events"
import { AudioDeviceRecoveryCoordinator } from "./audio-device-recovery-coordinator"

export interface ApplicationServices {
  projectGraph: ProjectGraphService
  projectCommands: ProjectCommandService
  mixerRuntime: MixerRuntimeService
  transport: TransportService
  audioImport: AudioImportService
  assetAudition: AssetAuditionService
  midiImport: MidiImportService
  lifecycle: LifecycleCoordinator
  operations: OperationService
  recordings: RecordingService
  waveforms: WaveformService
  midiControl: MidiControlService
  audioDeviceRecovery: AudioDeviceRecoveryCoordinator
  dispose(): void
}

export interface CreateApplicationServicesOptions {
  userDataPath: string
  sourceEpoch: string
  settings: ApplicationSettingsStore
  projectService: ProjectService
  audioHost: AudioHostService
  plugins: PluginCatalogService
  eventTargets: () => readonly ApplicationEventTarget[]
  allowRecordingWithoutAudio: boolean
}

export async function createApplicationServices(
  options: CreateApplicationServicesOptions
): Promise<ApplicationServices> {
  const { settings, projectService, audioHost, plugins } = options
  const assetMaterializer = new AssetMaterializer(options.userDataPath, projectService)
  const graphPublisher = new AudioGraphPublisher(
    new AudioGraphCompiler(),
    assetMaterializer,
    audioHost,
    plugins,
    settings
  )
  const projectGraph = new ProjectGraphService(projectService, graphPublisher)
  const projectCommands = new ProjectCommandService(
    projectGraph,
    projectService,
    audioHost,
    plugins
  )
  const mixerRuntime = new MixerRuntimeService(audioHost)
  const transport = new TransportService(projectService, audioHost)
  const audioImport = new AudioImportService(options.userDataPath, projectService)
  const assetAudition = new AssetAuditionService(
    projectService,
    projectGraph,
    assetMaterializer,
    audioHost
  )

  plugins.attachRuntime({
    resolveInstance: async (instanceId) => {
      const graph = await projectGraph.snapshot()
      const plugin = graph.plugins.find((candidate) => candidate.id === instanceId)
      if (!plugin) throw new Error(`Plugin instance '${instanceId}' was not found`)
      return { plugin, sampleRate: graph.sampleRate }
    },
    load: (plugin, sampleRate) => audioHost.loadPlugin(plugin, sampleRate),
    parameters: (instanceId) => audioHost.pluginParameters(instanceId),
    setParameter: (change) => audioHost.setPluginParameter(change),
    openEditor: async (instanceId) => {
      const graph = await projectGraph.snapshot()
      const plugin = graph.plugins.find((candidate) => candidate.id === instanceId)
      if (!plugin) throw new Error(`Plugin instance '${instanceId}' was not found`)
      const channel = graph.channels.find((candidate) => candidate.id === plugin.channelId)
      if (!channel) throw new Error(`Plugin channel '${plugin.channelId}' was not found`)
      const preference = await settings.pluginEditorPreference(pluginTypeKey(plugin.descriptor))
      return audioHost.openPluginEditor(instanceId, preference, {
        channelName: channel.name,
        channelColor: channel.color,
        pluginName: plugin.descriptor.name,
        appearance: audioHost.pluginEditorAppearanceSnapshot()
      })
    },
    closeEditor: (instanceId) => audioHost.closePluginEditor(instanceId),
    retry: (instanceId) => audioHost.retryPlugin(instanceId)
  })

  const midiImport = new MidiImportService(projectGraph, projectCommands, plugins, projectService)
  const initialAudioRuntime = await audioHost.audioEngineSnapshot()
  const normalizedAudioRuntime = normalizeAudioRuntime(initialAudioRuntime)
  const lifecycle = new LifecycleCoordinator(projectService.current, normalizedAudioRuntime, {
    allowRecordingWithoutAudio: options.allowRecordingWithoutAudio,
    audioHostEpoch: audioHost.helperEpoch() ?? undefined
  })
  if (initialAudioRuntime.state === "running") {
    await lifecycle.applicationState.commitAudioEngine(normalizedAudioRuntime)
  }
  const operations = new OperationService(
    new OperationRegistry(),
    lifecycle.applicationState.desktopSession
  )
  projectCommands.attachKernel(lifecycle, operations)
  let midiParameterSequence = 0n
  const midiControl = new MidiControlService({
    graph: () => projectGraph.snapshotNow(),
    learning: () => audioHost.isMidiControlLearning(),
    dispatchApplicationCommand: (command) => {
      const target = options.eventTargets()[0]
      if (target) sendApplicationCommand(target, command)
    },
    applyMixerControl: async (channelId, parameter, value) => {
      const applied = await projectGraph.applyMidiControl(channelId, parameter, value)
      if (!applied) return false
      if ((parameter === "gainDb" || parameter === "pan") && typeof value === "number") {
        await audioHost.previewMixerParameter({
          target: "channel",
          id: channelId,
          parameter,
          value
        })
      }
      return true
    },
    pluginParameters: (instanceId) => audioHost.pluginParameters(instanceId),
    applyPluginParameter: async (instanceId, parameter, value) => {
      const resource = await lifecycle.applicationState.pluginInstanceSnapshot(instanceId, () =>
        plugins.closeEditor(instanceId)
      )
      const helperEpoch = audioHost.helperEpoch()
      if (!resource || !helperEpoch) return false
      midiParameterSequence += 1n
      await audioHost.enqueuePluginParameter({
        plugin: resource.plugin,
        helperEpoch,
        pluginGeneration: resource.plugin.generation,
        sequence: midiParameterSequence.toString(),
        parameterKey: parameter.parameterKey,
        runtimeToken: parameter.runtimeToken,
        value,
        gesture: "perform"
      })
      return true
    },
    markDirty: () => commitExternalProjectDirty(projectService, lifecycle)
  })
  midiControl.configure((await settings.get()).midiControl)
  audioHost.setMidiControlEventHandler((event) => midiControl.receive(event))
  audioHost.setMidiControlPreferencesHandler((preferences) => midiControl.configure(preferences))
  const recordings = new RecordingService(
    settings,
    projectService,
    operations,
    projectGraph,
    transport,
    audioHost,
    projectCommands
  )
  const audioDeviceRecovery = new AudioDeviceRecoveryCoordinator(
    audioHost,
    lifecycle,
    recordings,
    projectGraph,
    transport
  )
  await audioDeviceRecovery.initialize()
  const applicationEvents = bindAudioHostApplicationEvents({
    audioHost,
    projectCommands,
    operations,
    plugins,
    sourceEpoch: options.sourceEpoch,
    targets: options.eventTargets,
    markProjectDirty: () => commitExternalProjectDirty(projectService, lifecycle)
  })
  const waveforms = new WaveformService(settings, projectService)

  return {
    projectGraph,
    projectCommands,
    mixerRuntime,
    transport,
    audioImport,
    assetAudition,
    midiImport,
    lifecycle,
    operations,
    recordings,
    waveforms,
    midiControl,
    audioDeviceRecovery,
    dispose: () => {
      audioDeviceRecovery.dispose()
      applicationEvents.dispose()
    }
  }
}
