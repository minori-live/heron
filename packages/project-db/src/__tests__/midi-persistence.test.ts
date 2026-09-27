import { PGlite } from "@electric-sql/pglite"
import { asc, count, eq, inArray } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import type { MidiClipState, MidiNoteState, ProjectCommand } from "@heron/contracts"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { migrateProjectDatabase } from "../migrations"
import * as schema from "../schema"
import { midiClips, midiEvents, midiNotes, midiSources, mixerChannels, tracks } from "../schema"
import { importMidiSource } from "../internal/midi"
import { persistMidiCommand } from "../internal/midi-persistence"
import type { ProjectDb } from "../internal/database-types"

let client: PGlite
let db: ProjectDb
const statements: Array<{ query: string; parameterCount: number }> = []

function note(index: number): MidiNoteState {
  return {
    id: `note-${index}`,
    startTick: index + 10,
    durationTicks: 120,
    channel: 0,
    key: 60,
    velocity: 90,
    releaseVelocity: 0
  }
}

function clip(notes: MidiNoteState[] = [], events: MidiClipState["events"] = []): MidiClipState {
  return {
    id: "clip",
    sourceId: "source",
    trackId: "track",
    name: "Imported MIDI",
    startTick: 0,
    lengthTicks: 100_000,
    sourceOffsetTicks: 0,
    sourceLengthTicks: 100_000,
    notes,
    events
  }
}

function importClip(value: MidiClipState): Promise<void> {
  return importMidiSource(
    db,
    { id: "source", name: "Source", contentHash: "source-hash", rawBytes: new Uint8Array([1]) },
    { type: "create-midi-clip", clip: value },
    "unused-output"
  )
}

function persist(command: Parameters<typeof persistMidiCommand>[1]): Promise<void> {
  return db.transaction((tx) => persistMidiCommand(tx, command))
}

async function storedNotes() {
  return db.select().from(midiNotes).orderBy(asc(midiNotes.id))
}

beforeAll(async () => {
  client = await PGlite.create()
  db = drizzle(client, {
    schema,
    logger: {
      logQuery(query, parameters) {
        statements.push({ query, parameterCount: parameters.length })
      }
    }
  })
  await migrateProjectDatabase(db)
  await db.insert(mixerChannels).values({
    id: "channel",
    kind: "instrument",
    name: "MIDI",
    color: "#4F8CFF",
    sortOrder: 0,
    outputBus: 1
  })
  await db.insert(tracks).values({ id: "track", channelId: "channel", sortOrder: 0 })
})

beforeEach(async () => {
  await db.delete(midiClips)
  await db.delete(midiSources)
  statements.length = 0
})

afterAll(async () => {
  await client?.close()
})

describe("bounded transactional MIDI persistence", () => {
  it("imports notes and events beyond one PostgreSQL bind message", async () => {
    // Eight bound note columns overflow at 8,192 rows; six event columns at 10,923.
    const notes = Array.from({ length: 8_192 }, (_, index) => note(index))
    const events: MidiClipState["events"] = Array.from({ length: 10_923 }, (_, index) => ({
      id: `event-${index}`,
      tick: index,
      channel: 0,
      kind: "control-change",
      data: new Uint8Array([1, index % 128])
    }))
    await importClip(clip(notes, events))

    expect(await db.select({ count: count() }).from(midiNotes)).toEqual([{ count: notes.length }])
    expect(await db.select({ count: count() }).from(midiEvents)).toEqual([{ count: events.length }])
    expect(
      await db
        .select()
        .from(midiNotes)
        .where(eq(midiNotes.id, notes.at(-1)!.id))
    ).toEqual([{ ...notes.at(-1), clipId: "clip" }])
    expect(
      await db
        .select()
        .from(midiEvents)
        .where(eq(midiEvents.id, events.at(-1)!.id))
    ).toEqual([{ ...events.at(-1), clipId: "clip" }])
    expect(Math.max(...statements.map((statement) => statement.parameterCount))).toBeLessThan(
      65_536
    )
  })

  it("rolls back the source, clip, and earlier insert batches when a later note is invalid", async () => {
    const notes = Array.from({ length: 8_192 }, (_, index) => note(index))
    notes.at(-1)!.velocity = 0
    await expect(importClip(clip(notes))).rejects.toThrow()
    expect(await db.select().from(midiSources)).toEqual([])
    expect(await db.select().from(midiClips)).toEqual([])
    expect(await db.select().from(midiNotes)).toEqual([])
    expect(await db.select().from(midiEvents)).toEqual([])
  })

  it("bounds note additions and large deletion lists while keeping other clips untouched", async () => {
    await importClip(clip())
    await persist({ type: "create-midi-clip", clip: { ...clip([note(-1)]), id: "other" } })
    const notes = Array.from({ length: 8_192 }, (_, index) => note(index))
    await persist({ type: "create-midi-notes", clipId: "clip", notes })
    expect(await db.select({ count: count() }).from(midiNotes)).toEqual([{ count: 8_193 }])

    const noteIds = Array.from({ length: 65_536 }, (_, index) => `note-${index - 1}`)
    await persist({ type: "delete-midi-notes", clipId: "clip", noteIds })
    expect(await storedNotes()).toEqual([{ ...note(-1), clipId: "other" }])
    expect(Math.max(...statements.map((statement) => statement.parameterCount))).toBeLessThan(
      65_536
    )
  })

  it("updates common note patches with bounded set-based work and preserves ordered repeated IDs", async () => {
    const notes = Array.from({ length: 1_000 }, (_, index) => note(index))
    await importClip(clip(notes))
    await persist({ type: "create-midi-clip", clip: { ...clip([note(-1)]), id: "other" } })
    statements.length = 0
    await persist({
      type: "update-midi-notes",
      clipId: "clip",
      updates: notes.map((value) => ({ noteId: value.id, patch: { velocity: 70 } }))
    })
    expect(
      await db
        .selectDistinct({ velocity: midiNotes.velocity })
        .from(midiNotes)
        .where(eq(midiNotes.clipId, "clip"))
    ).toEqual([{ velocity: 70 }])
    expect(
      statements.filter((statement) => statement.query.startsWith('update "midi_notes"')).length
    ).toBeLessThanOrEqual(2)

    await persist({
      type: "update-midi-notes",
      clipId: "clip",
      updates: [
        { noteId: "note-0", patch: { velocity: 80 } },
        { noteId: "note-1", patch: { velocity: 80 } },
        { noteId: "note-0", patch: {} },
        { noteId: "note-0", patch: { key: 62 } },
        { noteId: "note-0", patch: { velocity: 60 } },
        { noteId: "note--1", patch: { velocity: 60 } }
      ]
    })
    expect(
      await db
        .select()
        .from(midiNotes)
        .where(inArray(midiNotes.id, ["note-0", "note-1", "note--1"]))
        .orderBy(asc(midiNotes.id))
    ).toEqual([
      { ...note(-1), clipId: "other" },
      { ...note(0), clipId: "clip", key: 62, velocity: 60 },
      { ...note(1), clipId: "clip", velocity: 80 }
    ])
  })

  it("bounds common-patch IDs and rolls back earlier updates after a later invalid patch", async () => {
    await importClip(clip([note(0)]))
    const updates: Extract<ProjectCommand, { type: "update-midi-notes" }>["updates"] = Array.from(
      { length: 65_536 },
      (_, index) => ({
        noteId: `note-${index}`,
        patch: { velocity: 64, releaseVelocity: 12 }
      })
    )
    await persist({ type: "update-midi-notes", clipId: "clip", updates })
    expect(await storedNotes()).toEqual([
      { ...note(0), clipId: "clip", velocity: 64, releaseVelocity: 12 }
    ])
    expect(Math.max(...statements.map((statement) => statement.parameterCount))).toBeLessThan(
      65_536
    )

    await expect(
      persist({
        type: "update-midi-notes",
        clipId: "clip",
        updates: [
          { noteId: "note-0", patch: { velocity: 90 } },
          { noteId: "note-0", patch: { velocity: 0 } },
          { noteId: "note-0", patch: { velocity: 70 } }
        ]
      })
    ).rejects.toThrow()
    expect(await storedNotes()).toEqual([
      { ...note(0), clipId: "clip", velocity: 64, releaseVelocity: 12 }
    ])
  })

  it("rebases only the target clip and rolls back shifted notes when an event would become negative", async () => {
    const events: MidiClipState["events"] = [
      { id: "event", tick: 0, channel: 0, kind: "control-change", data: new Uint8Array([1, 64]) }
    ]
    await importClip(clip([note(0), note(1)], events))
    await persist({ type: "create-midi-clip", clip: { ...clip([note(-1)]), id: "other" } })
    await persist({ type: "rebase-midi-clip-content", clipId: "clip", deltaTicks: 20 })
    expect(await storedNotes()).toEqual([
      { ...note(-1), clipId: "other" },
      { ...note(0), clipId: "clip", startTick: 30 },
      { ...note(1), clipId: "clip", startTick: 31 }
    ])
    expect(await db.select({ tick: midiEvents.tick }).from(midiEvents)).toEqual([{ tick: 20 }])
    await expect(
      persist({ type: "rebase-midi-clip-content", clipId: "clip", deltaTicks: -21 })
    ).rejects.toThrow()
    expect(
      await db
        .select({ startTick: midiNotes.startTick })
        .from(midiNotes)
        .where(eq(midiNotes.clipId, "clip"))
        .orderBy(asc(midiNotes.startTick))
    ).toEqual([{ startTick: 30 }, { startTick: 31 }])
    expect(await db.select({ tick: midiEvents.tick }).from(midiEvents)).toEqual([{ tick: 20 }])
  })
})
