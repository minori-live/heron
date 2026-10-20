import { describe, expect, it } from "vitest"
import type {
  MidiClipState,
  ProjectCommand,
  ProjectGraphSnapshot,
  TrackFreezeState
} from "@heron/contracts"
import { applyToGraph, inverseFor } from "./graph"
import { ProjectValidationError, TrackFrozenError } from "./validation-error"
import {
  trackFreezeContentRange,
  trackFreezeEditBlock,
  trackFreezeFingerprint,
  trackFreezeLatencyDrift,
  trackFreezeMode,
  trackFreezePlayback
} from "./track-freeze"

function graph(): ProjectGraphSnapshot {
  return {
    sampleRate: 48_000,
    tracks: [
      { id: "track-audio", channelId: "audio", sortOrder: 0, freezeMode: "pre-fader" },
      { id: "track-side", channelId: "side", sortOrder: 1 }
    ],
    channels: [
      channel("audio", "audio", "Audio"),
      channel("side", "audio", "Side"),
      channel("master", "master", "Master"),
      channel("output", "output", "Output")
    ],
    audioClips: [
      clip("clip-a", "asset-a", "track-audio", 100, 200),
      clip("clip-side", "asset-side", "track-side", 0, 50)
    ],
    sends: [],
    plugins: [
      {
        id: "insert",
        channelId: "audio",
        role: "insert",
        slotOrder: 0,
        locator: { format: "vst3", artifactPath: "/plugins/Delay.vst3", nativeId: "delay" },
        descriptor: {
          source: { kind: "external" },
          locator: { format: "vst3", artifactPath: "/plugins/Delay.vst3", nativeId: "delay" },
          name: "Delay",
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
        sidechainInputs: [{ inputPortKey: "sidechain", sourceChannelId: "side" }],
        state: { version: 1, chunks: [{ key: "component", bytes: new Uint8Array([9]) }] }
      }
    ],
    midiClips: [],
    tempoMap: {
      ticksPerQuarter: 960,
      tempoEvents: [{ tick: 0, beatsPerMinute: 120 }],
      timeSignatureEvents: [{ tick: 0, numerator: 4, denominator: 4 }]
    },
    keySignatureEvents: []
  }
}

function channel(
  id: string,
  kind: ProjectGraphSnapshot["channels"][number]["kind"],
  name: string
): ProjectGraphSnapshot["channels"][number] {
  return {
    id,
    kind,
    systemRole: null,
    name,
    color: "#000000",
    sortOrder: 0,
    inputSource: null,
    inputFormat: null,
    gainDb: 0,
    pan: 0,
    muted: false,
    soloed: false,
    outputChannelId: kind === "output" || kind === "master" ? null : "output",
    outputBus: null,
    recordArmed: false,
    inputMonitoring: false,
    inputChannels: [],
    hardwareOutputChannels: kind === "output" ? [1, 2] : []
  }
}

function clip(
  id: string,
  assetId: string,
  trackId: string,
  startFrame: number,
  lengthFrames: number
): ProjectGraphSnapshot["audioClips"][number] {
  return {
    id,
    assetId,
    trackId,
    name: id,
    startFrame,
    sourceOffsetFrames: 0,
    lengthFrames,
    sourceLengthFrames: lengthFrames,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    assetSampleRate: 48_000,
    assetChannels: 2
  }
}

function freeze(
  fingerprint: string,
  status: TrackFreezeState["status"] = "frozen"
): TrackFreezeState {
  return {
    mode: "pre-fader",
    status,
    assetId: "freeze-asset",
    fingerprint,
    startFrame: 100,
    lengthFrames: 200,
    latencySamples: 32,
    tailFrames: 64,
    sampleRate: 48_000
  }
}

describe("track freeze", () => {
  it("locks region edits and pre-fader plug-in edits, and leaves the fader editable", () => {
    const source = graph()
    const fingerprint = trackFreezeFingerprint(source, "track-audio")
    const frozen = applyToGraph(source, {
      type: "set-track-freeze",
      trackId: "track-audio",
      freeze: freeze(fingerprint)
    })

    expect(trackFreezeEditBlock(frozen, { type: "delete-audio-clip", clipId: "clip-a" })).toEqual({
      trackId: "track-audio"
    })
    expect(() =>
      applyToGraph(frozen, {
        type: "update-audio-clip",
        clipId: "clip-a",
        patch: { startFrame: 0 }
      })
    ).toThrow(TrackFrozenError)
    expect(() =>
      applyToGraph(frozen, {
        type: "update-plugin",
        pluginId: "insert",
        patch: { enabled: false }
      })
    ).toThrow(TrackFrozenError)
    expect(
      applyToGraph(frozen, {
        type: "update-channel",
        channelId: "audio",
        patch: { gainDb: -3 }
      }).channels.find((channel) => channel.id === "audio")?.gainDb
    ).toBe(-3)
    expect(
      applyToGraph(frozen, {
        type: "update-plugin",
        pluginId: "insert",
        patch: { controlAlias: "alias" }
      }).plugins[0]?.controlAlias
    ).toBe("alias")
  })

  it("keeps source-only inserts editable and blocks a mode change while frozen", () => {
    const source = graph()
    source.tracks[0]!.freezeMode = "source-only"
    const fingerprint = trackFreezeFingerprint(source, "track-audio", "source-only")
    const frozen = applyToGraph(source, {
      type: "set-track-freeze",
      trackId: "track-audio",
      freeze: { ...freeze(fingerprint), mode: "source-only" }
    })

    expect(
      trackFreezeEditBlock(frozen, {
        type: "update-plugin",
        pluginId: "insert",
        patch: { enabled: false }
      })
    ).toBeNull()
    expect(() =>
      applyToGraph(frozen, {
        type: "update-track",
        trackId: "track-audio",
        patch: { freezeMode: "pre-fader" }
      })
    ).toThrow(TrackFrozenError)
  })

  it("marks a frozen track stale when a baked side-chain source changes", () => {
    const source = graph()
    const fingerprint = trackFreezeFingerprint(source, "track-audio")
    const frozen = applyToGraph(source, {
      type: "set-track-freeze",
      trackId: "track-audio",
      freeze: freeze(fingerprint)
    })
    const changed = applyToGraph(frozen, {
      type: "update-audio-clip",
      clipId: "clip-side",
      patch: { lengthFrames: 80 }
    })
    expect(changed.tracks[0]?.freeze?.status).toBe("stale")
    expect(changed.tracks[0]?.freeze?.assetId).toBe("freeze-asset")
  })

  it("does not treat missing plug-in latency reports as drift", () => {
    const source = graph()
    const fingerprint = trackFreezeFingerprint(source, "track-audio")
    const frozen = applyToGraph(source, {
      type: "set-track-freeze",
      trackId: "track-audio",
      freeze: freeze(fingerprint)
    })
    expect(trackFreezeLatencyDrift(frozen, "track-audio", new Map())).toBe(false)
    expect(trackFreezeLatencyDrift(frozen, "track-audio", new Map([["insert", 32]]))).toBe(false)
    expect(trackFreezeLatencyDrift(frozen, "track-audio", new Map([["insert", 64]]))).toBe(true)
  })

  it("round-trips freeze state through the inverse command and substitutes playback", () => {
    const source = graph()
    expect(trackFreezeContentRange(source, "track-audio")).toEqual({
      startFrame: 100,
      endFrame: 300
    })
    expect(trackFreezeContentRange(source, "track-side")).toEqual({ startFrame: 0, endFrame: 50 })
    const command = {
      type: "set-track-freeze" as const,
      trackId: "track-audio",
      freeze: freeze(trackFreezeFingerprint(source, "track-audio"))
    }
    const frozen = applyToGraph(source, command)
    const undone = applyToGraph(frozen, inverseFor(source, command))
    expect(undone.tracks[0]?.freeze).toBeUndefined()
    expect(trackFreezePlayback(frozen, frozen.tracks[0]!)).toEqual({
      assetId: "freeze-asset",
      startFrame: 100,
      lengthFrames: 200,
      omitPluginIds: ["insert"]
    })
  })

  it("applies a region edit after the same batch clears the freeze", () => {
    const source = graph()
    const frozen = applyToGraph(source, {
      type: "set-track-freeze",
      trackId: "track-audio",
      freeze: freeze(trackFreezeFingerprint(source, "track-audio"))
    })
    const edited = applyToGraph(frozen, {
      type: "batch",
      commands: [
        { type: "set-track-freeze", trackId: "track-audio", freeze: null },
        { type: "update-audio-clip", clipId: "clip-a", patch: { startFrame: 0 } }
      ]
    })
    expect(edited.tracks[0]?.freeze).toBeUndefined()
    expect(edited.audioClips.find((clip) => clip.id === "clip-a")?.startFrame).toBe(0)
  })

  it("rejects an empty track freeze range", () => {
    const source = graph()
    source.audioClips = source.audioClips.filter((clip) => clip.trackId !== "track-audio")
    expect(trackFreezeContentRange(source, "track-audio")).toBeNull()
  })

  it("rejects an invalid freeze and blocks every baked edit", () => {
    const source = graph()
    source.tracks.push({ id: "track-midi", channelId: "midi", sortOrder: 2 })
    source.channels.push(channel("midi", "instrument", "Keys"))
    source.audioClips.push(clip("clip-b", "asset-b", "track-audio", 0, 40))
    const midiClip: MidiClipState = {
      id: "midi-1",
      sourceId: "source",
      trackId: "track-midi",
      name: "Keys",
      startTick: 0,
      lengthTicks: 960,
      sourceOffsetTicks: 0,
      sourceLengthTicks: 960,
      notes: [
        {
          id: "note",
          startTick: 0,
          durationTicks: 120,
          channel: 1,
          key: 60,
          velocity: 100,
          releaseVelocity: 0
        }
      ],
      events: [
        {
          id: "event",
          tick: 10,
          channel: 1,
          kind: "control-change",
          data: new Uint8Array([1, 2])
        }
      ]
    }
    source.midiClips = [midiClip]
    source.plugins.push({
      ...source.plugins[0]!,
      id: "keys",
      channelId: "midi",
      role: "instrument",
      slotOrder: 1
    })
    source.tracks[2]!.freezeMode = "source-only"
    expect(trackFreezeMode({})).toBe("pre-fader")
    expect(trackFreezeContentRange(source, "track-midi")?.endFrame).toBeGreaterThan(0)
    expect(trackFreezeFingerprint(source, "track-midi")).toContain("keys")
    expect(trackFreezePlayback(source, source.tracks[0]!)).toBeNull()

    const fingerprint = trackFreezeFingerprint(source, "track-audio")
    const frozen = applyToGraph(source, {
      type: "set-track-freeze",
      trackId: "track-audio",
      freeze: freeze(fingerprint)
    })
    const midiFrozen = applyToGraph(frozen, {
      type: "set-track-freeze",
      trackId: "track-midi",
      freeze: {
        ...freeze(trackFreezeFingerprint(frozen, "track-midi", "source-only")),
        mode: "source-only"
      }
    })

    const blocked: ProjectCommand[] = [
      { type: "create-audio-clip", clip: clip("new", "asset", "track-audio", 0, 1) },
      { type: "move-audio-clip", clipId: "clip-a", trackId: "track-side", startFrame: 0 },
      { type: "create-midi-clip", clip: { ...midiClip, id: "midi-2" } },
      { type: "delete-midi-clip", clipId: "midi-1" },
      { type: "move-midi-clip", clipId: "midi-1", trackId: "track-audio", startTick: 0 },
      { type: "update-midi-clip-range", clipId: "midi-1", patch: { startTick: 10 } },
      { type: "create-midi-notes", clipId: "midi-1", notes: midiClip.notes },
      { type: "delete-midi-notes", clipId: "midi-1", noteIds: ["note"] },
      { type: "update-midi-notes", clipId: "midi-1", updates: [] },
      { type: "rebase-midi-clip-content", clipId: "midi-1", deltaTicks: 1 },
      { type: "create-plugin", plugin: source.plugins[0]! },
      { type: "delete-plugin", pluginId: "insert" },
      { type: "replace-plugin", pluginId: "insert", plugin: source.plugins[0]! },
      {
        type: "move-plugin",
        pluginId: "insert",
        channelId: "audio",
        role: "insert",
        slotOrder: 1
      },
      { type: "create-plugin", plugin: { ...source.plugins[1]!, id: "extra" } }
    ]
    for (const command of blocked) {
      expect(trackFreezeEditBlock(midiFrozen, command)?.trackId).toBeTruthy()
      expect(() => applyToGraph(midiFrozen, command)).toThrow(TrackFrozenError)
    }
    expect(
      trackFreezeEditBlock(midiFrozen, {
        type: "update-plugin",
        pluginId: "keys",
        patch: { enabled: false }
      })
    ).toEqual({ trackId: "track-midi" })
    expect(
      trackFreezeEditBlock(midiFrozen, {
        type: "update-track",
        trackId: "track-audio",
        patch: { notes: "live" }
      })
    ).toBeNull()
    expect(
      trackFreezeEditBlock(midiFrozen, {
        type: "delete-audio-clip",
        clipId: "missing"
      })
    ).toBeNull()
    expect(
      trackFreezeEditBlock(midiFrozen, { type: "delete-plugin", pluginId: "missing" })
    ).toBeNull()
    expect(
      trackFreezeEditBlock(midiFrozen, {
        type: "move-midi-clip",
        clipId: "missing",
        trackId: "track-side",
        startTick: 0
      })
    ).toBeNull()
    expect(
      trackFreezeEditBlock(midiFrozen, {
        type: "update-plugin",
        pluginId: "insert",
        patch: {}
      })
    ).toBeNull()
    expect(trackFreezeLatencyDrift(midiFrozen, "missing", new Map())).toBe(false)
    expect(trackFreezeLatencyDrift(midiFrozen, "track-audio", new Map([["insert", -1]]))).toBe(
      false
    )
    midiFrozen.tracks[0]!.freeze!.status = "stale"
    expect(trackFreezeLatencyDrift(midiFrozen, "track-audio", new Map([["insert", 64]]))).toBe(
      false
    )

    const invalid = freeze(fingerprint)
    const rejects = [
      { ...invalid, mode: "wet" },
      { ...invalid, status: "cold" },
      { ...invalid, assetId: "" },
      { ...invalid, fingerprint: "" },
      { ...invalid, startFrame: -1 },
      { ...invalid, lengthFrames: 0 },
      { ...invalid, latencySamples: -1 },
      { ...invalid, tailFrames: -1 },
      { ...invalid, sampleRate: 44_100 },
      { ...invalid, mode: "source-only" }
    ]
    for (const value of rejects) {
      expect(() =>
        applyToGraph(source, {
          type: "set-track-freeze",
          trackId: "track-audio",
          freeze: value as TrackFreezeState
        })
      ).toThrow(ProjectValidationError)
    }
    expect(() =>
      applyToGraph(source, { type: "set-track-freeze", trackId: "missing", freeze: null })
    ).toThrow(ProjectValidationError)
    source.tracks[0]!.channelId = "missing"
    expect(() =>
      applyToGraph(source, {
        type: "set-track-freeze",
        trackId: "track-audio",
        freeze: invalid
      })
    ).toThrow(ProjectValidationError)
    source.tracks[0]!.channelId = "audio"
    source.channels[0]!.systemRole = "metronome"
    expect(() =>
      applyToGraph(source, {
        type: "set-track-freeze",
        trackId: "track-audio",
        freeze: invalid
      })
    ).toThrow("System tracks cannot be frozen")
    const unmarked = graph()
    unmarked.tracks[0]!.freezeMode = "wet" as never
    expect(() =>
      applyToGraph(unmarked, {
        type: "set-track-freeze",
        trackId: "track-audio",
        freeze: { ...invalid, mode: "wet" as never }
      })
    ).toThrow(ProjectValidationError)
  })
})
