import type { ProjectGraphSnapshot, TrackState } from "@heron/contracts"
import { mixerChannelById, validateMixerGraph } from "./mixer-validation"
import { ProjectValidationError } from "./validation-error"

function channelForTrack(graph: ProjectGraphSnapshot, trackId: string) {
  const track = graph.tracks.find((candidate) => candidate.id === trackId)
  if (!track) throw new ProjectValidationError(`Project track '${trackId}' was not found`)
  return mixerChannelById(graph, track.channelId)
}

/** Studio adds arrangement ownership and musical maps to the shared Mixer. */
export function validateGraph(graph: ProjectGraphSnapshot): void {
  validateMixerGraph(graph)
  if (typeof graph.projectNotes !== "undefined" && typeof graph.projectNotes !== "string") {
    throw new ProjectValidationError("Project notes must be text")
  }
  if (
    typeof graph.projectEndTick !== "undefined" &&
    (!Number.isSafeInteger(graph.projectEndTick) || graph.projectEndTick < 1)
  ) {
    throw new ProjectValidationError("Project end must be a positive safe-integer tick")
  }
  const trackIds = new Set<string>()
  const tracksByChannel = new Map<string, TrackState>()
  for (const track of graph.tracks) {
    if (!track.id || trackIds.has(track.id))
      throw new ProjectValidationError("Project track IDs must be unique")
    if (new TextEncoder().encode(track.id).length > 64) {
      throw new ProjectValidationError("Project track IDs must be at most 64 UTF-8 bytes")
    }
    if (!Number.isSafeInteger(track.sortOrder) || track.sortOrder < 0) {
      throw new ProjectValidationError("Project track order must be a non-negative safe integer")
    }
    if (typeof track.notes !== "undefined" && typeof track.notes !== "string") {
      throw new ProjectValidationError("Track notes must be text")
    }
    if (tracksByChannel.has(track.channelId)) {
      throw new ProjectValidationError("A mixer channel can belong to at most one project track")
    }
    const channel = mixerChannelById(graph, track.channelId)
    if (
      channel.systemRole !== null ||
      (channel.kind !== "audio" && channel.kind !== "instrument")
    ) {
      throw new ProjectValidationError(
        "Project tracks must reference ordinary Audio or Instrument channels"
      )
    }
    trackIds.add(track.id)
    tracksByChannel.set(track.channelId, track)
  }

  for (const channel of graph.channels) {
    const shouldOwnTrack =
      channel.systemRole === null && (channel.kind === "audio" || channel.kind === "instrument")
    if (tracksByChannel.has(channel.id) !== shouldOwnTrack) {
      throw new ProjectValidationError(
        shouldOwnTrack
          ? "Ordinary Audio and Instrument channels require exactly one project track"
          : "Aux, Master, Output, and system channels cannot own project tracks"
      )
    }
  }
  for (const clip of graph.audioClips) {
    if (!Number.isSafeInteger(clip.startFrame) || clip.startFrame < 0) {
      throw new ProjectValidationError("Clip start frame must be a non-negative safe integer")
    }
    if (
      !Number.isSafeInteger(clip.sourceOffsetFrames) ||
      clip.sourceOffsetFrames < 0 ||
      !Number.isSafeInteger(clip.lengthFrames) ||
      clip.lengthFrames < 1 ||
      !Number.isSafeInteger(clip.sourceLengthFrames) ||
      clip.sourceLengthFrames < 1 ||
      clip.sourceOffsetFrames + clip.lengthFrames > clip.sourceLengthFrames ||
      !Number.isSafeInteger(clip.fadeInFrames) ||
      clip.fadeInFrames < 0 ||
      !Number.isSafeInteger(clip.fadeOutFrames) ||
      clip.fadeOutFrames < 0 ||
      clip.fadeInFrames + clip.fadeOutFrames > clip.lengthFrames
    ) {
      throw new ProjectValidationError("Clip source offset and length must use valid sample frames")
    }
    const channel = channelForTrack(graph, clip.trackId)
    if (channel.kind !== "audio" || channel.systemRole !== null) {
      throw new ProjectValidationError("Timeline clips must belong to audio tracks")
    }
  }
  if (graph.tempoMap.ticksPerQuarter !== 960) {
    throw new ProjectValidationError("Project tempo maps must use 960 PPQ")
  }
  if (
    graph.tempoMap.tempoEvents[0]?.tick !== 0 ||
    graph.tempoMap.timeSignatureEvents[0]?.tick !== 0
  ) {
    throw new ProjectValidationError("Tempo and time-signature maps require an event at tick 0")
  }
  let previousTempoTick = -1
  for (const event of graph.tempoMap.tempoEvents) {
    if (
      !Number.isSafeInteger(event.tick) ||
      event.tick <= previousTempoTick ||
      !Number.isFinite(event.beatsPerMinute) ||
      event.beatsPerMinute <= 0
    ) {
      throw new ProjectValidationError(
        "Tempo events must be ordered unique ticks with positive BPM"
      )
    }
    previousTempoTick = event.tick
  }
  let previousSignatureTick = -1
  for (const event of graph.tempoMap.timeSignatureEvents) {
    if (
      !Number.isSafeInteger(event.tick) ||
      event.tick <= previousSignatureTick ||
      !Number.isInteger(event.numerator) ||
      event.numerator < 1 ||
      event.numerator > 32 ||
      ![1, 2, 4, 8, 16, 32].includes(event.denominator)
    ) {
      throw new ProjectValidationError("Time-signature events contain invalid values")
    }
    previousSignatureTick = event.tick
  }
  if (graph.keySignatureEvents[0]?.tick !== 0) {
    throw new ProjectValidationError("Key-signature maps require an event at tick 0")
  }
  let previousKeyTick = -1
  for (const event of graph.keySignatureEvents) {
    if (
      !Number.isSafeInteger(event.tick) ||
      event.tick <= previousKeyTick ||
      !Number.isInteger(event.fifths) ||
      event.fifths < -7 ||
      event.fifths > 7 ||
      (event.mode !== "major" && event.mode !== "minor")
    ) {
      throw new ProjectValidationError("Key-signature events contain invalid values")
    }
    previousKeyTick = event.tick
  }
  const midiClipIds = new Set<string>()
  const midiNoteIds = new Set<string>()
  const midiEventIds = new Set<string>()
  for (const clip of graph.midiClips) {
    if (!clip.id || midiClipIds.has(clip.id))
      throw new ProjectValidationError("MIDI clip IDs must be unique")
    midiClipIds.add(clip.id)
    const channel = channelForTrack(graph, clip.trackId)
    if (channel.kind !== "instrument" || channel.systemRole !== null) {
      throw new ProjectValidationError("MIDI clips must belong to Instrument tracks")
    }
    if (
      !Number.isSafeInteger(clip.startTick) ||
      clip.startTick < 0 ||
      !Number.isSafeInteger(clip.sourceOffsetTicks) ||
      clip.sourceOffsetTicks < 0 ||
      !Number.isSafeInteger(clip.lengthTicks) ||
      clip.lengthTicks < 1 ||
      !Number.isSafeInteger(clip.sourceLengthTicks) ||
      clip.sourceLengthTicks < 1 ||
      clip.sourceOffsetTicks + clip.lengthTicks > clip.sourceLengthTicks
    ) {
      throw new ProjectValidationError("MIDI clip positions must use valid musical ticks")
    }
    for (const note of clip.notes) {
      if (!note.id || midiNoteIds.has(note.id))
        throw new ProjectValidationError("MIDI note IDs must be unique")
      midiNoteIds.add(note.id)
      if (
        !Number.isSafeInteger(note.startTick) ||
        note.startTick < 0 ||
        !Number.isSafeInteger(note.durationTicks) ||
        note.durationTicks < 1 ||
        !Number.isInteger(note.channel) ||
        note.channel < 0 ||
        note.channel > 15 ||
        !Number.isInteger(note.key) ||
        note.key < 0 ||
        note.key > 127 ||
        !Number.isInteger(note.velocity) ||
        note.velocity < 1 ||
        note.velocity > 127 ||
        !Number.isInteger(note.releaseVelocity) ||
        note.releaseVelocity < 0 ||
        note.releaseVelocity > 127
      ) {
        throw new ProjectValidationError(
          "MIDI note contains invalid tick, channel, key, or velocity data"
        )
      }
    }
    for (const event of clip.events) {
      if (!event.id || midiEventIds.has(event.id))
        throw new ProjectValidationError("MIDI event IDs must be unique")
      midiEventIds.add(event.id)
      if (!Number.isSafeInteger(event.tick) || event.tick < 0) {
        throw new ProjectValidationError("MIDI event ticks must use 1/3840-note integer resolution")
      }
    }
  }
}
