import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { afterEach, describe, expect, it } from "vitest"
import { LiveArchiveFormatError, LiveDatabase } from "../live-node"
import { buildLiveTemplateArchive } from "../live-template"
import { ProjectDatabase, StudioArchiveFormatError } from "../node"
import { buildProjectTemplateArchive } from "../template"

const migrations = fileURLToPath(new URL("../../drizzle-live", import.meta.url))
const studioMigrations = fileURLToPath(new URL("../../drizzle", import.meta.url))
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

async function fixture(): Promise<{ root: string; template: string }> {
  const root = await mkdtemp(join(tmpdir(), "heron-live-db-"))
  temporaryDirectories.push(root)
  const template = join(root, "live-template.pglite.gz")
  await buildLiveTemplateArchive(template, migrations)
  return { root, template }
}

describe("Live database lineage", () => {
  it("creates and reopens a root Mixer without Studio timeline tables", async () => {
    const { root, template } = await fixture()
    const database = await LiveDatabase.create(
      join(root, "working"),
      { name: "Stage", sampleRate: 48_000, audio: null, enabledMidiDeviceIds: [] },
      template
    )
    const graph = await database.mixerSnapshot()
    expect(graph.channels.map((channel) => channel.kind)).toEqual(["audio", "master", "output"])
    expect(graph.channels[0]).toMatchObject({
      inputMonitoring: false,
      outputChannelId: "output-1-2"
    })
    expect(graph.channels[0]).not.toHaveProperty("recordArmed")
    const archive = join(root, "stage.hrl")
    await database.dump(archive)
    await database.close()

    const reopened = await LiveDatabase.open(join(root, "reopened"), archive)
    expect(await reopened.configuration()).toEqual({
      name: "Stage",
      sampleRate: 48_000,
      audio: null,
      enabledMidiDeviceIds: []
    })
    expect(await reopened.mixerSnapshot()).toEqual(graph)
    await reopened.close()

    const client = new PGlite(join(root, "reopened"))
    try {
      const tables = await client.query<{ tablename: string }>(
        "select tablename from pg_tables where schemaname = 'public'"
      )
      const names = tables.rows.map((row) => row.tablename)
      expect(names).toContain("live_document")
      expect(names).not.toContain("tracks")
      expect(names).not.toContain("audio_clips")
      expect(names).not.toContain("midi_clips")
      expect(names).not.toContain("assets")
      expect(names).not.toContain("tempo_events")
      const channelColumns = await client.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'mixer_channels'"
      )
      expect(channelColumns.rows.map((row) => row.column_name)).not.toContain("system_role")
      expect(channelColumns.rows.map((row) => row.column_name)).not.toContain("record_armed")
    } finally {
      await client.close()
    }
  })

  it("rejects a missing Live marker before migration", async () => {
    const { root } = await fixture()
    const unrelated = new PGlite(join(root, "unrelated"))
    await unrelated.close()
    await expect(LiveDatabase.open(join(root, "unrelated"))).rejects.toMatchObject({
      code: "format-mismatch"
    } satisfies Partial<LiveArchiveFormatError>)
  })

  it("rejects a newer Live format with a distinct error", async () => {
    const { root, template } = await fixture()
    const path = join(root, "newer")
    const document = await LiveDatabase.create(
      path,
      {
        name: "Future",
        sampleRate: 48_000,
        audio: null,
        enabledMidiDeviceIds: []
      },
      template
    )
    await document.close()
    const client = new PGlite(path)
    await client.exec("update live_document set format_version = 999 where id = 'document'")
    await client.close()
    await expect(LiveDatabase.open(path)).rejects.toMatchObject({
      code: "unsupported-version"
    } satisfies Partial<LiveArchiveFormatError>)
  })

  it("commits a revisioned Mixer baseline atomically and rolls back invalid edits", async () => {
    const { root, template } = await fixture()
    const database = await LiveDatabase.create(
      join(root, "working"),
      { name: "Stage", sampleRate: 48_000, audio: null, enabledMidiDeviceIds: [] },
      template
    )
    try {
      const baseline = { graph: await database.mixerSnapshot(), parameterValues: [] }
      const changed = structuredClone(baseline)
      changed.graph.channels.find((channel) => channel.id === "audio-1")!.gainDb = -7
      expect(await database.replaceBaseline(changed, [], 0)).toBe(1)
      expect(
        (await database.mixerSnapshot()).channels.find((channel) => channel.id === "audio-1")
          ?.gainDb
      ).toBe(-7)
      await expect(database.replaceBaseline(baseline, [], 0)).rejects.toMatchObject({
        code: "revision-conflict"
      })
      const invalid = structuredClone(changed)
      invalid.graph.channels.find((channel) => channel.id === "audio-1")!.gainDb = 100
      await expect(database.replaceBaseline(invalid, [], 1)).rejects.toThrow()
      expect(await database.revision()).toBe(1)
      expect(
        (await database.mixerSnapshot()).channels.find((channel) => channel.id === "audio-1")
          ?.gainDb
      ).toBe(-7)
    } finally {
      await database.close()
    }
  })

  it("routes archive contents by kind before either migration lineage runs", async () => {
    const { root, template } = await fixture()
    const live = await LiveDatabase.create(
      join(root, "live-work"),
      { name: "Live", sampleRate: 48_000, audio: null, enabledMidiDeviceIds: [] },
      template
    )
    const liveArchive = join(root, "live.hrl")
    await live.dump(liveArchive)
    await live.close()
    await expect(
      ProjectDatabase.open(join(root, "wrong-studio"), liveArchive)
    ).rejects.toMatchObject({
      code: "format-mismatch"
    } satisfies Partial<StudioArchiveFormatError>)

    const studioTemplate = join(root, "studio-template.pglite.gz")
    await buildProjectTemplateArchive(studioTemplate, studioMigrations)
    const studio = await ProjectDatabase.create(
      join(root, "studio-work"),
      {
        name: "Studio",
        sampleRate: 48_000,
        numerator: 4,
        denominator: 4,
        waveformDisplayMode: "separate"
      },
      studioTemplate
    )
    const studioArchive = join(root, "studio.hrs")
    await studio.dumpTo(studioArchive)
    await studio.close()
    await expect(LiveDatabase.open(join(root, "wrong-live"), studioArchive)).rejects.toMatchObject({
      code: "format-mismatch"
    } satisfies Partial<LiveArchiveFormatError>)
  }, 30_000)
})
