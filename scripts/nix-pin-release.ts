import { appendFile, readFile, rename, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  applyPin,
  appImageName,
  linuxArchitectures,
  pinFromAppImages,
  type LinuxArchitecture
} from "./nix-release-policy.ts"

const releaseNixPath = fileURLToPath(new URL("../nix/release.nix", import.meta.url))

function usage(): never {
  throw new Error(
    "Usage: node scripts/nix-pin-release.ts <version> <asset-directory>\n" +
      "Hashes Heron-<version>-linux-{x86_64,arm64}.AppImage and writes nix/release.nix."
  )
}

async function pinRelease(
  version: string,
  assetDirectory: string
): Promise<{ changed: boolean; version: string }> {
  const paths = {} as Record<LinuxArchitecture, string>
  for (const architecture of linuxArchitectures) {
    paths[architecture] = resolve(assetDirectory, appImageName(version, architecture))
  }

  const pin = pinFromAppImages(version, paths)
  const content = await readFile(releaseNixPath, "utf8")
  const { next, changed } = applyPin(content, pin)
  if (changed) {
    const temporaryPath = `${releaseNixPath}.pin-${process.pid}`
    try {
      await writeFile(temporaryPath, next, { flag: "wx" })
      await rename(temporaryPath, releaseNixPath)
    } finally {
      await rm(temporaryPath, { force: true })
    }
  }
  return { changed, version: pin.version }
}

if (import.meta.main) {
  try {
    const version = process.argv[2]
    const assetDirectory = process.argv[3]
    if (!version || !assetDirectory || process.argv.length !== 4) usage()

    const result = await pinRelease(version, assetDirectory)
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(
        process.env.GITHUB_OUTPUT,
        `changed=${result.changed}\nversion=${result.version}\n`
      )
    }
    console.log(
      `Heron ${result.version}: ${result.changed ? "updated nix/release.nix" : "nix/release.nix already pinned"}`
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Nix release pin failed")
    process.exitCode = 1
  }
}
