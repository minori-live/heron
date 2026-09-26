import { copyFile, mkdir, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { parse } from "yaml"

const suffixes = ["", "-mac", "-linux", "-linux-arm64"] as const
const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$/
const channelOrder = { alpha: 0, beta: 1, rc: 2, latest: 3 } as const

type Channel = keyof typeof channelOrder

function parts(version: string): [number, number, number, number, number] {
  const match = versionPattern.exec(version)
  if (!match) throw new Error(`Invalid release version: ${version}`)
  const channel = (match[4] ?? "latest") as Channel
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    channelOrder[channel],
    Number(match[5] ?? 0)
  ]
}

export function compareReleaseVersions(left: string, right: string): number {
  const a = parts(left)
  const b = parts(right)
  for (const index of [0, 1, 2, 3, 4] as const) {
    const difference = a[index] - b[index]
    if (difference !== 0) return Math.sign(difference)
  }
  return 0
}

function manifestVersion(contents: string): string {
  const manifest: unknown = parse(contents)
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("version" in manifest) ||
    typeof manifest.version !== "string"
  )
    throw new Error("Update manifest has no version")
  return manifest.version
}

export async function promoteUpdateManifests(directory: string, tag: string): Promise<void> {
  if (!tag.startsWith("v")) throw new Error(`Invalid release tag: ${tag}`)
  const version = tag.slice(1)
  const channel = (versionPattern.exec(version)?.[4] ?? "latest") as Channel
  parts(version)
  const channels: Channel[] =
    channel === "latest"
      ? ["latest", "alpha", "beta", "rc"]
      : channel === "beta"
        ? ["alpha", "beta"]
        : [channel]
  await mkdir(resolve(directory, "current"), { recursive: true })
  for (const suffix of suffixes) {
    const source = resolve(directory, "versions", tag, `${channel}${suffix}.yml`)
    if (manifestVersion(await readFile(source, "utf8")) !== version)
      throw new Error(`Staged manifest has the wrong version: ${source}`)
    for (const targetChannel of channels) {
      const destination = resolve(directory, "current", `${targetChannel}${suffix}.yml`)
      const existing = await readFile(destination, "utf8").catch((error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
        throw error
      })
      if (existing !== null && compareReleaseVersions(version, manifestVersion(existing)) <= 0)
        continue
      await copyFile(source, destination)
    }
  }
}

if (import.meta.main) {
  const [directory, tag] = process.argv.slice(2)
  if (!directory || !tag) throw new Error("Expected manifest worktree and release tag")
  await promoteUpdateManifests(directory, tag)
}
