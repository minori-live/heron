import { describe, expect, it } from "vitest"
import type {
  LiveRuntimeSnapshot,
  LivePerformanceCommand,
  MixerGraphSnapshot,
  PluginInstanceState
} from "@heron/contracts"
import {
  applyLiveCapture,
  applyLiveEdit,
  applyLivePerformanceCommand,
  diffLiveCapture
} from "./live"

function graph(): MixerGraphSnapshot {
  return {
    sampleRate: 48_000,
    channels: [
      {
        id: "audio",
        kind: "audio",
        name: "Audio",
        color: "#4F8CFF",
        sortOrder: 0,
        inputSource: "hardware",
        inputFormat: "stereo",
        gainDb: 0,
        pan: 0,
        muted: false,
        soloed: false,
        outputChannelId: "output",
        outputBus: null,
        inputMonitoring: false,
        inputChannels: [1, 2],
        hardwareOutputChannels: []
      },
      {
        id: "master",
        kind: "master",
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
        inputMonitoring: false,
        inputChannels: [],
        hardwareOutputChannels: []
      },
      {
        id: "output",
        kind: "output",
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
        inputMonitoring: false,
        inputChannels: [],
        hardwareOutputChannels: [1, 2]
      }
    ],
    sends: [],
    plugins: []
  }
}

function effect(): PluginInstanceState {
  const locator = {
    format: "vst3" as const,
    artifactPath: "/plugins/Effect.vst3",
    nativeId: "effect"
  }
  return {
    id: "effect",
    channelId: "audio",
    role: "insert",
    slotOrder: 0,
    locator,
    descriptor: {
      source: { kind: "external" },
      locator,
      name: "Effect",
      vendor: "Heron",
      version: "1",
      categories: ["Fx"],
      kind: "effect",
      architecture: "x86_64",
      buses: [],
      supportedAudioModes: ["stereo"],
      hasEditor: false,
      compatibility: "compatible",
      compatibilityReason: null
    },
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
}

describe("Live root editing and capture", () => {
  it("deletes a root channel and its dependent graph objects in one edit", () => {
    const owned = effect()
    const downstream = effect()
    downstream.id = "downstream"
    downstream.channelId = "output"
    downstream.descriptor.buses = [
      {
        portKey: "sidechain",
        direction: "input",
        kind: "aux",
        name: "Sidechain",
        channels: 2,
        defaultActive: true
      }
    ]
    downstream.sidechainInputs = [{ inputPortKey: "sidechain", sourceChannelId: "audio" }]
    const initial = {
      graph: {
        ...graph(),
        plugins: [owned, downstream],
        sends: [
          {
            id: "send",
            sourceChannelId: "audio",
            targetChannelId: null,
            targetBus: 1,
            sortOrder: 0,
            enabled: true,
            tap: "post-pan" as const,
            levelDb: -90
          }
        ]
      },
      bindings: []
    }
    const result = applyLiveEdit(initial, { type: "delete-channel", channelId: "audio" })
    expect(result.graph.channels.map((channel) => channel.id)).toEqual(["master", "output"])
    expect(result.graph.sends).toEqual([])
    expect(result.graph.plugins).toHaveLength(1)
    expect(result.graph.plugins[0]?.sidechainInputs).toEqual([])
    expect(initial.graph.plugins).toHaveLength(2)
    expect(initial.graph.plugins[1]?.sidechainInputs).toHaveLength(1)
    expect(() => applyLiveEdit(initial, { type: "delete-channel", channelId: "master" })).toThrow(
      "Master cannot be deleted"
    )
    expect(() => applyLiveEdit(initial, { type: "delete-channel", channelId: "output" })).toThrow(
      "Output must be unused"
    )
  })

  it("inserts, moves and deletes effects while keeping unique contiguous slots", () => {
    const initial = {
      graph: { ...graph(), plugins: [effect(), { ...effect(), id: "second", slotOrder: 1 }] },
      bindings: []
    }
    const inserted = applyLiveEdit(initial, {
      type: "insert-plugin",
      plugin: { ...effect(), id: "new", slotOrder: 1 }
    })
    const slots = (value: { graph: MixerGraphSnapshot }, channelId = "audio") =>
      value.graph.plugins
        .filter((plugin) => plugin.channelId === channelId)
        .sort((a, b) => a.slotOrder - b.slotOrder)
        .map((plugin) => [plugin.id, plugin.slotOrder])
    expect(slots(inserted)).toEqual([
      ["effect", 0],
      ["new", 1],
      ["second", 2]
    ])
    const reordered = applyLiveEdit(inserted, {
      type: "move-plugin",
      pluginId: "second",
      channelId: "audio",
      slotOrder: 0
    })
    expect(slots(reordered)).toEqual([
      ["second", 0],
      ["effect", 1],
      ["new", 2]
    ])
    const moved = applyLiveEdit(reordered, {
      type: "move-plugin",
      pluginId: "effect",
      channelId: "output",
      slotOrder: 0
    })
    expect(slots(moved)).toEqual([
      ["second", 0],
      ["new", 1]
    ])
    expect(slots(moved, "output")).toEqual([["effect", 0]])
    const deleted = applyLiveEdit(moved, { type: "delete-plugin", pluginId: "second" })
    expect(slots(deleted)).toEqual([["new", 0]])
    expect(() =>
      applyLiveEdit(inserted, {
        type: "move-plugin",
        pluginId: "effect",
        channelId: "missing",
        slotOrder: 0
      })
    ).toThrow()
    expect(slots(initial)).toEqual([
      ["effect", 0],
      ["second", 1]
    ])
  })

  it("replaces a plugin state atomically while preserving its stable slot identity", () => {
    const initial = { graph: { ...graph(), plugins: [effect()] }, bindings: [] }
    const replacement = { ...effect(), state: { version: 1 as const, chunks: [] } }
    const replaced = applyLiveEdit(initial, {
      type: "replace-plugin",
      pluginId: "effect",
      plugin: replacement
    })
    expect(replaced.graph.plugins[0]?.state.chunks).toEqual([])
    expect(initial.graph.plugins[0]?.state.chunks).toHaveLength(2)
    expect(() =>
      applyLiveEdit(initial, {
        type: "replace-plugin",
        pluginId: "effect",
        plugin: { ...replacement, channelId: "output" }
      })
    ).toThrow("stable identity")
  })

  it("edits without tracks and rejects a broken route before persistence", () => {
    const initial = { graph: graph(), bindings: [] }
    const updated = applyLiveEdit(initial, {
      type: "update-channel",
      channelId: "audio",
      patch: { gainDb: -6 }
    })
    expect(updated.graph.channels[0]?.gainDb).toBe(-6)
    expect(initial.graph.channels[0]?.gainDb).toBe(0)
    expect(() =>
      applyLiveEdit(updated, {
        type: "update-channel",
        channelId: "audio",
        patch: { outputChannelId: "missing" }
      })
    ).toThrow()
  })

  it("captures frozen selected fields and leaves newer adjustments temporary", () => {
    const baseline: LiveRuntimeSnapshot = {
      graph: { ...graph(), plugins: [effect()] },
      parameterValues: [{ pluginId: "effect", parameterKey: "cutoff", value: 0.2 }]
    }
    const frozen = structuredClone(baseline)
    frozen.graph.channels[0]!.gainDb = -8
    frozen.graph.channels[0]!.muted = true
    frozen.graph.plugins[0]!.state.chunks[0]!.bytes[0] = 9
    frozen.parameterValues[0]!.value = 0.6
    const fields = diffLiveCapture(baseline, frozen)
    expect(fields).toEqual([
      { type: "channel", id: "audio", parameter: "gainDb" },
      { type: "channel", id: "audio", parameter: "muted" },
      { type: "plugin-state", id: "effect" },
      { type: "plugin-parameter", id: "effect", parameterKey: "cutoff" }
    ])

    const newer = structuredClone(frozen)
    newer.graph.channels[0]!.gainDb = -12
    newer.parameterValues[0]!.value = 0.9
    const captured = applyLiveCapture(baseline, frozen, fields, [fields[0]!, fields[2]!])
    expect(captured.graph.channels[0]?.gainDb).toBe(-8)
    expect(captured.graph.channels[0]?.muted).toBe(false)
    expect(captured.graph.plugins[0]?.state.chunks.map((chunk) => [...chunk.bytes])).toEqual([
      [9],
      [2]
    ])
    expect(captured.parameterValues[0]?.value).toBe(0.2)
    expect(diffLiveCapture(captured, newer)).toEqual([
      { type: "channel", id: "audio", parameter: "gainDb" },
      { type: "channel", id: "audio", parameter: "muted" },
      { type: "plugin-parameter", id: "effect", parameterKey: "cutoff" }
    ])
  })
})

describe("Live performance changes and selective capture", () => {
  function baseline(): LiveRuntimeSnapshot {
    const value = graph()
    value.plugins = [effect()]
    value.sends = [
      {
        id: "send",
        sourceChannelId: "audio",
        targetChannelId: null,
        targetBus: 1,
        sortOrder: 0,
        enabled: false,
        tap: "post-pan",
        levelDb: -90
      }
    ]
    return {
      graph: value,
      parameterValues: [{ pluginId: "effect", parameterKey: "mix", value: 0.2 }]
    }
  }

  it("keeps performance changes temporary and captures every field category independently", () => {
    const base = baseline()
    let live = applyLivePerformanceCommand(base, {
      type: "channel",
      id: "audio",
      parameter: "pan",
      value: 0.5
    })
    live = applyLivePerformanceCommand(live, {
      type: "channel",
      id: "audio",
      parameter: "muted",
      value: true
    })
    live = applyLivePerformanceCommand(live, {
      type: "send",
      id: "send",
      parameter: "levelDb",
      value: -6
    })
    live = applyLivePerformanceCommand(live, {
      type: "send",
      id: "send",
      parameter: "enabled",
      value: true
    })
    live = applyLivePerformanceCommand(live, {
      type: "plugin",
      id: "effect",
      parameter: "enabled",
      value: false
    })
    live = applyLivePerformanceCommand(live, {
      type: "plugin-parameter",
      id: "effect",
      parameterKey: "mix",
      value: 0.8
    })
    live = applyLivePerformanceCommand(live, {
      type: "plugin-parameter",
      id: "effect",
      parameterKey: "gain",
      value: 0.4
    })
    const fields = diffLiveCapture(base, live)
    expect(fields).toHaveLength(7)
    expect(base).toEqual(baseline())
    const sendAndPlugin = fields.filter(
      (field) =>
        field.type === "send" || field.type === "plugin" || field.type === "plugin-parameter"
    )
    const captured = applyLiveCapture(base, live, fields, sendAndPlugin)
    expect(captured.graph.channels[0]?.pan).toBe(0)
    expect(captured.graph.sends).toEqual(live.graph.sends)
    expect(captured.graph.plugins[0]?.enabled).toBe(false)
    expect(captured.parameterValues).toEqual(live.parameterValues)
    expect(diffLiveCapture(captured, live)).toEqual(
      fields.filter((field) => field.type === "channel")
    )
    expect(applyLiveCapture(base, live, fields, fields)).toEqual(live)
  })

  it.each([
    { type: "channel", id: "audio", parameter: "pan", value: true },
    { type: "channel", id: "audio", parameter: "muted", value: 1 },
    { type: "send", id: "send", parameter: "levelDb", value: false },
    { type: "send", id: "send", parameter: "enabled", value: 1 },
    { type: "plugin", id: "effect", parameter: "enabled", value: 1 },
    { type: "plugin-parameter", id: "effect", parameterKey: "", value: 1 },
    { type: "plugin-parameter", id: "missing", parameterKey: "mix", value: 1 }
  ])("rejects invalid performance values or targets: $type $parameter", (command) => {
    const base = baseline()
    expect(() => applyLivePerformanceCommand(base, command as LivePerformanceCommand)).toThrow()
    expect(base).toEqual(baseline())
  })

  it.each(["channels", "sends", "plugins"] as const)(
    "refuses capture after %s structure changes",
    (field) => {
      const base = baseline()
      const changed = structuredClone(base)
      changed.graph[field][0]!.id = "new"
      expect(() => diffLiveCapture(base, changed)).toThrow("structure changed")
      changed.graph[field] = []
      expect(() => diffLiveCapture(base, changed)).toThrow("structure changed")
    }
  )

  it("rejects duplicate, missing and nonfinite parameter values without corrupting a baseline", () => {
    const base = baseline()
    for (const parameterValues of [
      [],
      [{ pluginId: "missing", parameterKey: "mix", value: 1 }],
      [base.parameterValues[0]!, base.parameterValues[0]!],
      [{ pluginId: "effect", parameterKey: "mix", value: NaN }]
    ]) {
      expect(() => diffLiveCapture(base, { ...structuredClone(base), parameterValues })).toThrow()
    }
    const field = { type: "plugin-parameter" as const, id: "effect", parameterKey: "absent" }
    expect(() => applyLiveCapture(base, base, [field], [field])).toThrow("missing")
  })

  it("creates and removes Sends and updates plugins through normal Edit commands", () => {
    let edit = { graph: graph(), bindings: [] }
    edit = applyLiveEdit(edit, {
      type: "create-channel",
      channel: { ...edit.graph.channels[0]!, id: "audio-2" }
    }) as typeof edit
    edit = applyLiveEdit(edit, {
      type: "create-send",
      send: baseline().graph.sends[0]!
    }) as typeof edit
    edit = applyLiveEdit(edit, {
      type: "update-send",
      sendId: "send",
      patch: { levelDb: -12, enabled: true }
    }) as typeof edit
    expect(edit.graph.sends[0]).toMatchObject({ enabled: true, levelDb: -12 })
    edit = applyLiveEdit(edit, { type: "delete-send", sendId: "send" }) as typeof edit
    expect(edit.graph.sends).toEqual([])
    edit = applyLiveEdit(edit, { type: "create-plugin", plugin: effect() }) as typeof edit
    edit = applyLiveEdit(edit, {
      type: "update-plugin",
      pluginId: "effect",
      patch: { enabled: false }
    }) as typeof edit
    expect(edit.graph.plugins[0]?.enabled).toBe(false)
    edit = applyLiveEdit(edit, { type: "set-midi-bindings", bindings: [] }) as typeof edit
    expect(edit.bindings).toEqual([])
    expect(() =>
      applyLiveEdit(edit, {
        type: "insert-plugin",
        plugin: { ...effect(), id: "bad", slotOrder: -1 }
      })
    ).toThrow("slot order")
  })
})
