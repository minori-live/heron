import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ProjectAudioAssetSummary } from "@heron/contracts"
import type { ProjectService } from "./project-service"
import { AssetMaterializer } from "./asset-materializer"
import { AudioImportBatchError, AudioImportService } from "./audio-import-service"

const importAudioFile = vi.hoisted(() => vi.fn())

vi.mock("@heron/dsp-node", () => ({ importAudioFile }))

let directory: string
const convertedBytes = Buffer.from([4, 3, 2, 1])

function converted(contentHash = "audio-hash") {
  return {
    contentHash,
    sampleRate: 48_000,
    channels: 2,
    frameCount: 96_000,
    waveformLevels: [{ framesPerBucket: 256, bucketCount: 1, peaks: Buffer.from([1, 2, 3, 4]) }]
  }
}

function audioAsset(overrides: Partial<ProjectAudioAssetSummary> = {}): ProjectAudioAssetSummary {
  return {
    id: "existing-audio",
    kind: "audio",
    name: "First name.wav",
    contentHash: "audio-hash",
    sampleRate: 48_000,
    channels: 2,
    bitDepth: "float32",
    frameCount: 96_000n,
    ...overrides
  }
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "heron-audio-import-"))
  importAudioFile.mockReset()
  importAudioFile.mockImplementation(async ({ outputPath }: { outputPath: string }) => {
    await writeFile(outputPath, convertedBytes)
    return converted()
  })
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe("AudioImportService", () => {
  it("persists converted bytes and reuses them when the imported asset is materialized", async () => {
    const projects = {
      findAssetByContentHash: vi.fn(async () => null),
      importLargeObject: vi.fn(async (path: string) => {
        await expect(readFile(path)).resolves.toEqual(convertedBytes)
      }),
      assetContentHashes: vi.fn(async (ids: string[]) =>
        ids.map((id) => ({ id, contentHash: "audio-hash" }))
      ),
      readAssetAudio: vi.fn(async () => convertedBytes)
    }
    const materializer = new AssetMaterializer(directory, projects)
    const service = new AudioImportService(
      directory,
      projects as unknown as ProjectService,
      materializer
    )

    const result = await service.import(["/samples/Kick.mp3"], "operation-1")

    expect(result.importedAssetIds).toHaveLength(1)
    expect(projects.findAssetByContentHash).toHaveBeenCalledWith("audio", "audio-hash")
    expect(result.selectedAssetIds).toEqual(result.importedAssetIds)
    expect(importAudioFile).toHaveBeenCalledWith(
      expect.objectContaining({ inputPath: "/samples/Kick.mp3", originator: "Heron" })
    )
    expect(projects.importLargeObject).toHaveBeenCalledWith(
      expect.stringMatching(/\.bwf$/),
      "operation-1",
      expect.objectContaining({
        id: result.importedAssetIds[0],
        name: "Kick.mp3",
        mimeType: "audio/x-bwf",
        contentHash: "audio-hash",
        sampleRate: 48_000,
        channels: 2,
        bitDepth: "float32",
        frameCount: 96_000n
      }),
      expect.any(Function)
    )
    const assetId = result.importedAssetIds[0]!
    const first = await materializer.materializeAsset(assetId)
    expect(await materializer.materializeAsset(assetId)).toBe(first)
    await expect(readFile(first)).resolves.toEqual(convertedBytes)
    expect(projects.readAssetAudio).not.toHaveBeenCalled()
    await expect(readdir(join(directory, "media-import"))).resolves.toEqual([])
  })

  it("deduplicates by content hash and retains the first imported name", async () => {
    const existing = audioAsset()
    const projects = {
      findAssetByContentHash: vi.fn(async () => existing),
      importLargeObject: vi.fn(async () => undefined)
    }
    const assets = { adoptImportedAsset: vi.fn(async () => undefined) }
    const service = new AudioImportService(directory, projects as unknown as ProjectService, assets)

    const result = await service.import(["/renamed/Same Content.flac"], "operation-2")

    expect(result).toEqual({ selectedAssetIds: [existing.id], importedAssetIds: [] })
    expect(projects.importLargeObject).not.toHaveBeenCalled()
    expect(assets.adoptImportedAsset).not.toHaveBeenCalled()
    await expect(readdir(join(directory, "media-import"))).resolves.toEqual([])
  })

  it.each(["worker result lost", "AbortError"])(
    "retains the dispatched-write outcome on %s",
    async (reason) => {
      const projects = {
        findAssetByContentHash: vi.fn(async () => null),
        importLargeObject: vi.fn(async () => {
          throw Object.assign(new Error(reason), { name: reason })
        })
      }
      const assets = { adoptImportedAsset: vi.fn(async () => undefined) }
      const service = new AudioImportService(
        directory,
        projects as unknown as ProjectService,
        assets
      )

      const failure = await service
        .import(["/samples/Kick.wav"], "operation-3")
        .catch((error) => error)

      expect(failure).toBeInstanceOf(AudioImportBatchError)
      expect(failure).toMatchObject({ databaseWriteDispatched: true, importedAssetIds: [] })
      expect(assets.adoptImportedAsset).not.toHaveBeenCalled()
      await expect(readdir(join(directory, "media-import"))).resolves.toEqual([])
    }
  )

  it("keeps a committed import successful when cache publication fails and rebuilds it later", async () => {
    const projects = {
      findAssetByContentHash: vi.fn(async () => null),
      importLargeObject: vi.fn(async () => undefined),
      assetContentHashes: vi.fn(async (ids: string[]) =>
        ids.map((id) => ({ id, contentHash: "audio-hash" }))
      ),
      readAssetAudio: vi.fn(async () => convertedBytes)
    }
    const cacheDirectory = join(directory, "mixer-cache")
    await writeFile(cacheDirectory, "cache directory is unavailable")
    const materializer = new AssetMaterializer(directory, projects)
    const service = new AudioImportService(
      directory,
      projects as unknown as ProjectService,
      materializer
    )

    const result = await service.import(["/samples/Kick.wav"], "operation-cache-failure")

    expect(result.importedAssetIds).toHaveLength(1)
    expect(result.selectedAssetIds).toEqual(result.importedAssetIds)
    await expect(readdir(join(directory, "media-import"))).resolves.toEqual([])
    await rm(cacheDirectory)
    const path = await materializer.materializeAsset(result.importedAssetIds[0]!)
    await expect(readFile(path)).resolves.toEqual(convertedBytes)
    expect(projects.readAssetAudio).toHaveBeenCalledExactlyOnceWith(result.importedAssetIds[0])
  })

  it("cleans a cancelled conversion before any database write is dispatched", async () => {
    importAudioFile.mockImplementation(async ({ outputPath }: { outputPath: string }) => {
      await writeFile(outputPath, convertedBytes)
      throw Object.assign(new Error("conversion cancelled"), { name: "AbortError" })
    })
    const projects = {
      findAssetByContentHash: vi.fn(async () => null),
      importLargeObject: vi.fn(async () => undefined)
    }
    const assets = { adoptImportedAsset: vi.fn(async () => undefined) }
    const service = new AudioImportService(directory, projects as unknown as ProjectService, assets)

    await expect(
      service.import(["/samples/Kick.wav"], "operation-cancelled")
    ).rejects.toMatchObject({
      databaseWriteDispatched: false,
      importedAssetIds: [],
      selectedAssetIds: []
    })
    expect(projects.importLargeObject).not.toHaveBeenCalled()
    expect(assets.adoptImportedAsset).not.toHaveBeenCalled()
    await expect(readdir(join(directory, "media-import"))).resolves.toEqual([])
  })
})
