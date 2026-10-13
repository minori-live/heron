import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { access, readFile, readdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { cargoHost } from "../../../scripts/cargo-host.ts"
import {
  currentPluginPlatform,
  parseBundleManifest,
  parsePluginLock
} from "../../../scripts/plugin-artifact-contract.ts"
import { validateRevoxResources } from "../../../scripts/plugin-revox-resources.ts"
import { runTask } from "../../../scripts/task-process.ts"

const workspace = resolve(import.meta.dirname, "../../..")

async function packagedPlugins(): Promise<string> {
  const release = join(workspace, "release")
  const candidates: string[] = []
  for (const entry of await readdir(release, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const resources =
      process.platform === "darwin"
        ? join(release, entry.name, "Heron.app", "Contents", "Resources")
        : join(release, entry.name, "resources")
    try {
      await access(join(resources, "app.asar"))
      candidates.push(join(resources, "plugins"))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
  assert.equal(candidates.length, 1, "Expected exactly one packaged application")
  const candidate = candidates[0]
  assert.ok(candidate, "Expected a packaged application resource path")
  return candidate
}

async function fileDigests(root: string, relative = ""): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const path = join(relative, entry.name)
    if (entry.isDirectory()) Object.assign(result, await fileDigests(root, path))
    else {
      assert.ok(entry.isFile(), `Unexpected packaged plug-in file type: ${path}`)
      const hash = createHash("sha256")
      for await (const chunk of createReadStream(join(root, path))) {
        assert.ok(Buffer.isBuffer(chunk), "Expected binary plug-in file contents")
        hash.update(chunk)
      }
      result[path] = hash.digest("hex")
    }
  }
  return result
}

await runTask(async () => {
  const platform = currentPluginPlatform()
  const lock = parsePluginLock(
    JSON.parse(await readFile(join(workspace, "heron-plugins.lock.json"), "utf8"))
  )
  assert.ok(lock.release, "A published plug-in release must be locked")
  const prepared = join(workspace, "target", "bundles")
  const packaged = await packagedPlugins()
  const manifest = parseBundleManifest(
    JSON.parse(await readFile(join(packaged, "bundle-manifest.json"), "utf8")),
    lock.release,
    platform
  )
  // Heron owns this copy boundary: signing/universal packaging must preserve
  // every producer bundle byte, including its private runtime and notices.
  assert.deepEqual(
    await fileDigests(packaged),
    await fileDigests(prepared),
    "Packaged plug-ins must match the complete prepared release inventory"
  )
  const revox = manifest.plugins.find((plugin) => plugin.builtinId === "live.minori.heron.revox")
  assert.ok(revox, "The packaged built-in suite must include Revox")
  const revoxBundle = join(packaged, revox.bundleName)
  await validateRevoxResources(revoxBundle, platform)
  console.log(`Verified ${manifest.plugins.length} byte-identical packaged plug-in bundles`)
  await cargoHost(
    [
      "test",
      "--locked",
      "-p",
      "heron-audio-host",
      "--test",
      "builtin_revox_bundle",
      "--",
      "--ignored",
      "--test-threads=1",
      "--nocapture"
    ],
    { cwd: workspace, env: { ...process.env, HERON_REVOX_BUNDLE: revoxBundle } }
  )
})
