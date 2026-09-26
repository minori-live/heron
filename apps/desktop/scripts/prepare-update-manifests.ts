import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { parse, stringify } from "yaml"
import { releaseBuild } from "../src/shared/release-build.ts"
import { verifyUpdateAssets } from "./verify-update-assets.ts"

const platforms = ["windows-x64", "macos-universal", "linux-x64", "linux-arm64"] as const
const releaseAssetBase = "https://github.com/minori-live/heron/releases/download/"

export async function prepareUpdateManifests(
  assetsDirectory: string,
  outputDirectory: string,
  version: string,
  channel: string
): Promise<void> {
  const tag = `v${version}`
  const assetBase = `${releaseAssetBase}${encodeURIComponent(tag)}/`
  await mkdir(outputDirectory, { recursive: true })
  for (const platform of platforms) {
    const name = await verifyUpdateAssets(assetsDirectory, version, channel, platform)
    const manifest = parse(await readFile(resolve(assetsDirectory, name), "utf8")) as {
      files: { url: string; blockMapSize?: number }[]
      path?: string
    }
    for (const file of manifest.files) {
      file.url = `${assetBase}${encodeURIComponent(file.url)}`
      delete file.blockMapSize
    }
    if (manifest.path) manifest.path = `${assetBase}${encodeURIComponent(manifest.path)}`
    await writeFile(resolve(outputDirectory, name), stringify(manifest))
  }
}

if (import.meta.main) {
  const [assetsDirectory, outputDirectory, version] = process.argv.slice(2)
  if (!assetsDirectory || !outputDirectory || !version)
    throw new Error("Expected assets directory, output directory and release version")
  const release = releaseBuild(version, process.env)
  if (!release) throw new Error("Update manifests require a validated tagged release")
  await prepareUpdateManifests(assetsDirectory, outputDirectory, version, release.channel)
}
