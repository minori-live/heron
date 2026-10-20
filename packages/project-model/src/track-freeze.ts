import type {
  AudioClipState,
  MidiClipState,
  PluginInstancePatch,
  PluginInstanceState,
  ProjectCommand,
  ProjectGraphSnapshot,
  TrackFreezeMode,
  TrackFreezeState,
  TrackState
} from "@heron/contracts"
import { projectTickToSeconds } from "./selectors"
import { ProjectValidationError } from "./validation-error"

export interface TrackFreezeEditBlock {
  trackId: string
}

export interface TrackFreezePlayback {
  assetId: string
  startFrame: number
  lengthFrames: number
  omitPluginIds: string[]
}

export interface TrackFreezeContentRange {
  startFrame: number
  endFrame: number
}

const PLUGIN_PATCH_KEYS_WITHOUT_AUDIO = new Set<keyof PluginInstancePatch>(["controlAlias"])

export function trackFreezeMode(track: Pick<TrackState, "freezeMode">): TrackFreezeMode {
  return track.freezeMode ?? "pre-fader"
}

export function validateTrackFreeze(graph: ProjectGraphSnapshot, track: TrackState): void {
  if (
    track.freezeMode !== undefined &&
    track.freezeMode !== "pre-fader" &&
    track.freezeMode !== "source-only"
  ) {
    throw new ProjectValidationError("Track freeze mode must be pre-fader or source-only")
  }
  const freeze = track.freeze
  if (freeze == null) return
  if (freeze.mode !== "pre-fader" && freeze.mode !== "source-only") {
    throw new ProjectValidationError("Track freeze mode must be pre-fader or source-only")
  }
  if (freeze.status !== "frozen" && freeze.status !== "stale") {
    throw new ProjectValidationError("Track freeze status must be frozen or stale")
  }
  if (!freeze.assetId || !freeze.fingerprint) {
    throw new ProjectValidationError("Track freeze requires an asset and fingerprint")
  }
  if (!Number.isSafeInteger(freeze.startFrame) || freeze.startFrame < 0) {
    throw new ProjectValidationError("Track freeze start must be a non-negative safe integer")
  }
  if (!Number.isSafeInteger(freeze.lengthFrames) || freeze.lengthFrames < 1) {
    throw new ProjectValidationError("Track freeze length must be a positive safe integer")
  }
  if (!Number.isSafeInteger(freeze.latencySamples) || freeze.latencySamples < 0) {
    throw new ProjectValidationError("Track freeze latency must be a non-negative safe integer")
  }
  if (!Number.isSafeInteger(freeze.tailFrames) || freeze.tailFrames < 0) {
    throw new ProjectValidationError("Track freeze tail must be a non-negative safe integer")
  }
  if (freeze.sampleRate !== graph.sampleRate) {
    throw new ProjectValidationError("Track freeze sample rate must match the project")
  }
}

/** Frames covered by the track's audio and MIDI content. Null when there is nothing to freeze. */
export function trackFreezeContentRange(
  graph: ProjectGraphSnapshot,
  trackId: string
): TrackFreezeContentRange | null {
  const track = requireTrack(graph, trackId)
  let start = Number.POSITIVE_INFINITY
  let end = 0
  for (const clip of graph.audioClips) {
    if (clip.trackId !== track.id) continue
    start = Math.min(start, clip.startFrame)
    end = Math.max(end, clip.startFrame + clip.lengthFrames)
  }
  for (const clip of graph.midiClips) {
    if (clip.trackId !== track.id) continue
    const clipStart = secondsToFrame(graph, projectTickToSeconds(graph, clip.startTick))
    const clipEnd = secondsToFrame(
      graph,
      projectTickToSeconds(graph, clip.startTick + clip.lengthTicks)
    )
    start = Math.min(start, clipStart)
    end = Math.max(end, Math.max(clipEnd, clipStart + 1))
  }
  if (!Number.isFinite(start) || end <= start) return null
  return { startFrame: start, endFrame: end }
}

export function trackFreezeFingerprint(
  graph: ProjectGraphSnapshot,
  trackId: string,
  mode: TrackFreezeMode = trackFreezeMode(requireTrack(graph, trackId))
): string {
  const track = requireTrack(graph, trackId)
  const plugins = includedPlugins(graph, track, mode)
  const includeTempo = plugins.some((plugin) => plugin.role === "instrument") || hasMidi(graph, track.id)
  const sidechainChannelIds = new Set(
    plugins.flatMap((plugin) => plugin.sidechainInputs.map((route) => route.sourceChannelId))
  )
  return JSON.stringify({
    mode,
    sampleRate: graph.sampleRate,
    audio: graph.audioClips
      .filter((clip) => clip.trackId === track.id)
      .sort(compareId)
      .map(audioIdentity),
    midi: graph.midiClips
      .filter((clip) => clip.trackId === track.id)
      .sort(compareId)
      .map(midiIdentity),
    tempo: includeTempo ? graph.tempoMap : null,
    plugins: plugins.map(pluginIdentity),
    sidechainAudio: graph.audioClips
      .filter((clip) => sidechainChannelIds.has(channelIdForTrack(graph, clip.trackId)))
      .sort(compareId)
      .map(audioIdentity)
  })
}

export function trackFreezePlayback(
  graph: ProjectGraphSnapshot,
  track: TrackState
): TrackFreezePlayback | null {
  const freeze = track.freeze
  if (!freeze) return null
  return {
    assetId: freeze.assetId,
    startFrame: freeze.startFrame,
    lengthFrames: freeze.lengthFrames,
    omitPluginIds: includedPlugins(graph, track, freeze.mode).map((plugin) => plugin.id)
  }
}

/**
 * True when every baked plug-in has a reported latency and the sum no longer
 * matches the freeze file. Missing reports do not count as drift.
 */
export function trackFreezeLatencyDrift(
  graph: ProjectGraphSnapshot,
  trackId: string,
  reportedLatencySamples: ReadonlyMap<string, number | null | undefined>
): boolean {
  const track = graph.tracks.find((candidate) => candidate.id === trackId)
  const freeze = track?.freeze
  if (!track || !freeze || freeze.status !== "frozen") return false
  const plugins = includedPlugins(graph, track, freeze.mode)
  let sum = 0
  for (const plugin of plugins) {
    const reported = reportedLatencySamples.get(plugin.id)
    if (reported == null || !Number.isSafeInteger(reported) || reported < 0) return false
    sum += reported
  }
  return sum !== freeze.latencySamples
}

export function trackFreezeEditBlock(
  graph: ProjectGraphSnapshot,
  command: ProjectCommand
): TrackFreezeEditBlock | null {
  switch (command.type) {
    case "batch":
      return null
    case "update-track":
      return command.patch.freezeMode !== undefined && lockedTrack(graph, command.trackId)
        ? { trackId: command.trackId }
        : null
    case "create-audio-clip":
      return blockTrack(graph, command.clip.trackId)
    case "delete-audio-clip":
    case "update-audio-clip":
      return blockTrack(graph, clipTrackId(graph, command.clipId))
    case "move-audio-clip":
      return (
        blockTrack(graph, clipTrackId(graph, command.clipId)) ??
        blockTrack(graph, command.trackId)
      )
    case "create-midi-clip":
      return blockTrack(graph, command.clip.trackId)
    case "delete-midi-clip":
    case "move-midi-clip":
    case "update-midi-clip-range":
    case "create-midi-notes":
    case "delete-midi-notes":
    case "update-midi-notes":
    case "rebase-midi-clip-content": {
      const trackId = midiTrackId(graph, command.clipId)
      return (
        blockTrack(graph, trackId) ??
        (command.type === "move-midi-clip" ? blockTrack(graph, command.trackId) : null)
      )
    }
    case "create-plugin":
      return blockPluginRole(graph, command.plugin.channelId, command.plugin.role)
    case "delete-plugin":
    case "replace-plugin":
      return blockPlugin(graph, command.pluginId)
    case "update-plugin":
      return pluginPatchChangesAudio(command.patch) ? blockPlugin(graph, command.pluginId) : null
    case "move-plugin":
      return (
        blockPlugin(graph, command.pluginId) ??
        blockPluginRole(graph, command.channelId, command.role)
      )
    default:
      return null
  }
}

export function refreshTrackFreezes(graph: ProjectGraphSnapshot): void {
  for (const track of graph.tracks) {
    const freeze = track.freeze
    if (!freeze || freeze.status !== "frozen") continue
    if (trackFreezeFingerprint(graph, track.id, freeze.mode) !== freeze.fingerprint) {
      freeze.status = "stale"
    }
  }
}

export function applyTrackFreeze(
  graph: ProjectGraphSnapshot,
  trackId: string,
  freeze: TrackFreezeState | null
): void {
  const track = requireTrack(graph, trackId)
  const channel = graph.channels.find((candidate) => candidate.id === track.channelId)
  if (!channel) throw new ProjectValidationError(`Mixer channel '${track.channelId}' was not found`)
  if (channel.systemRole !== null) {
    throw new ProjectValidationError("System tracks cannot be frozen")
  }
  if (freeze === null) {
    track.freeze = undefined
    return
  }
  if (freeze.mode !== trackFreezeMode(track)) {
    throw new ProjectValidationError("Freeze file mode does not match the track freeze mode")
  }
  track.freeze = structuredClone(freeze)
  validateTrackFreeze(graph, track)
}

function includedPlugins(
  graph: ProjectGraphSnapshot,
  track: TrackState,
  mode: TrackFreezeMode
): PluginInstanceState[] {
  return graph.plugins
    .filter(
      (plugin) =>
        plugin.channelId === track.channelId && (mode === "pre-fader" || plugin.role === "instrument")
    )
    .sort((left, right) => left.slotOrder - right.slotOrder || left.id.localeCompare(right.id))
}

function lockedTrack(graph: ProjectGraphSnapshot, trackId: string | null): boolean {
  if (!trackId) return false
  return Boolean(graph.tracks.find((track) => track.id === trackId)?.freeze)
}

function blockTrack(
  graph: ProjectGraphSnapshot,
  trackId: string | null
): TrackFreezeEditBlock | null {
  return trackId && lockedTrack(graph, trackId) ? { trackId } : null
}

function blockPlugin(graph: ProjectGraphSnapshot, pluginId: string): TrackFreezeEditBlock | null {
  const plugin = graph.plugins.find((candidate) => candidate.id === pluginId)
  if (!plugin) return null
  return blockPluginRole(graph, plugin.channelId, plugin.role)
}

function blockPluginRole(
  graph: ProjectGraphSnapshot,
  channelId: string,
  role: PluginInstanceState["role"]
): TrackFreezeEditBlock | null {
  const track = graph.tracks.find((candidate) => candidate.channelId === channelId)
  if (!track?.freeze) return null
  if (track.freeze.mode === "source-only" && role !== "instrument") return null
  return { trackId: track.id }
}

function pluginPatchChangesAudio(patch: PluginInstancePatch): boolean {
  return Object.keys(patch).some(
    (key) => !PLUGIN_PATCH_KEYS_WITHOUT_AUDIO.has(key as keyof PluginInstancePatch)
  )
}

function requireTrack(graph: ProjectGraphSnapshot, trackId: string): TrackState {
  const track = graph.tracks.find((candidate) => candidate.id === trackId)
  if (!track) throw new ProjectValidationError(`Project track '${trackId}' was not found`)
  return track
}

function clipTrackId(graph: ProjectGraphSnapshot, clipId: string): string | null {
  return graph.audioClips.find((clip) => clip.id === clipId)?.trackId ?? null
}

function midiTrackId(graph: ProjectGraphSnapshot, clipId: string): string | null {
  return graph.midiClips.find((clip) => clip.id === clipId)?.trackId ?? null
}

function hasMidi(graph: ProjectGraphSnapshot, trackId: string): boolean {
  return graph.midiClips.some((clip) => clip.trackId === trackId)
}

function channelIdForTrack(graph: ProjectGraphSnapshot, trackId: string): string {
  return graph.tracks.find((track) => track.id === trackId)?.channelId ?? ""
}

function secondsToFrame(graph: ProjectGraphSnapshot, seconds: number): number {
  return Math.max(0, Math.round(seconds * graph.sampleRate))
}

function compareId(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id)
}

function audioIdentity(clip: AudioClipState) {
  return {
    id: clip.id,
    assetId: clip.assetId,
    startFrame: clip.startFrame,
    sourceOffsetFrames: clip.sourceOffsetFrames,
    lengthFrames: clip.lengthFrames,
    fadeInFrames: clip.fadeInFrames,
    fadeOutFrames: clip.fadeOutFrames,
    assetSampleRate: clip.assetSampleRate,
    assetChannels: clip.assetChannels
  }
}

function midiIdentity(clip: MidiClipState) {
  return {
    id: clip.id,
    startTick: clip.startTick,
    lengthTicks: clip.lengthTicks,
    sourceOffsetTicks: clip.sourceOffsetTicks,
    notes: clip.notes.map((note) => ({
      startTick: note.startTick,
      durationTicks: note.durationTicks,
      channel: note.channel,
      key: note.key,
      velocity: note.velocity
    })),
    events: clip.events.map((event) => ({
      tick: event.tick,
      channel: event.channel,
      kind: event.kind,
      data: bytesToBase64(event.data)
    }))
  }
}

function pluginIdentity(plugin: PluginInstanceState) {
  return {
    id: plugin.id,
    role: plugin.role,
    slotOrder: plugin.slotOrder,
    enabled: plugin.enabled,
    audioMode: plugin.audioMode,
    locator: plugin.locator,
    sidechainInputs: plugin.sidechainInputs,
    state: plugin.state.chunks.map((chunk) => ({
      key: chunk.key,
      bytes: bytesToBase64(chunk.bytes)
    }))
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
