import { asc, eq, inArray } from "drizzle-orm"
import type { ProjectGraphSnapshot } from "@heron/contracts"
import {
  audioClips,
  assets,
  keySignatureEvents,
  midiClips,
  midiEvents,
  midiNotes,
  PROJECT_ID,
  project,
  tempoEvents,
  tracks,
  timeSignatureEvents
} from "../schema"
import { bytes } from "./serialization"
import { readMixerGraphSnapshot } from "./mixer-reads"
import type { ProjectDb } from "./database-types"
import type { SnapshotPayloadCache } from "./snapshot-payload-cache"
import { MIDI_QUERY_PARAMETER_BUDGET } from "./midi-batches"

async function refreshClipRows<T extends { clipId: string }>(
  cached: T[] | undefined,
  dirtyClipIds: ReadonlySet<string> | undefined,
  select: (clipIds?: string[]) => PromiseLike<T[]>
): Promise<T[]> {
  // A very wide batch is cheaper to refresh once than to build an unbounded IN
  // list, and must never exceed PostgreSQL's bind parameter limit.
  if (!cached || !dirtyClipIds || dirtyClipIds.size > MIDI_QUERY_PARAMETER_BUDGET) return select()
  if (dirtyClipIds.size === 0) return cached
  const refreshed = await select([...dirtyClipIds])
  // Each clip's rows remain ordered. The graph groups by clip below, so cache
  // storage does not need a full-project sort after refreshing a few clips.
  return [...cached.filter((row) => !dirtyClipIds.has(row.clipId)), ...refreshed]
}

export async function readProjectGraphSnapshot(
  db: Pick<ProjectDb, "select">,
  payloads?: SnapshotPayloadCache
): Promise<ProjectGraphSnapshot> {
  const [
    trackRows,
    clipRows,
    midiClipRows,
    midiNoteRows,
    midiEventRows,
    tempoRows,
    signatureRows,
    keySignatureRows,
    projectRows
  ] = await Promise.all([
    db.select().from(tracks).orderBy(asc(tracks.sortOrder), asc(tracks.id)),
    db
      .select({
        id: audioClips.id,
        assetId: audioClips.assetId,
        trackId: audioClips.trackId,
        name: audioClips.name,
        startFrame: audioClips.startFrame,
        sourceOffsetFrames: audioClips.sourceOffsetFrames,
        lengthFrames: audioClips.lengthFrames,
        fadeInFrames: audioClips.fadeInFrames,
        fadeOutFrames: audioClips.fadeOutFrames,
        assetSampleRate: assets.sampleRate,
        assetChannels: assets.channels,
        assetFrameCount: assets.frameCount
      })
      .from(audioClips)
      .innerJoin(assets, eq(assets.id, audioClips.assetId))
      .orderBy(asc(audioClips.startFrame), asc(audioClips.id)),
    db.select().from(midiClips).orderBy(asc(midiClips.startTick), asc(midiClips.id)),
    refreshClipRows(payloads?.notes, payloads?.dirtyNoteClipIds, (clipIds) =>
      db
        .select()
        .from(midiNotes)
        .where(clipIds ? inArray(midiNotes.clipId, clipIds) : undefined)
        .orderBy(asc(midiNotes.clipId), asc(midiNotes.startTick), asc(midiNotes.id))
    ),
    refreshClipRows(payloads?.events, payloads?.dirtyEventClipIds, (clipIds) =>
      db
        .select()
        .from(midiEvents)
        .where(clipIds ? inArray(midiEvents.clipId, clipIds) : undefined)
        .orderBy(asc(midiEvents.clipId), asc(midiEvents.tick), asc(midiEvents.id))
    ),
    db.select().from(tempoEvents).orderBy(asc(tempoEvents.tick)),
    db.select().from(timeSignatureEvents).orderBy(asc(timeSignatureEvents.tick)),
    db.select().from(keySignatureEvents).orderBy(asc(keySignatureEvents.tick)),
    db
      .select({
        sampleRate: project.sampleRate,
        notes: project.notes,
        projectEndTick: project.projectEndTick
      })
      .from(project)
      .where(eq(project.id, PROJECT_ID))
      .limit(1)
  ])

  const projectRow = projectRows[0]
  if (!projectRow) throw new Error("Project configuration is missing")
  const mixer = await readMixerGraphSnapshot(db, projectRow.sampleRate, payloads)
  if (payloads) {
    payloads.notes = midiNoteRows
    payloads.events = midiEventRows
    payloads.dirtyNoteClipIds.clear()
    payloads.dirtyEventClipIds.clear()
  }

  const notesByClip = new Map<string, ProjectGraphSnapshot["midiClips"][number]["notes"]>()
  for (const note of midiNoteRows) {
    const notes = notesByClip.get(note.clipId) ?? []
    notes.push({
      id: note.id,
      startTick: note.startTick,
      durationTicks: note.durationTicks,
      channel: note.channel,
      key: note.key,
      velocity: note.velocity,
      releaseVelocity: note.releaseVelocity
    })
    notesByClip.set(note.clipId, notes)
  }
  const eventsByClip = new Map<string, ProjectGraphSnapshot["midiClips"][number]["events"]>()
  for (const event of midiEventRows) {
    const events = eventsByClip.get(event.clipId) ?? []
    events.push({
      id: event.id,
      tick: event.tick,
      channel: event.channel,
      kind: event.kind,
      data: new Uint8Array(bytes(event.data))
    })
    eventsByClip.set(event.clipId, events)
  }

  return {
    ...mixer,
    projectNotes: projectRow.notes,
    projectEndTick: projectRow.projectEndTick,
    tracks: trackRows,
    audioClips: clipRows.map(({ assetFrameCount, ...clip }) => ({
      ...clip,
      startFrame: Number(clip.startFrame),
      sourceOffsetFrames: Number(clip.sourceOffsetFrames),
      lengthFrames: Number(clip.lengthFrames),
      sourceLengthFrames: Math.max(
        1,
        Math.round((Number(assetFrameCount) * projectRow.sampleRate) / clip.assetSampleRate)
      ),
      fadeInFrames: Number(clip.fadeInFrames),
      fadeOutFrames: Number(clip.fadeOutFrames)
    })),
    midiClips: midiClipRows.map((clip) => ({
      id: clip.id,
      sourceId: clip.sourceId,
      trackId: clip.trackId,
      name: clip.name,
      startTick: clip.startTick,
      lengthTicks: clip.lengthTicks,
      sourceOffsetTicks: clip.sourceOffsetTicks,
      sourceLengthTicks: clip.sourceLengthTicks,
      notes: notesByClip.get(clip.id) ?? [],
      events: eventsByClip.get(clip.id) ?? []
    })),
    tempoMap: {
      ticksPerQuarter: 960,
      tempoEvents: tempoRows.map((event) => ({
        tick: event.tick,
        beatsPerMinute: event.beatsPerMinute
      })),
      timeSignatureEvents: signatureRows
    },
    keySignatureEvents: keySignatureRows.map((event) => ({
      ...event,
      mode: event.mode === "minor" ? "minor" : "major"
    }))
  }
}
