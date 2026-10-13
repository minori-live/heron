import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import {
  applyPin,
  appImageName,
  hexToSri,
  pinFromAppImages,
  releaseIdentity,
  renderReleaseNix,
  sha256FileHex
} from "./nix-release-policy.ts"

const x64Hex = "ae423656355daed1c9680752408407ea114c2360ab402c99bc0c4fdf2a941cbb"
const armHex = "f61bc8c1fad6da2f881a326a99a0b70391201cde2c56233c4064960cbe4e7b0b"

function pinContent(
  version: string,
  x64 = x64Hex,
  arm = armHex
): ReturnType<typeof releaseIdentity> {
  return releaseIdentity(
    renderReleaseNix({
      version,
      hashes: {
        "x86_64-linux": hexToSri(x64),
        "aarch64-linux": hexToSri(arm)
      }
    })
  )
}

const samplePin = renderReleaseNix(pinContent("0.8.0"))

describe("nix-release-policy", () => {
  it("converts hex digests to Nix SRI hashes", () => {
    assert.equal(hexToSri(x64Hex), "sha256-rkI2VjVdrtHJaAdSQIQH6hFMI2CrQCyZvAxP3yqUHLs=")
    assert.equal(hexToSri(armHex), "sha256-9hvIwfrW2i+IGjJqmaC3A5EgHN4sViM8QGSWDL5Oews=")
  })

  it("names Linux AppImages with the release artifact pattern", () => {
    assert.equal(appImageName("0.8.0", "x86_64-linux"), "Heron-0.8.0-linux-x86_64.AppImage")
    assert.equal(appImageName("0.8.0", "aarch64-linux"), "Heron-0.8.0-linux-arm64.AppImage")
  })

  it("reads and renders nix/release.nix pins", () => {
    assert.deepEqual(releaseIdentity(samplePin), pinContent("0.8.0"))
  })

  it("pins from local AppImage bytes", () => {
    const directory = mkdtempSync(join(tmpdir(), "heron-nix-pin-"))
    const x64Path = join(directory, appImageName("0.9.0", "x86_64-linux"))
    const armPath = join(directory, appImageName("0.9.0", "aarch64-linux"))
    writeFileSync(x64Path, "x64-appimage")
    writeFileSync(armPath, "arm-appimage")

    const pin = pinFromAppImages("0.9.0", {
      "x86_64-linux": x64Path,
      "aarch64-linux": armPath
    })
    assert.equal(pin.version, "0.9.0")
    assert.equal(pin.hashes["x86_64-linux"], hexToSri(sha256FileHex(x64Path)))
    assert.equal(pin.hashes["aarch64-linux"], hexToSri(sha256FileHex(armPath)))
  })

  it("applies upgrades and refuses stable downgrades", () => {
    const upgraded = applyPin(samplePin, pinContent("0.9.0"))
    assert.equal(upgraded.changed, true)
    assert.match(upgraded.next, /version = "0\.9\.0";/)

    assert.throws(() => applyPin(samplePin, pinContent("0.7.0")), /downgrade/)
    assert.equal(applyPin(samplePin, pinContent("0.8.0")).changed, false)
  })

  it("allows same-version digest replacement for draft rebuilds", () => {
    const rebuilt = pinContent("0.8.0", "0".repeat(64), armHex)
    const result = applyPin(samplePin, rebuilt)
    assert.equal(result.changed, true)
    assert.match(result.next, /x86_64-linux = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="/)
  })
})
