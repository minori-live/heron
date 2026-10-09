import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { describe, expect, it } from "vitest"
import { useProjectDbFixture } from "./support/project-db-fixture"

const { createDatabase, templatePath } = useProjectDbFixture()

describe("project schema, migrations, and channel configuration", () => {
  it("opens the generated schema-only template with migrations already applied", async () => {
    const directory = await mkdtemp(join(tmpdir(), "heron-project-template-verifier-"))
    const verifier = await PGlite.create({
      dataDir: join(directory, "pgdata"),
      loadDataDir: new Blob([await readFile(templatePath())])
    })
    try {
      const projectRows = await verifier.query<{ count: number }>(
        "select count(*)::int as count from project"
      )
      expect(projectRows.rows[0]?.count).toBe(0)
    } finally {
      await verifier.close()
      await rm(directory, { force: true, recursive: true })
    }
  })

  it("runs generated migrations, seeds the graph, and updates normalized configuration", async () => {
    const { database } = await createDatabase()

    await database.migrate()
    expect(await database.getConfiguration()).toEqual({
      name: "Test project",
      sampleRate: 48_000,
      timeSignatureNumerator: 4,
      timeSignatureDenominator: 4,
      waveformDisplayMode: "separate"
    })
    expect(await database.defaultRecordingTrack()).toEqual({
      id: "audio-1",
      name: "Audio 1",
      inputChannels: [1, 2]
    })

    const seeded = await database.mixerSnapshot()
    expect(seeded.channels.map(({ id }) => id)).toEqual([
      "audio-1",
      "metronome",
      "master",
      "output-1-2"
    ])
    expect(seeded.channels.find(({ id }) => id === "metronome")).toMatchObject({
      kind: "instrument",
      systemRole: "metronome",
      muted: true,
      outputChannelId: "output-1-2"
    })
    expect(seeded.plugins.find(({ id }) => id === "metronome-instrument")).toMatchObject({
      channelId: "metronome",
      locator: {
        format: "vst3",
        nativeId: "8CD16A11027ACC7FDF0C1419E86D1024"
      },
      role: "instrument",
      descriptor: {
        source: { kind: "builtin", id: "live.minori.heron.metronome" }
      }
    })
    expect(seeded.tempoMap).toEqual({
      ticksPerQuarter: 960,
      tempoEvents: [{ tick: 0, beatsPerMinute: 120 }],
      timeSignatureEvents: [{ tick: 0, numerator: 4, denominator: 4 }]
    })
    expect(seeded.keySignatureEvents).toEqual([{ tick: 0, fifths: 0, mode: "major" }])
    expect(seeded.channels.find(({ id }) => id === "audio-1")?.inputMonitoring).toBe(false)
    expect(seeded.projectNotes).toBe("")
    expect(seeded.projectEndTick).toBe(61_440)
    expect(seeded.tracks[0]?.notes).toBe("")

    await database.applyCommand(
      { type: "update-project-notes", notes: "# Recording plan" },
      "output-1-2"
    )
    await database.applyCommand({ type: "update-project-end", endTick: 15_360 }, "output-1-2")
    await database.applyCommand(
      { type: "update-track", trackId: "track:audio-1", patch: { notes: "Use take 3." } },
      "output-1-2"
    )
    await database.applyCommand(
      { type: "update-track", trackId: "track:audio-1", patch: { sortOrder: 2 } },
      "output-1-2"
    )
    const noted = await database.mixerSnapshot()
    expect(noted.projectNotes).toBe("# Recording plan")
    expect(noted.projectEndTick).toBe(15_360)
    expect(noted.tracks[0]).toMatchObject({ notes: "Use take 3.", sortOrder: 2 })

    await database.updateConfiguration({
      name: "Renamed",
      sampleRate: 44_100,
      timeSignatureNumerator: 7,
      timeSignatureDenominator: 8,
      waveformDisplayMode: "aggregate"
    })
    await database.applyCommand(
      {
        type: "update-channel",
        channelId: "audio-1",
        patch: {}
      },
      "output-1-2"
    )

    expect(await database.getConfiguration()).toEqual({
      name: "Renamed",
      sampleRate: 44_100,
      timeSignatureNumerator: 7,
      timeSignatureDenominator: 8,
      waveformDisplayMode: "aggregate"
    })
    expect((await database.mixerSnapshot()).tempoMap.timeSignatureEvents[0]).toEqual({
      tick: 0,
      numerator: 7,
      denominator: 8
    })
    await database.applyCommand(
      {
        type: "replace-key-signature-map",
        events: [
          { tick: 0, fifths: 2, mode: "major" },
          { tick: 3_840, fifths: -7, mode: "minor" }
        ]
      },
      "output-1-2"
    )
    expect((await database.mixerSnapshot()).keySignatureEvents).toEqual([
      { tick: 0, fifths: 2, mode: "major" },
      { tick: 3_840, fifths: -7, mode: "minor" }
    ])
  })

  it("persists input monitoring only for Audio channels", async () => {
    const { database } = await createDatabase()
    await database.applyCommand(
      {
        type: "update-channel",
        channelId: "audio-1",
        patch: { inputMonitoring: true }
      },
      "output-1-2"
    )
    expect(
      (await database.mixerSnapshot()).channels.find(({ id }) => id === "audio-1")
    ).toMatchObject({ inputMonitoring: true })

    await expect(
      database.applyCommand(
        {
          type: "update-channel",
          channelId: "metronome",
          patch: { inputMonitoring: true }
        },
        "output-1-2"
      )
    ).rejects.toThrow()
  })

  it("round-trips application capture targets before enabling input monitoring", async () => {
    const { database } = await createDatabase()
    const target = {
      platform: "windows" as const,
      executablePath: "C:\\Program Files\\Steam\\steam.exe",
      executableName: "steam.exe",
      includeProcessTree: true
    }

    await database.applyCommand(
      {
        type: "update-channel",
        channelId: "audio-1",
        patch: {
          inputSource: "application",
          inputFormat: "stereo",
          inputChannels: [1, 2],
          applicationCapture: target
        }
      },
      "output-1-2"
    )
    expect(
      (await database.mixerSnapshot()).channels.find(({ id }) => id === "audio-1")
    ).toMatchObject({ inputSource: "application", applicationCapture: target })

    await database.applyCommand(
      {
        type: "update-channel",
        channelId: "audio-1",
        patch: { inputMonitoring: true }
      },
      "output-1-2"
    )
    expect(
      (await database.mixerSnapshot()).channels.find(({ id }) => id === "audio-1")
    ).toMatchObject({
      inputSource: "application",
      applicationCapture: target,
      inputMonitoring: true
    })

    await database.applyCommand(
      {
        type: "update-channel",
        channelId: "audio-1",
        patch: {
          inputSource: "hardware",
          inputFormat: "stereo",
          inputChannels: [1, 2]
        }
      },
      "output-1-2"
    )
    expect(
      (await database.mixerSnapshot()).channels.find(({ id }) => id === "audio-1")
    ).toMatchObject({ inputSource: "hardware", applicationCapture: null })

    // A macOS bundle identifier uses the same JSONB target without a schema change.
    const macTarget = {
      platform: "macos" as const,
      bundleIdentifier: "com.example.player",
      executablePath: "/Applications/Player.app/Contents/MacOS/Player",
      executableName: "Player",
      includeProcessTree: true
    }
    await database.applyCommand(
      {
        type: "update-channel",
        channelId: "audio-1",
        patch: {
          inputSource: "application",
          inputFormat: "stereo",
          inputChannels: [1, 2],
          applicationCapture: macTarget
        }
      },
      "output-1-2"
    )
    expect(
      (await database.mixerSnapshot()).channels.find(({ id }) => id === "audio-1")
    ).toMatchObject({ inputSource: "application", applicationCapture: macTarget })
  })

  it("round-trips every plugin audio mode", async () => {
    const { database } = await createDatabase()
    const modes = ["mono", "mono-to-stereo", "stereo", "dual-mono"] as const
    await database.applyCommand(
      {
        type: "batch",
        commands: modes.map((audioMode, slotOrder) => ({
          type: "create-plugin" as const,
          plugin: {
            id: `effect-${audioMode}`,
            channelId: "audio-1",
            role: "insert" as const,
            slotOrder,
            locator: {
              format: "vst3",
              artifactPath: "effect.vst3",
              nativeId: "0123456789ABCDEFFEDCBA9876543210"
            },
            descriptor: {
              source: { kind: "external" as const },
              locator: {
                format: "vst3" as const,
                artifactPath: "effect.vst3",
                nativeId: "0123456789ABCDEFFEDCBA9876543210"
              },
              name: "Effect",
              vendor: "Heron Studio",
              version: "1.0",
              categories: ["Fx"],
              kind: "effect" as const,
              architecture: "x86_64",
              buses: [],
              supportedAudioModes: [...modes],
              hasEditor: true,
              compatibility: "compatible" as const,
              compatibilityReason: null
            },
            audioMode,
            enabled: true,
            sidechainInputs: [],
            state: { version: 1 as const, chunks: [] }
          }
        }))
      },
      "audio-1"
    )

    expect(
      (await database.mixerSnapshot()).plugins
        .filter((plugin) => plugin.channelId === "audio-1")
        .map((plugin) => plugin.audioMode)
    ).toEqual(modes)
  })
})
