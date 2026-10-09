import { describe, expect, it } from "vitest"
import type {
  PluginDescriptor,
  MixerGraphSnapshot,
  PluginInstanceState,
  ProjectGraphSnapshot,
  ProjectCommand
} from "@heron/contracts"
import {
  applyToGraph,
  cloneGraph,
  deletedChannelIds,
  finiteRange,
  inverseFor,
  onlyRealtimeParameters,
  validateGraph
} from "./graph"
import { availableOutputTargets, patchMixerGraph } from "./selectors"
import { validateMixerGraph } from "./mixer-validation"
import { MixerValidationError, ProjectValidationError } from "./validation-error"

const effectDescriptor: PluginDescriptor = {
  source: { kind: "external" },
  locator: {
    format: "vst3",
    artifactPath: "/plugins/Effect.vst3",
    nativeId: "effect-class"
  },
  name: "Effect",
  vendor: "Heron Studio",
  version: "1.0",
  categories: ["Fx"],
  kind: "effect",
  architecture: "x86_64",
  buses: [],
  supportedAudioModes: ["stereo"],
  hasEditor: false,
  compatibility: "compatible",
  compatibilityReason: null
}

function plugin(overrides: Partial<PluginInstanceState> = {}): PluginInstanceState {
  return {
    id: "plugin-1",
    channelId: "instrument-1",
    role: "insert",
    slotOrder: 0,
    locator: effectDescriptor.locator,
    descriptor: effectDescriptor,
    audioMode: "stereo",
    enabled: true,
    state: {
      version: 1,
      chunks: [
        { key: "component", bytes: new Uint8Array([1]) },
        { key: "controller", bytes: new Uint8Array([2]) }
      ]
    },
    ...overrides,
    sidechainInputs: overrides.sidechainInputs ?? []
  }
}

function graph(): ProjectGraphSnapshot {
  return {
    sampleRate: 48_000,
    tracks: [{ id: "track:instrument-1", channelId: "instrument-1", sortOrder: 0 }],
    channels: [
      {
        id: "instrument-1",
        kind: "instrument",
        systemRole: null,
        name: "Instrument 1",
        color: "#73D6A2",
        sortOrder: 0,
        inputSource: null,
        inputFormat: null,
        gainDb: 0,
        pan: 0,
        muted: false,
        soloed: false,
        outputChannelId: "output",
        outputBus: null,
        recordArmed: false,
        inputMonitoring: false,
        inputChannels: [],
        hardwareOutputChannels: []
      },
      {
        id: "master",
        kind: "master",
        systemRole: null,
        name: "Master",
        color: "#8C83FF",
        sortOrder: 0,
        inputSource: null,
        inputFormat: null,
        gainDb: 0,
        pan: 0,
        muted: false,
        soloed: false,
        outputChannelId: null,
        outputBus: null,
        recordArmed: false,
        inputMonitoring: false,
        inputChannels: [],
        hardwareOutputChannels: []
      },
      {
        id: "output",
        kind: "output",
        systemRole: null,
        name: "Output",
        color: "#EF7C95",
        sortOrder: 0,
        inputSource: null,
        inputFormat: null,
        gainDb: 0,
        pan: 0,
        muted: false,
        soloed: false,
        outputChannelId: null,
        outputBus: null,
        recordArmed: false,
        inputMonitoring: false,
        inputChannels: [],
        hardwareOutputChannels: [1, 2]
      }
    ],
    audioClips: [],
    sends: [],
    plugins: [],
    midiClips: [
      {
        id: "clip-1",
        sourceId: "source-1",
        trackId: "track:instrument-1",
        name: "Clip",
        startTick: 0,
        lengthTicks: 960,
        sourceOffsetTicks: 0,
        sourceLengthTicks: 960,
        notes: [
          {
            id: "note-1",
            startTick: 120,
            durationTicks: 240,
            channel: 0,
            key: 60,
            velocity: 100,
            releaseVelocity: 0
          }
        ],
        events: []
      }
    ],
    tempoMap: {
      ticksPerQuarter: 960,
      tempoEvents: [{ tick: 0, beatsPerMinute: 120 }],
      timeSignatureEvents: [{ tick: 0, numerator: 4, denominator: 4 }]
    },
    keySignatureEvents: [{ tick: 0, fifths: 0, mode: "major" }]
  }
}

describe("shared Mixer and Studio validation", () => {
  it("routes and previews ordinary channels without constructing a Studio arrangement", () => {
    const studio = graph()
    const mixer: MixerGraphSnapshot = {
      sampleRate: studio.sampleRate,
      channels: studio.channels,
      sends: studio.sends,
      plugins: [plugin()]
    }
    expect(() => validateMixerGraph(mixer)).not.toThrow()
    expect(availableOutputTargets(mixer, "instrument-1")).toContainEqual({
      kind: "output",
      channelId: "output"
    })
    const preview = patchMixerGraph(mixer, "channel", "instrument-1", { gainDb: -6 })
    expect(preview.channels[0]!.gainDb).toBe(-6)
    expect(mixer.channels[0]!.gainDb).toBe(0)
    expect(() => validateMixerGraph(preview)).not.toThrow()

    // Hosted Mixer imports tolerate the narrower projection without Studio-only fields.
    const hostedProjection = {
      sampleRate: studio.sampleRate,
      channels: studio.channels.map(
        ({ systemRole: _systemRole, recordArmed: _recordArmed, ...channel }) => channel
      ),
      sends: studio.sends,
      plugins: studio.plugins
    }
    expect(() => validateMixerGraph(hostedProjection)).not.toThrow()

    expect(() => validateGraph({ ...studio, tracks: [] })).toThrow(ProjectValidationError)
    expect(() => validateGraph({ ...studio, tracks: [] })).toThrow("exactly one project track")

    // Studio additions remain validated even though routing accepts their Mixer projection.
    studio.midiClips[0]!.trackId = "missing-track"
    expect(() => validateGraph(studio)).toThrow(ProjectValidationError)
    expect(() => validateMixerGraph(mixer)).not.toThrow()
  })

  it("rejects dangling routing and invalid plug-in slots as typed Mixer domain failures", () => {
    const studio = graph()
    const mixer: MixerGraphSnapshot = {
      sampleRate: studio.sampleRate,
      channels: studio.channels,
      sends: [],
      plugins: [plugin({ slotOrder: -1 })]
    }
    expect(() => validateMixerGraph(mixer)).toThrow(MixerValidationError)
    expect(() => validateMixerGraph(mixer)).toThrow(ProjectValidationError)
    mixer.plugins = []
    mixer.channels[0]!.outputChannelId = "missing-output"
    expect(() => validateMixerGraph(mixer)).toThrow(MixerValidationError)
  })

  it("rejects ambiguous plug-in identities and descriptor routes in a Mixer import", () => {
    const studio = graph()
    const mixer: MixerGraphSnapshot = {
      sampleRate: studio.sampleRate,
      channels: studio.channels,
      sends: [],
      plugins: [plugin(), plugin({ slotOrder: 1 })]
    }
    expect(() => validateMixerGraph(mixer)).toThrow("Plugin instance IDs must be unique")
    mixer.plugins[1] = plugin({ id: "second-plugin" })
    expect(() => validateMixerGraph(mixer)).toThrow("Plugin slots must be unique")
    mixer.plugins[1] = plugin({
      id: "second-plugin",
      slotOrder: 1,
      locator: { ...effectDescriptor.locator, artifactPath: "/plugins/Other.vst3" }
    })
    expect(() => validateMixerGraph(mixer)).toThrow("Plugin locator must match")
    mixer.plugins = [
      plugin({ sidechainInputs: [{ inputPortKey: "", sourceChannelId: "instrument-1" }] })
    ]
    expect(() => validateMixerGraph(mixer)).toThrow("side-chain port keys cannot be empty")
  })
})

describe("project graph validation and command guards", () => {
  it("enforces descriptor-supported hosted audio modes", () => {
    const nativeMono = graph()
    nativeMono.plugins.push(
      plugin({
        descriptor: { ...effectDescriptor, supportedAudioModes: ["mono"] },
        audioMode: "mono-to-stereo"
      })
    )
    expect(() => validateGraph(nativeMono)).not.toThrow()

    const unsupported = graph()
    unsupported.plugins.push(
      plugin({
        descriptor: { ...effectDescriptor, supportedAudioModes: ["mono"] },
        audioMode: "stereo"
      })
    )
    expect(() => validateGraph(unsupported)).toThrowError(
      "Plugin audio mode must be supported by its descriptor snapshot"
    )
  })

  it("rejects non-text project and track notes", () => {
    expect(() => validateGraph({ ...graph(), projectNotes: 42 as unknown as string })).toThrowError(
      "Project notes must be text"
    )

    const invalidTrackNotes = graph()
    invalidTrackNotes.tracks[0]!.notes = 42 as unknown as string
    expect(() => validateGraph(invalidTrackNotes)).toThrowError("Track notes must be text")
  })

  it("validates finite ranges and rejects unknown lookup targets", () => {
    expect(() => finiteRange(0.5, 0, 1, "Sample")).not.toThrow()
    expect(() => finiteRange(Number.NaN, 0, 1, "Sample")).toThrow("Sample must be between")
    expect(() => finiteRange(2, 0, 1, "Sample")).toThrow("Sample must be between")

    const value = graph()
    expect(() =>
      applyToGraph(value, { type: "update-track", trackId: "missing", patch: { sortOrder: 1 } })
    ).toThrow("Project track 'missing' was not found")
    expect(() =>
      applyToGraph(value, { type: "update-channel", channelId: "missing", patch: { gainDb: 0 } })
    ).toThrow("Mixer channel 'missing' was not found")
    expect(() =>
      applyToGraph(value, { type: "update-send", sendId: "missing", patch: { levelDb: 0 } })
    ).toThrow("Mixer send 'missing' was not found")
    expect(() =>
      applyToGraph(value, {
        type: "move-audio-clip",
        clipId: "missing",
        trackId: "track:instrument-1",
        startFrame: 0
      })
    ).toThrow("Timeline clip 'missing' was not found")
    expect(() =>
      applyToGraph(value, {
        type: "update-plugin",
        pluginId: "missing",
        patch: { enabled: false }
      })
    ).toThrow("Plugin instance 'missing' was not found")
    expect(() =>
      applyToGraph(value, {
        type: "move-midi-clip",
        clipId: "missing",
        trackId: "track:instrument-1",
        startTick: 0
      })
    ).toThrow("MIDI clip 'missing' was not found")
    expect(() =>
      applyToGraph(value, {
        type: "update-midi-notes",
        clipId: "clip-1",
        updates: [{ noteId: "missing", patch: { key: 1 } }]
      })
    ).toThrow("MIDI note 'missing' was not found")
    expect(() => inverseFor(value, { type: "delete-send", sendId: "missing" })).toThrow(
      "Mixer send 'missing' was not found"
    )
    expect(cloneGraph(value)).toEqual(value)
    expect(cloneGraph(value)).not.toBe(value)
  })

  it("enforces channel deletion policy and restores an unused Output", () => {
    const value = graph()
    expect(() => applyToGraph(value, { type: "delete-channel", channelId: "master" })).toThrow(
      "Master cannot be deleted"
    )
    expect(() =>
      applyToGraph(value, { type: "delete-channel", channelId: "instrument-1" })
    ).toThrow("Track-owned channels must be deleted through delete-track")

    const withSystem = graph()
    withSystem.channels.push({
      ...structuredClone(withSystem.channels[0]!),
      id: "metronome",
      systemRole: "metronome",
      name: "Metronome",
      midiInput: undefined
    })
    expect(() =>
      applyToGraph(withSystem, { type: "delete-channel", channelId: "metronome" })
    ).toThrow("System channels cannot be deleted")
    expect(() =>
      inverseFor(withSystem, { type: "delete-channel", channelId: "metronome" })
    ).toThrow("System channels cannot be deleted")

    expect(() => applyToGraph(value, { type: "delete-channel", channelId: "output" })).toThrow(
      "An Output must be unused before it can be deleted"
    )
    expect(() => inverseFor(value, { type: "delete-channel", channelId: "instrument-1" })).toThrow(
      "Track-owned channels must be deleted through delete-track"
    )
    expect(() => inverseFor(value, { type: "delete-channel", channelId: "master" })).toThrow(
      "Master cannot be deleted"
    )

    const spareOutput = {
      ...structuredClone(value.channels.find((channel) => channel.id === "output")!),
      id: "output-2",
      name: "Output 2",
      hardwareOutputChannels: [3, 4] as [number, number],
      sortOrder: 1
    }
    const withSpare = applyToGraph(value, { type: "create-channel", channel: spareOutput })
    const deleted = applyToGraph(withSpare, { type: "delete-channel", channelId: "output-2" })
    expect(deleted.channels.some((channel) => channel.id === "output-2")).toBe(false)
    expect(
      applyToGraph(
        deleted,
        inverseFor(withSpare, { type: "delete-channel", channelId: "output-2" })
      )
    ).toEqual(withSpare)
  })

  it("rejects moving an instrument into an occupied slot and replacing a missing plugin", () => {
    const instrumentDescriptor: PluginDescriptor = {
      ...effectDescriptor,
      locator: {
        format: "vst3",
        artifactPath: "/plugins/Instrument.vst3",
        nativeId: "instrument-class"
      },
      kind: "instrument",
      name: "Synth",
      supportedAudioModes: ["stereo"]
    }
    const before = graph()
    const withInstrument = applyToGraph(before, {
      type: "create-plugin",
      plugin: plugin({
        id: "inst-1",
        role: "instrument",
        slotOrder: 0,
        locator: instrumentDescriptor.locator,
        descriptor: instrumentDescriptor,
        audioMode: "stereo"
      })
    })
    const second = applyToGraph(withInstrument, {
      type: "create-plugin",
      plugin: plugin({
        id: "inst-2",
        channelId: "master",
        role: "instrument",
        slotOrder: 0,
        locator: instrumentDescriptor.locator,
        descriptor: instrumentDescriptor,
        audioMode: "stereo"
      })
    })
    expect(() =>
      applyToGraph(second, {
        type: "move-plugin",
        pluginId: "inst-2",
        channelId: "instrument-1",
        role: "instrument",
        slotOrder: 0
      })
    ).toThrow("Replace the assigned instrument instead of moving into an occupied slot")

    expect(() =>
      applyToGraph(before, {
        type: "replace-plugin",
        pluginId: "missing",
        plugin: plugin()
      })
    ).toThrow("Plugin instance 'missing' was not found")
  })

  it("moves insert plugins across channels and reindexes source slots", () => {
    const before = graph()
    before.tracks.push({ id: "track:instrument-2", channelId: "instrument-2", sortOrder: 1 })
    before.channels.push({
      ...structuredClone(before.channels[0]!),
      id: "instrument-2",
      name: "Instrument 2",
      sortOrder: 1
    })
    const withPlugins = applyToGraph(
      applyToGraph(before, {
        type: "create-plugin",
        plugin: plugin({ id: "fx-a", slotOrder: 0 })
      }),
      {
        type: "create-plugin",
        plugin: plugin({ id: "fx-b", slotOrder: 1 })
      }
    )
    const moved = applyToGraph(withPlugins, {
      type: "move-plugin",
      pluginId: "fx-a",
      channelId: "instrument-2",
      role: "insert",
      slotOrder: 0
    })
    expect(moved.plugins.find((candidate) => candidate.id === "fx-a")).toMatchObject({
      channelId: "instrument-2",
      slotOrder: 0
    })
    expect(moved.plugins.find((candidate) => candidate.id === "fx-b")?.slotOrder).toBe(0)
    expect(
      applyToGraph(
        moved,
        inverseFor(withPlugins, {
          type: "move-plugin",
          pluginId: "fx-a",
          channelId: "instrument-2",
          role: "insert",
          slotOrder: 0
        })
      )
    ).toEqual(withPlugins)
  })

  it("covers delete-track inverse restoration of dependent graph entities", () => {
    const before = graph()
    before.tracks.push({ id: "track:audio-1", channelId: "audio-1", sortOrder: 1 })
    before.channels.push({
      ...structuredClone(before.channels[0]!),
      id: "audio-1",
      kind: "audio",
      name: "Audio",
      inputSource: "hardware",
      inputFormat: "stereo",
      inputChannels: [1, 2],
      midiInput: undefined
    })
    before.audioClips.push({
      id: "audio-clip-1",
      assetId: "asset-1",
      trackId: "track:audio-1",
      name: "Take",
      startFrame: 0,
      sourceOffsetFrames: 0,
      lengthFrames: 480,
      sourceLengthFrames: 480,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      assetSampleRate: 48_000,
      assetChannels: 2
    })
    before.sends.push({
      id: "send-1",
      sourceChannelId: "audio-1",
      targetChannelId: "output",
      targetBus: null,
      sortOrder: 0,
      enabled: true,
      tap: "post",
      levelDb: -6
    })
    before.plugins.push(plugin({ id: "fx-1", channelId: "audio-1" }))
    const deleteTrack: ProjectCommand = { type: "delete-track", trackId: "track:audio-1" }
    const deleted = applyToGraph(before, deleteTrack)
    expect(deleted.tracks.some((track) => track.id === "track:audio-1")).toBe(false)
    const restored = applyToGraph(deleted, inverseFor(before, deleteTrack))
    expect(restored.audioClips).toEqual(before.audioClips)
    expect(restored.sends).toEqual(before.sends)
    expect(restored.plugins).toEqual(before.plugins)
  })

  it("validates track, channel, send, plugin, tempo, and routing constraints", () => {
    const duplicateTrack = graph()
    duplicateTrack.tracks.push({ ...duplicateTrack.tracks[0]! })
    expect(() => validateGraph(duplicateTrack)).toThrow("Project track IDs must be unique")

    const longTrack = graph()
    longTrack.tracks[0]!.id = "t".repeat(65)
    expect(() => validateGraph(longTrack)).toThrow("at most 64 UTF-8 bytes")

    const badOrder = graph()
    badOrder.tracks[0]!.sortOrder = -1
    expect(() => validateGraph(badOrder)).toThrow("non-negative safe integer")

    const badGain = graph()
    badGain.channels[0]!.gainDb = 100
    expect(() => validateGraph(badGain)).toThrow("Channel gain")

    const audio = graph()
    audio.tracks.push({ id: "track:audio", channelId: "audio", sortOrder: 1 })
    audio.channels.push({
      ...structuredClone(audio.channels[0]!),
      id: "audio",
      kind: "audio",
      name: "Audio",
      inputSource: "hardware",
      inputFormat: "stereo",
      inputChannels: [1],
      midiInput: undefined
    })
    expect(() => validateGraph(audio)).toThrow("input mappings must match their input format")

    const soloMaster = graph()
    soloMaster.channels.find((channel) => channel.kind === "master")!.soloed = true
    expect(() => validateGraph(soloMaster)).toThrow("Master cannot be soloed")

    const noOutput = graph()
    noOutput.channels = noOutput.channels.filter((channel) => channel.kind !== "output")
    noOutput.channels[0]!.outputChannelId = null
    noOutput.channels[0]!.outputBus = 1
    expect(() => validateGraph(noOutput)).toThrow("at least one hardware Output")

    const duplicateOutputMap = graph()
    duplicateOutputMap.channels.push({
      ...structuredClone(duplicateOutputMap.channels.find((channel) => channel.id === "output")!),
      id: "output-2",
      hardwareOutputChannels: [1, 2],
      sortOrder: 1
    })
    expect(() => validateGraph(duplicateOutputMap)).toThrow(
      "Hardware Output channel pairs must be unique"
    )

    const badSend = graph()
    badSend.sends.push({
      id: "send-1",
      sourceChannelId: "master",
      targetBus: 1,
      targetChannelId: null,
      sortOrder: 0,
      enabled: true,
      tap: "post",
      levelDb: 0
    })
    expect(() => validateGraph(badSend)).toThrow(
      "Only Audio, Instrument, and Aux channels can source sends"
    )

    const badPlugin = graph()
    badPlugin.plugins.push(
      plugin({
        role: "instrument",
        descriptor: { ...effectDescriptor, kind: "effect" },
        locator: effectDescriptor.locator
      })
    )
    expect(() => validateGraph(badPlugin)).toThrow(
      "An instrument slot requires an instrument plugin on an Instrument channel"
    )

    const badTempo = graph()
    ;(badTempo.tempoMap as { ticksPerQuarter: number }).ticksPerQuarter = 480
    expect(() => validateGraph(badTempo)).toThrow("960 PPQ")

    const badKey = graph()
    badKey.keySignatureEvents = [{ tick: 10, fifths: 0, mode: "major" }]
    expect(() => validateGraph(badKey)).toThrow("Key-signature maps require an event at tick 0")

    const midiOnAudio = graph()
    midiOnAudio.tracks.push({ id: "track:audio", channelId: "audio", sortOrder: 1 })
    midiOnAudio.channels.push({
      ...structuredClone(midiOnAudio.channels[0]!),
      id: "audio",
      kind: "audio",
      name: "Audio",
      inputSource: "hardware",
      inputFormat: "stereo",
      inputChannels: [1, 2],
      midiInput: undefined
    })
    midiOnAudio.midiClips[0]!.trackId = "track:audio"
    expect(() => validateGraph(midiOnAudio)).toThrow("MIDI clips must belong to Instrument tracks")

    const feedback = graph()
    feedback.channels.push({
      ...structuredClone(feedback.channels[0]!),
      id: "aux-1",
      kind: "aux",
      name: "Aux",
      inputSource: "bus",
      inputFormat: "mono",
      inputChannels: [1],
      outputBus: 1,
      outputChannelId: null,
      midiInput: undefined
    })
    // Aux feeds BUS 1 and also consumes BUS 1.
    expect(() => validateGraph(feedback)).toThrow("feedback loop")
  })

  it("validates instrument MIDI routes and audio clip ownership", () => {
    const badMidi = graph()
    badMidi.channels[0]!.midiInput = { portId: "port", portName: null, channel: 0 }
    expect(() => validateGraph(badMidi)).toThrow(
      "Instrument MIDI routes require a valid port and channel"
    )

    const armedMaster = graph()
    armedMaster.channels.find((channel) => channel.kind === "master")!.recordArmed = true
    expect(() => validateGraph(armedMaster)).toThrow(
      "Only Audio and ordinary Instrument channels can arm recording"
    )

    const value = graph()
    value.tracks.push({ id: "track:audio", channelId: "audio", sortOrder: 1 })
    value.channels.push({
      ...structuredClone(value.channels[0]!),
      id: "audio",
      kind: "audio",
      name: "Audio",
      inputSource: "hardware",
      inputFormat: "stereo",
      inputChannels: [1, 2],
      midiInput: undefined
    })
    value.audioClips.push({
      id: "clip",
      assetId: "asset",
      trackId: "track:instrument-1",
      name: "Misplaced",
      startFrame: 0,
      sourceOffsetFrames: 0,
      lengthFrames: 100,
      sourceLengthFrames: 100,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      assetSampleRate: 48_000,
      assetChannels: 2
    })
    expect(() => validateGraph(value)).toThrow("Timeline clips must belong to audio tracks")

    const badClipFrames = graph()
    badClipFrames.tracks.push({ id: "track:audio", channelId: "audio", sortOrder: 1 })
    badClipFrames.channels.push({
      ...structuredClone(badClipFrames.channels[0]!),
      id: "audio",
      kind: "audio",
      name: "Audio",
      inputSource: "hardware",
      inputFormat: "stereo",
      inputChannels: [1, 2],
      midiInput: undefined
    })
    badClipFrames.audioClips.push({
      id: "clip",
      assetId: "asset",
      trackId: "track:audio",
      name: "Bad",
      startFrame: -1,
      sourceOffsetFrames: 0,
      lengthFrames: 100,
      sourceLengthFrames: 100,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      assetSampleRate: 48_000,
      assetChannels: 2
    })
    expect(() => validateGraph(badClipFrames)).toThrow(
      "Clip start frame must be a non-negative safe integer"
    )
  })

  it("enforces unique lowercase plug-in control aliases", () => {
    const value = graph()
    value.plugins = [
      plugin({ id: "plugin-1", slotOrder: 0, controlAlias: "lead.fx" }),
      plugin({ id: "plugin-2", slotOrder: 1, controlAlias: "lead.fx" })
    ]
    expect(() => validateGraph(value)).toThrow("control aliases must be unique")
    value.plugins[1]!.controlAlias = "Lead FX"
    expect(() => validateGraph(value)).toThrow("lowercase slugs")
  })

  it("classifies realtime parameter patches and deleted channel ids", () => {
    expect(
      onlyRealtimeParameters({
        type: "update-channel",
        channelId: "instrument-1",
        patch: { gainDb: -3, pan: 0.1 }
      })
    ).toBe(true)
    expect(
      onlyRealtimeParameters({
        type: "update-channel",
        channelId: "instrument-1",
        patch: { name: "Lead" }
      })
    ).toBe(false)
    expect(
      onlyRealtimeParameters({
        type: "batch",
        commands: [
          { type: "replace-key-signature-map", events: [{ tick: 0, fifths: 0, mode: "major" }] },
          { type: "update-send", sendId: "send", patch: { levelDb: -6 } },
          { type: "update-project-notes", notes: "Project note" },
          { type: "update-track", trackId: "track:instrument-1", patch: { notes: "Track note" } }
        ]
      })
    ).toBe(true)
    expect(
      onlyRealtimeParameters({
        type: "update-track",
        trackId: "track:instrument-1",
        patch: { sortOrder: 2 }
      })
    ).toBe(false)
    expect(
      onlyRealtimeParameters({
        type: "create-send",
        send: {
          id: "send",
          sourceChannelId: "instrument-1",
          targetBus: 1,
          sortOrder: 0,
          enabled: true,
          tap: "post",
          levelDb: 0
        }
      })
    ).toBe(false)

    const value = graph()
    expect([
      ...deletedChannelIds(value, { type: "delete-track", trackId: "track:instrument-1" })
    ]).toEqual(["instrument-1"])
    expect([...deletedChannelIds(value, { type: "delete-channel", channelId: "output" })]).toEqual([
      "output"
    ])
    expect(
      [
        ...deletedChannelIds(value, {
          type: "batch",
          commands: [
            { type: "delete-track", trackId: "track:instrument-1" },
            { type: "update-channel", channelId: "master", patch: { gainDb: -1 } }
          ]
        })
      ].sort()
    ).toEqual(["instrument-1"])
    expect([
      ...deletedChannelIds(value, { type: "update-channel", channelId: "master", patch: {} })
    ]).toEqual([])
  })
})
