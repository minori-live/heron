import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import type { MixerChannelState } from "@heron/contracts"
import { describe, expect, it } from "vitest"
import { ProjectDatabase } from "../node"
import { useProjectDbFixture } from "./support/project-db-fixture"

const { databases, createDatabase } = useProjectDbFixture()

function encodePeaks(values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4)
  const view = new DataView(bytes.buffer)
  values.forEach((value, index) => view.setFloat32(index * 4, value, true))
  return bytes
}

describe("project assets, waveform cache, and archive durability", () => {
  it("restores non-destructive audio and MIDI clip edits after reopening", async () => {
    const resource = await createDatabase("disk")
    const audioPath = join(resource.directory, "editable-audio.wav")
    await writeFile(audioPath, new Uint8Array())
    await resource.database.importLargeObject(audioPath, {
      id: "editable-audio",
      name: "Editable audio",
      mimeType: "audio/x-bwf",
      contentHash: "editable-audio-hash",
      sampleRate: 96_000,
      channels: 2,
      bitDepth: "float32",
      frameCount: 192_000n,
      bwfTimeReference: 0n
    })

    const audioChannel: MixerChannelState = {
      id: "audio-edit",
      kind: "audio",
      systemRole: null,
      name: "Audio edit",
      color: "#5BC0EB",
      sortOrder: 0,
      inputSource: "hardware",
      inputFormat: "stereo",
      gainDb: 0,
      pan: 0,
      muted: false,
      soloed: false,
      outputChannelId: "output-1-2",
      outputBus: null,
      recordArmed: false,
      inputMonitoring: false,
      inputChannels: [1, 2],
      hardwareOutputChannels: []
    }
    const instrumentChannel: MixerChannelState = {
      ...audioChannel,
      id: "instrument-edit",
      kind: "instrument",
      name: "Instrument edit",
      sortOrder: 1,
      inputSource: null,
      inputFormat: null,
      inputChannels: []
    }
    await resource.database.applyCommand(
      {
        type: "batch",
        commands: [
          {
            type: "create-track",
            track: { id: "track:audio-edit", channelId: audioChannel.id, sortOrder: 0 },
            channel: audioChannel
          },
          {
            type: "create-track",
            track: {
              id: "track:instrument-edit",
              channelId: instrumentChannel.id,
              sortOrder: 1
            },
            channel: instrumentChannel
          },
          {
            type: "create-midi-source",
            source: {
              id: "editable-midi-source",
              name: "Editable MIDI",
              contentHash: "blank:editable-midi-source",
              rawBytes: new Uint8Array()
            }
          },
          {
            type: "create-midi-clip",
            clip: {
              id: "editable-midi-clip",
              sourceId: "editable-midi-source",
              trackId: "track:instrument-edit",
              name: "Editable MIDI",
              startTick: 0,
              sourceOffsetTicks: 0,
              lengthTicks: 3_840,
              sourceLengthTicks: 3_840,
              notes: [],
              events: []
            }
          },
          {
            type: "create-audio-clip",
            clip: {
              id: "editable-audio-clip",
              assetId: "editable-audio",
              trackId: "track:audio-edit",
              name: "Editable audio",
              startFrame: 0,
              sourceOffsetFrames: 0,
              lengthFrames: 48_000,
              sourceLengthFrames: 96_000,
              fadeInFrames: 0,
              fadeOutFrames: 0,
              assetSampleRate: 96_000,
              assetChannels: 2
            }
          }
        ]
      },
      "output-1-2"
    )
    await resource.database.applyCommand(
      {
        type: "batch",
        commands: [
          {
            type: "update-audio-clip",
            clipId: "editable-audio-clip",
            patch: {
              sourceOffsetFrames: 12_000,
              lengthFrames: 36_000,
              fadeInFrames: 2_400,
              fadeOutFrames: 4_800
            }
          },
          {
            type: "update-midi-clip-range",
            clipId: "editable-midi-clip",
            patch: {
              startTick: 960,
              sourceOffsetTicks: 480,
              lengthTicks: 2_880,
              sourceLengthTicks: 7_680
            }
          }
        ]
      },
      "output-1-2"
    )

    await resource.database.close()
    databases.splice(databases.indexOf(resource), 1)
    const reopened = await ProjectDatabase.open(join(resource.directory, "pgdata"))
    databases.push({ database: reopened, directory: resource.directory })

    const restored = await reopened.mixerSnapshot()
    expect(restored.audioClips).toContainEqual(
      expect.objectContaining({
        id: "editable-audio-clip",
        sourceOffsetFrames: 12_000,
        lengthFrames: 36_000,
        sourceLengthFrames: 96_000,
        fadeInFrames: 2_400,
        fadeOutFrames: 4_800
      })
    )
    expect(restored.midiClips).toContainEqual(
      expect.objectContaining({
        id: "editable-midi-clip",
        startTick: 960,
        sourceOffsetTicks: 480,
        lengthTicks: 2_880,
        sourceLengthTicks: 7_680
      })
    )
  }, 30_000)

  it("persists assets, waveform caches, and large objects through an archive", async () => {
    const { database, directory } = await createDatabase("disk")
    const audioPath = join(directory, "audio.bwf")
    const archivePath = join(directory, "project.dump")
    const audio = new Uint8Array([1, 3, 5, 7, 9, 11])
    await writeFile(audioPath, audio)

    await database.importLargeObject(audioPath, {
      id: "asset-1",
      name: "Audio",
      mimeType: "audio/x-bwf",
      contentHash: "hash-1",
      sampleRate: 48_000,
      channels: 2,
      bitDepth: "float32",
      frameCount: 2n,
      bwfTimeReference: 0n,
      waveformLevels: [
        {
          framesPerBucket: 2,
          bucketCount: 1,
          peaks: encodePeaks([-1, 1, -0.5, 0.5])
        }
      ]
    })

    expect(await database.readLargeObject("asset-1")).toEqual(audio)
    expect(await database.listAssets()).toEqual([
      {
        id: "asset-1",
        kind: "audio",
        name: "Audio",
        contentHash: "hash-1",
        sampleRate: 48_000,
        channels: 2,
        bitDepth: "float32",
        frameCount: 2n
      }
    ])
    expect(await database.assetsMissingWaveform()).toEqual([])
    expect(await database.readWaveform("asset-1", 0, 2, 100)).toMatchObject({
      sampleRate: 48_000,
      channels: 2,
      frameCount: 2,
      framesPerBucket: 2,
      bucketCount: 1
    })

    await database.dumpTo(archivePath)
    expect([...(await readFile(archivePath)).subarray(0, 2)]).not.toEqual([0x1f, 0x8b])
    const restoredDirectory = await mkdtemp(join(tmpdir(), "heron-project-db-restored-"))
    const restored = await ProjectDatabase.open(join(restoredDirectory, "pgdata"), archivePath)
    databases.push({ database: restored, directory: restoredDirectory })

    expect(await restored.readLargeObject("asset-1")).toEqual(audio)
    expect(await restored.readWaveform("asset-1", 0, 2, 100)).toMatchObject({
      startFrame: 0,
      endFrame: 2,
      framesPerBucket: 2,
      bucketCount: 1,
      peaks: encodePeaks([-1, 1, -0.5, 0.5])
    })
    await restored.storeWaveform("asset-1", {
      sampleRate: 48_000,
      channels: 2,
      frameCount: 2n,
      levels: []
    })
    expect(await restored.assetsMissingWaveform()).toEqual(["asset-1"])
    await restored.deleteAssets(["asset-1"])
    expect(await restored.listAssets()).toEqual([])
    await expect(restored.readLargeObject("asset-1")).rejects.toThrow("was not found")
  }, 15_000)

  it("selects and slices one waveform level inside PGlite", async () => {
    const { database, directory } = await createDatabase()
    const audioPath = join(directory, "waveform-window.bwf")
    await writeFile(audioPath, new Uint8Array())
    const detailedValues = Array.from({ length: 24 }, (_, index) => index + 1)
    const overviewValues = Array.from({ length: 12 }, (_, index) => 101 + index)
    await database.importLargeObject(audioPath, {
      id: "waveform-window",
      name: "Waveform window",
      mimeType: "audio/x-bwf",
      contentHash: "waveform-window-hash",
      sampleRate: 48_000,
      channels: 2,
      bitDepth: "float32",
      frameCount: 12n,
      bwfTimeReference: 0n,
      waveformLevels: [
        {
          framesPerBucket: 2,
          bucketCount: 6,
          peaks: encodePeaks(detailedValues)
        },
        {
          framesPerBucket: 4,
          bucketCount: 3,
          peaks: encodePeaks(overviewValues)
        }
      ]
    })

    expect(await database.readWaveform("waveform-window", 3, 9, 100)).toEqual({
      sampleRate: 48_000,
      channels: 2,
      frameCount: 12,
      startFrame: 2,
      endFrame: 10,
      framesPerBucket: 2,
      bucketCount: 4,
      peaks: encodePeaks(detailedValues.slice(4, 20))
    })
    expect(await database.readWaveform("waveform-window", 0, 12, 3)).toEqual({
      sampleRate: 48_000,
      channels: 2,
      frameCount: 12,
      startFrame: 0,
      endFrame: 12,
      framesPerBucket: 4,
      bucketCount: 3,
      peaks: encodePeaks(overviewValues)
    })
    expect(await database.readWaveform("waveform-window", -10, 30, 100)).toEqual({
      sampleRate: 48_000,
      channels: 2,
      frameCount: 12,
      startFrame: 0,
      endFrame: 12,
      framesPerBucket: 2,
      bucketCount: 6,
      peaks: encodePeaks(detailedValues)
    })
    expect(await database.readWaveform("waveform-window", 10, 2, 100)).toMatchObject({
      startFrame: 10,
      endFrame: 10,
      bucketCount: 0,
      peaks: new Uint8Array()
    })
    expect(await database.readWaveform("missing", 0, 10, 100)).toBeNull()
  }, 15_000)

  it("reclaims orphaned large objects before writing the archive", async () => {
    const resource = await createDatabase("disk")
    await resource.database.close()
    databases.splice(databases.indexOf(resource), 1)

    const raw = new PGlite(join(resource.directory, "pgdata"))
    try {
      await raw.query("select lo_from_bytea(0, $1)", [new Uint8Array([1, 2, 3, 4])])
      const before = await raw.query<{ count: number }>(
        "select count(*)::int as count from pg_catalog.pg_largeobject_metadata"
      )
      expect(before.rows[0]?.count).toBe(1)
    } finally {
      await raw.close()
    }

    const database = await ProjectDatabase.open(join(resource.directory, "pgdata"))
    databases.push({ database, directory: resource.directory })
    const archivePath = join(resource.directory, "maintained-project.dump")
    await database.dumpTo(archivePath)

    const verificationDirectory = await mkdtemp(join(tmpdir(), "heron-maintained-archive-"))
    const verifier = await PGlite.create({
      dataDir: join(verificationDirectory, "pgdata"),
      loadDataDir: new Blob([await readFile(archivePath)])
    })
    try {
      const after = await verifier.query<{ count: number }>(
        "select count(*)::int as count from pg_catalog.pg_largeobject_metadata"
      )
      expect(after.rows[0]?.count).toBe(0)
    } finally {
      await verifier.close()
      await rm(verificationDirectory, { force: true, recursive: true })
    }
  }, 15_000)

  it("rolls back a cancelled large-object import", async () => {
    const { database, directory } = await createDatabase()
    const audioPath = join(directory, "cancelled.bwf")
    await writeFile(audioPath, new Uint8Array([1, 2, 3, 4]))

    await expect(
      database.importLargeObject(
        audioPath,
        {
          id: "cancelled",
          name: "Cancelled",
          mimeType: "audio/x-bwf",
          contentHash: "cancelled-hash",
          sampleRate: 48_000,
          channels: 1,
          bitDepth: "pcm16",
          frameCount: 2n,
          bwfTimeReference: 0n
        },
        undefined,
        () => true
      )
    ).rejects.toThrow("cancelled")
    expect(await database.listAssets()).toEqual([])
  })
})
