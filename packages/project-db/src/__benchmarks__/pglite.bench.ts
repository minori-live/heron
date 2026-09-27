import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { performance } from "node:perf_hooks"
import type { ProjectCommand } from "@heron/contracts"
import { afterAll, beforeAll, bench, describe, expect } from "vitest"
import { PROJECT_MIGRATIONS_FOLDER } from "../migrations"
import { ProjectDatabase } from "../node"
import type { LargeObjectAssetInput } from "../protocol"
import { buildProjectTemplateArchive } from "../template"

const MIB = 1024 * 1024
const AUDIO_BYTES = 16 * MIB
const AUDIO_FRAMES = AUDIO_BYTES / (2 * 4)
const configuration = {
  name: "PGlite benchmark",
  sampleRate: 48_000,
  numerator: 4,
  denominator: 4,
  waveformDisplayMode: "separate" as const
}
const audioAsset: LargeObjectAssetInput = {
  id: "asset-1",
  name: "16 MiB stereo audio",
  mimeType: "audio/x-bwf",
  contentHash: "asset-hash",
  sampleRate: 48_000,
  channels: 2,
  bitDepth: "float32",
  frameCount: BigInt(AUDIO_FRAMES),
  bwfTimeReference: 0n
}

let database: ProjectDatabase | undefined
let directory: string | undefined
let templateArchivePath: string
let archivePath: string
let audioPath: string
let sequence = 0
const samples = new Map<string, number[]>()

// Fixed xorshift32 seed keeps binary fixtures reproducible and avoids measuring
// artificially cheap all-zero audio or plug-in chunks.
function binaryFixture(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  let state = 0x1a2b3c4d
  for (let index = 0; index < length; index++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    bytes[index] = state & 0xff
  }
  return bytes
}

function notes(clipId: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${clipId}-note-${index}`,
    startTick: index * 3,
    durationTicks: 2,
    channel: 0,
    key: 60 + (index % 12),
    velocity: 100,
    releaseVelocity: 0
  }))
}

function measure(name: string, operation: () => Promise<unknown>, iterations = 5): void {
  const durations: number[] = []
  samples.set(name, durations)
  bench(
    name,
    async () => {
      const start = performance.now()
      await operation()
      durations.push(performance.now() - start)
    },
    { iterations, time: 0, warmupIterations: 0, warmupTime: 0 }
  )
}

function percentile(sorted: number[], ratio: number): number {
  const index = (sorted.length - 1) * ratio
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower)
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "heron-pglite-bench-"))
  templateArchivePath = join(directory, "project-template.pglite.gz")
  archivePath = join(directory, "baseline.hrs")
  await buildProjectTemplateArchive(templateArchivePath, PROJECT_MIGRATIONS_FOLDER)
  database = await ProjectDatabase.create(
    join(directory, "pgdata"),
    configuration,
    templateArchivePath
  )

  const trackCommands: ProjectCommand[] = Array.from({ length: 64 }, (_, index) => ({
    type: "create-track",
    track: { id: `track-${index}`, channelId: `channel-${index}`, sortOrder: index + 1 },
    channel: {
      id: `channel-${index}`,
      kind: "instrument",
      systemRole: null,
      name: `Track ${index}`,
      color: "#4F8CFF",
      sortOrder: index + 1,
      inputSource: null,
      inputFormat: null,
      gainDb: 0,
      pan: 0,
      muted: false,
      soloed: false,
      outputChannelId: "output-1-2",
      outputBus: null,
      recordArmed: false,
      inputMonitoring: false,
      inputChannels: [],
      hardwareOutputChannels: []
    }
  }))
  await database.applyCommand({ type: "batch", commands: trackCommands }, "output-1-2")

  const midiCommands: ProjectCommand[] = Array.from({ length: 32 }, (_, index) => ({
    type: "create-midi-clip",
    clip: {
      id: `clip-${index}`,
      sourceId: "source-1",
      trackId: `track-${index}`,
      name: `Clip ${index}`,
      startTick: index * 3_840,
      lengthTicks: 3_840,
      sourceOffsetTicks: 0,
      sourceLengthTicks: 3_840,
      notes: notes(`clip-${index}`, 1_000),
      events: []
    }
  }))
  const stateBytes = binaryFixture(8 * MIB)
  await database.importMidi(
    {
      id: "source-1",
      name: "Synthetic MIDI source with 8 MiB payload",
      contentHash: "source-hash",
      rawBytes: stateBytes
    },
    { type: "batch", commands: midiCommands },
    "output-1-2"
  )
  await database.savePluginStates([
    {
      id: "metronome-instrument",
      state: { version: 1, chunks: [{ key: "component", bytes: stateBytes }] }
    }
  ])

  audioPath = join(directory, "audio.bwf")
  const audio = binaryFixture(AUDIO_BYTES)
  await writeFile(audioPath, audio)
  await database.importLargeObject(audioPath, audioAsset)
  const levels = []
  let framesPerBucket = 64
  while (true) {
    const bucketCount = Math.ceil(AUDIO_FRAMES / framesPerBucket)
    levels.push({ framesPerBucket, bucketCount, peaks: new Uint8Array(bucketCount * 2 * 8) })
    if (bucketCount <= 1) break
    framesPerBucket *= 4
  }
  await database.storeWaveform("asset-1", {
    sampleRate: 48_000,
    channels: 2,
    frameCount: BigInt(AUDIO_FRAMES),
    levels
  })

  // Fail setup if the intended workload has drifted; all timings below use the
  // public repository API, including its validation and transaction boundaries.
  const snapshot = await database.mixerSnapshot()
  expect(snapshot.channels).toHaveLength(68)
  expect(snapshot.midiClips.reduce((count, clip) => count + clip.notes.length, 0)).toBe(32_000)
  expect(Buffer.from(await database.readLargeObject("asset-1")).equals(Buffer.from(audio))).toBe(
    true
  )
  await database.dumpTo(archivePath)
  process.stdout.write(`PGlite benchmark data directory: ${directory}\n`)
}, 60_000)

afterAll(async () => {
  for (const [name, durations] of samples) {
    if (durations.length === 0) continue
    const sorted = [...durations].sort((left, right) => left - right)
    process.stdout.write(
      `${name}: n=${sorted.length} p50=${percentile(sorted, 0.5).toFixed(3)}ms p95=${percentile(sorted, 0.95).toFixed(3)}ms\n`
    )
  }
  try {
    await database?.close()
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true })
  }
})

describe("PGlite document lifecycle", () => {
  measure(
    "new disk document from template, including close",
    async () => {
      const created = await ProjectDatabase.create(
        join(directory!, `created-${sequence++}`),
        configuration,
        templateArchivePath
      )
      await created.close()
    },
    3
  )

  measure(
    "restore populated archive, including close",
    async () => {
      const restored = await ProjectDatabase.open(
        join(directory!, `restored-${sequence++}`),
        archivePath
      )
      await restored.close()
    },
    3
  )

  measure(
    "save populated project archive",
    () => database!.dumpTo(join(directory!, "saved.hrs")),
    3
  )
})

describe("PGlite warm project: 68 channels, 32k notes, 8 MiB plug-in state", () => {
  measure("full project snapshot", () => database!.mixerSnapshot())

  measure("rename one channel with committed snapshot", () =>
    database!.applyCommand(
      {
        type: "update-channel",
        channelId: "channel-0",
        patch: { name: `Renamed ${sequence++}` }
      },
      "output-1-2"
    )
  )

  measure("update 1000 note velocities with committed snapshot", () =>
    database!
      .applyCommand(
        {
          type: "update-midi-notes",
          clipId: "clip-0",
          updates: Array.from({ length: 1000 }, (_, index) => ({
            noteId: `clip-0-note-${index}`,
            patch: { velocity: 90 + (sequence % 2) }
          }))
        },
        "output-1-2"
      )
      .then(() => {
        sequence++
      })
  )

  measure("asset metadata with an 8 MiB MIDI source", () => database!.listAssets())

  measure(
    "windowed waveform read: 16 MiB stereo audio",
    () => database!.readWaveform("asset-1", 1_000_000, 1_064_000, 1_000),
    20
  )

  measure("read 16 MiB audio large object", () => database!.readLargeObject("asset-1"), 3)

  // These two operations include their public undo/delete path to keep each
  // iteration's logical project size constant. Their names reflect that cost.
  measure(
    "import and undo one 8192-note MIDI clip",
    async () => {
      await database!.importMidi(
        {
          id: "import-source",
          name: "Import",
          contentHash: "import-source",
          rawBytes: new Uint8Array([1])
        },
        {
          type: "create-midi-clip",
          clip: {
            id: "import-clip",
            sourceId: "import-source",
            trackId: "track-0",
            name: "Imported",
            startTick: 0,
            lengthTicks: 32_768,
            sourceOffsetTicks: 0,
            sourceLengthTicks: 32_768,
            notes: notes("import-clip", 8192),
            events: []
          }
        },
        "output-1-2"
      )
      await database!.rollbackMidi(
        "import-source",
        { type: "delete-midi-clip", clipId: "import-clip" },
        "output-1-2"
      )
    },
    3
  )

  measure(
    "import and delete 16 MiB audio large object",
    async () => {
      await database!.importLargeObject(audioPath, {
        ...audioAsset,
        id: "import-asset",
        contentHash: "import-asset"
      })
      await database!.deleteAssets(["import-asset"])
    },
    3
  )
})
