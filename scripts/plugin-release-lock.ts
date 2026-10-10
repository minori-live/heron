import { readFile, rename, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import {
  parsePluginLock,
  PLUGIN_PLATFORMS,
  PLUGIN_REPOSITORY,
  pluginAssetName,
  stablePluginVersion,
  type PluginLock,
  type PluginRelease
} from "./plugin-artifact-contract.ts"

interface GitHubRelease {
  tag_name: string
  draft: boolean
  prerelease: boolean
  assets: Array<{ name: string; digest?: string }>
}
export type ReleaseFetch = (url: string) => Promise<Response>

async function response(url: string, fetchRelease: ReleaseFetch): Promise<Response> {
  const result = await fetchRelease(url)
  if (!result.ok) throw new Error(`Unable to read plug-in release metadata (${result.status})`)
  return result
}

export async function pluginLockFromRelease(
  versionInput: string,
  fetchRelease: ReleaseFetch
): Promise<PluginLock> {
  const version = stablePluginVersion(versionInput)
  const api = `https://api.github.com/repos/${PLUGIN_REPOSITORY}`
  const release = (await (
    await response(`${api}/releases/tags/v${version}`, fetchRelease)
  ).json()) as GitHubRelease
  if (
    release.tag_name !== `v${version}` ||
    release.draft ||
    release.prerelease ||
    !Array.isArray(release.assets)
  )
    throw new Error("Only published stable plug-in releases may be locked")
  const source = (await (await response(`${api}/commits/v${version}`, fetchRelease)).json()) as {
    sha?: string
  }
  const checksums = await (
    await response(
      `https://github.com/${PLUGIN_REPOSITORY}/releases/download/v${version}/SHA256SUMS`,
      fetchRelease
    )
  ).text()
  const sums = new Map<string, string>()
  for (const line of checksums.trim().split(/\r?\n/u)) {
    const match = /^([0-9a-f]{64})\s+\*?([^\s/\\]+)$/u.exec(line)
    if (!match || !match[1] || !match[2] || sums.has(match[2]))
      throw new Error("Invalid or duplicate plug-in release checksum entry")
    sums.set(match[2], match[1])
  }
  const assets = Object.fromEntries(
    PLUGIN_PLATFORMS.map((platform) => {
      const files = Object.fromEntries(
        (["runtime", "symbols"] as const).map((kind) => {
          const file = pluginAssetName(version, platform, kind === "symbols")
          const asset = release.assets.find((asset) => asset.name === file)
          const sha256 = sums.get(file)
          if (!asset || !sha256 || (asset.digest && asset.digest !== `sha256:${sha256}`))
            throw new Error(`Plug-in release is incomplete or has inconsistent checksums: ${file}`)
          return [kind, { file, sha256 }]
        })
      )
      return [platform, files]
    })
  ) as PluginRelease["assets"]
  return parsePluginLock({
    schemaVersion: 1,
    repository: PLUGIN_REPOSITORY,
    release: { version, sourceCommit: source.sha, assets }
  })
}

function compareVersions(candidate: string, current: string): number {
  const left = candidate.split(".").map(Number)
  const right = current.split(".").map(Number)
  for (let index = 0; index < 3; index += 1) {
    const candidatePart = left[index] ?? 0
    const currentPart = right[index] ?? 0
    if (candidatePart !== currentPart) return candidatePart > currentPart ? 1 : -1
  }
  return 0
}

export async function updatePluginLock(
  workspace: string,
  version: string,
  fetchRelease: ReleaseFetch,
  pending?: PluginLock
): Promise<boolean> {
  const path = join(workspace, "heron-plugins.lock.json")
  const existing = parsePluginLock(JSON.parse(await readFile(path, "utf8")))
  stablePluginVersion(version)
  const previous = pending ? [existing, pending] : [existing]
  for (const lock of previous)
    if (lock.release && compareVersions(version, lock.release.version) < 0)
      throw new Error("Plug-in release downgrades are forbidden, including pending upgrades")
  const lock = await pluginLockFromRelease(version, fetchRelease)
  for (const baseline of previous)
    if (baseline.release?.version === version && JSON.stringify(baseline) !== JSON.stringify(lock))
      throw new Error(
        "Published plug-in versions are immutable; source commits and checksums must not change"
      )
  if (JSON.stringify(existing) === JSON.stringify(lock)) return false
  const temporary = `${path}.${randomUUID()}.partial`
  try {
    await writeFile(temporary, `${JSON.stringify(lock, null, 2)}\n`, { flag: "wx" })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
  return true
}

export async function updatePluginLockToLatest(
  workspace: string,
  fetchRelease: ReleaseFetch,
  pending?: PluginLock
): Promise<boolean> {
  const latest = (await (
    await response(
      `https://api.github.com/repos/${PLUGIN_REPOSITORY}/releases/latest`,
      fetchRelease
    )
  ).json()) as GitHubRelease
  if (
    latest.draft ||
    latest.prerelease ||
    typeof latest.tag_name !== "string" ||
    !latest.tag_name.startsWith("v")
  )
    throw new Error("No published stable plug-in release is available")
  return updatePluginLock(
    workspace,
    stablePluginVersion(latest.tag_name.slice(1)),
    fetchRelease,
    pending
  )
}
