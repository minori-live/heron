import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test, { type TestContext } from "node:test"
import { PLUGIN_PLATFORMS, type PluginPlatform } from "./plugin-artifact-contract.ts"
import { validatePluginBinary } from "./plugin-artifact-extract.ts"
import { validateRevoxResources } from "./plugin-revox-resources.ts"
import { revoxResourceFixture } from "./test-support/revox-resource-fixture.ts"

async function bundle(
  context: TestContext,
  platform: PluginPlatform,
  alter: (entries: ReturnType<typeof revoxResourceFixture>) => void = () => {}
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "heron-revox-resources-"))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const entries = revoxResourceFixture(platform)
  alter(entries)
  for (const entry of entries) {
    const path = join(directory, entry.path)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, entry.bytes)
  }
  return directory
}

await test("Revox accepts each platform's bundle-local runtime and embedded model provenance", async (context) => {
  for (const platform of PLUGIN_PLATFORMS) {
    const directory = await bundle(context, platform, (entries) => {
      entries.push({
        path: "Contents/Resources/additional-notice.txt",
        bytes: Buffer.from("extra")
      })
    })
    await validateRevoxResources(directory, platform)
  }
})

await test("Revox cannot be staged without its runtime or with another platform's runtime", async (context) => {
  const missing = await bundle(context, "linux-x64", (entries) => {
    entries.shift()
  })
  await assert.rejects(validateRevoxResources(missing, "linux-x64"))
  const wrongMachine = await bundle(context, "windows-x64", (entries) => {
    assert(entries[0])
    entries[0].bytes.writeUInt16LE(0xaa64, 68)
  })
  await assert.rejects(validateRevoxResources(wrongMachine, "windows-x64"))
})

await test("Revox universal runtime needs both architectures as dylibs without relaxing plug-in bundle types", async (context) => {
  const [runtime] = revoxResourceFixture("macos-universal")
  assert(runtime)
  assert.throws(() => validatePluginBinary(runtime.bytes, "macos-universal"))
  const invalid = await bundle(context, "macos-universal", (entries) => {
    assert(entries[0])
    entries[0].bytes.writeUInt32LE(8, 96 + 12)
  })
  await assert.rejects(validateRevoxResources(invalid, "macos-universal"))
  const duplicate = await bundle(context, "macos-universal", (entries) => {
    assert(entries[0])
    entries[0].bytes.writeUInt32BE(0x01000007, 28)
    entries[0].bytes.writeUInt32LE(0x01000007, 96 + 4)
  })
  await assert.rejects(validateRevoxResources(duplicate, "macos-universal"))
})

await test("Revox rejects missing licensing and incomplete model or runtime provenance", async (context) => {
  const mutations = [
    (entries: ReturnType<typeof revoxResourceFixture>) => {
      entries.splice(
        entries.findIndex((entry) => entry.path.endsWith("FCPE-LICENSE")),
        1
      )
    },
    (entries: ReturnType<typeof revoxResourceFixture>) => {
      entries.find((entry) => entry.path.endsWith("license-selection.json"))!.bytes =
        Buffer.from("{}")
    },
    (entries: ReturnType<typeof revoxResourceFixture>) => {
      entries.find((entry) => entry.path.endsWith("fcpe-plugin-export.json"))!.bytes =
        Buffer.from("{}")
    },
    (entries: ReturnType<typeof revoxResourceFixture>) => {
      const entry = entries.find((entry) => entry.path.endsWith("runtime-source.json"))!
      entry.bytes = Buffer.from(
        JSON.stringify({ ...JSON.parse(entry.bytes.toString()), platform: "linux-arm64" })
      )
    }
  ]
  for (const mutate of mutations) {
    const directory = await bundle(context, "linux-x64", mutate)
    await assert.rejects(validateRevoxResources(directory, "linux-x64"))
  }
})
