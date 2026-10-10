import { createHash } from "node:crypto"
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { gzipSync } from "node:zlib"
import type { PluginDescriptor } from "@heron/contracts"
import type { ProjectDatabase as Database } from "../../../node"

// This generator executes the archived packages, including their workspace
// contracts/model aliases. See agents/docs/legacy-builtin-project-fixture.md.
const sourceCommit = "3bb8209aaaccce6fb5ab1e27e725c58a8cc0e5e6"
const sourceTrees = {
  "packages/project-db": "889ff8aadf332d40bc7cf35c4b2ae1fa9db8f480",
  "packages/contracts": "f3a610dd60e1bc27142aef649845d48da7a606b1",
  "packages/project-model": "7233cb14f9cc5a5df246f3a7d5540ffc20aa4310"
}
function gitObject(kind: "tree" | "blob", bytes: Buffer): Buffer {
  return createHash("sha1").update(`${kind} ${bytes.length}\0`).update(bytes).digest()
}
async function sourceTree(directory: string): Promise<Buffer> {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.name !== "node_modules")
    .sort((left, right) =>
      Buffer.compare(
        Buffer.from(left.name + (left.isDirectory() ? "/" : "")),
        Buffer.from(right.name + (right.isDirectory() ? "/" : ""))
      )
    )
  const records: Buffer[] = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    const mode = entry.isDirectory()
      ? "40000"
      : entry.isSymbolicLink()
        ? "120000"
        : ((await lstat(path)).mode & 0o111) !== 0
          ? "100755"
          : "100644"
    const hash = entry.isDirectory()
      ? await sourceTree(path)
      : gitObject(
          "blob",
          entry.isSymbolicLink() ? Buffer.from(await readlink(path)) : await readFile(path)
        )
    records.push(Buffer.from(`${mode} ${entry.name}\0`), hash)
  }
  return gitObject("tree", Buffer.concat(records))
}
const fixtureDirectory = dirname(fileURLToPath(import.meta.url))
const { values } = parseArgs({
  options: { source: { type: "string" }, output: { type: "string" } }
})
if (!values.source) throw new Error("Pass --source pointing to the git-archived Heron source")
const source = resolve(values.source)
const output = resolve(values.output ?? fixtureDirectory)
if ((await readFile(join(source, "VERSION"), "utf8")).trim() !== "0.6.4")
  throw new Error("This fixture must be generated with the archived Heron 0.6.4 source")
for (const [path, expected] of Object.entries(sourceTrees)) {
  if ((await sourceTree(join(source, path))).toString("hex") !== expected)
    throw new Error(`The archived ${path} source does not match ${sourceCommit}`)
}

const { ProjectDatabase } = (await import(
  pathToFileURL(join(source, "packages/project-db/src/node.ts")).href
)) as unknown as typeof import("../../../node")
const { buildProjectTemplateArchive } = (await import(
  pathToFileURL(join(source, "packages/project-db/src/template.ts")).href
)) as unknown as typeof import("../../../template")
const { PROJECT_MIGRATIONS_FOLDER } = (await import(
  pathToFileURL(join(source, "packages/project-db/src/migrations.ts")).href
)) as unknown as typeof import("../../../migrations")
const working = await mkdtemp(join(tmpdir(), "heron-legacy-builtins-"))
let database: Database | undefined
try {
  const template = join(working, "template.pglite.gz")
  await buildProjectTemplateArchive(template, PROJECT_MIGRATIONS_FOLDER)
  database = await ProjectDatabase.create(
    join(working, "pgdata"),
    {
      name: "Heron 0.6.4 built-in migration fixture",
      sampleRate: 48_000,
      numerator: 4,
      denominator: 4,
      waveformDisplayMode: "separate"
    },
    template
  )
  const graph = await database.mixerSnapshot()
  const metronome = graph.plugins.find((plugin) => plugin.id === "metronome-instrument")
  if (!metronome) throw new Error("The original database did not seed the metronome")
  const instrument = graph.channels.find((channel) => channel.id === "metronome")
  if (!instrument) throw new Error("The original database did not seed the instrument channel")
  await database.applyCommand(
    {
      type: "create-channel",
      channel: {
        ...instrument,
        id: "legacy-sine-channel",
        name: "Legacy Sine",
        systemRole: null,
        sortOrder: 1,
        muted: false
      }
    },
    "output-1-2"
  )

  for (const spec of [
    {
      slug: "gain",
      name: "Heron Gain",
      nativeId: "46774F504DF84B4AC1F308AB88DD3677",
      channelId: "audio-1",
      role: "insert",
      kind: "effect"
    },
    {
      slug: "sine",
      name: "Heron Sine",
      nativeId: "C1351DFA4DDD4B4AC1F30896F6D9DF76",
      channelId: "legacy-sine-channel",
      role: "instrument",
      kind: "instrument"
    }
  ] as const) {
    const locator = {
      format: "vst3" as const,
      artifactPath: `${spec.name}.vst3`,
      nativeId: spec.nativeId
    }
    const outputBus = metronome.descriptor.buses[0]
    if (!outputBus) throw new Error("The original metronome descriptor has no output bus")
    const descriptor: PluginDescriptor = {
      ...metronome.descriptor,
      source: { kind: "builtin", id: `live.minori.heron.${spec.slug}` },
      locator,
      name: spec.name,
      version: "0.6.4",
      kind: spec.kind,
      categories: spec.kind === "effect" ? ["Fx"] : ["Instrument", "Synth"],
      buses:
        spec.kind === "effect"
          ? [
              {
                ...outputBus,
                portKey: "vst3:audio:input:0",
                direction: "input",
                name: "Stereo In"
              },
              outputBus
            ]
          : [outputBus],
      supportedAudioModes: ["stereo"]
    }
    await database.applyCommand(
      {
        type: "create-plugin",
        plugin: {
          id: `legacy-${spec.slug}`,
          channelId: spec.channelId,
          role: spec.role,
          slotOrder: 0,
          locator,
          descriptor,
          audioMode: "stereo",
          enabled: true,
          sidechainInputs: [],
          state: { version: 1, chunks: [] }
        }
      },
      "output-1-2"
    )
  }
  const samples = [
    { slug: "gain", id: "legacy-gain" },
    { slug: "sine", id: "legacy-sine" },
    { slug: "metronome", id: "metronome-instrument" }
  ]
  await database.savePluginStates(
    await Promise.all(
      samples.map(async ({ slug, id }) => ({
        id,
        state: {
          version: 1 as const,
          chunks: [
            {
              key: "component",
              bytes: new Uint8Array(await readFile(join(fixtureDirectory, `${slug}.pluginstate`)))
            },
            { key: "controller", bytes: new Uint8Array() }
          ]
        }
      }))
    )
  )
  const archivePath = join(working, "legacy-builtins-0.6.4.hrs")
  await database.dumpTo(archivePath)
  const archive = await readFile(archivePath)
  const compressed = gzipSync(archive, { level: 9 })
  await mkdir(output, { recursive: true })
  await writeFile(join(output, "legacy-builtins-0.6.4.hrs.gz"), compressed)
  const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
  const provenance = {
    schemaVersion: 1,
    heronVersion: "0.6.4",
    sourceCommit,
    sourceTrees,
    generatedBy:
      "Original ProjectDatabase.create/applyCommand/savePluginStates/dumpTo; lossless gzip for fixture storage",
    dependencies: { pglite: "0.5.8", drizzleOrm: "0.45.3", truceStateEncoder: "6.3.0" },
    archive: {
      file: "legacy-builtins-0.6.4.hrs.gz",
      sha256: digest(compressed),
      rawSha256: digest(archive),
      rawBytes: archive.length
    },
    states: await Promise.all(
      samples.map(async ({ slug }) => {
        const bytes = await readFile(join(fixtureDirectory, `${slug}.pluginstate`))
        return { file: `${slug}.pluginstate`, sha256: digest(bytes), bytes: bytes.length }
      })
    )
  }
  await writeFile(join(output, "provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`)
  console.log(
    `Saved original-code project fixture: ${archive.length} bytes (${compressed.length} compressed)`
  )
} finally {
  await database?.close()
  await rm(working, { recursive: true, force: true })
}
