import { describe, expect, it } from "vitest"
import type { PluginDescriptor, PluginInstanceState, ProjectGraphSnapshot } from "@heron/contracts"
import { AudioGraphCompiler } from "./audio-graph-compiler"

const descriptor: PluginDescriptor = {
  source: { kind: "external" },
  locator: { format: "vst3", artifactPath: "/plugins/Effect.vst3", nativeId: "effect-class" },
  name: "Effect",
  vendor: "Heron Studio",
  version: "1.0",
  categories: ["Fx"],
  kind: "effect",
  architecture: "x86_64",
  buses: [],
  supportedAudioModes: ["stereo"],
  hasEditor: true,
  compatibility: "compatible",
  compatibilityReason: null
}

const plugin: PluginInstanceState = {
  id: "plugin-1",
  channelId: "audio-1",
  role: "insert",
  slotOrder: 0,
  locator: descriptor.locator,
  descriptor,
  audioMode: "stereo",
  enabled: true,
  sidechainInputs: [],
  state: {
    version: 1,
    chunks: [
      { key: "component", bytes: new Uint8Array([1]) },
      { key: "controller", bytes: new Uint8Array([2]) }
    ]
  }
}

function snapshot(overrides: Partial<ProjectGraphSnapshot> = {}): ProjectGraphSnapshot {
  return {
    sampleRate: 48_000,
    tracks: [
      { id: "track:audio-1", channelId: "audio-1", sortOrder: 0 },
      { id: "track:instrument-1", channelId: "instrument-1", sortOrder: 1 }
    ],
    channels: [
      {
        id: "audio-1",
        kind: "audio",
        systemRole: null,
        name: "Audio 1",
        color: "#8C83FF",
        sortOrder: 0,
        inputSource: "hardware",
        inputFormat: "stereo",
        gainDb: -3,
        pan: 0.25,
        muted: false,
        soloed: true,
        outputChannelId: "output",
        outputBus: null,
        recordArmed: true,
        inputMonitoring: true,
        inputChannels: [1, 2],
        hardwareOutputChannels: []
      },
      {
        id: "instrument-1",
        kind: "instrument",
        systemRole: null,
        name: "Instrument 1",
        color: "#73D6A2",
        sortOrder: 1,
        inputSource: null,
        inputFormat: null,
        midiInput: { portId: "midi-1", portName: "Keyboard", channel: 3 },
        gainDb: 0,
        pan: 0,
        muted: false,
        soloed: false,
        outputChannelId: "output",
        outputBus: null,
        recordArmed: false,
        inputMonitoring: true,
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
    audioClips: [
      {
        id: "audio-clip-1",
        assetId: "asset-1",
        trackId: "track:audio-1",
        name: "Take",
        startFrame: 480,
        sourceOffsetFrames: 10,
        lengthFrames: 960,
        sourceLengthFrames: 970,
        fadeInFrames: 48,
        fadeOutFrames: 96,
        assetSampleRate: 48_000,
        assetChannels: 2
      }
    ],
    sends: [
      {
        id: "send-1",
        sourceChannelId: "audio-1",
        targetChannelId: null,
        targetBus: 1,
        sortOrder: 0,
        enabled: true,
        tap: "post-pan",
        levelDb: -12
      }
    ],
    plugins: [plugin],
    midiClips: [
      {
        id: "midi-clip-1",
        sourceId: "source-1",
        trackId: "track:instrument-1",
        name: "Phrase",
        startTick: 0,
        lengthTicks: 960,
        sourceOffsetTicks: 0,
        sourceLengthTicks: Number.MAX_SAFE_INTEGER,
        notes: [
          {
            id: "note-1",
            startTick: 0,
            durationTicks: 240,
            channel: 0,
            key: 60,
            velocity: 100,
            releaseVelocity: 0
          }
        ],
        events: [
          {
            id: "event-1",
            tick: 0,
            channel: 0,
            kind: "control-change",
            data: new Uint8Array([0xb0, 7, 100])
          }
        ]
      }
    ],
    tempoMap: {
      ticksPerQuarter: 960,
      tempoEvents: [
        { tick: 0, beatsPerMinute: 120 },
        { tick: 1920, beatsPerMinute: 140 }
      ],
      timeSignatureEvents: [
        { tick: 0, numerator: 4, denominator: 4 },
        { tick: 3840, numerator: 3, denominator: 4 }
      ]
    },
    keySignatureEvents: [{ tick: 0, fifths: 0, mode: "major" }],
    ...overrides
  }
}

describe("AudioGraphCompiler", () => {
  it("compiles a trackless Live Mixer with explicit monitoring and runtime-only clock defaults", () => {
    const studio = snapshot()
    const live = {
      sampleRate: studio.sampleRate,
      channels: studio.channels.map(
        ({ systemRole: _systemRole, recordArmed: _recordArmed, ...channel }) => channel
      ),
      sends: studio.sends,
      plugins: studio.plugins
    }
    const runtime = new AudioGraphCompiler().compile(live, new Map(), {
      softwareMonitoringEnabled: true,
      latencyPolicy: { type: "normal" }
    })
    expect(runtime.channels.find((channel) => channel.id === "audio-1")).toMatchObject({
      input_monitoring: true,
      record_armed: false
    })
    expect(runtime.clips).toEqual([])
    expect(runtime.midi_clips).toEqual([])
    expect(runtime.tempo_events).toEqual([{ tick: 0, beats_per_minute: 120 }])
    expect(runtime.time_signature_events).toEqual([{ tick: 0, numerator: 4, denominator: 4 }])
  })

  const compiler = new AudioGraphCompiler()
  const assetPaths = new Map([["asset-1", "/assets/take.wav"]])

  it("compiles channels, sends, clips, plugins, midi, and tempo maps", () => {
    const compiled = compiler.compile(snapshot(), assetPaths, true)

    expect(compiled.sample_rate).toBe(48_000)
    expect(compiled.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "audio-1",
          kind: "audio",
          gain_db: -3,
          pan: 0.25,
          soloed: true,
          record_armed: true,
          input_monitoring: true,
          input_source: "hardware",
          input_channels: [1, 2],
          output_channel_id: "output"
        }),
        expect.objectContaining({
          id: "instrument-1",
          kind: "instrument",
          input_monitoring: true,
          midi_input_port_id: "midi-1",
          midi_input_port_name: "Keyboard",
          midi_input_channel: 3
        })
      ])
    )
    expect(compiled.sends).toEqual([
      expect.objectContaining({
        id: "send-1",
        source_channel_id: "audio-1",
        target_bus: 1,
        enabled: true,
        tap: "post-pan",
        level_db: -12
      })
    ])
    expect(compiled.clips).toEqual([
      {
        id: "audio-clip-1",
        channel_id: "audio-1",
        start_frame: 480,
        source_offset_frames: 10,
        length_frames: 960,
        fade_in_frames: 48,
        fade_out_frames: 96,
        path: "/assets/take.wav"
      }
    ])
    expect(compiled.plugins).toEqual([
      expect.objectContaining({
        instance_id: "plugin-1",
        channel_id: "audio-1",
        role: "insert",
        slot_order: 0,
        audio_mode: "stereo",
        enabled: true,
        latency_samples: 0,
        tail_samples: 0
      })
    ])
    expect(compiled.midi_clips).toEqual([
      expect.objectContaining({
        id: "midi-clip-1",
        channel_id: "instrument-1",
        start_tick: 0,
        length_ticks: 960,
        notes: {
          storage: "inline",
          notes: [
            expect.objectContaining({
              start_tick: 0,
              duration_ticks: 240,
              key: 60,
              velocity: 100
            })
          ]
        },
        events: {
          storage: "inline",
          events: [
            expect.objectContaining({
              tick: 0,
              kind: "control-change",
              data: { storage: "inline", bytes: new Uint8Array([0xb0, 7, 100]) }
            })
          ]
        }
      })
    ])
    expect(compiled.tempo_events).toEqual([
      { tick: 0, beats_per_minute: 120 },
      { tick: 1920, beats_per_minute: 140 }
    ])
    expect(compiled.time_signature_events).toEqual([
      { tick: 0, numerator: 4, denominator: 4 },
      { tick: 3840, numerator: 3, denominator: 4 }
    ])
  })

  // The compiled graph is decoded by Rust through `serde`, which rejects an
  // unknown or renamed key only when a project is opened. Rust also marks
  // optional fields `#[serde(default)]`, so the producer may omit those; every
  // other key is required. The key lists mirror
  // `populated_graph_fixture_pins_the_cross_language_wire_keys` in
  // `crates/dsp-runtime/src/protocol/tests.rs`; the two must move together.
  it("emits only wire keys the Rust decoder accepts and every required one", () => {
    const graph = snapshot()
    graph.channels.find((channel) => channel.id === "audio-1")!.applicationCapture = {
      platform: "macos",
      bundleIdentifier: "com.example.player",
      executablePath: "/Applications/Player.app/Contents/MacOS/Player",
      executableName: "Player",
      includeProcessTree: true
    }
    const compiled = compiler.compile(graph, assetPaths, true)
    const audioChannel = compiled.channels.find((channel) => channel.id === "audio-1")!
    const keysOf = (value: object): string[] => Object.keys(value).sort()

    const channels = [
      "application_capture",
      "color",
      "gain_db",
      "hardware_output_channels",
      "id",
      "input_channels",
      "input_monitoring",
      "input_source",
      "kind",
      "midi_input_channel",
      "midi_input_port_id",
      "midi_input_port_name",
      "muted",
      "name",
      "output_bus",
      "output_channel_id",
      "pan",
      "record_armed",
      "soloed",
      "system_role"
    ]
    const capture = [
      "bundle_identifier",
      "executable_name",
      "executable_path",
      "include_process_tree",
      "platform"
    ]
    const sends = [
      "enabled",
      "id",
      "level_db",
      "source_channel_id",
      "tap",
      "target_bus",
      "target_channel_id"
    ]
    const clips = [
      "channel_id",
      "fade_in_frames",
      "fade_out_frames",
      "id",
      "length_frames",
      "path",
      "source_offset_frames",
      "start_frame"
    ]
    const plugins = [
      "audio_mode",
      "aux_input_buses",
      "channel_id",
      "duplicate_mono_output",
      "enabled",
      "instance_generation",
      "instance_id",
      "latency_samples",
      "role",
      "slot_order",
      "tail_samples"
    ]
    const midiClips = [
      "channel_id",
      "events",
      "id",
      "length_ticks",
      "notes",
      "source_offset_ticks",
      "start_tick"
    ]
    const notes = ["channel", "duration_ticks", "key", "release_velocity", "start_tick", "velocity"]

    // Each entry is [label, object, allowed keys, keys Rust cannot default].
    const shapes: Array<[string, object, string[], string[]]> = [
      ["graph", compiled, Object.keys(compiled), Object.keys(compiled)],
      // Rust marks these `#[serde(default)]`, so the producer may omit them.
      [
        "channel",
        compiled.channels[0]!,
        channels,
        [
          "gain_db",
          "hardware_output_channels",
          "id",
          "input_channels",
          "input_source",
          "kind",
          "muted",
          "output_bus",
          "output_channel_id",
          "pan",
          "record_armed",
          "soloed",
          "system_role"
        ]
      ],
      ["application capture", audioChannel.application_capture!, capture, capture],
      ["send", compiled.sends[0]!, sends, sends],
      ["clip", compiled.clips[0]!, clips, clips],
      [
        "plugin",
        compiled.plugins[0]!,
        plugins,
        [
          "channel_id",
          "enabled",
          "instance_id",
          "latency_samples",
          "role",
          "slot_order",
          "tail_samples"
        ]
      ],
      ["midi clip", compiled.midi_clips[0]!, midiClips, midiClips],
      ["note batch", compiled.midi_clips[0]!.notes, ["notes", "reference", "storage"], ["storage"]],
      ["note", compiled.midi_clips[0]!.notes.notes[0]!, notes, notes],
      [
        "event batch",
        compiled.midi_clips[0]!.events,
        ["events", "reference", "storage"],
        ["storage"]
      ],
      [
        "midi event",
        compiled.midi_clips[0]!.events.events[0]!,
        ["channel", "data", "kind", "tick"],
        ["channel", "data", "kind", "tick"]
      ],
      [
        "binary payload",
        compiled.midi_clips[0]!.events.events[0]!.data,
        ["bytes", "index", "length", "offset", "reference", "storage"],
        ["storage"]
      ],
      [
        "latency policy",
        compiled.latency_policy!,
        ["plugin_budget_samples", "target_output_channel_id", "type"],
        ["type"]
      ],
      [
        "tempo event",
        compiled.tempo_events[0]!,
        ["beats_per_minute", "tick"],
        ["beats_per_minute", "tick"]
      ],
      [
        "time signature event",
        compiled.time_signature_events[0]!,
        ["denominator", "numerator", "tick"],
        ["denominator", "numerator", "tick"]
      ]
    ]

    for (const [label, value, allowed, required] of shapes) {
      const actual = keysOf(value)
      expect(
        actual.filter((key) => !allowed.includes(key)),
        `${label} has unknown keys`
      ).toEqual([])
      expect(
        required.filter((key) => !actual.includes(key)),
        `${label} is missing keys`
      ).toEqual([])
    }
  })

  it("marks host-provided mono-to-stereo output duplication for native mono effects", () => {
    const monoDescriptor: PluginDescriptor = { ...descriptor, supportedAudioModes: ["mono"] }
    const monoToStereo: PluginInstanceState = {
      ...plugin,
      descriptor: monoDescriptor,
      audioMode: "mono-to-stereo"
    }

    const compiled = compiler.compile(snapshot({ plugins: [monoToStereo] }), assetPaths, true)

    expect(compiled.plugins[0]).toMatchObject({
      audio_mode: "mono-to-stereo",
      duplicate_mono_output: true
    })
  })

  it("gates audio monitoring on softwareMonitoringEnabled while instruments keep theirs", () => {
    const graph = snapshot()
    const monitored = compiler.compile(graph, assetPaths, true)
    const unmonitored = compiler.compile(graph, assetPaths, false)

    expect(monitored.channels.find((channel) => channel.id === "audio-1")?.input_monitoring).toBe(
      true
    )
    expect(unmonitored.channels.find((channel) => channel.id === "audio-1")?.input_monitoring).toBe(
      false
    )
    expect(
      unmonitored.channels.find((channel) => channel.id === "instrument-1")?.input_monitoring
    ).toBe(true)
  })

  it("disables audio monitoring when the channel is not hardware-monitored", () => {
    const graph = snapshot()
    const audio = graph.channels.find((channel) => channel.id === "audio-1")!
    audio.inputMonitoring = false
    expect(
      compiler.compile(graph, assetPaths, true).channels.find((channel) => channel.id === "audio-1")
        ?.input_monitoring
    ).toBe(false)

    audio.inputMonitoring = true
    audio.inputSource = "bus"
    expect(
      compiler.compile(graph, assetPaths, true).channels.find((channel) => channel.id === "audio-1")
        ?.input_monitoring
    ).toBe(false)
  })

  it("preserves a macOS application capture bundle identifier in the native graph", () => {
    const graph = snapshot()
    const audio = graph.channels.find((channel) => channel.id === "audio-1")!
    audio.inputSource = "application"
    audio.applicationCapture = {
      platform: "macos",
      bundleIdentifier: "com.example.player",
      executablePath: "/Applications/Player.app/Contents/MacOS/Player",
      executableName: "Player",
      includeProcessTree: true
    }

    expect(
      compiler.compile(graph, assetPaths, true).channels.find((channel) => channel.id === "audio-1")
        ?.application_capture
    ).toEqual({
      platform: "macos",
      bundle_identifier: "com.example.player",
      executable_path: "/Applications/Player.app/Contents/MacOS/Player",
      executable_name: "Player",
      include_process_tree: true
    })
  })

  it("throws when a clip references a missing track", () => {
    const graph = snapshot()
    graph.audioClips[0]!.trackId = "track:missing"

    expect(() => compiler.compile(graph, assetPaths, false)).toThrow(
      "Project track 'track:missing' was not found"
    )
  })
})
