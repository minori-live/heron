import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { MixerChannelState, ProjectCommand } from "@heron/contracts"
import { describe, expect, it } from "vitest"
import { readMixerGraphSnapshot } from "../internal/mixer-reads"
import { useProjectDbFixture } from "./support/project-db-fixture"

const { createDatabase } = useProjectDbFixture()

describe("project command and snapshot atomicity", () => {
  it("reads the shared Mixer after removing every Studio-only table", async () => {
    const { database } = await createDatabase()
    const before = await database.mixerSnapshot()
    const client = Reflect.get(database, "client") as PGlite
    await client.exec(`
      drop table project, assets, asset_waveform_levels, tracks, audio_clips,
        tempo_events, time_signature_events, key_signature_events,
        midi_sources, midi_clips, midi_notes, midi_events cascade;
    `)
    const mixer = await readMixerGraphSnapshot(drizzle(client), before.sampleRate)
    expect(mixer).toEqual({
      sampleRate: before.sampleRate,
      channels: before.channels,
      sends: before.sends,
      plugins: before.plugins
    })
  })

  it("returns the committed graph and rolls back mutations when snapshot decoding fails", async () => {
    const { database } = await createDatabase()
    const committed = await database.applyCommand(
      { type: "update-project-notes", notes: "committed" },
      "output-1-2"
    )
    expect(committed.projectNotes).toBe("committed")
    expect(committed).toEqual(await database.mixerSnapshot())

    const client = Reflect.get(database, "client") as PGlite
    await client.query("update plugin_instances set descriptor_snapshot = $1 where id = $2", [
      "{invalid-json",
      "metronome-instrument"
    ])
    await expect(
      database.applyCommand({ type: "update-project-notes", notes: "must roll back" }, "output-1-2")
    ).rejects.toThrow(SyntaxError)
    const result = await client.query<{ notes: string }>("select notes from project")
    expect(result.rows).toEqual([{ notes: "committed" }])
  })

  it("does not commit a channel edit when the enclosing project row is missing", async () => {
    const { database } = await createDatabase()
    const client = Reflect.get(database, "client") as PGlite
    await client.exec("delete from project")
    await expect(
      database.applyCommand(
        { type: "update-channel", channelId: "master", patch: { gainDb: -9 } },
        "output-1-2"
      )
    ).rejects.toThrow("Project configuration is missing")
    const result = await client.query<{ gain_db: number }>(
      "select gain_db from mixer_channels where id = 'master'"
    )
    expect(result.rows).toEqual([{ gain_db: 0 }])
  })

  it("enforces relations and rolls back failed command batches", async () => {
    const { database } = await createDatabase()
    const aux: MixerChannelState = {
      id: "aux-1",
      kind: "aux",
      systemRole: null,
      name: "Aux 1",
      color: "#112233",
      sortOrder: 0,
      inputSource: "bus",
      inputFormat: "mono",
      gainDb: 0,
      pan: 0,
      muted: false,
      soloed: false,
      outputChannelId: "output-1-2",
      recordArmed: false,
      inputMonitoring: false,
      inputChannels: [7],
      hardwareOutputChannels: []
    }

    await database.applyCommand({ type: "create-channel", channel: aux }, "output-1-2")
    await database.applyCommand(
      {
        type: "create-send",
        send: {
          id: "post-pan-send",
          sourceChannelId: "audio-1",
          targetBus: 7,
          sortOrder: 0,
          enabled: true,
          tap: "post-pan",
          levelDb: -3
        }
      },
      "output-1-2"
    )
    const persistedSend = (await database.mixerSnapshot()).sends.find(
      (send) => send.id === "post-pan-send"
    )
    expect(persistedSend).toMatchObject({ id: "post-pan-send", tap: "post-pan" })
    expect(persistedSend).not.toHaveProperty("pan")
    await database.applyCommand(
      {
        type: "create-plugin",
        plugin: {
          id: "sidechain-effect",
          channelId: "audio-1",
          role: "insert",
          slotOrder: 0,
          locator: {
            format: "vst3",
            artifactPath: "sidechain.vst3",
            nativeId: "0123456789ABCDEFFEDCBA9876543210"
          },
          descriptor: {
            source: { kind: "external" },
            locator: {
              format: "vst3",
              artifactPath: "sidechain.vst3",
              nativeId: "0123456789ABCDEFFEDCBA9876543210"
            },
            name: "Side-chain Effect",
            vendor: "Heron Studio",
            version: "1.0",
            categories: ["Fx"],
            kind: "effect",
            architecture: "x86_64",
            buses: [
              {
                portKey: "vst3:audio:input:1",
                direction: "input",
                kind: "aux",
                name: "Side-chain",
                channels: 1,
                defaultActive: false
              }
            ],
            supportedAudioModes: ["stereo"],
            hasEditor: true,
            compatibility: "compatible",
            compatibilityReason: null
          },
          audioMode: "stereo",
          enabled: true,
          sidechainInputs: [{ inputPortKey: "vst3:audio:input:1", sourceChannelId: aux.id }],
          state: { version: 1, chunks: [] }
        }
      },
      "output-1-2"
    )
    expect(
      (await database.mixerSnapshot()).plugins.find(({ id }) => id === "sidechain-effect")
        ?.sidechainInputs
    ).toEqual([{ inputPortKey: "vst3:audio:input:1", sourceChannelId: aux.id }])
    await database.applyCommand({ type: "delete-channel", channelId: aux.id }, "output-1-2")
    expect(
      (await database.mixerSnapshot()).plugins.find(({ id }) => id === "sidechain-effect")
        ?.sidechainInputs
    ).toEqual([])
    expect(
      (await database.mixerSnapshot()).channels.find(({ id }) => id === "audio-1")
    ).toMatchObject({ outputChannelId: "output-1-2" })

    const invalidBatch: ProjectCommand = {
      type: "batch",
      commands: [
        { type: "create-channel", channel: { ...aux, id: "rolled-back-aux" } },
        {
          type: "create-send",
          send: {
            id: "invalid-send",
            sourceChannelId: "missing-channel",
            targetBus: 8,
            sortOrder: 0,
            enabled: true,
            tap: "post",
            levelDb: 0
          }
        }
      ]
    }
    await expect(database.applyCommand(invalidBatch, "output-1-2")).rejects.toThrow()
    expect((await database.mixerSnapshot()).channels).not.toContainEqual(
      expect.objectContaining({ id: "rolled-back-aux" })
    )

    await expect(
      database.applyCommand(
        {
          type: "replace-tempo-map",
          tempoMap: {
            ticksPerQuarter: 960,
            tempoEvents: [{ tick: 240, beatsPerMinute: 90 }],
            timeSignatureEvents: [{ tick: 0, numerator: 3, denominator: 4 }]
          }
        },
        "output-1-2"
      )
    ).rejects.toThrow("tick 0")
    expect((await database.mixerSnapshot()).tempoMap.tempoEvents).toEqual([
      { tick: 0, beatsPerMinute: 120 }
    ])
    await expect(
      database.applyCommand(
        {
          type: "replace-key-signature-map",
          events: [{ tick: 240, fifths: 0, mode: "major" }]
        },
        "output-1-2"
      )
    ).rejects.toThrow("tick 0")
  })

  it("persists metronome mute while protecting the system channel and clip boundary", async () => {
    const { database } = await createDatabase()
    await database.applyCommand(
      {
        type: "update-channel",
        channelId: "metronome",
        patch: { muted: false, name: "Click" }
      },
      "output-1-2"
    )
    expect(
      (await database.mixerSnapshot()).channels.find(({ id }) => id === "metronome")
    ).toMatchObject({
      name: "Click",
      muted: false,
      systemRole: "metronome"
    })

    await expect(
      database.applyCommand({ type: "delete-channel", channelId: "metronome" }, "output-1-2")
    ).rejects.toThrow("System channels cannot be deleted")
    await expect(
      database.applyCommand(
        {
          type: "batch",
          commands: [{ type: "delete-channel", channelId: "metronome" }]
        },
        "output-1-2"
      )
    ).rejects.toThrow("System channels cannot be deleted")
    await expect(
      database.applyCommand(
        {
          type: "create-midi-clip",
          clip: {
            id: "invalid-metronome-clip",
            sourceId: "missing-source",
            trackId: "track:metronome",
            name: "Invalid",
            startTick: 0,
            sourceOffsetTicks: 0,
            lengthTicks: 960,
            sourceLengthTicks: 960,
            notes: [],
            events: []
          }
        },
        "output-1-2"
      )
    ).rejects.toThrow()
    expect((await database.mixerSnapshot()).channels).toContainEqual(
      expect.objectContaining({ id: "metronome", systemRole: "metronome" })
    )
  })

  it("creates and removes a blank MIDI source and clip atomically", async () => {
    const { database } = await createDatabase()
    const instrument: MixerChannelState = {
      id: "instrument-blank",
      kind: "instrument",
      systemRole: null,
      name: "Instrument",
      color: "#73D6A2",
      sortOrder: 0,
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
    const source = {
      id: "blank-source",
      name: "MIDI Clip 1",
      contentHash: "blank:blank-source",
      rawBytes: new Uint8Array()
    }
    const track = {
      id: `track:${instrument.id}`,
      channelId: instrument.id,
      sortOrder: instrument.sortOrder
    }
    const clip = {
      id: "blank-clip",
      sourceId: source.id,
      trackId: track.id,
      name: source.name,
      startTick: 960,
      lengthTicks: 3_840,
      sourceOffsetTicks: 0,
      sourceLengthTicks: 3_840,
      notes: [],
      events: []
    }
    const create: ProjectCommand = {
      type: "batch",
      commands: [
        { type: "create-track", track, channel: instrument },
        { type: "create-midi-source", source },
        { type: "create-midi-clip", clip }
      ]
    }

    await database.applyCommand(create, "output-1-2")
    expect((await database.mixerSnapshot()).midiClips).toContainEqual(clip)
    expect(await database.listAssets()).toContainEqual({
      id: source.id,
      kind: "midi",
      name: source.name,
      contentHash: source.contentHash,
      byteLength: 0
    })
    expect(await database.readMidiSource(source.id)).toEqual(source)

    await database.applyCommand(
      {
        type: "batch",
        commands: [
          { type: "delete-midi-clip", clipId: clip.id },
          { type: "delete-midi-source", source }
        ]
      },
      "output-1-2"
    )
    expect((await database.mixerSnapshot()).midiClips).toEqual([])

    await database.applyCommand(
      {
        type: "batch",
        commands: [
          { type: "create-midi-source", source },
          { type: "create-midi-clip", clip }
        ]
      },
      "output-1-2"
    )
    expect((await database.mixerSnapshot()).midiClips).toContainEqual(clip)
  })

  // This case creates, flushes, closes and reopens a physical PostgreSQL data
  // directory; the complete round-trip exceeded the suite's 15s test timeout on Windows CI.
  it("round-trips atomic piano-roll note edits at 1/3840-note resolution", async () => {
    const { database } = await createDatabase()
    const instrument = {
      id: "instrument-1",
      kind: "instrument" as const,
      systemRole: null,
      name: "Instrument 1",
      color: "#73D6A2",
      sortOrder: 0,
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
    const clip = {
      id: "midi-clip-1",
      sourceId: "midi-source-1",
      trackId: `track:${instrument.id}`,
      name: "Editable",
      startTick: 960,
      sourceOffsetTicks: 0,
      lengthTicks: 960,
      sourceLengthTicks: 960,
      notes: [
        {
          id: "note-1",
          startTick: 120,
          durationTicks: 240,
          channel: 0,
          key: 60,
          velocity: 100,
          releaseVelocity: 0
        }
      ],
      events: [
        {
          id: "event-1",
          tick: 240,
          channel: 0,
          kind: "control-change" as const,
          data: new Uint8Array([1, 2])
        }
      ]
    }
    await database.importMidi(
      {
        id: clip.sourceId,
        name: "editable.mid",
        contentHash: "editable-midi-source",
        rawBytes: new Uint8Array([0x4d, 0x54, 0x68, 0x64])
      },
      {
        type: "batch",
        commands: [
          {
            type: "create-track",
            track: {
              id: `track:${instrument.id}`,
              channelId: instrument.id,
              sortOrder: instrument.sortOrder
            },
            channel: instrument
          },
          { type: "create-midi-clip", clip }
        ]
      },
      "output-1-2"
    )

    await database.applyCommand(
      {
        type: "batch",
        commands: [
          {
            type: "rebase-midi-clip-content",
            clipId: clip.id,
            deltaTicks: 240
          },
          {
            type: "update-midi-clip-range",
            clipId: clip.id,
            patch: { startTick: 720, lengthTicks: 1_200, sourceLengthTicks: 1_200 }
          },
          {
            type: "update-midi-notes",
            clipId: clip.id,
            updates: [
              {
                noteId: "note-1",
                patch: { startTick: 1, durationTicks: 1, velocity: 127 }
              }
            ]
          },
          {
            type: "create-midi-notes",
            clipId: clip.id,
            notes: [
              {
                id: "note-2",
                startTick: 480,
                durationTicks: 1,
                channel: 15,
                key: 127,
                velocity: 1,
                releaseVelocity: 127
              }
            ]
          }
        ]
      },
      "output-1-2"
    )

    const edited = (await database.mixerSnapshot()).midiClips[0]!
    expect(edited).toMatchObject({ startTick: 720, lengthTicks: 1_200 })
    expect(edited.notes).toEqual([
      expect.objectContaining({ id: "note-1", startTick: 1, durationTicks: 1, velocity: 127 }),
      expect.objectContaining({ id: "note-2", durationTicks: 1, channel: 15, key: 127 })
    ])
    expect(edited.events[0]?.tick).toBe(480)

    await expect(
      database.applyCommand(
        {
          type: "batch",
          commands: [
            {
              type: "create-midi-notes",
              clipId: clip.id,
              notes: [
                {
                  id: "rolled-back-note",
                  startTick: 0,
                  durationTicks: 1,
                  channel: 0,
                  key: 60,
                  velocity: 100,
                  releaseVelocity: 0
                }
              ]
            },
            {
              type: "update-midi-notes",
              clipId: clip.id,
              updates: [{ noteId: "note-2", patch: { durationTicks: 0 } }]
            }
          ]
        },
        "output-1-2"
      )
    ).rejects.toThrow()
    expect((await database.mixerSnapshot()).midiClips[0]?.notes).not.toContainEqual(
      expect.objectContaining({ id: "rolled-back-note" })
    )
  })

  it("atomically persists a hardware Mixer overlay with plug-in state capture", async () => {
    const { database } = await createDatabase()
    const before = await database.mixerSnapshot()
    const master = before.channels.find((channel) => channel.kind === "master")!

    await database.saveControlState(
      [],
      [{ id: master.id, gainDb: -12, pan: 0.25, muted: true, soloed: false }]
    )

    const after = await database.mixerSnapshot()
    expect(after.channels.find((channel) => channel.id === master.id)).toMatchObject({
      gainDb: -12,
      pan: 0.25,
      muted: true,
      soloed: false
    })

    await database.saveControlState([], [])
    await database.applyCommand(
      {
        type: "create-plugin",
        plugin: {
          id: "controlled-effect",
          channelId: master.id,
          role: "insert",
          slotOrder: 0,
          locator: {
            format: "vst3",
            artifactPath: "controlled.vst3",
            nativeId: "0123456789ABCDEFFEDCBA9876543210"
          },
          descriptor: {
            source: { kind: "external" },
            locator: {
              format: "vst3",
              artifactPath: "controlled.vst3",
              nativeId: "0123456789ABCDEFFEDCBA9876543210"
            },
            name: "Controlled Effect",
            vendor: "Heron Studio",
            version: "1.0",
            categories: ["Fx"],
            kind: "effect",
            architecture: "x86_64",
            buses: [],
            supportedAudioModes: ["stereo"],
            hasEditor: false,
            compatibility: "compatible",
            compatibilityReason: null
          },
          audioMode: "stereo",
          enabled: true,
          controlAlias: "controlled.effect",
          sidechainInputs: [],
          state: { version: 1, chunks: [] }
        }
      },
      "output-1-2"
    )

    await database.saveControlState(
      [
        {
          id: "controlled-effect",
          state: {
            version: 1,
            chunks: [{ key: "component", bytes: new Uint8Array([1, 2, 3]) }]
          }
        }
      ],
      [{ id: master.id, gainDb: -9 }]
    )

    const captured = await database.mixerSnapshot()
    expect(captured.channels.find((channel) => channel.id === master.id)?.gainDb).toBe(-9)
    expect(
      captured.plugins.find((plugin) => plugin.id === "controlled-effect")?.state.chunks
    ).toEqual([{ key: "component", bytes: new Uint8Array([1, 2, 3]) }])
  })
})
