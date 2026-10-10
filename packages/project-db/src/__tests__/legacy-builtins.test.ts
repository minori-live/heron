import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"
import { ProjectDatabase } from "../node"

const fixtures = fileURLToPath(new URL("./fixtures/legacy-builtins/", import.meta.url))
const legacyPlugins = [
  {
    instanceId: "legacy-gain",
    slug: "gain",
    name: "Heron Gain",
    nativeId: "46774F504DF84B4AC1F308AB88DD3677"
  },
  {
    instanceId: "legacy-sine",
    slug: "sine",
    name: "Heron Sine",
    nativeId: "C1351DFA4DDD4B4AC1F30896F6D9DF76"
  },
  {
    instanceId: "metronome-instrument",
    slug: "metronome",
    name: "Heron Metronome",
    nativeId: "8CD16A11027ACC7FDF0C1419E86D1024"
  }
] as const

// This archive was exported by the original database code at 3bb8209, with
// nondefault component bytes captured from that commit's original plug-ins.
// It is a generated compatibility sample, not a claimed user-created project.
it("retains legacy built-in identities and opaque state when reopening and saving an original-code project", async () => {
  const directory = await mkdtemp(join(tmpdir(), "heron-legacy-project-test-"))
  let database: ProjectDatabase | undefined
  try {
    database = await ProjectDatabase.open(
      join(directory, "original"),
      join(fixtures, "legacy-builtins-0.6.4.hrs.gz")
    )
    const original = await database.mixerSnapshot()
    expect(original.plugins).toHaveLength(3)
    for (const legacy of legacyPlugins) {
      const expectedComponent = new Uint8Array(
        await readFile(join(fixtures, `${legacy.slug}.pluginstate`))
      )
      const plugin = original.plugins.find(({ id }) => id === legacy.instanceId)
      const locator = {
        format: "vst3",
        artifactPath: `${legacy.name}.vst3`,
        nativeId: legacy.nativeId
      }
      expect(plugin).toMatchObject({
        locator,
        descriptor: {
          source: { kind: "builtin", id: `live.minori.heron.${legacy.slug}` },
          locator
        },
        state: {
          version: 1,
          chunks: [
            { key: "component", bytes: expectedComponent },
            { key: "controller", bytes: new Uint8Array() }
          ]
        }
      })
    }
    // Saving an unrelated user edit must retain the full legacy plug-in state.
    await database.applyCommand(
      { type: "update-project-notes", notes: "Saved after plug-in repository migration" },
      "output-1-2"
    )
    const saved = join(directory, "resaved.hrs")
    await database.dumpTo(saved)
    await database.close()
    database = undefined
    database = await ProjectDatabase.open(join(directory, "resaved"), saved)
    const reopened = await database.mixerSnapshot()
    expect(reopened.projectNotes).toBe("Saved after plug-in repository migration")
    expect(reopened.plugins).toEqual(original.plugins)
  } finally {
    await database?.close()
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
