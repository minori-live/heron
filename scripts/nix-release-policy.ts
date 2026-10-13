export const upstream = "minori-live/heron"
export const latestReleaseUrl = `https://api.github.com/repos/${upstream}/releases/latest`

export const linuxArchitectures = ["x86_64-linux", "aarch64-linux"] as const
export type LinuxArchitecture = (typeof linuxArchitectures)[number]

export interface Asset {
  name: string
  url: string
  size: number
  sha256: string
}

export interface Release {
  tag: string
  version: string
  assets: Record<LinuxArchitecture, Asset>
}

const archSuffix: Record<LinuxArchitecture, string> = {
  "x86_64-linux": "x86_64",
  "aarch64-linux": "arm64"
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a GitHub release or asset object")
  }
  return value as Record<string, unknown>
}

function versionParts(version: string): bigint[] {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Not a stable release version: ${version}`)
  }
  return version.split(".").map(BigInt)
}

export function compareVersions(left: string, right: string): number {
  const a = versionParts(left)
  const b = versionParts(right)
  for (let index = 0; index < 3; index++) {
    if (a[index]! < b[index]!) return -1
    if (a[index]! > b[index]!) return 1
  }
  return 0
}

/** Convert a lowercase hex SHA-256 digest to a Nix SRI `sha256-…` hash. */
export function hexToSri(hex: string): string {
  if (!/^[a-f0-9]{64}$/.test(hex)) {
    throw new Error(`Invalid SHA-256 hex digest: ${hex}`)
  }
  return `sha256-${Buffer.from(hex, "hex").toString("base64")}`
}

function asset(assets: unknown[], tag: string, name: string): Asset {
  const matches = assets.map(record).filter((item) => item.name === name)
  if (matches.length !== 1) throw new Error(`Expected exactly one release asset: ${name}`)
  const item = matches[0]!
  const url = `https://github.com/${upstream}/releases/download/${tag}/${name}`
  if (item.state !== "uploaded" || item.browser_download_url !== url) {
    throw new Error(`Release asset is not uploaded at its canonical URL: ${name}`)
  }
  if (typeof item.size !== "number" || !Number.isSafeInteger(item.size) || item.size <= 0) {
    throw new Error(`Invalid release asset size: ${name}`)
  }
  if (typeof item.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(item.digest)) {
    throw new Error(`Invalid GitHub asset digest: ${name}`)
  }
  return { name, url, size: item.size, sha256: item.digest.slice(7) }
}

export function parseRelease(value: unknown): Release {
  const release = record(value)
  if (release.draft !== false || release.prerelease !== false) {
    throw new Error("Only published, non-prerelease releases may update the Nix flake")
  }
  if (typeof release.tag_name !== "string" || !release.tag_name.startsWith("v")) {
    throw new Error("Expected a v-prefixed release tag")
  }
  const tag = release.tag_name
  const version = tag.slice(1)
  versionParts(version)
  if (!Array.isArray(release.assets)) throw new Error("Missing release assets")

  const assets = {} as Record<LinuxArchitecture, Asset>
  for (const architecture of linuxArchitectures) {
    const name = `Heron-${version}-linux-${archSuffix[architecture]}.AppImage`
    assets[architecture] = asset(release.assets, tag, name)
  }

  return { tag, version, assets }
}

export interface ReleasePin {
  version: string
  hashes: Record<LinuxArchitecture, string>
}

const versionPattern = /^ {2}version = "([^"]+)";$/m
const hashPattern = (architecture: LinuxArchitecture) =>
  new RegExp(`^ {4}${architecture} = "(sha256-[A-Za-z0-9+/=]+)";$`, "m")

export function releaseIdentity(content: string): ReleasePin {
  const versionMatch = content.match(versionPattern)
  if (!versionMatch) {
    throw new Error("Expected one pinned version in nix/release.nix")
  }
  const version = versionMatch[1]!
  versionParts(version)

  const hashes = {} as Record<LinuxArchitecture, string>
  for (const architecture of linuxArchitectures) {
    const matches = [...content.matchAll(new RegExp(hashPattern(architecture).source, "gm"))]
    if (matches.length !== 1) {
      throw new Error(`Expected one ${architecture} hash in nix/release.nix`)
    }
    hashes[architecture] = matches[0]![1]!
  }

  return { version, hashes }
}

export function renderReleaseNix(pin: ReleasePin): string {
  return `# Pinned published Linux AppImage digests for the Nix package.
# Updated by \`node scripts/nix-sync-release.ts\` when a stable release is published.
{
  version = "${pin.version}";
  hashes = {
    x86_64-linux = "${pin.hashes["x86_64-linux"]}";
    aarch64-linux = "${pin.hashes["aarch64-linux"]}";
  };
}
`
}

export function updateReleaseNix(content: string, release: Release): string {
  const current = releaseIdentity(content)
  const nextHashes = {
    "x86_64-linux": hexToSri(release.assets["x86_64-linux"].sha256),
    "aarch64-linux": hexToSri(release.assets["aarch64-linux"].sha256)
  } satisfies Record<LinuxArchitecture, string>

  const comparison = compareVersions(release.version, current.version)
  if (comparison < 0) throw new Error("Refusing to downgrade the Nix release pin")
  if (comparison === 0) {
    for (const architecture of linuxArchitectures) {
      if (current.hashes[architecture] !== nextHashes[architecture]) {
        throw new Error(
          `Published bytes changed for the same version (${architecture}); manual investigation required`
        )
      }
    }
    return content
  }

  return renderReleaseNix({ version: release.version, hashes: nextHashes })
}
