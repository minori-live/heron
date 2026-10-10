import { createHash, randomUUID } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { access, cp, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import {
  currentPluginPlatform,
  parsePluginLock,
  PLUGIN_REPOSITORY,
  type PluginAsset,
  type PluginPlatform
} from "./plugin-artifact-contract.ts"
import { extractPluginArchive, validateExtractedArtifact } from "./plugin-artifact-extract.ts"
import { validatePluginSymbols, type PluginDebugInspector } from "./plugin-symbol-validation.ts"
import { acquirePluginStageLock } from "./plugin-stage-lock.ts"

export interface PluginPrepareOptions {
  workspace: string
  platform?: PluginPlatform
  symbols?: boolean
  offline?: boolean
  fetchArtifact?: (url: string) => Promise<Response>
  debugInfo?: PluginDebugInspector
}

export async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest("hex")
}

async function* downloadChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader()
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) return
      yield chunk.value
    }
  } finally {
    reader.releaseLock()
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

async function cachedArchive(
  options: PluginPrepareOptions,
  version: string,
  asset: PluginAsset
): Promise<string> {
  const directory = join(options.workspace, "target", "plugin-artifacts")
  const cached = join(directory, `${asset.sha256}.zip`)
  if (await exists(cached)) {
    if ((await fileSha256(cached)) === asset.sha256) return cached
    if (options.offline) throw new Error(`Corrupted plug-in cache in offline mode: ${asset.file}`)
  } else if (options.offline) {
    throw new Error(`Missing plug-in cache in offline mode: ${asset.file}`)
  }
  await mkdir(directory, { recursive: true })
  const partial = join(directory, `${asset.sha256}.${randomUUID()}.partial`)
  try {
    const url = `https://github.com/${PLUGIN_REPOSITORY}/releases/download/v${version}/${asset.file}`
    const response = await (
      options.fetchArtifact ??
      ((url: string) => fetch(url, { signal: AbortSignal.timeout(120_000) }))
    )(url)
    if (!response.ok || !response.body)
      throw new Error(`Plug-in download failed (${response.status}): ${asset.file}`)
    let received = 0
    const hash = createHash("sha256")
    const bounded = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length
        hash.update(chunk)
        callback(received > 2 * 1024 ** 3 ? new Error("Oversized plug-in download") : null, chunk)
      }
    })
    await pipeline(
      Readable.from(downloadChunks(response.body)),
      bounded,
      createWriteStream(partial, { flags: "wx" })
    )
    if (hash.digest("hex") !== asset.sha256)
      throw new Error(`Plug-in download SHA-256 mismatch: ${asset.file}`)
    await rename(partial, cached)
    return cached
  } finally {
    await rm(partial, { force: true })
  }
}

async function recoverStage(destination: string): Promise<string> {
  const previous = join(dirname(destination), `.${basename(destination)}.previous`)
  // Recover the old directory if a previous process stopped between the two
  // renames. Publication has one commit point: source -> destination.
  if (await exists(previous)) {
    if (await exists(destination)) await rm(previous, { recursive: true })
    else await rename(previous, destination)
  }
  return previous
}

async function publishStage(source: string, destination: string): Promise<void> {
  const previous = await recoverStage(destination)
  const hadPrevious = await exists(destination)
  if (hadPrevious) await rename(destination, previous)
  try {
    await rename(source, destination)
  } catch (error) {
    if (hadPrevious) await rename(previous, destination)
    throw error
  }
  await rm(previous, { recursive: true, force: true })
}

export async function preparePluginArtifacts(options: PluginPrepareOptions): Promise<string> {
  const lock = parsePluginLock(
    JSON.parse(await readFile(join(options.workspace, "heron-plugins.lock.json"), "utf8"))
  )
  const release = lock.release
  if (!release)
    throw new Error(
      "heron-plugins.lock.json is uninitialized. Publish the first tested plug-in release, then run pnpm plugins:update <version>; source-built plug-ins are not a fallback."
    )
  const platform = options.platform ?? currentPluginPlatform()
  const symbols = options.symbols ?? false
  const target = join(options.workspace, "target")
  const destination = join(target, symbols ? "heron-plugin-symbols" : "bundles")
  const stageLock = join(
    target,
    symbols ? ".heron-plugin-symbols.gate" : ".heron-plugin-bundles.gate"
  )
  await mkdir(target, { recursive: true })
  const releaseRecoveryLock = await acquirePluginStageLock(stageLock)
  try {
    await recoverStage(destination)
  } finally {
    await releaseRecoveryLock()
  }
  const asset = release.assets[platform][symbols ? "symbols" : "runtime"]
  const archive = await cachedArchive(options, release.version, asset)
  const staging = await mkdtemp(join(target, ".heron-plugins-"))
  let runtimeStaging: string | undefined
  try {
    await extractPluginArchive(archive, staging)
    await validateExtractedArtifact(staging, release, platform, symbols)
    if (symbols) {
      const runtimeArchive = await cachedArchive(
        options,
        release.version,
        release.assets[platform].runtime
      )
      runtimeStaging = await mkdtemp(join(target, ".heron-plugin-runtime-"))
      await extractPluginArchive(runtimeArchive, runtimeStaging)
      await validateExtractedArtifact(runtimeStaging, release, platform, false)
      await validatePluginSymbols(runtimeStaging, staging, release, platform, options.debugInfo)
    }
    let source = staging
    if (!symbols) {
      source = join(staging, "bundles")
      await cp(join(staging, "bundle-manifest.json"), join(source, "bundle-manifest.json"))
    }
    const unlock = await acquirePluginStageLock(stageLock)
    try {
      const current = parsePluginLock(
        JSON.parse(await readFile(join(options.workspace, "heron-plugins.lock.json"), "utf8"))
      )
      if (JSON.stringify(current.release) !== JSON.stringify(release))
        throw new Error("Plug-in lock changed during preparation; retry with the current release")
      await publishStage(source, destination)
    } finally {
      await unlock()
    }
    return destination
  } finally {
    if (runtimeStaging) await rm(runtimeStaging, { recursive: true, force: true })
    await rm(staging, { recursive: true, force: true })
  }
}
