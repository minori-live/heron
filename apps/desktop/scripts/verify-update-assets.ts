import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { basename, resolve } from "node:path"
import { parse } from "yaml"
import { releaseBuild } from "../src/shared/release-build.ts"

export async function verifyUpdateAssets(
  directory: string,
  version: string,
  channel: string,
  platformId: string
): Promise<string> {
  const platforms: Record<string, { suffix: string; extension: string }> = {
    "windows-x64": { suffix: "", extension: ".exe" },
    "macos-universal": { suffix: "-mac", extension: ".zip" },
    "linux-x64": { suffix: "-linux", extension: ".AppImage" },
    "linux-arm64": { suffix: "-linux-arm64", extension: ".AppImage" }
  }
  const platform = platforms[platformId]
  if (!platform) throw new Error("Expected a release platform/architecture")
  const metadataName = `${channel}${platform.suffix}.yml`
  const metadata = parse(await readFile(resolve(directory, metadataName), "utf8")) as {
    version?: string
    files?: { url: string; sha512: string; size: number }[]
  }
  if (metadata.version !== version || !metadata.files?.length)
    throw new Error("Invalid update version/files")
  if (!metadata.files.some((file) => file.url.endsWith(platform.extension)))
    throw new Error("Missing update target")
  for (const file of metadata.files) {
    if (
      typeof file.url !== "string" ||
      basename(file.url) !== file.url ||
      file.url.includes("\\")
    ) {
      throw new Error("Update metadata must reference local release assets")
    }
    const path = resolve(directory, file.url)
    if ((await stat(path)).size !== file.size) throw new Error(`Size mismatch: ${file.url}`)
    const hash = createHash("sha512")
    for await (const chunk of createReadStream(path)) {
      if (!(chunk instanceof Uint8Array)) throw new Error("Expected binary artifact data")
      hash.update(chunk)
    }
    if (hash.digest("base64") !== file.sha512) throw new Error(`Checksum mismatch: ${file.url}`)
    if (file.url.endsWith(".exe") || file.url.endsWith(".zip")) await stat(`${path}.blockmap`)
  }
  return metadataName
}

if (import.meta.main) {
  const directory = resolve(import.meta.dirname, "../../../release")
  const version = (await readFile(resolve(import.meta.dirname, "../../../VERSION"), "utf8")).trim()
  const release = releaseBuild(version, process.env)
  if (!release) throw new Error("Update artifact validation requires a tagged build")
  const metadata = await verifyUpdateAssets(
    directory,
    version,
    release.channel,
    process.argv[2] ?? ""
  )
  console.log(`Verified ${metadata} and all referenced assets`)
}
