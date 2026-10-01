import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import type { LiveHierarchy, LiveRuntimeSnapshot } from "@heron/contracts"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { LiveDatabase } from "../live-node"
import { LIVE_FORMAT_VERSION } from "../live-schema"
import { buildLiveTemplateArchive } from "../live-template"

const migrations = fileURLToPath(new URL("../../drizzle-live", import.meta.url))
const configuration = {
  name: "Tour",
  sampleRate: 48_000,
  audio: null,
  enabledMidiDeviceIds: []
}
let directory: string
let template: string

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "heron-live-hierarchy-"))
  template = join(directory, "live-template.pglite.gz")
  await buildLiveTemplateArchive(template, migrations)
}, 60_000)

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

function hierarchy(): LiveHierarchy {
  return {
    sets: [
      {
        id: "set",
        name: "First Set",
        sortOrder: 0,
        overrides: [{ type: "channel", id: "audio-1", parameter: "gainDb", value: -9 }]
      }
    ],
    patches: [
      {
        id: "patch",
        setId: "set",
        name: "Opening",
        sortOrder: 0,
        overrides: [{ type: "channel", id: "audio-1", parameter: "pan", value: 0.25 }]
      }
    ]
  }
}

async function baseline(database: LiveDatabase): Promise<LiveRuntimeSnapshot> {
  return {
    graph: await database.mixerSnapshot(),
    parameterValues: await database.pluginParameterValues()
  }
}

describe("Live Set and Patch persistence", () => {
  it("preserves layers across root writes, working-copy recovery and archive reopen", async () => {
    const path = join(directory, "working")
    let database = await LiveDatabase.create(path, configuration, template)
    try {
      expect(await database.hierarchy()).toEqual({ sets: [], patches: [] })
      const root = await baseline(database)
      const layers = hierarchy()
      expect(await database.replaceBaseline(root, [], 0, layers)).toBe(1)
      root.graph.channels.find((channel) => channel.id === "audio-1")!.gainDb = -3
      // Existing Mixer-only callers must keep every Set/Patch override.
      expect(await database.replaceBaseline(root, [], 1)).toBe(2)
      expect(await database.hierarchy()).toEqual(layers)
      await database.close()
      database = await LiveDatabase.open(path)
      expect(await database.hierarchy()).toEqual(layers)
      expect(await database.revision()).toBe(2)
      expect(await baseline(database)).toEqual(root)
      const archive = join(directory, "tour.hrl")
      await database.dump(archive)
      const reopened = await LiveDatabase.open(join(directory, "archive"), archive)
      try {
        expect(await reopened.hierarchy()).toEqual(layers)
        expect(await reopened.revision()).toBe(2)
        expect(await baseline(reopened)).toEqual(root)
      } finally {
        await reopened.close()
      }
    } finally {
      await database.close()
    }
  }, 30_000)

  it("rolls back root, layers and revision when overrides or retained targets are invalid", async () => {
    const database = await LiveDatabase.create("memory://", configuration, template)
    try {
      const root = await baseline(database)
      const layers = hierarchy()
      await database.replaceBaseline(root, [], 0, layers)
      const changed = structuredClone(root)
      changed.graph.channels.find((channel) => channel.id === "audio-1")!.gainDb = -4
      const invalidOverride = hierarchy()
      invalidOverride.patches[0]!.overrides[0]!.value = 10
      await expect(database.replaceBaseline(changed, [], 1, invalidOverride)).rejects.toThrow()
      const danglingParent = hierarchy()
      danglingParent.patches[0]!.setId = "missing"
      await expect(database.replaceBaseline(changed, [], 1, danglingParent)).rejects.toThrow()
      await expect(database.replaceBaseline(changed, [], 0, layers)).rejects.toMatchObject({
        code: "revision-conflict"
      })
      const removedTarget = structuredClone(root)
      removedTarget.graph.channels = root.graph.channels.filter(
        (channel) => channel.id !== "audio-1"
      )
      await expect(database.replaceBaseline(removedTarget, [], 1)).rejects.toThrow()
      expect(await database.revision()).toBe(1)
      expect(await baseline(database)).toEqual(root)
      expect(await database.hierarchy()).toEqual(layers)

      // Explicitly removing the hierarchy permits removal of the former target.
      expect(await database.replaceBaseline(removedTarget, [], 1, { sets: [], patches: [] })).toBe(
        2
      )
      expect(await database.hierarchy()).toEqual({ sets: [], patches: [] })
    } finally {
      await database.close()
    }
  })

  it("rolls back an SQL failure after root and Set replacement have begun", async () => {
    const database = await LiveDatabase.create("memory://", configuration, template)
    try {
      const root = await baseline(database)
      const layers = hierarchy()
      await database.replaceBaseline(root, [], 0, layers)
      const changed = structuredClone(root)
      changed.graph.channels.find((channel) => channel.id === "audio-1")!.gainDb = -4
      const invalidStorage = hierarchy()
      // Valid domain integer, outside PostgreSQL's declared integer storage.
      invalidStorage.patches[0]!.sortOrder = 2 ** 31
      await expect(database.replaceBaseline(changed, [], 1, invalidStorage)).rejects.toThrow()
      expect(await database.revision()).toBe(1)
      expect(await baseline(database)).toEqual(root)
      expect(await database.hierarchy()).toEqual(layers)
    } finally {
      await database.close()
    }
  })

  it("rejects an archive with a broken persisted override before publishing its hierarchy", async () => {
    const path = join(directory, "corrupt")
    const database = await LiveDatabase.create(path, configuration, template)
    await database.replaceBaseline(await baseline(database), [], 0, hierarchy())
    await database.close()
    const client = new PGlite(path)
    try {
      await client.query("update live_patches set overrides = $1 where id = $2", [
        JSON.stringify([{ type: "channel", id: "missing", parameter: "gainDb", value: -3 }]),
        "patch"
      ])
    } finally {
      await client.close()
    }
    await expect(LiveDatabase.open(path)).rejects.toBeInstanceOf(TypeError)
  })

  it("upgrades root-only archives without data loss and marks the format for older writers", async () => {
    const legacyMigrations = join(directory, "legacy-migrations")
    await mkdir(join(legacyMigrations, "meta"), { recursive: true })
    const journal = JSON.parse(
      await readFile(join(migrations, "meta", "_journal.json"), "utf8")
    ) as {
      entries: Array<{ idx: number; tag: string }>
    }
    journal.entries = journal.entries.filter((entry) => entry.idx < 2)
    await writeFile(join(legacyMigrations, "meta", "_journal.json"), JSON.stringify(journal))
    await Promise.all(
      journal.entries.map((entry) =>
        copyFile(join(migrations, `${entry.tag}.sql`), join(legacyMigrations, `${entry.tag}.sql`))
      )
    )
    const legacyTemplate = join(directory, "legacy-template.pglite.gz")
    await buildLiveTemplateArchive(legacyTemplate, legacyMigrations)
    const legacyPath = join(directory, "legacy")
    const legacy = await LiveDatabase.create("memory://", configuration, legacyTemplate)
    const root = await baseline(legacy)
    const legacyArchive = join(directory, "legacy.hrl")
    await legacy.dump(legacyArchive)
    await legacy.close()
    const upgraded = await LiveDatabase.open(legacyPath, legacyArchive)
    try {
      expect(await upgraded.hierarchy()).toEqual({ sets: [], patches: [] })
      expect(await baseline(upgraded)).toEqual(root)
      expect(await upgraded.configuration()).toEqual(configuration)
      expect(await upgraded.revision()).toBe(0)
    } finally {
      await upgraded.close()
    }
    const client = new PGlite(legacyPath)
    try {
      const { rows } = await client.query<{ format_version: number }>(
        "select format_version from live_document where id = 'document'"
      )
      expect(rows).toEqual([{ format_version: LIVE_FORMAT_VERSION }])
      expect(rows[0]!.format_version).toBeGreaterThan(1)
    } finally {
      await client.close()
    }
    // Reapplying current migrations must keep the upgrade and all root data.
    const reopened = await LiveDatabase.open(legacyPath)
    try {
      expect(await reopened.hierarchy()).toEqual({ sets: [], patches: [] })
      expect(await baseline(reopened)).toEqual(root)
    } finally {
      await reopened.close()
    }
  }, 30_000)
})
