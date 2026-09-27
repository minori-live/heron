import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PGlite, types } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { MidiClipState, PluginInstanceState, ProjectCommand } from "@heron/contracts"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { ProjectDatabase } from "../node"
import { migrateProjectDatabase } from "../migrations"
import * as schema from "../schema"
import { readProjectGraphSnapshot } from "../internal/project-reads"
import { SnapshotPayloadCache } from "../internal/snapshot-payload-cache"

let templateDirectory: string
let templatePath: string
let database: ProjectDatabase
let client: PGlite
let databaseClosed = true

const clip: MidiClipState = {
  id: "clip",
  sourceId: "source",
  trackId: "track:audio-1",
  name: "MIDI",
  startTick: 0,
  lengthTicks: 960,
  sourceOffsetTicks: 0,
  sourceLengthTicks: 960,
  notes: [
    {
      id: "note",
      startTick: 10,
      durationTicks: 120,
      channel: 0,
      key: 60,
      velocity: 90,
      releaseVelocity: 0
    }
  ],
  events: [
    { id: "event", tick: 0, channel: 0, kind: "control-change", data: new Uint8Array([1, 64]) }
  ]
}

const state = (value: number) => ({
  version: 1 as const,
  chunks: [{ key: "component", bytes: new Uint8Array([value, 2, 3]) }]
})

function apply(command: ProjectCommand) {
  return database.applyCommand(command, "output-1-2")
}

async function insertPlugin(id = "plugin", value = 4): Promise<PluginInstanceState> {
  const metronome = (await database.mixerSnapshot()).plugins.find(
    (plugin) => plugin.id === "metronome-instrument"
  )!
  const plugin: PluginInstanceState = {
    ...metronome,
    id,
    channelId: "audio-1",
    role: "insert",
    state: state(value)
  }
  await apply({ type: "create-plugin", plugin })
  return plugin
}

function pluginBytes(
  graph: Awaited<ReturnType<ProjectDatabase["mixerSnapshot"]>>,
  id = "metronome-instrument"
) {
  return graph.plugins.find((plugin) => plugin.id === id)!.state.chunks[0]!.bytes
}

beforeAll(async () => {
  templateDirectory = await mkdtemp(join(tmpdir(), "heron-snapshot-cache-"))
  templatePath = join(templateDirectory, "template.pglite")
  const templateClient = await PGlite.create()
  try {
    await migrateProjectDatabase(drizzle(templateClient, { schema }))
    const archive = await templateClient.dumpDataDir("none")
    await writeFile(templatePath, Buffer.from(await archive.arrayBuffer()))
  } finally {
    await templateClient.close()
  }
})

beforeEach(async () => {
  database = await ProjectDatabase.create(
    "memory://",
    {
      name: "Cache test",
      sampleRate: 48_000,
      numerator: 4,
      denominator: 4,
      waveformDisplayMode: "separate"
    },
    templatePath
  )
  client = Reflect.get(database, "client") as PGlite
  databaseClosed = false
  await database.importMidi(
    { id: "source", name: "Source", contentHash: "hash", rawBytes: new Uint8Array([1]) },
    { type: "create-midi-clip", clip },
    "output-1-2"
  )
  await database.savePluginStates([{ id: "metronome-instrument", state: state(1) }])
})

afterEach(async () => {
  vi.restoreAllMocks()
  if (!databaseClosed) await database?.close()
})

afterAll(async () => {
  await rm(templateDirectory, { recursive: true, force: true })
})

describe("snapshot payload cache", () => {
  it("lists and finds ordered asset metadata without decoding MIDI source payloads", async () => {
    const backing = new Uint8Array(1_048_576 + 11).fill(5)
    const rawBytes = backing.subarray(7, 7 + 1_048_576)
    const rows = drizzle(client, { schema })
    await rows.insert(schema.midiSources).values([
      { id: "large", name: "Alpha", contentHash: "shared-hash", rawBytes },
      {
        id: "alpha-other",
        name: "Alpha",
        contentHash: "other-hash",
        rawBytes: new Uint8Array([1, 2])
      }
    ])
    const audioMetadata = {
      name: "Audio",
      mimeType: "audio/x-bwf" as const,
      byteLength: 0n,
      sampleRate: 48_000,
      channels: 2,
      bitDepth: "float32" as const,
      frameCount: 0n,
      bwfTimeReference: 0n
    }
    await rows.insert(schema.assets).values([
      {
        ...audioMetadata,
        id: "audio-z",
        contentHash: "shared-hash",
        largeObjectOid: 1,
        createdAt: new Date("2020-01-01T00:00:00Z")
      },
      {
        ...audioMetadata,
        id: "audio-a",
        contentHash: "audio-a-hash",
        largeObjectOid: 2,
        createdAt: new Date("2020-01-01T00:00:00Z")
      },
      {
        ...audioMetadata,
        id: "audio-early",
        contentHash: "audio-early-hash",
        largeObjectOid: 3,
        createdAt: new Date("2019-01-01T00:00:00Z")
      }
    ])
    const parser = client.parsers[types.BYTEA]
    client.parsers[types.BYTEA] = () => {
      throw new Error("Metadata lookup must not decode binary payloads")
    }
    try {
      const listed = await database.listAssets()
      expect(listed.map((asset) => asset.id)).toEqual([
        "audio-early",
        "audio-a",
        "audio-z",
        "alpha-other",
        "large",
        "source"
      ])
      expect(listed.filter((asset) => asset.kind === "midi")).toEqual([
        {
          id: "alpha-other",
          name: "Alpha",
          kind: "midi",
          contentHash: "other-hash",
          byteLength: 2
        },
        {
          id: "large",
          name: "Alpha",
          kind: "midi",
          contentHash: "shared-hash",
          byteLength: rawBytes.byteLength
        },
        { id: "source", name: "Source", kind: "midi", contentHash: "hash", byteLength: 1 }
      ])
      expect(await database.findAssetByContentHash("midi", "shared-hash")).toEqual(listed[4])
      expect(await database.findAssetByContentHash("audio", "shared-hash")).toEqual(listed[2])
      expect(await database.findAssetByContentHash("audio", "other-hash")).toBeNull()
      expect(await database.findAssetByContentHash("midi", "audio-a-hash")).toBeNull()
      expect(await database.findAssetByContentHash("midi", "missing")).toBeNull()
    } finally {
      client.parsers[types.BYTEA] = parser!
    }
  })

  it("reuses payload rows for channel edits while still reading current graph metadata", async () => {
    await database.mixerSnapshot()
    const queries: string[] = []
    const transaction = client.transaction.bind(client)
    vi.spyOn(client, "transaction").mockImplementation((callback) =>
      transaction(async (tx) => {
        const query = vi.spyOn(tx, "query")
        try {
          return await callback(tx)
        } finally {
          queries.push(...query.mock.calls.map(([sql]) => sql))
        }
      })
    )
    const renamed = await apply({
      type: "update-channel",
      channelId: "audio-1",
      patch: { name: "Renamed" }
    })
    expect(renamed.channels.find((channel) => channel.id === "audio-1")?.name).toBe("Renamed")
    expect(renamed.midiClips).toEqual([clip])
    expect(pluginBytes(renamed)).toEqual(new Uint8Array([1, 2, 3]))
    expect(
      queries.some((sql) => /from "(?:midi_notes|midi_events|plugin_state_chunks)"/.test(sql))
    ).toBe(false)
    expect(queries.some((sql) => /from "project"/.test(sql))).toBe(true)
    expect(queries.some((sql) => /from "plugin_instances"/.test(sql))).toBe(true)
  })

  it("isolates returned note, event, and plugin bytes from later snapshots", async () => {
    const first = await database.mixerSnapshot()
    first.midiClips[0]!.notes[0]!.velocity = 1
    first.midiClips[0]!.events[0]!.data[0] = 99
    pluginBytes(first)[0] = 99
    const next = await apply({ type: "update-project-notes", notes: "saved" })
    expect(next.midiClips).toEqual([clip])
    expect(pluginBytes(next)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it("copies Buffer-backed cached payloads instead of exposing Buffer slices", async () => {
    const payloads = new SnapshotPayloadCache()
    payloads.notes = []
    payloads.events = [{ ...clip.events[0]!, clipId: clip.id, data: Buffer.from([1, 64]) }]
    payloads.pluginChunks = [
      { pluginId: "metronome-instrument", chunkKey: "component", bytes: Buffer.from([1, 2, 3]) }
    ]
    const first = await readProjectGraphSnapshot(drizzle(client, { schema }), payloads)
    first.midiClips[0]!.events[0]!.data[0] = 99
    pluginBytes(first)[0] = 99
    expect(Array.from(payloads.events[0]!.data)).toEqual([1, 64])
    expect(Array.from(payloads.pluginChunks[0]!.bytes)).toEqual([1, 2, 3])
  })

  it("refreshes MIDI mutations, including nested batches and clip deletion/recreation", async () => {
    await database.mixerSnapshot()
    const extra = { ...clip.notes[0]!, id: "extra", startTick: 20 }
    const added = await apply({
      type: "batch",
      commands: [
        { type: "create-midi-notes", clipId: clip.id, notes: [extra] },
        {
          type: "batch",
          commands: [
            {
              type: "update-midi-notes",
              clipId: clip.id,
              updates: [{ noteId: "note", patch: { velocity: 70 } }]
            }
          ]
        }
      ]
    })
    expect(added.midiClips[0]!.notes).toEqual([{ ...clip.notes[0], velocity: 70 }, extra])
    const removed = await apply({ type: "delete-midi-notes", clipId: clip.id, noteIds: ["extra"] })
    expect(removed.midiClips[0]!.notes).toHaveLength(1)
    const shifted = await apply({
      type: "rebase-midi-clip-content",
      clipId: clip.id,
      deltaTicks: 5
    })
    expect(shifted.midiClips[0]!.notes[0]!.startTick).toBe(15)
    expect(shifted.midiClips[0]!.events[0]!.tick).toBe(5)
    expect((await apply({ type: "delete-midi-clip", clipId: clip.id })).midiClips).toEqual([])
    const recreated = await apply({
      type: "create-midi-clip",
      clip: { ...clip, notes: [extra], events: [] }
    })
    expect(recreated.midiClips[0]!.notes).toEqual([extra])
    expect(recreated.midiClips[0]!.events).toEqual([])
  })

  it("refreshes only changed clips and preserves other clips and per-clip ordering", async () => {
    const other: MidiClipState = {
      ...clip,
      id: "other",
      startTick: 960,
      notes: [{ ...clip.notes[0]!, id: "other-note", velocity: 30 }],
      events: [{ ...clip.events[0]!, id: "other-event", data: new Uint8Array([2, 80]) }]
    }
    await apply({ type: "create-midi-clip", clip: other })
    await apply({
      type: "create-midi-notes",
      clipId: clip.id,
      notes: [{ ...clip.notes[0]!, id: "late-note", startTick: 50 }]
    })
    await database.mixerSnapshot()
    const queries: Array<{ sql: string; parameters: unknown[] }> = []
    const transaction = client.transaction.bind(client)
    vi.spyOn(client, "transaction").mockImplementation((callback) =>
      transaction(async (tx) => {
        const query = vi.spyOn(tx, "query")
        try {
          return await callback(tx)
        } finally {
          queries.push(
            ...query.mock.calls.map(([sql, parameters]) => ({ sql, parameters: parameters ?? [] }))
          )
        }
      })
    )
    const changed = await apply({
      type: "update-midi-notes",
      clipId: clip.id,
      updates: [{ noteId: "note", patch: { startTick: 70 } }]
    })
    expect(
      changed.midiClips.find((value) => value.id === clip.id)!.notes.map((note) => note.id)
    ).toEqual(["late-note", "note"])
    expect(changed.midiClips.find((value) => value.id === other.id)).toEqual(other)
    const noteReads = queries.filter(({ sql }) => /from "midi_notes"/.test(sql))
    expect(noteReads).toHaveLength(1)
    expect(noteReads[0]!.parameters).toEqual([clip.id])
    expect(noteReads[0]!.sql).toContain('where "midi_notes"."clip_id"')
    expect(queries.some(({ sql }) => /from "midi_events"/.test(sql))).toBe(false)

    queries.length = 0
    const rebased = await apply({
      type: "rebase-midi-clip-content",
      clipId: clip.id,
      deltaTicks: 5
    })
    expect(
      rebased.midiClips.find((value) => value.id === clip.id)!.notes.map((note) => note.startTick)
    ).toEqual([55, 75])
    expect(rebased.midiClips.find((value) => value.id === clip.id)!.events[0]!.tick).toBe(5)
    expect(rebased.midiClips.find((value) => value.id === other.id)).toEqual(other)
    const payloadReads = queries.filter(({ sql }) => /from "(?:midi_notes|midi_events)"/.test(sql))
    expect(payloadReads).toHaveLength(2)
    expect(payloadReads.map(({ parameters }) => parameters)).toEqual([[clip.id], [clip.id]])

    await apply({ type: "delete-midi-clip", clipId: clip.id })
    const recreated = await apply({
      type: "create-midi-clip",
      clip: { ...clip, notes: [], events: [] }
    })
    expect(recreated.midiClips).toEqual([{ ...clip, notes: [], events: [] }, other])
  })

  it("isolates dirty clip sets between forks and bounds a very wide invalidation", async () => {
    const rows = drizzle(client, { schema })
    const published = new SnapshotPayloadCache()
    const before = await readProjectGraphSnapshot(rows, published)
    const tentative = published.fork({ type: "delete-midi-clip", clipId: clip.id })
    const sibling = tentative.fork({ type: "delete-midi-clip", clipId: "other" })
    expect([...published.dirtyNoteClipIds]).toEqual([])
    expect([...published.dirtyEventClipIds]).toEqual([])
    expect([...tentative.dirtyNoteClipIds]).toEqual([clip.id])
    expect([...tentative.dirtyEventClipIds]).toEqual([clip.id])
    expect([...sibling.dirtyNoteClipIds]).toEqual([clip.id, "other"])

    const wide = published.fork({
      type: "batch",
      commands: Array.from({ length: 65_536 }, (_, index) => ({
        type: "delete-midi-clip",
        clipId: `unloaded-${index}`
      }))
    })
    const query = vi.spyOn(client, "query")
    const refreshed = await readProjectGraphSnapshot(rows, wide)
    expect(refreshed).toEqual(before)
    expect(
      Math.max(...query.mock.calls.map(([, parameters]) => parameters?.length ?? 0))
    ).toBeLessThan(65_536)
    expect([...published.dirtyNoteClipIds]).toEqual([])
    expect([...wide.dirtyNoteClipIds]).toEqual([])
    expect([...wide.dirtyEventClipIds]).toEqual([])
  })

  it("refreshes plugin saves, updates, replacement, and deletion", async () => {
    await database.mixerSnapshot()
    await database.savePluginStates([{ id: "metronome-instrument", state: state(2) }])
    expect(pluginBytes(await database.mixerSnapshot())[0]).toBe(2)
    await database.saveControlState([{ id: "metronome-instrument", state: state(3) }], [])
    expect(pluginBytes(await database.mixerSnapshot())[0]).toBe(3)
    const plugin = await insertPlugin()
    const updated = await apply({
      type: "update-plugin",
      pluginId: plugin.id,
      patch: { state: state(5) }
    })
    expect(pluginBytes(updated, plugin.id)[0]).toBe(5)
    const replaced = await apply({
      type: "replace-plugin",
      pluginId: plugin.id,
      plugin: { ...plugin, state: state(6) }
    })
    expect(pluginBytes(replaced, plugin.id)[0]).toBe(6)
    const deleted = await apply({ type: "delete-plugin", pluginId: plugin.id })
    expect(deleted.plugins.some((value) => value.id === plugin.id)).toBe(false)
    await insertPlugin(plugin.id, 7)
    expect(pluginBytes(await database.mixerSnapshot(), plugin.id)[0]).toBe(7)
  })

  it("invalidates payloads removed by track cascades before the same IDs are reused", async () => {
    const plugin = await insertPlugin()
    const before = await database.mixerSnapshot()
    const channel = before.channels.find((value) => value.id === "audio-1")!
    const track = before.tracks.find((value) => value.id === "track:audio-1")!
    const deleted = await apply({ type: "delete-track", trackId: track.id })
    expect(deleted.midiClips).toEqual([])
    expect(deleted.plugins.some((value) => value.id === plugin.id)).toBe(false)
    await apply({ type: "create-track", channel, track })
    const recreated = await apply({
      type: "batch",
      commands: [
        { type: "create-midi-clip", clip: { ...clip, notes: [], events: [] } },
        { type: "create-plugin", plugin: { ...plugin, state: state(8) } }
      ]
    })
    expect(recreated.midiClips[0]!.notes).toEqual([])
    expect(recreated.midiClips[0]!.events).toEqual([])
    expect(pluginBytes(recreated, plugin.id)[0]).toBe(8)
  })

  it("does not publish changed payloads from a transaction whose metadata decoding fails", async () => {
    const before = await database.mixerSnapshot()
    const descriptor = before.plugins.find(
      (plugin) => plugin.id === "metronome-instrument"
    )!.descriptor
    await client.query("update plugin_instances set descriptor_snapshot = $1 where id = $2", [
      "{invalid",
      "metronome-instrument"
    ])
    await expect(
      apply({
        type: "batch",
        commands: [
          {
            type: "update-midi-notes",
            clipId: clip.id,
            updates: [{ noteId: "note", patch: { velocity: 110 } }]
          },
          { type: "update-plugin", pluginId: "metronome-instrument", patch: { state: state(9) } }
        ]
      })
    ).rejects.toThrow(SyntaxError)
    await client.query("update plugin_instances set descriptor_snapshot = $1 where id = $2", [
      JSON.stringify(descriptor),
      "metronome-instrument"
    ])
    const after = await database.mixerSnapshot()
    expect(after.midiClips).toEqual(before.midiClips)
    expect(pluginBytes(after)).toEqual(pluginBytes(before))

    await client.exec("delete from project")
    await expect(
      apply({ type: "update-channel", channelId: "audio-1", patch: { name: "Must roll back" } })
    ).rejects.toThrow("Project configuration is missing")
    expect(
      (await client.query<{ name: string }>("select name from mixer_channels where id = 'audio-1'"))
        .rows
    ).toEqual([{ name: "Audio 1" }])
  })

  it("serializes overlapping snapshots, payload mutations, and later unrelated commands", async () => {
    await database.mixerSnapshot()
    const firstRead = database.mixerSnapshot()
    const firstEdit = apply({
      type: "update-midi-notes",
      clipId: clip.id,
      updates: [{ noteId: "note", patch: { velocity: 75 } }]
    })
    const secondEdit = apply({
      type: "create-midi-notes",
      clipId: clip.id,
      notes: [{ ...clip.notes[0]!, id: "extra", startTick: 20 }]
    })
    const middleRead = database.mixerSnapshot()
    const stateSave = database.savePluginStates([{ id: "metronome-instrument", state: state(7) }])
    const rename = apply({
      type: "update-channel",
      channelId: "audio-1",
      patch: { name: "Concurrent" }
    })
    const finalRead = database.mixerSnapshot()
    const [first, , second, middle, , renamed, last] = await Promise.all([
      firstRead,
      firstEdit,
      secondEdit,
      middleRead,
      stateSave,
      rename,
      finalRead
    ])
    expect(first.midiClips[0]!.notes[0]!.velocity).toBe(90)
    for (const graph of [second, middle, renamed, last]) {
      expect(graph.midiClips[0]!.notes.map((note) => note.id)).toEqual(["note", "extra"])
      expect(graph.midiClips[0]!.notes[0]!.velocity).toBe(75)
    }
    expect(pluginBytes(middle)[0]).toBe(1)
    expect(pluginBytes(renamed)[0]).toBe(7)
    expect(last).toEqual(renamed)

    const finalEdit = apply({
      type: "update-midi-notes",
      clipId: clip.id,
      updates: [{ noteId: "note", patch: { velocity: 65 } }]
    })
    const closing = database.close().then(() => {
      databaseClosed = true
    })
    const [committedBeforeClose] = await Promise.all([finalEdit, closing])
    expect(committedBeforeClose.midiClips[0]!.notes[0]!.velocity).toBe(65)
  })
})
