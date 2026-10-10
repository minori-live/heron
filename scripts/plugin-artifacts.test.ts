import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises"
import { join, sep } from "node:path"
import { tmpdir } from "node:os"
import test, { type TestContext } from "node:test"
import { crc32 } from "node:zlib"
import {
  parseBundleManifest,
  parsePluginLock,
  PLUGIN_PLATFORMS,
  PLUGIN_REPOSITORY,
  pluginAssetName,
  pluginBinaryPath,
  stablePluginVersion,
  REQUIRED_BUILTINS,
  type PluginLock,
  type PluginRelease
} from "./plugin-artifact-contract.ts"
import { preparePluginArtifacts } from "./plugin-artifact-cache.ts"
import { extractPluginArchive, validatePluginBinary } from "./plugin-artifact-extract.ts"
import { validatePluginSymbols, type PluginDebugInfo } from "./plugin-symbol-validation.ts"
import {
  pluginLockFromRelease,
  updatePluginLock,
  updatePluginLockToLatest
} from "./plugin-release-lock.ts"

interface FixtureEntry {
  path: string
  bytes: Buffer
  mode?: number
}

// A small stored ZIP fixture is enough to exercise our extraction policy.
// ZIP inflation/parser conformance belongs to the dependency.
function zip(entries: FixtureEntry[]): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.path)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50)
    header.writeUInt16LE(20, 4)
    header.writeUInt32LE(crc32(entry.bytes), 14)
    header.writeUInt32LE(entry.bytes.length, 18)
    header.writeUInt32LE(entry.bytes.length, 22)
    header.writeUInt16LE(name.length, 26)
    local.push(header, name, entry.bytes)
    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50)
    record.writeUInt16LE(0x0314, 4)
    record.writeUInt16LE(20, 6)
    record.writeUInt32LE(crc32(entry.bytes), 16)
    record.writeUInt32LE(entry.bytes.length, 20)
    record.writeUInt32LE(entry.bytes.length, 24)
    record.writeUInt16LE(name.length, 28)
    record.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38)
    record.writeUInt32LE(offset, 42)
    central.push(record, name)
    offset += header.length + name.length + entry.bytes.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}

function elf(machine = 62): Buffer {
  const bytes = Buffer.alloc(64)
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1])
  bytes.writeUInt16LE(machine, 18)
  return bytes
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Deferred fixture is not initialized")
  }
  const promise = new Promise<T>((resolver) => {
    resolve = resolver
  })
  return { promise, resolve }
}

const version = "1.0.0"
const sourceCommit = "a".repeat(40)
const platform = "linux-x64" as const

function lockedRelease(
  hash: string,
  suiteVersion = version
): PluginLock & { release: PluginRelease } {
  return {
    schemaVersion: 1,
    repository: PLUGIN_REPOSITORY,
    release: {
      version: suiteVersion,
      sourceCommit,
      assets: Object.fromEntries(
        PLUGIN_PLATFORMS.map((platform) => [
          platform,
          {
            runtime: { file: pluginAssetName(suiteVersion, platform), sha256: hash },
            symbols: { file: pluginAssetName(suiteVersion, platform, true), sha256: hash }
          }
        ])
      ) as PluginRelease["assets"]
    }
  }
}

function runtimeArchive(machine = 62, suiteVersion = version): Buffer {
  return zip([
    {
      path: "bundle-manifest.json",
      bytes: Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          version: suiteVersion,
          sourceCommit,
          platform,
          plugins: REQUIRED_BUILTINS
        })
      )
    },
    ...REQUIRED_BUILTINS.flatMap((plugin) => [
      {
        path: `bundles/${plugin.bundleName}/Contents/x86_64-linux/${plugin.name}.so`,
        bytes: elf(machine),
        mode: 0o100755
      },
      {
        path: `bundles/${plugin.bundleName}/Contents/Resources/LICENSE`,
        bytes: Buffer.from("matching suite license fixture")
      }
    ])
  ])
}

const fixtureSymbolModules = REQUIRED_BUILTINS.map((plugin) => ({
  modulePath: `symbols/${plugin.name}.so`,
  binaryPath: pluginBinaryPath(plugin.bundleName, platform),
  debugId: plugin.nativeId,
  arch: "x64" as const
}))

function symbolsArchive(modules: unknown[] = fixtureSymbolModules): Buffer {
  return zip([
    {
      path: "symbols-manifest.json",
      bytes: Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          version,
          sourceCommit,
          platform,
          format: "vst3",
          modules
        })
      )
    },
    ...REQUIRED_BUILTINS.map((plugin) => ({
      path: `symbols/${plugin.name}.so`,
      bytes: Buffer.from("matching fixture symbols")
    }))
  ])
}

function fixtureDebugInfo(path: string): PluginDebugInfo {
  const plugin = REQUIRED_BUILTINS.find((plugin) => path.includes(plugin.name))
  assert(plugin)
  return {
    variants: [{ debug_id: plugin.nativeId, arch: "x86_64" }],
    is_usable: true,
    features: "symtab, unwind, debug"
  }
}

async function symbolsWorkspace(context: TestContext, archive = symbolsArchive()) {
  const fixture = await workspace(context, archive)
  const runtime = runtimeArchive()
  fixture.lock.release.assets[platform].runtime.sha256 = createHash("sha256")
    .update(runtime)
    .digest("hex")
  await writeFile(join(fixture.root, "heron-plugins.lock.json"), JSON.stringify(fixture.lock))
  return {
    ...fixture,
    fetchArtifact: async (url: string) =>
      new Response(Uint8Array.from(url.endsWith("-symbols.zip") ? archive : runtime))
  }
}

async function workspace(context: TestContext, archive = runtimeArchive()) {
  const root = await mkdtemp(join(tmpdir(), "heron-plugin-artifact-"))
  context.after(() => rm(root, { recursive: true, force: true }))
  const hash = createHash("sha256").update(archive).digest("hex")
  const lock = lockedRelease(hash)
  await writeFile(join(root, "heron-plugins.lock.json"), JSON.stringify(lock))
  return { root, lock, archive, hash }
}

await test("preparation verifies pinned bytes, preserves executable modes and replaces stale bundles", async (context) => {
  const { root, archive } = await workspace(context)
  await mkdir(join(root, "target/bundles/obsolete.vst3"), { recursive: true })
  await writeFile(join(root, "target/bundles/obsolete.vst3/old"), "old")
  const urls: string[] = []
  const destination = await preparePluginArtifacts({
    workspace: root,
    platform,
    fetchArtifact: async (url) => {
      urls.push(url)
      return new Response(Uint8Array.from(archive))
    }
  })
  assert.equal(
    urls[0],
    `https://github.com/${PLUGIN_REPOSITORY}/releases/download/v1.0.0/${pluginAssetName(version, platform)}`
  )
  assert.equal((await readdir(destination)).length, REQUIRED_BUILTINS.length + 1)
  assert.equal(
    JSON.parse(await readFile(join(destination, "bundle-manifest.json"), "utf8")).sourceCommit,
    sourceCommit
  )
  assert.equal(
    await readFile(join(destination, "Heron Gain.vst3/Contents/Resources/LICENSE"), "utf8"),
    "matching suite license fixture"
  )
  if (process.platform !== "win32")
    assert.equal(
      (await stat(join(destination, "Heron Gain.vst3/Contents/x86_64-linux/Heron Gain.so"))).mode &
        0o777,
      0o755
    )
  await preparePluginArtifacts({
    workspace: root,
    platform,
    offline: true,
    fetchArtifact: async () => {
      throw new Error("offline must not request the network")
    }
  })
  assert.equal((await readdir(destination)).length, REQUIRED_BUILTINS.length + 1)
})

await test("failed or interrupted downloads preserve the existing stage and never leave reusable partials", async (context) => {
  const { root } = await workspace(context)
  await mkdir(join(root, "target/bundles"), { recursive: true })
  await writeFile(join(root, "target/bundles/previous"), "known-good")
  for (const response of [
    new Response("wrong bytes"),
    new Response("unavailable", { status: 503 }),
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("interrupted"))
        }
      })
    )
  ]) {
    await assert.rejects(
      preparePluginArtifacts({ workspace: root, platform, fetchArtifact: async () => response })
    )
    assert.equal(await readFile(join(root, "target/bundles/previous"), "utf8"), "known-good")
    assert.deepEqual(await readdir(join(root, "target/plugin-artifacts")), [])
  }
})

await test("corrupted offline caches fail without replacing a stage; online preparation repairs the cache", async (context) => {
  const { root, hash, archive } = await workspace(context)
  await mkdir(join(root, "target/plugin-artifacts"), { recursive: true })
  await writeFile(join(root, "target/plugin-artifacts", `${hash}.zip`), "corrupt")
  await assert.rejects(preparePluginArtifacts({ workspace: root, platform, offline: true }))
  await preparePluginArtifacts({
    workspace: root,
    platform,
    fetchArtifact: async () => new Response(Uint8Array.from(archive))
  })
  await preparePluginArtifacts({ workspace: root, platform, offline: true })
})

await test("an interrupted stage commit restores the previous bundles before a failing download", async (context) => {
  const { root } = await workspace(context)
  await mkdir(join(root, "target/.bundles.previous"), { recursive: true })
  await writeFile(join(root, "target/.bundles.previous/previous"), "recoverable")
  await mkdir(join(root, "target/.heron-plugin-bundles.lock"))
  await writeFile(
    join(root, "target/.heron-plugin-bundles.lock/owner.json"),
    JSON.stringify({ pid: 2147483647 })
  )
  await assert.rejects(
    preparePluginArtifacts({
      workspace: root,
      platform,
      fetchArtifact: async () => new Response("unavailable", { status: 503 })
    })
  )
  assert.equal(await readFile(join(root, "target/bundles/previous"), "utf8"), "recoverable")
  assert(!(await readdir(join(root, "target"))).includes(".bundles.previous"))
  assert(!(await readdir(join(root, "target"))).includes(".heron-plugin-bundles.lock"))
})

await test("uninitialized locks fail before network access or staging", async (context) => {
  const { root } = await workspace(context)
  await writeFile(
    join(root, "heron-plugins.lock.json"),
    JSON.stringify({ schemaVersion: 1, repository: PLUGIN_REPOSITORY, release: null })
  )
  await assert.rejects(
    preparePluginArtifacts({
      workspace: root,
      fetchArtifact: async () => {
        assert.fail("must not download with an uninitialized lock")
      }
    })
  )
  assert.deepEqual((await readdir(root)).sort(), ["heron-plugins.lock.json"])
})

await test("abandoned incomplete staging owners are recoverable", async (context) => {
  const { root, archive } = await workspace(context)
  const lock = join(root, "target/.heron-plugin-bundles.lock")
  for (const owner of ["", '{"pid":', "null", '{"pid":0}']) {
    await mkdir(lock, { recursive: true })
    await writeFile(join(lock, "owner.json"), owner)
    const old = new Date(Date.now() - 120_000)
    await utimes(lock, old, old)
    await preparePluginArtifacts({
      workspace: root,
      platform,
      fetchArtifact: async () => new Response(Uint8Array.from(archive))
    })
    assert(!(await readdir(join(root, "target"))).includes(".heron-plugin-bundles.lock"))
  }
})

await test("a slow preparation cannot overwrite a newer locked and published stage", async (context) => {
  const { root, archive } = await workspace(context)
  const download = deferred<Response>()
  const started = deferred<void>()
  const stale = preparePluginArtifacts({
    workspace: root,
    platform,
    fetchArtifact: async () => {
      started.resolve(undefined)
      return download.promise
    }
  })
  await started.promise
  const updated = runtimeArchive(62, "1.1.0")
  const hash = createHash("sha256").update(updated).digest("hex")
  await writeFile(
    join(root, "heron-plugins.lock.json"),
    JSON.stringify(lockedRelease(hash, "1.1.0"))
  )
  const destination = await preparePluginArtifacts({
    workspace: root,
    platform,
    fetchArtifact: async () => new Response(Uint8Array.from(updated))
  })
  download.resolve(new Response(Uint8Array.from(archive)))
  await assert.rejects(stale, /lock changed/u)
  assert.equal(
    JSON.parse(await readFile(join(destination, "bundle-manifest.json"), "utf8")).version,
    "1.1.0"
  )
  assert(!(await readdir(join(root, "target"))).some((entry) => entry.startsWith(".heron-")))
})

await test("archives cannot escape staging or create symlinks, Windows ADS or ambiguous paths", async (context) => {
  const { root } = await workspace(context)
  const cases: FixtureEntry[][] = [
    [{ path: "../escaped", bytes: Buffer.from("bad") }],
    [{ path: "/absolute", bytes: Buffer.from("bad") }],
    [{ path: "bundles/link", bytes: Buffer.from("../../escaped"), mode: 0o120777 }],
    [{ path: "bundles/file:stream", bytes: Buffer.from("bad") }],
    [{ path: "bundles/CON.txt", bytes: Buffer.from("bad") }],
    [
      { path: "bundles/a", bytes: Buffer.from("bad") },
      { path: "bundles/A", bytes: Buffer.from("bad") }
    ]
  ]
  for (const [index, entries] of cases.entries()) {
    const input = join(root, `bad-${index}.zip`)
    await writeFile(input, zip(entries))
    await assert.rejects(extractPluginArchive(input, join(root, `stage-${index}`)))
  }
  assert(!(await readdir(root)).includes("escaped"))
})

await test("manifest identities and binary architectures are verified before publication", async (context) => {
  const { root, lock, archive } = await workspace(context, runtimeArchive(183))
  await assert.rejects(
    preparePluginArtifacts({
      workspace: root,
      platform,
      fetchArtifact: async () => new Response(Uint8Array.from(archive))
    })
  )
  const manifest = { schemaVersion: 1, version, sourceCommit, platform, plugins: REQUIRED_BUILTINS }
  assert.throws(() =>
    parseBundleManifest({ ...manifest, sourceCommit: "b".repeat(40) }, lock.release, platform)
  )
  assert.throws(() =>
    parseBundleManifest({ ...manifest, platform: "linux-arm64" }, lock.release, platform)
  )
  assert.throws(() =>
    parseBundleManifest(
      { ...manifest, plugins: REQUIRED_BUILTINS.slice(0, 2) },
      lock.release,
      platform
    )
  )
  assert.throws(() =>
    parseBundleManifest(
      { ...manifest, plugins: [...REQUIRED_BUILTINS, REQUIRED_BUILTINS[0]] },
      lock.release,
      platform
    )
  )
  assert.throws(() => validatePluginBinary(elf(), "linux-arm64"))
  assert.throws(() => validatePluginBinary(elf(), "windows-x64"))
  assert.throws(() => validatePluginBinary(elf(), "macos-universal"))
})

await test("platform binary validation accepts supported machines and requires both macOS bundle slices", () => {
  validatePluginBinary(elf(183), "linux-arm64")
  const pe = Buffer.alloc(128)
  pe.writeUInt16LE(0x5a4d)
  pe.writeUInt32LE(64, 0x3c)
  pe.writeUInt32LE(0x4550, 64)
  pe.writeUInt16LE(0x8664, 68)
  validatePluginBinary(pe, "windows-x64")
  pe.writeUInt16LE(0xaa64, 68)
  assert.throws(() => validatePluginBinary(pe, "windows-x64"))

  const universal = Buffer.alloc(128)
  universal.writeUInt32BE(0xcafebabe)
  universal.writeUInt32BE(2, 4)
  for (const [index, cpu] of [0x01000007, 0x0100000c].entries()) {
    const entry = 8 + index * 20
    const offset = 64 + index * 32
    universal.writeUInt32BE(cpu, entry)
    universal.writeUInt32BE(offset, entry + 8)
    universal.writeUInt32BE(32, entry + 12)
    universal.writeUInt32LE(0xfeedfacf, offset)
    universal.writeUInt32LE(cpu, offset + 4)
    universal.writeUInt32LE(8, offset + 12)
  }
  validatePluginBinary(universal, "macos-universal")
  universal.writeUInt32LE(6, 64 + 32 + 12)
  assert.throws(() => validatePluginBinary(universal, "macos-universal"))
})

await test("upgrade versions remain stable semver with numerically ordered components", () => {
  assert.equal(stablePluginVersion("1.10.0"), "1.10.0")
  for (const invalid of ["01.0.0", "1.0.0-beta.1", "1.0.0+local", "9007199254740992.0.0"])
    assert.throws(() => stablePluginVersion(invalid))
})

await test("concurrent prepares share verified downloads and publish a complete stage", async (context) => {
  const { root, archive } = await workspace(context)
  await Promise.all(
    [1, 2].map(() =>
      preparePluginArtifacts({
        workspace: root,
        platform,
        fetchArtifact: async () => new Response(Uint8Array.from(archive))
      })
    )
  )
  assert.equal((await readdir(join(root, "target/bundles"))).length, REQUIRED_BUILTINS.length + 1)
  assert(!(await readdir(join(root, "target"))).some((entry) => entry.startsWith(".heron-")))
})

await test("the updater pins all platform artifacts to the published tag commit and rejects incomplete releases", async () => {
  const files = PLUGIN_PLATFORMS.flatMap((platform) => [
    pluginAssetName(version, platform),
    pluginAssetName(version, platform, true)
  ])
  const digest = "e".repeat(64)
  const fetchRelease = async (url: string) => {
    if (url.endsWith("SHA256SUMS"))
      return new Response(files.map((file) => `${digest}  ${file}`).join("\n"))
    if (url.includes("/commits/")) return Response.json({ sha: sourceCommit })
    return Response.json({
      tag_name: `v${version}`,
      draft: false,
      prerelease: false,
      assets: files.map((name) => ({ name, digest: `sha256:${digest}` }))
    })
  }
  const lock = await pluginLockFromRelease(version, fetchRelease)
  assert.equal(lock.release?.sourceCommit, sourceCommit)
  assert(lock.release)
  assert.equal(Object.keys(lock.release.assets).length, 4)
  assert.throws(() => parsePluginLock({ ...lock, repository: "untrusted/repo" }))
  await assert.rejects(
    pluginLockFromRelease(version, async (url) => {
      if (url.includes("/releases/tags/"))
        return Response.json({
          tag_name: `v${version}`,
          draft: false,
          prerelease: false,
          assets: []
        })
      return fetchRelease(url)
    })
  )
})

await test("an older dispatch does not downgrade the lock or write changes", async (context) => {
  const { root } = await workspace(context)
  const before = await readFile(join(root, "heron-plugins.lock.json"), "utf8")
  await assert.rejects(
    updatePluginLock(root, "0.9.0", async () => {
      assert.fail("downgrades must not request metadata")
    })
  )
  assert.equal(await readFile(join(root, "heron-plugins.lock.json"), "utf8"), before)
})

await test("latest notifications converge on the newest release and reject mutated versions", async (context) => {
  const { root } = await workspace(context)
  const filesFor = (version: string) =>
    PLUGIN_PLATFORMS.flatMap((platform) => [
      pluginAssetName(version, platform),
      pluginAssetName(version, platform, true)
    ])
  const fetchRelease = async (url: string) => {
    const selectedVersion = url.includes("v1.0.0") ? "1.0.0" : "1.1.0"
    const files = filesFor(selectedVersion)
    if (url.endsWith("SHA256SUMS"))
      return new Response(files.map((file) => `${"e".repeat(64)}  ${file}`).join("\n"))
    if (url.includes("/commits/")) return Response.json({ sha: sourceCommit })
    return Response.json({
      tag_name: `v${selectedVersion}`,
      draft: false,
      prerelease: false,
      assets: files.map((name) => ({ name }))
    })
  }
  await assert.rejects(updatePluginLock(root, "1.0.0", fetchRelease))
  assert.equal(await updatePluginLockToLatest(root, fetchRelease), true)
  const lock = parsePluginLock(
    JSON.parse(await readFile(join(root, "heron-plugins.lock.json"), "utf8"))
  )
  assert.equal(lock.release?.version, "1.1.0")
  assert.equal(await updatePluginLockToLatest(root, fetchRelease), false)
})

await test("rolling upgrades cannot regress or mutate an unmerged lock ahead of main", async (context) => {
  const { root } = await workspace(context)
  const before = await readFile(join(root, "heron-plugins.lock.json"), "utf8")
  let latest = "1.1.0"
  let digest = "e".repeat(64)
  const fetchRelease = async (url: string) => {
    const selected = /\/v(\d+\.\d+\.\d+)/u.exec(url)?.[1] ?? latest
    const files = PLUGIN_PLATFORMS.flatMap((platform) => [
      pluginAssetName(selected, platform),
      pluginAssetName(selected, platform, true)
    ])
    if (url.endsWith("SHA256SUMS"))
      return new Response(files.map((file) => `${digest}  ${file}`).join("\n"))
    if (url.includes("/commits/")) return Response.json({ sha: sourceCommit })
    return Response.json({
      tag_name: `v${selected}`,
      draft: false,
      prerelease: false,
      assets: files.map((name) => ({ name }))
    })
  }
  const pending = await pluginLockFromRelease("1.2.0", fetchRelease)
  await assert.rejects(updatePluginLockToLatest(root, fetchRelease, pending), /downgrades/u)
  assert.equal(await readFile(join(root, "heron-plugins.lock.json"), "utf8"), before)
  latest = "1.2.0"
  digest = "f".repeat(64)
  await assert.rejects(updatePluginLockToLatest(root, fetchRelease, pending), /immutable/u)
  assert.equal(await readFile(join(root, "heron-plugins.lock.json"), "utf8"), before)
  digest = "e".repeat(64)
  assert.equal(await updatePluginLockToLatest(root, fetchRelease, pending), true)
  assert.deepEqual(
    parsePluginLock(JSON.parse(await readFile(join(root, "heron-plugins.lock.json"), "utf8"))),
    pending
  )
})

await test("matching external symbols are staged independently of the runtime bundles", async (context) => {
  const { root, fetchArtifact } = await symbolsWorkspace(context)
  await mkdir(join(root, "target/bundles"), { recursive: true })
  await writeFile(join(root, "target/bundles/known-good-runtime"), "runtime")
  const destination = await preparePluginArtifacts({
    workspace: root,
    platform,
    symbols: true,
    fetchArtifact,
    debugInfo: fixtureDebugInfo
  })
  assert.equal(
    await readFile(join(destination, "symbols/Heron Gain.so"), "utf8"),
    "matching fixture symbols"
  )
  assert.equal(await readFile(join(root, "target/bundles/known-good-runtime"), "utf8"), "runtime")
  const manifest = JSON.parse(await readFile(join(destination, "symbols-manifest.json"), "utf8"))
  assert.equal(manifest.modules[0].binaryPath, fixtureSymbolModules[0]?.binaryPath)
  await preparePluginArtifacts({
    workspace: root,
    platform,
    symbols: true,
    offline: true,
    debugInfo: fixtureDebugInfo
  })
})

await test("symbols must uniquely cover every locked plug-in with its actual Debug ID and architecture", async (context) => {
  const badManifests = [
    fixtureSymbolModules.slice(0, 1),
    fixtureSymbolModules.map((module) => ({
      ...module,
      binaryPath: fixtureSymbolModules[0]?.binaryPath,
      debugId: fixtureSymbolModules[0]?.debugId
    })),
    fixtureSymbolModules.map((module) => ({ ...module, binaryPath: undefined })),
    fixtureSymbolModules.map((module) => ({ ...module, debugId: "wrong-debug-id" }))
  ]
  for (const modules of badManifests) {
    const { root, fetchArtifact } = await symbolsWorkspace(context, symbolsArchive(modules))
    await mkdir(join(root, "target/heron-plugin-symbols"), { recursive: true })
    await writeFile(join(root, "target/heron-plugin-symbols/previous"), "known-good")
    await assert.rejects(
      preparePluginArtifacts({
        workspace: root,
        platform,
        symbols: true,
        fetchArtifact,
        debugInfo: fixtureDebugInfo
      })
    )
    assert.equal(
      await readFile(join(root, "target/heron-plugin-symbols/previous"), "utf8"),
      "known-good"
    )
  }
  for (const invalid of [
    {
      variants: [{ debug_id: "wrong-debug-id", arch: "x86_64" }],
      features: "debug",
      is_usable: true
    },
    {
      variants: [{ debug_id: REQUIRED_BUILTINS[0]?.nativeId ?? "", arch: "arm64" }],
      features: "debug",
      is_usable: true
    },
    {
      variants: [{ debug_id: REQUIRED_BUILTINS[0]?.nativeId ?? "", arch: "x86_64" }],
      features: "symtab, unwind",
      is_usable: true
    }
  ]) {
    const { root, fetchArtifact } = await symbolsWorkspace(context)
    await assert.rejects(
      preparePluginArtifacts({
        workspace: root,
        platform,
        symbols: true,
        fetchArtifact,
        debugInfo: (path) =>
          path.includes(`${sep}symbols${sep}`) ? invalid : fixtureDebugInfo(path)
      })
    )
  }
})

await test("universal symbols allow one debug file per plug-in with both matching architecture slices", async (context) => {
  const { root, lock } = await workspace(context)
  const universalPlatform = "macos-universal" as const
  const runtime = join(root, "runtime")
  const symbols = join(root, "debug")
  await mkdir(runtime)
  await mkdir(symbols)
  const header = { schemaVersion: 1, version, sourceCommit, platform: universalPlatform }
  await writeFile(
    join(runtime, "bundle-manifest.json"),
    JSON.stringify({ ...header, plugins: REQUIRED_BUILTINS })
  )
  const modules = REQUIRED_BUILTINS.flatMap((plugin) =>
    ["x64", "arm64"].map((arch) => ({
      modulePath: `symbols/${plugin.name}.dSYM/Contents/Resources/DWARF/${plugin.name}`,
      binaryPath: pluginBinaryPath(plugin.bundleName, universalPlatform),
      arch,
      debugId: `${plugin.nativeId}-${arch}`
    }))
  )
  await writeFile(
    join(symbols, "symbols-manifest.json"),
    JSON.stringify({ ...header, format: "vst3", modules })
  )
  let inspected = 0
  const inspect = (path: string): PluginDebugInfo => {
    inspected += 1
    const plugin = REQUIRED_BUILTINS.find((plugin) => path.includes(plugin.name))
    assert(plugin)
    return {
      variants: [
        { arch: "x86_64", debug_id: `${plugin.nativeId}-x64` },
        { arch: "arm64", debug_id: `${plugin.nativeId}-arm64` }
      ],
      features: "symtab, unwind, debug",
      is_usable: true
    }
  }
  await validatePluginSymbols(runtime, symbols, lock.release, universalPlatform, inspect)
  assert.equal(inspected, REQUIRED_BUILTINS.length * 2)
  await writeFile(
    join(symbols, "symbols-manifest.json"),
    JSON.stringify({ ...header, format: "vst3", modules: modules.slice(0, -1) })
  )
  await assert.rejects(
    validatePluginSymbols(runtime, symbols, lock.release, universalPlatform, inspect)
  )
})
