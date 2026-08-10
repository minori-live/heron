import { describe, expect, it, vi } from "vitest"
import { BUILTIN_MIDI_TRANSFORM_PROFILE_IDS } from "@heron/contracts"

const fakes = vi.hoisted(() => ({
  graph: {
    sampleRate: 48_000,
    channels: [
      {
        id: "channel",
        kind: "audio",
        systemRole: null,
        sortOrder: 0,
        name: "Track",
        color: "#fff",
        gainDb: 0,
        pan: 0,
        muted: false,
        soloed: false
      }
    ],
    plugins: [
      {
        id: "plugin",
        channelId: "channel",
        controlAlias: "lead",
        descriptor: { name: "Gain", locator: { format: "vst3" } }
      }
    ]
  },
  snapshot: vi.fn(),
  snapshotNow: vi.fn(),
  applyMidiControl: vi.fn(async () => true),
  markDirty: vi.fn(async () => undefined),
  pluginInstanceSnapshot: vi.fn(async () => ({ plugin: { generation: 2 } })),
  sendApplicationCommand: vi.fn(),
  attachKernel: vi.fn(),
  applicationDispose: vi.fn(),
  commitAudioEngine: vi.fn(async () => undefined),
  applicationState: { desktopSession: { kind: "desktop-session" }, commitAudioEngine: vi.fn() }
}))

vi.mock("../project", () => ({
  AssetMaterializer: class {},
  AssetAuditionService: class {},
  AudioImportService: class {},
  AudioGraphCompiler: class {},
  AudioGraphPublisher: class {},
  ProjectGraphService: class {
    snapshot = fakes.snapshot
    snapshotNow = fakes.snapshotNow
    applyMidiControl = fakes.applyMidiControl
  },
  ProjectCommandService: class {
    attachKernel = fakes.attachKernel
  },
  MidiImportService: class {},
  WaveformService: class {},
  commitExternalProjectDirty: fakes.markDirty
}))
vi.mock("../audio", () => ({
  MixerRuntimeService: class {},
  TransportService: class {
    snapshot = vi.fn()
  }
}))
vi.mock("../kernel", () => ({
  LifecycleCoordinator: class {
    applicationState = {
      desktopSession: { kind: "desktop-session" },
      commitAudioEngine: fakes.commitAudioEngine,
      pluginInstanceSnapshot: fakes.pluginInstanceSnapshot,
      currentAudioDeviceRecovery: vi.fn(() => null)
    }
  },
  OperationRegistry: class {},
  OperationService: class {}
}))
vi.mock("../recording", () => ({ RecordingService: class {} }))
vi.mock("./audio-host-application-events", () => ({
  bindAudioHostApplicationEvents: vi.fn(() => ({ dispose: fakes.applicationDispose }))
}))
vi.mock("./application-command-events", () => ({
  sendApplicationCommand: fakes.sendApplicationCommand
}))
vi.mock("../ipc", () => ({ normalizeAudioRuntime: vi.fn((runtime) => runtime) }))
vi.mock("@heron/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@heron/contracts")>()),
  pluginTypeKey: vi.fn(() => "vst3:gain")
}))

import { createApplicationServices } from "./application-services"

interface AttachedRuntime {
  resolveInstance(id: string): Promise<unknown>
  load(plugin: unknown, sampleRate: number): Promise<unknown>
  parameters(id: string): Promise<unknown>
  setParameter(change: unknown): Promise<unknown>
  openEditor(id: string): Promise<unknown>
  closeEditor(id: string): Promise<unknown>
}

describe("createApplicationServices", () => {
  it("wires runtime adapters and delegates plug-in editor context", async () => {
    fakes.snapshot.mockResolvedValue(fakes.graph)
    fakes.snapshotNow.mockReturnValue(fakes.graph)
    const attached: AttachedRuntime[] = []
    const plugins = {
      attachRuntime: vi.fn((runtime: AttachedRuntime) => attached.push(runtime)),
      closeEditor: vi.fn(async () => undefined)
    }
    const audioHost = {
      loadPlugin: vi.fn(async () => undefined),
      pluginParameters: vi.fn(async () => []),
      setPluginParameter: vi.fn(async () => undefined),
      openPluginEditor: vi.fn(async () => undefined),
      closePluginEditor: vi.fn(async () => undefined),
      pluginEditorAppearanceSnapshot: vi.fn(() => ({ theme: "dark", locale: "en-US" })),
      audioEngineSnapshot: vi.fn(async () => ({ state: "running" })),
      helperEpoch: vi.fn(() => "audio-epoch"),
      isMidiControlLearning: vi.fn(() => false),
      previewMixerParameter: vi.fn(async () => undefined),
      enqueuePluginParameter: vi.fn(async () => undefined),
      setMidiControlEventHandler: vi.fn(),
      setMidiControlPreferencesHandler: vi.fn(),
      setDeviceRecoveryHandler: vi.fn(),
      deviceRecoverySnapshot: vi.fn(async () => ({ recovery: null, runtime: null }))
    }
    const settings = {
      get: vi.fn(async () => ({
        midiControl: {
          bindings: [
            {
              id: "command",
              address: {
                portId: "controller",
                portName: "Controller",
                channel: 0,
                type: "control-change",
                number: 7
              },
              input: { type: "absolute" },
              target: { type: "application-command", command: "project.save" }
            },
            {
              id: "gain",
              address: {
                portId: "controller",
                portName: "Controller",
                channel: 0,
                type: "control-change",
                number: 7
              },
              input: { type: "absolute" },
              target: { type: "mixer", channelIndex: 0, parameter: "gain" },
              transformProfileId: BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.linear
            },
            {
              id: "plugin",
              address: {
                portId: "controller",
                portName: "Controller",
                channel: 0,
                type: "control-change",
                number: 7
              },
              input: { type: "absolute" },
              target: {
                type: "plugin-parameter",
                controlAlias: "lead",
                parameterKey: "cutoff"
              },
              transformProfileId: BUILTIN_MIDI_TRANSFORM_PROFILE_IDS.linear
            }
          ],
          transformProfiles: []
        }
      })),
      pluginEditorPreference: vi.fn(async () => ({ mode: "native", zoomPercent: 100 }))
    }
    const services = await createApplicationServices({
      userDataPath: "/data",
      sourceEpoch: "main-epoch",
      settings,
      projectService: { current: null },
      audioHost,
      plugins,
      eventTargets: () => [{ id: "window" }],
      allowRecordingWithoutAudio: false
    } as never)

    expect(plugins.attachRuntime).toHaveBeenCalledOnce()
    expect(fakes.commitAudioEngine).toHaveBeenCalledWith({ state: "running" })
    expect(fakes.attachKernel).toHaveBeenCalledOnce()
    const runtime = attached[0]!
    await expect(runtime.resolveInstance("plugin")).resolves.toMatchObject({ sampleRate: 48_000 })
    await expect(runtime.resolveInstance("missing")).rejects.toThrow("was not found")
    await runtime.load({ id: "plugin" }, 48_000)
    await runtime.parameters("plugin")
    await runtime.setParameter({})
    await runtime.openEditor("plugin")
    await runtime.closeEditor("plugin")
    expect(audioHost.openPluginEditor).toHaveBeenCalledWith(
      "plugin",
      { mode: "native", zoomPercent: 100 },
      expect.objectContaining({ channelName: "Track", pluginName: "Gain" })
    )

    vi.mocked(audioHost.pluginParameters).mockResolvedValue([
      {
        parameterKey: "cutoff",
        runtimeToken: "token",
        title: "Cutoff",
        value: 0,
        minValue: 0,
        maxValue: 1,
        hidden: false,
        readOnly: false,
        automatable: true
      } as never
    ])
    const receiveMidi = vi.mocked(audioHost.setMidiControlEventHandler).mock.calls[0]![0]
    receiveMidi({
      generation: 1,
      timestampMicroseconds: 1_000,
      portId: "controller",
      portName: "Controller",
      channel: 0,
      type: "control-change",
      number: 7,
      value: 127
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    await Promise.resolve()
    expect(fakes.sendApplicationCommand).toHaveBeenCalledWith(
      expect.objectContaining({ id: "window" }),
      "project.save"
    )
    expect(fakes.applyMidiControl).toHaveBeenCalledWith("channel", "gainDb", 12)
    expect(audioHost.previewMixerParameter).toHaveBeenCalledWith({
      target: "channel",
      id: "channel",
      parameter: "gainDb",
      value: 12
    })
    expect(audioHost.enqueuePluginParameter).toHaveBeenCalledWith(
      expect.objectContaining({
        helperEpoch: "audio-epoch",
        pluginGeneration: 2,
        sequence: "1",
        parameterKey: "cutoff",
        runtimeToken: "token",
        value: 1
      })
    )
    expect(fakes.markDirty).toHaveBeenCalled()

    fakes.snapshot.mockResolvedValueOnce({ ...fakes.graph, channels: [] })
    await expect(runtime.openEditor("plugin")).rejects.toThrow("channel")
    services.dispose()
    expect(fakes.applicationDispose).toHaveBeenCalledOnce()
  })
})
