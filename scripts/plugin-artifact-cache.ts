import { randomUUID } from "node:crypto"
import { createWriteStream } from "node:fs"
import { access, cp, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import {
  currentPluginPlatform,
  parsePluginLock,
  PLUGIN_REPOSITORY,
  type PluginAsset,
  type PluginPlatform,
  type PluginRelease
} from "./plugin-artifact-contract.ts"
import { extractPluginArchive, validateExtractedArtifact } from "./plugin-artifact-extract.ts"
import { acquirePluginStageLock } from "./plugin-stage-lock.ts"

export interface PluginPrepareOptions {
  workspace: string
  platform?: PluginPlatform
  offline?: boolean
  fetchArtifact?: (url: string) => Promise<Response>
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
  platform: PluginPlatform,
  asset: PluginAsset
): Promise<string> {
  const directory = join(options.workspace, "target", "plugin-artifacts", version, platform)
  const cached = join(directory, asset.file)
  if (await exists(cached)) return cached
  if (options.offline) {
    throw new Error(`Missing plug-in cache in offline mode: ${asset.file}`)
  }
  await mkdir(directory, { recursive: true })
  const partial = join(directory, `${asset.file}.${randomUUID()}.partial`)
  try {
    const url = `https://github.com/${PLUGIN_REPOSITORY}/releases/download/v${version}/${asset.file}`
    const response = await (
      options.fetchArtifact ??
      ((url: string) => fetch(url, { signal: AbortSignal.timeout(120_000) }))
    )(url)
    if (!response.ok || !response.body)
      throw new Error(`Plug-in download failed (${response.status}): ${asset.file}`)
    let received = 0
    const bounded = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length
        callback(received > 2 * 1024 ** 3 ? new Error("Oversized plug-in download") : null, chunk)
      }
    })
    await pipeline(
      Readable.from(downloadChunks(response.body)),
      bounded,
      createWriteStream(partial, { flags: "wx" })
    )
    await rename(partial, cached)
    return cached
  } finally {
    await rm(partial, { force: true })
  }
}

async function extractValidatedArchive(
  archive: string,
  staging: string,
  release: PluginRelease,
  platform: PluginPlatform
): Promise<void> {
  try {
    await extractPluginArchive(archive, staging)
    await validateExtractedArtifact(staging, release, platform)
  } catch (error) {
    await rm(archive, { force: true })
    throw error
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
  const asset = release.assets[platform].runtime
  const target = join(options.workspace, "target")
  const destination = join(target, "bundles")
  const stageLock = join(target, ".heron-plugin-bundles.gate")
  await mkdir(target, { recursive: true })
  const releaseRecoveryLock = await acquirePluginStageLock(stageLock)
  try {
    await recoverStage(destination)
  } finally {
    await releaseRecoveryLock()
  }
  const archive = await cachedArchive(options, release.version, platform, asset)
  const staging = await mkdtemp(join(target, ".heron-plugins-"))
  try {
    await extractValidatedArchive(archive, staging, release, platform)
    const source = join(staging, "bundles")
    await cp(join(staging, "bundle-manifest.json"), join(source, "bundle-manifest.json"))
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
    await rm(staging, { recursive: true, force: true })
  }
}
