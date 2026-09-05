import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { verifyUpdateAssets } from "../../../scripts/verify-update-assets.ts"

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

describe("release update assets", () => {
  it.each([
    null,
    [],
    "metadata",
    {},
    { version: "1.0.0", files: "files" },
    { version: "1.0.0", files: [] }
  ])("rejects malformed metadata: %j", async (metadata) => {
    const directory = await mkdtemp(join(tmpdir(), "heron-updates-"))
    directories.push(directory)
    await writeFile(join(directory, "latest.yml"), JSON.stringify(metadata))
    await expect(verifyUpdateAssets(directory, "1.0.0", "latest", "windows-x64")).rejects.toThrow(
      "Invalid update version/files"
    )
  })

  it.each([
    null,
    [],
    "file",
    {},
    { url: 42 },
    { url: "Heron.exe", sha512: 42, size: 1 },
    { url: "Heron.exe", sha512: "", size: 1 },
    { url: "Heron.exe", sha512: "hash", size: "1" },
    { url: "Heron.exe", sha512: "hash", size: -1 },
    { url: "Heron.exe", sha512: "hash", size: 1.5 },
    { url: "Heron.exe", sha512: "hash", size: Number.MAX_SAFE_INTEGER + 1 }
  ])("rejects malformed file entries before accessing artifacts: %j", async (file) => {
    const directory = await mkdtemp(join(tmpdir(), "heron-updates-"))
    directories.push(directory)
    await writeFile(
      join(directory, "latest.yml"),
      JSON.stringify({
        version: "1.0.0",
        files: [{ url: "Heron.exe", sha512: "hash", size: 1 }, file]
      })
    )
    await expect(verifyUpdateAssets(directory, "1.0.0", "latest", "windows-x64")).rejects.toThrow(
      "Invalid update files[1]"
    )
  })

  it.each([
    ["windows-x64", "latest.yml", "Heron.exe"],
    ["macos-universal", "latest-mac.yml", "Heron.zip"],
    ["linux-x64", "latest-linux.yml", "Heron-x64.AppImage"],
    ["linux-arm64", "latest-linux-arm64.yml", "Heron-arm64.AppImage"]
  ])("validates all metadata references for %s", async (platform, metadataName, artifact) => {
    const directory = await mkdtemp(join(tmpdir(), "heron-updates-"))
    directories.push(directory)
    const bytes = Buffer.from("test installer")
    const metadata = {
      version: "1.0.0",
      files: [
        {
          url: artifact,
          size: bytes.length,
          sha512: createHash("sha512").update(bytes).digest("base64")
        }
      ]
    }
    await writeFile(join(directory, artifact), bytes)
    await writeFile(join(directory, `${artifact}.blockmap`), "blockmap")
    // JSON is valid YAML; the fixture passes through the same production YAML parser.
    await writeFile(join(directory, metadataName), JSON.stringify(metadata))
    expect(await verifyUpdateAssets(directory, "1.0.0", "latest", platform)).toBe(metadataName)
    await writeFile(join(directory, artifact), "bad installer!")
    await expect(verifyUpdateAssets(directory, "1.0.0", "latest", platform)).rejects.toThrow()
  })
  it("does not accept metadata for a different architecture or version", async () => {
    const directory = await mkdtemp(join(tmpdir(), "heron-updates-"))
    directories.push(directory)
    await writeFile(
      join(directory, "beta-linux.yml"),
      JSON.stringify({ version: "0.9.0", files: [{}] })
    )
    await expect(
      verifyUpdateAssets(directory, "1.0.0-beta.1", "beta", "linux-arm64")
    ).rejects.toThrow()
    await expect(
      verifyUpdateAssets(directory, "1.0.0-beta.1", "beta", "linux-x64")
    ).rejects.toThrow("Invalid update version")
  })
})
