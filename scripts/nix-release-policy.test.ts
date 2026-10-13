import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  compareVersions,
  hexToSri,
  parseRelease,
  releaseIdentity,
  renderReleaseNix,
  updateReleaseNix
} from "./nix-release-policy.ts"

const samplePin = renderReleaseNix({
  version: "0.8.0",
  hashes: {
    "x86_64-linux": "sha256-rkI2VjVdrtHJaAdSQIQH6hFMI2CrQCyZvAxP3yqUHLs=",
    "aarch64-linux": "sha256-9hvIwfrW2i+IGjJqmaC3A5EgHN4sViM8QGSWDL5Oews="
  }
})

const x64Hex = "ae423656355daed1c9680752408407ea114c2360ab402c99bc0c4fdf2a941cbb"
const armHex = "f61bc8c1fad6da2f881a326a99a0b70391201cde2c56233c4064960cbe4e7b0b"

function releasePayload(version: string, draft = false, prerelease = false) {
  const tag = `v${version}`
  return {
    draft,
    prerelease,
    tag_name: tag,
    assets: [
      {
        name: `Heron-${version}-linux-x86_64.AppImage`,
        state: "uploaded",
        size: 100,
        digest: `sha256:${x64Hex}`,
        browser_download_url: `https://github.com/minori-live/heron/releases/download/${tag}/Heron-${version}-linux-x86_64.AppImage`
      },
      {
        name: `Heron-${version}-linux-arm64.AppImage`,
        state: "uploaded",
        size: 100,
        digest: `sha256:${armHex}`,
        browser_download_url: `https://github.com/minori-live/heron/releases/download/${tag}/Heron-${version}-linux-arm64.AppImage`
      }
    ]
  }
}

describe("nix-release-policy", () => {
  it("converts GitHub hex digests to Nix SRI hashes", () => {
    assert.equal(hexToSri(x64Hex), "sha256-rkI2VjVdrtHJaAdSQIQH6hFMI2CrQCyZvAxP3yqUHLs=")
    assert.equal(hexToSri(armHex), "sha256-9hvIwfrW2i+IGjJqmaC3A5EgHN4sViM8QGSWDL5Oews=")
  })

  it("parses a published stable release with both Linux AppImages", () => {
    const release = parseRelease(releasePayload("0.9.0"))
    assert.equal(release.version, "0.9.0")
    assert.equal(release.assets["x86_64-linux"].sha256, x64Hex)
    assert.equal(release.assets["aarch64-linux"].sha256, armHex)
  })

  it("rejects drafts, prereleases, and incomplete assets", () => {
    assert.throws(() => parseRelease(releasePayload("0.9.0", true)), /non-prerelease/)
    assert.throws(() => parseRelease(releasePayload("0.9.0", false, true)), /non-prerelease/)
    const incomplete = releasePayload("0.9.0")
    incomplete.assets.pop()
    assert.throws(() => parseRelease(incomplete), /exactly one release asset/)
  })

  it("reads and upgrades nix/release.nix pins without downgrading", () => {
    const identity = releaseIdentity(samplePin)
    assert.equal(identity.version, "0.8.0")
    assert.equal(compareVersions("0.9.0", "0.8.0"), 1)

    const upgraded = updateReleaseNix(samplePin, parseRelease(releasePayload("0.9.0")))
    assert.match(upgraded, /version = "0\.9\.0";/)
    assert.match(upgraded, /x86_64-linux = "sha256-rkI2VjVdrtHJaAdSQIQH6hFMI2CrQCyZvAxP3yqUHLs=";/)

    assert.equal(updateReleaseNix(samplePin, parseRelease(releasePayload("0.8.0"))), samplePin)
    assert.throws(
      () => updateReleaseNix(samplePin, parseRelease(releasePayload("0.7.0"))),
      /downgrade/
    )
  })

  it("refuses same-version digest replacements", () => {
    const mutated = releasePayload("0.8.0")
    mutated.assets[0]!.digest =
      "sha256:0000000000000000000000000000000000000000000000000000000000000000"
    assert.throws(() => updateReleaseNix(samplePin, parseRelease(mutated)), /same version/)
  })
})
