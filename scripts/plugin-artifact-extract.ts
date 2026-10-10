import { createRequire } from "node:module"
import { chmod, lstat, mkdir, readFile, readdir } from "node:fs/promises"
import { createWriteStream } from "node:fs"
import { dirname, join } from "node:path"
import { pipeline } from "node:stream/promises"
import { Transform, type Readable } from "node:stream"
import {
  artifactRelativePath,
  parseBundleManifest,
  parseSymbolsManifest,
  pluginBinaryPath,
  type PluginPlatform,
  type PluginRelease
} from "./plugin-artifact-contract.ts"

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

function expectedMachine(platform: PluginPlatform): number {
  return platform.endsWith("arm64") ? 183 : 62
}

export function validatePluginBinary(bytes: Buffer, platform: PluginPlatform): void {
  if (bytes.length < 64) throw new Error("Truncated plug-in binary")
  if (platform.startsWith("linux")) {
    if (
      !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
      bytes[4] !== 2 ||
      bytes[5] !== 1 ||
      bytes.readUInt16LE(18) !== expectedMachine(platform)
    )
      throw new Error("Plug-in ELF architecture does not match its platform")
    return
  }
  if (platform === "windows-x64") {
    const pe = bytes.readUInt32LE(0x3c)
    if (
      bytes.readUInt16LE(0) !== 0x5a4d ||
      pe > bytes.length - 6 ||
      bytes.readUInt32LE(pe) !== 0x4550 ||
      bytes.readUInt16LE(pe + 4) !== 0x8664
    )
      throw new Error("Plug-in PE architecture does not match its platform")
    return
  }
  const magic = bytes.readUInt32BE(0)
  const fat64 = magic === 0xcafebabf
  if (magic !== 0xcafebabe && !fat64) throw new Error("macOS plug-in must be a universal Mach-O")
  const slices = bytes.readUInt32BE(4)
  const size = fat64 ? 32 : 20
  if (slices !== 2 || bytes.length < 8 + slices * size)
    throw new Error("Invalid universal plug-in slices")
  const cpus = new Set<number>()
  for (let index = 0; index < slices; index += 1) {
    const entry = 8 + index * size
    cpus.add(bytes.readUInt32BE(entry))
    const offset = fat64 ? Number(bytes.readBigUInt64BE(entry + 8)) : bytes.readUInt32BE(entry + 8)
    const length = fat64
      ? Number(bytes.readBigUInt64BE(entry + 16))
      : bytes.readUInt32BE(entry + 12)
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      length < 16 ||
      offset < 8 + slices * size ||
      offset > bytes.length - length ||
      bytes.readUInt32LE(offset) !== 0xfeedfacf ||
      bytes.readUInt32LE(offset + 4) !== bytes.readUInt32BE(entry) ||
      bytes.readUInt32LE(offset + 12) !== 8
    )
      throw new Error("Invalid universal plug-in binary slice")
  }
  if (!cpus.has(0x01000007) || !cpus.has(0x0100000c))
    throw new Error("Universal plug-in requires x64 and arm64 slices")
}

export async function validateExtractedArtifact(
  directory: string,
  release: PluginRelease,
  platform: PluginPlatform,
  symbols: boolean
): Promise<void> {
  const allowed = symbols
    ? ["symbols", "symbols-manifest.json"]
    : ["bundles", "bundle-manifest.json"]
  const entries = await readdir(directory)
  if (entries.some((entry) => !allowed.includes(entry)))
    throw new Error("Unexpected plug-in archive root entry")
  if (symbols) {
    const manifest = parseSymbolsManifest(
      JSON.parse(await readFile(join(directory, "symbols-manifest.json"), "utf8")),
      release,
      platform
    )
    for (const module of manifest.modules) {
      const file = await lstat(join(directory, module.modulePath))
      if (!file.isFile() || file.size === 0) throw new Error("Missing plug-in debug module")
    }
    return
  }
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
  }
}
