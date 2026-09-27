import { and, eq, inArray } from "drizzle-orm"
import type { MidiClipRangePatch, MidiNotePatch, ProjectCommand } from "@heron/contracts"
import { midiClips, midiEvents, midiNotes, midiSources } from "../schema"
import type { ProjectTransaction } from "./database-types"
import { MIDI_QUERY_PARAMETER_BUDGET, midiBatches } from "./midi-batches"
import { rebaseMidiClipContent } from "./midi-rebase"

type MidiCommand = Extract<
  ProjectCommand,
  {
    type:
      | "create-midi-source"
      | "delete-midi-source"
      | "create-midi-clip"
      | "delete-midi-clip"
      | "move-midi-clip"
      | "update-midi-clip-range"
      | "create-midi-notes"
      | "delete-midi-notes"
      | "update-midi-notes"
      | "rebase-midi-clip-content"
  }
>

function rangePatch(patch: MidiClipRangePatch): Partial<typeof midiClips.$inferInsert> {
  const result: Partial<typeof midiClips.$inferInsert> = {}
  if (patch.startTick !== undefined) result.startTick = patch.startTick
  if (patch.lengthTicks !== undefined) result.lengthTicks = patch.lengthTicks
  if (patch.sourceOffsetTicks !== undefined) result.sourceOffsetTicks = patch.sourceOffsetTicks
  if (patch.sourceLengthTicks !== undefined) result.sourceLengthTicks = patch.sourceLengthTicks
  return result
}

function notePatch(patch: MidiNotePatch): Partial<typeof midiNotes.$inferInsert> {
  const result: Partial<typeof midiNotes.$inferInsert> = {}
  if (patch.startTick !== undefined) result.startTick = patch.startTick
  if (patch.durationTicks !== undefined) result.durationTicks = patch.durationTicks
  if (patch.channel !== undefined) result.channel = patch.channel
  if (patch.key !== undefined) result.key = patch.key
  if (patch.velocity !== undefined) result.velocity = patch.velocity
  if (patch.releaseVelocity !== undefined) result.releaseVelocity = patch.releaseVelocity
  return result
}

async function insertNotes(
  tx: ProjectTransaction,
  clipId: string,
  notes: Extract<ProjectCommand, { type: "create-midi-notes" }>["notes"]
): Promise<void> {
  for (const batch of midiBatches(notes, 8)) {
    await tx.insert(midiNotes).values(
      batch.map((note) => ({
        id: note.id,
        clipId,
        startTick: note.startTick,
        durationTicks: note.durationTicks,
        channel: note.channel,
        key: note.key,
        velocity: note.velocity,
        releaseVelocity: note.releaseVelocity
      }))
    )
  }
}

async function updateNotes(
  tx: ProjectTransaction,
  clipId: string,
  updates: Extract<ProjectCommand, { type: "update-midi-notes" }>["updates"]
): Promise<void> {
  let pendingPatch: ReturnType<typeof notePatch> | null = null
  let pendingIds: string[] = []
  const flush = async (): Promise<void> => {
    if (!pendingPatch) return
    await tx
      .update(midiNotes)
      .set(pendingPatch)
      .where(and(eq(midiNotes.clipId, clipId), inArray(midiNotes.id, pendingIds)))
    pendingPatch = null
    pendingIds = []
  }

  for (const update of updates) {
    const patch = notePatch(update.patch)
    const keys = Object.keys(patch) as Array<keyof typeof patch>
    if (keys.length === 0) continue
    const previousPatch = pendingPatch
    if (
      previousPatch &&
      (keys.length !== Object.keys(previousPatch).length ||
        keys.some((key) => !Object.is(patch[key], previousPatch[key])) ||
        pendingIds.length >= MIDI_QUERY_PARAMETER_BUDGET - keys.length - 1)
    ) {
      await flush()
    }
    // Only adjacent equal patches are merged. Reordering or collapsing different
    // patches can change repeated-note-ID semantics, including constraint failures.
    pendingPatch = patch
    pendingIds.push(update.noteId)
  }
  await flush()
}

async function insertClip(
  tx: ProjectTransaction,
  clip: Extract<ProjectCommand, { type: "create-midi-clip" }>["clip"]
): Promise<void> {
  await tx.insert(midiClips).values({
    id: clip.id,
    sourceId: clip.sourceId,
    trackId: clip.trackId,
    name: clip.name,
    startTick: clip.startTick,
    lengthTicks: clip.lengthTicks,
    sourceOffsetTicks: clip.sourceOffsetTicks,
    sourceLengthTicks: clip.sourceLengthTicks
  })
  await insertNotes(tx, clip.id, clip.notes)
  for (const batch of midiBatches(clip.events, 6)) {
    await tx.insert(midiEvents).values(
      batch.map((event) => ({
        id: event.id,
        clipId: clip.id,
        tick: event.tick,
        channel: event.channel,
        kind: event.kind,
        data: event.data
      }))
    )
  }
}

export function isMidiCommand(command: ProjectCommand): command is MidiCommand {
  return [
    "create-midi-source",
    "delete-midi-source",
    "create-midi-clip",
    "delete-midi-clip",
    "move-midi-clip",
    "update-midi-clip-range",
    "create-midi-notes",
    "delete-midi-notes",
    "update-midi-notes",
    "rebase-midi-clip-content"
  ].includes(command.type)
}

export async function persistMidiCommand(
  tx: ProjectTransaction,
  command: MidiCommand
): Promise<void> {
  switch (command.type) {
    case "create-midi-source":
      await tx.insert(midiSources).values(command.source)
      return
    case "delete-midi-source":
      await tx.delete(midiSources).where(eq(midiSources.id, command.source.id))
      return
    case "create-midi-clip":
      await insertClip(tx, command.clip)
      return
    case "delete-midi-clip":
      await tx.delete(midiClips).where(eq(midiClips.id, command.clipId))
      return
    case "move-midi-clip":
      await tx
        .update(midiClips)
        .set({ trackId: command.trackId, startTick: command.startTick })
        .where(eq(midiClips.id, command.clipId))
      return
    case "update-midi-clip-range": {
      const patch = rangePatch(command.patch)
      if (Object.keys(patch).length > 0) {
        await tx.update(midiClips).set(patch).where(eq(midiClips.id, command.clipId))
      }
      return
    }
    case "create-midi-notes":
      await insertNotes(tx, command.clipId, command.notes)
      return
    case "delete-midi-notes":
      for (const ids of midiBatches(command.noteIds, 1, 1)) {
        await tx
          .delete(midiNotes)
          .where(and(eq(midiNotes.clipId, command.clipId), inArray(midiNotes.id, ids)))
      }
      return
    case "update-midi-notes":
      await updateNotes(tx, command.clipId, command.updates)
      return
    case "rebase-midi-clip-content":
      await rebaseMidiClipContent(tx, command.clipId, command.deltaTicks)
  }
}
