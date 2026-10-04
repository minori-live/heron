import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { LiveArchiveFormatError, LiveDatabase } from "../live-node"
import { buildLiveTemplateArchive } from "../live-template"
import { ProjectDatabase, StudioArchiveFormatError } from "../node"
import { buildProjectTemplateArchive } from "../template"
import {
  createLiveRootMixerProfile,
  writeLiveRootMixerTrace
} from "./diagnostics/live-root-mixer-profile"

const migrations = fileURLToPath(new URL("../../drizzle-live", import.meta.url))
const studioMigrations = fileURLToPath(new URL("../../drizzle", import.meta.url))
const temporaryDirectories: string[] = []
let templateDirectory: string
let template: string

beforeAll(async () => {
  templateDirectory = await mkdtemp(join(tmpdir(), "heron-live-template-test-"))
  template = join(templateDirectory, "live-template.pglite.gz")
  await buildLiveTemplateArchive(template, migrations)
}, 60_000)

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

afterAll(async () => {
  await rm(templateDirectory, { recursive: true, force: true })
})

async function fixture(): Promise<{ root: string; template: string }> {
  const root = await mkdtemp(join(tmpdir(), "heron-live-db-"))
  temporaryDirectories.push(root)
  return { root, template }
}

describe("Live database lineage", () => {
  it("creates and reopens a root Mixer without Studio timeline tables", async ({
    onTestFailed,
    onTestFinished,
    signal
  }) => {
    const startedAt = performance.now()
    const initialCpu = process.cpuUsage()
    const sampleId = randomUUID()
    const profile = createLiveRootMixerProfile()
    const stages: Array<{
      name: string
      elapsedMs: number
      start: number
      cpu: NodeJS.CpuUsage
      status: "running" | "completed" | "failed"
      durationMs?: number
      cpuMs?: number
    }> = []
    async function step<T>(name: string, operation: () => Promise<T>): Promise<T> {
      const start = performance.now()
      const cpu = process.cpuUsage()
      const stage: (typeof stages)[number] = {
        name,
        elapsedMs: Math.round(start - startedAt),
        start,
        cpu,
        status: "running"
      }
      stages.push(stage)
      try {
        const result = await (profile ? profile.step(name, operation) : operation())
        stage.status = "completed"
        return result
      } catch (error) {
        stage.status = "failed"
        throw error
      } finally {
        const used = process.cpuUsage(cpu)
        stage.durationMs = Math.round(performance.now() - start)
        stage.cpuMs = Math.round((used.user + used.system) / 1000)
      }
    }
    let reported = false
    function report(reason: string): void {
      if (reported) return
      reported = true
      const profileSnapshot = profile?.stop()
      const used = process.cpuUsage(initialCpu)
      writeLiveRootMixerTrace({
        sampleId,
        pid: process.pid,
        sampleLabel: process.env.HERON_LIVE_ROOT_MIXER_SAMPLE ?? null,
        runtime: {
          node: process.version,
          uv: process.versions.uv,
          platform: process.platform,
          arch: process.arch
        },
        reason,
        elapsedMs: Math.round(performance.now() - startedAt),
        cpuMs: Math.round((used.user + used.system) / 1000),
        memory: process.memoryUsage(),
        profile: profileSnapshot ?? { enabled: false },
        // CPU is process-wide, and nested stages overlap with their parent.
        stages: stages.map(({ start, cpu, ...stage }) => {
          if (stage.status !== "running") return stage
          const used = process.cpuUsage(cpu)
          return {
            ...stage,
            durationMs: Math.round(performance.now() - start),
            cpuMs: Math.round((used.user + used.system) / 1000)
          }
        })
      })
    }
    const onAbort = () => report("test aborted")
    signal.addEventListener("abort", onAbort, { once: true })
    onTestFinished(({ task }) => {
      signal.removeEventListener("abort", onAbort)
      profile?.stop()
      if (
        task.result?.state === "pass" &&
        (process.env.HERON_TRACE_LIVE_ROOT_MIXER === "1" ||
          profile ||
          process.env.HERON_LIVE_ROOT_MIXER_TRACE_DIR)
      ) {
        report("test passed")
      }
    })
    onTestFailed(() => report("test failed"))
    try {
      const { root, template } = await step("fixture", fixture)
      const database = await step("create from template", () =>
        LiveDatabase.create(
          join(root, "working"),
          { name: "Stage", sampleRate: 48_000, audio: null, enabledMidiDeviceIds: [] },
          template
        )
      )
      const graph = await step("created mixer snapshot", () => database.mixerSnapshot())
      expect(graph.channels.map((channel) => channel.kind)).toEqual(["audio", "master", "output"])
      expect(graph.channels[0]).toMatchObject({
        inputMonitoring: false,
        outputChannelId: "output-1-2"
      })
      expect(graph.channels[0]).not.toHaveProperty("recordArmed")
      const archive = join(root, "stage.hrl")
      await step("dump archive and fsync", () => database.dump(archive))
      await step("close created database", () => database.close())

      const reopened = await step("open archive and migrate", () => {
        const open = () =>
          LiveDatabase.open(join(root, "reopened"), archive, (name, operation) =>
            step(`open archive: ${name}`, operation)
          )
        return profile ? profile.measureArchiveOpen(open) : open()
      })
      expect(await step("reopened configuration", () => reopened.configuration())).toEqual({
        name: "Stage",
        sampleRate: 48_000,
        audio: null,
        enabledMidiDeviceIds: []
      })
      expect(await step("reopened mixer snapshot", () => reopened.mixerSnapshot())).toEqual(graph)
      await step("close reopened database", () => reopened.close())

      const client = new PGlite(join(root, "reopened"))
      try {
        await step("raw directory reopen", () => client.waitReady)
        const tables = await step("read public tables", () =>
          client.query<{ tablename: string }>(
            "select tablename from pg_tables where schemaname = 'public'"
          )
        )
        const names = tables.rows.map((row) => row.tablename)
        expect(names).toContain("live_document")
        expect(names).not.toContain("tracks")
        expect(names).not.toContain("audio_clips")
        expect(names).not.toContain("midi_clips")
        expect(names).not.toContain("assets")
        expect(names).not.toContain("tempo_events")
        const channelColumns = await step("read channel columns", () =>
          client.query<{ column_name: string }>(
            "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'mixer_channels'"
          )
        )
        expect(channelColumns.rows.map((row) => row.column_name)).not.toContain("system_role")
        expect(channelColumns.rows.map((row) => row.column_name)).not.toContain("record_armed")
      } finally {
        await step("close raw client", () => client.close())
      }
    } finally {
      profile?.stop()
    }
  })

  it("rejects a missing Live marker before migration", async () => {
    const { root } = await fixture()
    const unrelated = new PGlite(join(root, "unrelated"))
    await unrelated.close()
    await expect(LiveDatabase.open(join(root, "unrelated"))).rejects.toMatchObject({
      code: "format-mismatch"
    } satisfies Partial<LiveArchiveFormatError>)
  })

  it("rejects a newer Live format with a distinct error", async () => {
    const { root, template } = await fixture()
    const path = join(root, "newer")
    const document = await LiveDatabase.create(
      path,
      {
        name: "Future",
        sampleRate: 48_000,
        audio: null,
        enabledMidiDeviceIds: []
      },
      template
    )
    await document.close()
    const client = new PGlite(path)
    await client.exec("update live_document set format_version = 999 where id = 'document'")
    await client.close()
    await expect(LiveDatabase.open(path)).rejects.toMatchObject({
      code: "unsupported-version"
    } satisfies Partial<LiveArchiveFormatError>)
  })

  it("commits a revisioned Mixer baseline atomically and rolls back invalid edits", async () => {
    // Transaction semantics use a fresh real engine without unrelated disk setup.
    const database = await LiveDatabase.create(
      "memory://",
      { name: "Stage", sampleRate: 48_000, audio: null, enabledMidiDeviceIds: [] },
      template
    )
    try {
      const baseline = { graph: await database.mixerSnapshot(), parameterValues: [] }
      const changed = structuredClone(baseline)
      changed.graph.channels.find((channel) => channel.id === "audio-1")!.gainDb = -7
      expect(await database.replaceBaseline(changed, [], 0)).toBe(1)
      expect(
        (await database.mixerSnapshot()).channels.find((channel) => channel.id === "audio-1")
          ?.gainDb
      ).toBe(-7)
      await expect(database.replaceBaseline(baseline, [], 0)).rejects.toMatchObject({
        code: "revision-conflict"
      })
      const invalid = structuredClone(changed)
      invalid.graph.channels.find((channel) => channel.id === "audio-1")!.gainDb = 100
      await expect(database.replaceBaseline(invalid, [], 1)).rejects.toThrow()
      expect(await database.revision()).toBe(1)
      expect(
        (await database.mixerSnapshot()).channels.find((channel) => channel.id === "audio-1")
          ?.gainDb
      ).toBe(-7)
    } finally {
      await database.close()
    }
  })

  it("routes archive contents by kind before either migration lineage runs", async () => {
    const { root, template } = await fixture()
    const live = await LiveDatabase.create(
      join(root, "live-work"),
      { name: "Live", sampleRate: 48_000, audio: null, enabledMidiDeviceIds: [] },
      template
    )
    const liveArchive = join(root, "live.hrl")
    await live.dump(liveArchive)
    await live.close()
    await expect(
      ProjectDatabase.open(join(root, "wrong-studio"), liveArchive)
    ).rejects.toMatchObject({
      code: "format-mismatch"
    } satisfies Partial<StudioArchiveFormatError>)

    const studioTemplate = join(root, "studio-template.pglite.gz")
    await buildProjectTemplateArchive(studioTemplate, studioMigrations)
    const studio = await ProjectDatabase.create(
      join(root, "studio-work"),
      {
        name: "Studio",
        sampleRate: 48_000,
        numerator: 4,
        denominator: 4,
        waveformDisplayMode: "separate"
      },
      studioTemplate
    )
    const studioArchive = join(root, "studio.hrs")
    await studio.dumpTo(studioArchive)
    await studio.close()
    await expect(LiveDatabase.open(join(root, "wrong-live"), studioArchive)).rejects.toMatchObject({
      code: "format-mismatch"
    } satisfies Partial<LiveArchiveFormatError>)
  }, 30_000)
})

describe("Live rig persistence", () => {
  it("round-trips exact devices, MIDI bindings, Sends, plugin chunks and captured parameters", async () => {
    const { root, template } = await fixture()
    const configuration = {
      name: "Stage",
      sampleRate: 48000,
      audio: {
        backend: "mock" as const,
        inputDeviceId: "physical-input",
        outputDeviceId: "physical-output",
        bufferSize: 128
      },
      enabledMidiDeviceIds: ["keyboard"]
    }
    const database = await LiveDatabase.create(join(root, "rig"), configuration, template)
    try {
      expect(await database.configuration()).toEqual(configuration)
      expect(await database.updateConfiguration({ ...configuration, name: "Tour" }, 0)).toBe(1)
      await expect(database.updateConfiguration(configuration, 0)).rejects.toMatchObject({
        code: "revision-conflict"
      })
      const graph = await database.mixerSnapshot()
      const audio = graph.channels.find((channel) => channel.kind === "audio")!
      graph.channels.push({
        ...audio,
        id: "keys",
        name: "Keys",
        kind: "instrument",
        inputSource: null,
        inputFormat: null,
        inputChannels: [],
        midiInput: { portId: "keyboard", portName: "Keyboard", channel: 2 }
      })
      graph.sends = [
        {
          id: "send",
          sourceChannelId: audio.id,
          targetChannelId: null,
          targetBus: 1,
          sortOrder: 0,
          tap: "post-pan",
          enabled: true,
          levelDb: -12
        }
      ]
      const locator = {
        format: "vst3" as const,
        artifactPath: "/plugins/Effect.vst3",
        nativeId: "effect"
      }
      graph.plugins = [
        {
          id: "effect",
          channelId: audio.id,
          role: "insert",
          slotOrder: 0,
          locator,
          descriptor: {
            source: { kind: "external" },
            locator,
            name: "Effect",
            vendor: "Heron",
            version: "1",
            categories: ["Fx"],
            kind: "effect",
            architecture: "x86_64",
            buses: [
              {
                portKey: "sidechain",
                direction: "input",
                kind: "aux",
                name: "Sidechain",
                channels: 2,
                defaultActive: true
              }
            ],
            supportedAudioModes: ["stereo"],
            hasEditor: false,
            compatibility: "compatible",
            compatibilityReason: null
          },
          audioMode: "stereo",
          enabled: true,
          controlAlias: null,
          sidechainInputs: [{ inputPortKey: "sidechain", sourceChannelId: "keys" }],
          state: { version: 1, chunks: [{ key: "component", bytes: new Uint8Array([1, 3, 5]) }] }
        }
      ]
      const binding: import("@heron/contracts").LiveMidiBinding = {
        id: "gain",
        address: {
          portId: "keyboard",
          portName: "keyboard",
          channel: 2,
          type: "control-change",
          number: 7
        },
        input: { type: "absolute" },
        target: { type: "channel", channelId: audio.id, parameter: "gain" },
        transformProfileId: "builtin:absolute-linear"
      }
      const bindings = [
        binding,
        {
          ...binding,
          id: "mix",
          target: { type: "plugin-parameter" as const, pluginId: "effect", parameterKey: "mix" }
        }
      ]
      const snapshot = {
        graph,
        parameterValues: [{ pluginId: "effect", parameterKey: "mix", value: 0.75 }]
      }
      expect(await database.replaceBaseline(snapshot, bindings, 1)).toBe(2)
      expect(await database.midiBindings()).toEqual(bindings)
      expect(await database.pluginParameterValues()).toEqual(snapshot.parameterValues)
      expect((await database.mixerSnapshot()).plugins).toMatchObject(graph.plugins)
      const path = join(root, "Tour.hrl")
      await database.dump(path)
      const reopened = await LiveDatabase.open(join(root, "reopened"), path)
      try {
        expect(await reopened.configuration()).toEqual({ ...configuration, name: "Tour" })
        expect(await reopened.revision()).toBe(2)
        expect(await reopened.mixerSnapshot()).toEqual(await database.mixerSnapshot())
        expect(await reopened.pluginParameterValues()).toEqual(snapshot.parameterValues)
        expect(await reopened.midiBindings()).toEqual(bindings)
      } finally {
        await reopened.close()
      }

      for (const invalid of [
        { ...snapshot, graph: { ...graph, sampleRate: 44100 } },
        { ...snapshot, parameterValues: [{ pluginId: "missing", parameterKey: "mix", value: 1 }] },
        { ...snapshot, parameterValues: [...snapshot.parameterValues, ...snapshot.parameterValues] }
      ])
        await expect(database.replaceBaseline(invalid, bindings, 2)).rejects.toThrow()
      await expect(database.replaceBaseline(snapshot, [binding, binding], 2)).rejects.toThrow(
        "unique"
      )
      // Fail a database constraint after the revision has advanced inside the transaction.
      const invalidSql = structuredClone(snapshot)
      invalidSql.graph.channels[0]!.name = " "
      await expect(database.replaceBaseline(invalidSql, bindings, 2)).rejects.toThrow()
      expect(await database.revision()).toBe(2)
      expect((await database.mixerSnapshot()).plugins).toMatchObject(graph.plugins)
      expect(await database.pluginParameterValues()).toEqual(snapshot.parameterValues)
    } finally {
      await database.close()
    }
  }, 30000)

  it("rejects invalid rig configuration before replacing the persisted choice", async () => {
    const configuration = {
      name: "Stage",
      sampleRate: 48000,
      audio: null,
      enabledMidiDeviceIds: []
    }
    const database = await LiveDatabase.create("memory://", configuration, template)
    try {
      for (const invalid of [
        { ...configuration, name: " " },
        { ...configuration, sampleRate: 12 },
        { ...configuration, enabledMidiDeviceIds: ["keyboard", "keyboard"] },
        { ...configuration, enabledMidiDeviceIds: [""] },
        {
          ...configuration,
          audio: {
            backend: "mock" as const,
            inputDeviceId: "",
            outputDeviceId: "out",
            bufferSize: 128
          }
        }
      ])
        await expect(database.updateConfiguration(invalid, 0)).rejects.toThrow()
      expect(await database.revision()).toBe(0)
      expect(await database.configuration()).toEqual(configuration)
    } finally {
      await database.close()
    }
  })
})
