import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

export const linuxArchitectures = ["x86_64-linux", "aarch64-linux"] as const
export type LinuxArchitecture = (typeof linuxArchitectures)[number]

export const archSuffix: Record<LinuxArchitecture, string> = {
  "x86_64-linux": "x86_64",
  "aarch64-linux": "arm64"
}

export interface ReleasePin {
  version: string
  hashes: Record<LinuxArchitecture, string>
}

const versionPattern = /^ {2}version = "([^"]+)";$/m
const hashPattern = (architecture: LinuxArchitecture) =>
  new RegExp(`^ {4}${architecture} = "(sha256-[A-Za-z0-9+/=]+)";$`, "m")
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const releaseVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/

export function assertReleaseVersion(version: string): void {
  if (!releaseVersion.test(version)) {
    throw new Error(`Not a release version: ${version}`)
  }
}

/** Convert a lowercase hex SHA-256 digest to a Nix SRI `sha256-…` hash. */
export function hexToSri(hex: string): string {
  if (!/^[a-f0-9]{64}$/.test(hex)) {
    throw new Error(`Invalid SHA-256 hex digest: ${hex}`)
  }
  return `sha256-${Buffer.from(hex, "hex").toString("base64")}`
}

export function sha256FileHex(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

export function appImageName(version: string, architecture: LinuxArchitecture): string {
  assertReleaseVersion(version)
  return `Heron-${version}-linux-${archSuffix[architecture]}.AppImage`
}

export function releaseIdentity(content: string): ReleasePin {
  const versionMatch = content.match(versionPattern)
  if (!versionMatch) {
    throw new Error("Expected one pinned version in nix/release.nix")
  }
  const version = versionMatch[1]!
  assertReleaseVersion(version)

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
  assertReleaseVersion(pin.version)
  for (const architecture of linuxArchitectures) {
    if (!/^sha256-[A-Za-z0-9+/=]+$/.test(pin.hashes[architecture])) {
      throw new Error(`Invalid Nix SRI hash for ${architecture}`)
    }
  }

  return `# Pinned Linux AppImage digests for the Nix package.
# Written by the Publish workflow from the release AppImages (scripts/nix-pin-release.ts).
{
  version = "${pin.version}";
  hashes = {
    x86_64-linux = "${pin.hashes["x86_64-linux"]}";
    aarch64-linux = "${pin.hashes["aarch64-linux"]}";
  };
}
`
}

/** Build a pin from local AppImage paths produced by the release build. */
export function pinFromAppImages(
  version: string,
  paths: Record<LinuxArchitecture, string>
): ReleasePin {
  assertReleaseVersion(version)
  const hashes = {} as Record<LinuxArchitecture, string>
  for (const architecture of linuxArchitectures) {
    const path = paths[architecture]
    const expectedName = appImageName(version, architecture)
    if (!path.endsWith(expectedName) && !path.includes(`/${expectedName}`)) {
      throw new Error(`Expected AppImage path ending with ${expectedName}, got ${path}`)
    }
    hashes[architecture] = hexToSri(sha256FileHex(path))
  }
  return { version, hashes }
}

export function applyPin(content: string, pin: ReleasePin): { next: string; changed: boolean } {
  const next = renderReleaseNix(pin)
  if (content === next) return { next: content, changed: false }

  // Same version with different digests is allowed while a draft is rebuilt.
  // Refuse only an accidental downgrade of a stable x.y.z pin.
  try {
    const current = releaseIdentity(content)
    if (
      stableVersion.test(current.version) &&
      stableVersion.test(pin.version) &&
      compareStableVersions(pin.version, current.version) < 0
    ) {
      throw new Error(
        `Refusing to downgrade nix/release.nix from ${current.version} to ${pin.version}`
      )
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Refusing to downgrade")) {
      throw error
    }
    // Unreadable current pin: overwrite from authoritative release assets.
  }

  return { next, changed: true }
}

function compareStableVersions(left: string, right: string): number {
  const a = left.split(".").map(BigInt)
  const b = right.split(".").map(BigInt)
  for (let index = 0; index < 3; index++) {
    if (a[index]! < b[index]!) return -1
    if (a[index]! > b[index]!) return 1
  }
  return 0
}
