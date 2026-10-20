import { describe, expect, it } from "vitest"
import type { ProjectGraphSnapshot, TrackFreezeState } from "@heron/contracts"
import { applyToGraph, inverseFor } from "./graph"
import { TrackFrozenError } from "./validation-error"
import {
  trackFreezeContentRange,
  trackFreezeEditBlock,
  trackFreezeFingerprint,
  trackFreezeLatencyDrift,
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
})
