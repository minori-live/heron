import { createRequire } from "node:module"
import { chmod, mkdir, readFile, readdir } from "node:fs/promises"
import { createWriteStream } from "node:fs"
import { dirname, join } from "node:path"
import { pipeline } from "node:stream/promises"
import { Transform, type Readable } from "node:stream"
import {
  artifactRelativePath,
  parseBundleManifest,
  pluginBinaryPath,
  type PluginPlatform,
  type PluginRelease
} from "./plugin-artifact-contract.ts"
import { validateArtifactBinary } from "./plugin-binary.ts"
import { validateRevoxResources } from "./plugin-revox-resources.ts"

interface ZipEntry {
  path: string
  type: "File" | "Directory"
  flags: number
  externalFileAttributes: number
  uncompressedSize: number
  stream(): Readable
}
const unzip = createRequire(import.meta.url)("unzipper") as {
  Open: { file(path: string): Promise<{ files: ZipEntry[] }> }
}

// We own allowed archive paths/types and expanded-size limits; unzipper owns
// the ZIP parser and inflation. Archives never write outside a new staging dir.
export async function extractPluginArchive(archive: string, destination: string): Promise<void> {
  const { files } = await unzip.Open.file(archive)
  if (files.length === 0 || files.length > 65_000)
    throw new Error("Invalid plug-in archive entry count")
  const names = new Set<string>()
  let expandedSize = 0
  const entries = files.map((entry) => {
    const path = artifactRelativePath(entry.path)
    const fileType = (entry.externalFileAttributes >>> 16) & 0o170000
    if (fileType !== 0 && fileType !== 0o100000 && fileType !== 0o040000)
      throw new Error(`Unsupported plug-in archive file type: ${path}`)
    if ((entry.flags & 1) !== 0) throw new Error("Encrypted plug-in archives are unsupported")
    const name = path.toLowerCase()
    if (names.has(name)) throw new Error(`Duplicate plug-in archive path: ${path}`)
    names.add(name)
    if (
      !Number.isSafeInteger(entry.uncompressedSize) ||
      entry.uncompressedSize < 0 ||
      entry.uncompressedSize > 1024 ** 3
    )
      throw new Error(`Oversized plug-in archive file: ${path}`)
    expandedSize += entry.uncompressedSize
    if (expandedSize > 4 * 1024 ** 3) throw new Error("Oversized expanded plug-in archive")
    return { entry, path }
  })
  await mkdir(destination, { recursive: true })
  for (const { entry, path } of entries) {
    const output = join(destination, path)
    if (entry.type === "Directory") {
      await mkdir(output, { recursive: true })
      continue
    }
    await mkdir(dirname(output), { recursive: true })
    let written = 0
    const bounded = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        written += chunk.length
        callback(
          written > entry.uncompressedSize
            ? new Error(`Plug-in archive size mismatch: ${path}`)
            : null,
          chunk
        )
      }
    })
    await pipeline(entry.stream(), bounded, createWriteStream(output, { flags: "wx" }))
    if (written !== entry.uncompressedSize)
      throw new Error(`Plug-in archive size mismatch: ${path}`)
    await chmod(output, ((entry.externalFileAttributes >>> 16) & 0o111) !== 0 ? 0o755 : 0o644)
  }
}

export function validatePluginBinary(bytes: Buffer, platform: PluginPlatform): void {
  validateArtifactBinary(bytes, platform, "plugin")
}

export async function validateExtractedArtifact(
  directory: string,
  release: PluginRelease,
  platform: PluginPlatform
): Promise<void> {
  const allowed = ["bundles", "bundle-manifest.json"]
  const entries = await readdir(directory)
  if (entries.some((entry) => !allowed.includes(entry)))
    throw new Error("Unexpected plug-in archive root entry")
  const manifest = parseBundleManifest(
    JSON.parse(await readFile(join(directory, "bundle-manifest.json"), "utf8")),
    release,
    platform
  )
  const bundles = await readdir(join(directory, "bundles"), { withFileTypes: true })
  if (
    bundles.length !== manifest.plugins.length ||
    bundles.some(
      (bundle) =>
        !bundle.isDirectory() ||
        !manifest.plugins.some((plugin) => plugin.bundleName === bundle.name)
    )
  )
    throw new Error("Plug-in archive contains unlisted or missing bundles")
  for (const plugin of manifest.plugins) {
    validatePluginBinary(
      await readFile(join(directory, pluginBinaryPath(plugin.bundleName, platform))),
      platform
    )
    if (plugin.builtinId === "live.minori.heron.revox")
      await validateRevoxResources(join(directory, "bundles", plugin.bundleName), platform)
  }
}
