import { appendFile, readFile, rename, rm, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import {
  latestReleaseUrl,
  parseRelease,
  updateReleaseNix,
  type Release
} from "./nix-release-policy.ts"

const releaseNixPath = fileURLToPath(new URL("../nix/release.nix", import.meta.url))
const publicFetch = (url: string) => fetch(url, { signal: AbortSignal.timeout(300_000) })

async function latest(): Promise<Release> {
  const response = await publicFetch(latestReleaseUrl)
  if (!response.ok) throw new Error(`Release lookup failed: HTTP ${response.status}`)
  return parseRelease(await response.json())
}

async function synchronize(path: string): Promise<{ changed: boolean; version: string }> {
  const content = await readFile(path, "utf8")
  const release = await latest()
  const next = updateReleaseNix(content, release)
  const changed = next !== content
  const confirmed = await latest()
  if (JSON.stringify(confirmed) !== JSON.stringify(release)) {
    throw new Error("Latest release changed during verification; retry synchronization")
  }
  if (changed) {
    const temporaryPath = `${path}.sync-${process.pid}`
    try {
      await writeFile(temporaryPath, next, { flag: "wx" })
      await rename(temporaryPath, path)
    } finally {
      await rm(temporaryPath, { force: true })
    }
  }
  return { changed, version: release.version }
}

if (import.meta.main) {
  try {
    if (process.argv.length > 2) {
      throw new Error("Usage: node scripts/nix-sync-release.ts")
    }
    const result = await synchronize(releaseNixPath)
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(
        process.env.GITHUB_OUTPUT,
        `changed=${result.changed}\nversion=${result.version}\n`
      )
    }
    console.log(
      `Heron ${result.version}: ${result.changed ? "updated nix/release.nix" : "already synchronized"}`
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Nix release synchronization failed")
    process.exitCode = 1
  }
}
