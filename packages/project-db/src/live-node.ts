import { openAsBlob } from "node:fs"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { and, asc, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import type { PgliteDatabase } from "drizzle-orm/pglite"
import type {
  LiveDocumentConfiguration,
  LiveMidiBinding,
  LiveRuntimeSnapshot,
  MixerGraphSnapshot
} from "@heron/contracts"
import { AUDIO_BACKENDS, PROJECT_SAMPLE_RATES } from "@heron/contracts"
import { validateMixerGraph } from "@heron/project-model"
import { dumpDataDirectory } from "./internal/archive"
import { pgliteByteaOptions } from "./internal/bytea-codecs"
import { bytes, pluginDescriptor } from "./internal/serialization"
import { migrateLiveDatabase } from "./live-migrations"
import { clearLiveMixer, inspectLiveArchive } from "./maintenance"
import {
  LIVE_DOCUMENT_ID,
  LIVE_FORMAT_VERSION,
  liveDocument,
  liveMidiBindings,
  livePluginParameterValues,
  mixerChannels,
  mixerSends,
  pluginInstances,
  pluginSidechainRoutes,
  pluginStateChunks
} from "./live-schema"
import * as schema from "./live-schema"

const LIVE_TEMPLATE_ARCHIVE = fileURLToPath(
  new URL(/* @vite-ignore */ "../live-template.pglite.gz", import.meta.url)
)

type LiveDb = PgliteDatabase<typeof schema>

export class LiveArchiveFormatError extends Error {
  constructor(readonly code: "format-mismatch" | "unsupported-version") {
    super(
      code === "format-mismatch"
        ? "Archive is not a Live document"
        : "Live archive format is newer than this application"
    )
  }
}

export class LiveRevisionConflictError extends Error {
  readonly code = "revision-conflict"
  constructor() {
    super("Live document revision changed")
  }
}

async function assertLiveArchive(client: PGlite): Promise<void> {
  let header: Awaited<ReturnType<typeof inspectLiveArchive>>
  try {
    header = await inspectLiveArchive(client)
  } catch {
    throw new LiveArchiveFormatError("format-mismatch")
  }
  if (!header.exists || header.kind !== "live") throw new LiveArchiveFormatError("format-mismatch")
  if ((header.formatVersion ?? 0) > LIVE_FORMAT_VERSION)
    throw new LiveArchiveFormatError("unsupported-version")
}

function validateConfiguration(value: LiveDocumentConfiguration): void {
  if (!value.name.trim()) throw new TypeError("Live document name cannot be empty")
  if (!PROJECT_SAMPLE_RATES.includes(value.sampleRate as (typeof PROJECT_SAMPLE_RATES)[number])) {
    throw new TypeError("Unsupported Live sample rate")
  }
  if (value.audio) {
    if (
      !AUDIO_BACKENDS.includes(value.audio.backend) ||
      !value.audio.inputDeviceId ||
      !value.audio.outputDeviceId ||
      !Number.isInteger(value.audio.bufferSize) ||
      value.audio.bufferSize < 16 ||
      value.audio.bufferSize > 16_384
    ) {
      throw new TypeError("Live audio configuration requires exact devices and a valid buffer")
    }
  }
  if (
    new Set(value.enabledMidiDeviceIds).size !== value.enabledMidiDeviceIds.length ||
    value.enabledMidiDeviceIds.some((id) => !id.trim())
  ) {
    throw new TypeError("Live enabled MIDI device IDs must be unique and nonempty")
  }
}

export class LiveDatabase {
  private readonly db: LiveDb

  private constructor(private readonly client: PGlite) {
    this.db = drizzle(client, { schema })
  }

  static async create(
    dataDir: string,
    configuration: LiveDocumentConfiguration,
    templateArchivePath = LIVE_TEMPLATE_ARCHIVE
  ): Promise<LiveDatabase> {
    validateConfiguration(configuration)
    const instance = new LiveDatabase(
      await PGlite.create({
        ...pgliteByteaOptions,
        dataDir,
        loadDataDir: await openAsBlob(templateArchivePath)
      })
    )
    try {
      await instance.db.transaction(async (tx) => {
        await tx.insert(liveDocument).values({
          id: LIVE_DOCUMENT_ID,
          name: configuration.name.trim(),
          sampleRate: configuration.sampleRate,
          backend: configuration.audio?.backend ?? null,
          inputDeviceId: configuration.audio?.inputDeviceId ?? null,
          outputDeviceId: configuration.audio?.outputDeviceId ?? null,
          bufferSize: configuration.audio?.bufferSize ?? null,
          enabledMidiDeviceIds: configuration.enabledMidiDeviceIds
        })
        await tx.insert(mixerChannels).values([
          {
            id: "master",
            kind: "master",
            name: "Master",
            color: "#8C83FF",
            sortOrder: 0,
            inputSource: null,
            inputFormat: null,
            outputChannelId: null,
            outputBus: null,
            inputMonitoring: false,
            inputChannels: [],
            hardwareOutputChannels: []
          },
          {
            id: "output-1-2",
            kind: "output",
            name: "Output 1–2",
            color: "#EF7C95",
            sortOrder: 0,
            inputSource: null,
            inputFormat: null,
            outputChannelId: null,
            outputBus: null,
            inputMonitoring: false,
            inputChannels: [],
            hardwareOutputChannels: [1, 2]
          },
          {
            id: "audio-1",
            kind: "audio",
            name: "Audio 1",
            color: "#4F8CFF",
            sortOrder: 0,
            inputSource: "hardware",
            inputFormat: "stereo",
            outputChannelId: "output-1-2",
            outputBus: null,
            inputMonitoring: false,
            inputChannels: [1, 2],
            hardwareOutputChannels: []
          }
        ])
      })
      return instance
    } catch (error) {
      await instance.close()
      throw error
    }
  }

  static async open(dataDir: string, archivePath?: string): Promise<LiveDatabase> {
    const client = archivePath
      ? await PGlite.create({
          ...pgliteByteaOptions,
          dataDir,
          loadDataDir: await openAsBlob(archivePath)
        })
      : new PGlite(dataDir, pgliteByteaOptions)
    const instance = new LiveDatabase(client)
    try {
      // Read the kind before applying Live migrations to an untrusted archive.
      await assertLiveArchive(client)
      await migrateLiveDatabase(instance.db)
      return instance
    } catch (error) {
      await instance.close()
      throw error
    }
  }

  private async documentRow(): Promise<typeof liveDocument.$inferSelect> {
    let rows: Array<typeof liveDocument.$inferSelect>
    try {
      rows = await this.db
        .select()
        .from(liveDocument)
        .where(eq(liveDocument.id, LIVE_DOCUMENT_ID))
        .limit(1)
    } catch {
      throw new LiveArchiveFormatError("format-mismatch")
    }
    const row = rows[0]
    if (!row || row.kind !== "live") throw new LiveArchiveFormatError("format-mismatch")
    if (row.formatVersion > LIVE_FORMAT_VERSION)
      throw new LiveArchiveFormatError("unsupported-version")
    return row
  }

  async configuration(): Promise<LiveDocumentConfiguration> {
    const row = await this.documentRow()
    return {
      name: row.name,
      sampleRate: row.sampleRate,
      audio:
        row.backend && row.inputDeviceId && row.outputDeviceId && row.bufferSize
          ? {
              backend: row.backend,
              inputDeviceId: row.inputDeviceId,
              outputDeviceId: row.outputDeviceId,
              bufferSize: row.bufferSize
            }
          : null,
      enabledMidiDeviceIds: row.enabledMidiDeviceIds
    }
  }

  async updateConfiguration(
    configuration: LiveDocumentConfiguration,
    expectedRevision: number
  ): Promise<number> {
    validateConfiguration(configuration)
    const [updated] = await this.db
      .update(liveDocument)
      .set({
        name: configuration.name.trim(),
        sampleRate: configuration.sampleRate,
        backend: configuration.audio?.backend ?? null,
        inputDeviceId: configuration.audio?.inputDeviceId ?? null,
        outputDeviceId: configuration.audio?.outputDeviceId ?? null,
        bufferSize: configuration.audio?.bufferSize ?? null,
        enabledMidiDeviceIds: configuration.enabledMidiDeviceIds,
        revision: expectedRevision + 1
      })
      .where(
        and(eq(liveDocument.id, LIVE_DOCUMENT_ID), eq(liveDocument.revision, expectedRevision))
      )
      .returning({ revision: liveDocument.revision })
    if (!updated) throw new LiveRevisionConflictError()
    return updated.revision
  }

  async replaceBaseline(
    snapshot: LiveRuntimeSnapshot,
    bindings: LiveMidiBinding[],
    expectedRevision: number
  ): Promise<number> {
    validateMixerGraph(snapshot.graph)
    const pluginIds = new Set(snapshot.graph.plugins.map((plugin) => plugin.id))
    const bindingIds = new Set<string>()
    for (const binding of bindings) {
      if (!binding.id || bindingIds.has(binding.id) || !binding.address.portId) {
        throw new TypeError("Live MIDI binding ID and physical port must be valid and unique")
      }
      bindingIds.add(binding.id)
    }
    const parameterKeys = new Set<string>()
    for (const value of snapshot.parameterValues) {
      const key = `${value.pluginId}\u0000${value.parameterKey}`
      if (
        !pluginIds.has(value.pluginId) ||
        !value.parameterKey ||
        !Number.isFinite(value.value) ||
        parameterKeys.has(key)
      ) {
        throw new TypeError("Live plug-in parameter value is invalid")
      }
      parameterKeys.add(key)
    }
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(liveDocument)
        .set({ revision: expectedRevision + 1 })
        .where(
          and(eq(liveDocument.id, LIVE_DOCUMENT_ID), eq(liveDocument.revision, expectedRevision))
        )
        .returning({ revision: liveDocument.revision, sampleRate: liveDocument.sampleRate })
      if (!updated) throw new LiveRevisionConflictError()
      if (snapshot.graph.sampleRate !== updated.sampleRate) {
        throw new TypeError("Live Mixer sample rate must match the document configuration")
      }
      await clearLiveMixer(tx)
      await tx.insert(mixerChannels).values(
        snapshot.graph.channels.map((channel) => ({
          id: channel.id,
          kind: channel.kind,
          name: channel.name,
          color: channel.color,
          sortOrder: channel.sortOrder,
          inputSource: channel.inputSource,
          inputFormat: channel.inputFormat,
          applicationCapture: channel.applicationCapture ?? null,
          midiInputPortId: channel.midiInput?.portId ?? null,
          midiInputPortName: channel.midiInput?.portName ?? null,
          midiInputChannel: channel.midiInput?.channel ?? null,
          gainDb: channel.gainDb,
          pan: channel.pan,
          muted: channel.muted,
          soloed: channel.soloed,
          outputChannelId: channel.outputChannelId,
          outputBus: channel.outputBus ?? null,
          inputMonitoring: channel.inputMonitoring,
          inputChannels: channel.inputChannels,
          hardwareOutputChannels: channel.hardwareOutputChannels
        }))
      )
      if (snapshot.graph.sends.length) {
        await tx.insert(mixerSends).values(
          snapshot.graph.sends.map((send) => ({
            id: send.id,
            sourceChannelId: send.sourceChannelId,
            targetChannelId: send.targetChannelId ?? null,
            targetBus: send.targetBus,
            sortOrder: send.sortOrder,
            enabled: send.enabled,
            tap: send.tap,
            levelDb: send.levelDb
          }))
        )
      }
      if (snapshot.graph.plugins.length) {
        await tx.insert(pluginInstances).values(
          snapshot.graph.plugins.map((plugin) => ({
            id: plugin.id,
            channelId: plugin.channelId,
            role: plugin.role,
            slotOrder: plugin.slotOrder,
            locatorFormat: plugin.locator.format,
            artifactPath: plugin.locator.artifactPath,
            nativeId: plugin.locator.nativeId,
            descriptorSnapshot: JSON.stringify(plugin.descriptor),
            audioMode: plugin.audioMode,
            enabled: plugin.enabled,
            controlAlias: plugin.controlAlias ?? null
          }))
        )
        const routes = snapshot.graph.plugins.flatMap((plugin) =>
          plugin.sidechainInputs.map((route) => ({
            pluginId: plugin.id,
            inputPortKey: route.inputPortKey,
            sourceChannelId: route.sourceChannelId
          }))
        )
        if (routes.length) await tx.insert(pluginSidechainRoutes).values(routes)
        const chunks = snapshot.graph.plugins.flatMap((plugin) =>
          plugin.state.chunks.map((chunk) => ({
            pluginId: plugin.id,
            chunkKey: chunk.key,
            bytes: chunk.bytes
          }))
        )
        if (chunks.length) await tx.insert(pluginStateChunks).values(chunks)
      }
      if (snapshot.parameterValues.length) {
        await tx.insert(livePluginParameterValues).values(snapshot.parameterValues)
      }
      if (bindings.length) {
        await tx.insert(liveMidiBindings).values(
          bindings.map((binding) => ({
            id: binding.id,
            portId: binding.address.portId,
            channel: binding.address.channel,
            messageKind: binding.address.type,
            number: binding.address.number,
            inputMode: binding.input,
            target: binding.target,
            transformProfileId: binding.transformProfileId ?? null
          }))
        )
      }
      return updated.revision
    })
  }

  async revision(): Promise<number> {
    return (await this.documentRow()).revision
  }

  async mixerSnapshot(): Promise<MixerGraphSnapshot> {
    const [document, channelRows, sendRows, pluginRows, routeRows, chunkRows] = await Promise.all([
      this.documentRow(),
      this.db
        .select()
        .from(mixerChannels)
        .orderBy(asc(mixerChannels.sortOrder), asc(mixerChannels.id)),
      this.db
        .select()
        .from(mixerSends)
        .orderBy(asc(mixerSends.sourceChannelId), asc(mixerSends.sortOrder), asc(mixerSends.id)),
      this.db
        .select()
        .from(pluginInstances)
        .orderBy(
          asc(pluginInstances.channelId),
          asc(pluginInstances.slotOrder),
          asc(pluginInstances.id)
        ),
      this.db
        .select()
        .from(pluginSidechainRoutes)
        .orderBy(asc(pluginSidechainRoutes.pluginId), asc(pluginSidechainRoutes.inputPortKey)),
      this.db
        .select()
        .from(pluginStateChunks)
        .orderBy(asc(pluginStateChunks.pluginId), asc(pluginStateChunks.chunkKey))
    ])
    return {
      sampleRate: document.sampleRate,
      channels: channelRows.map((channel) => ({
        id: channel.id,
        kind: channel.kind,
        name: channel.name,
        color: channel.color,
        sortOrder: channel.sortOrder,
        inputSource: channel.inputSource,
        inputFormat: channel.inputFormat,
        applicationCapture:
          channel.inputSource === "application" ? channel.applicationCapture : null,
        midiInput:
          channel.kind === "instrument"
            ? {
                portId: channel.midiInputPortId,
                portName: channel.midiInputPortName,
                channel: channel.midiInputChannel
              }
            : null,
        gainDb: channel.gainDb,
        pan: channel.pan,
        muted: channel.muted,
        soloed: channel.soloed,
        outputChannelId: channel.outputChannelId,
        outputBus: channel.outputBus,
        inputMonitoring: channel.inputMonitoring,
        inputChannels: channel.inputChannels,
        hardwareOutputChannels: channel.hardwareOutputChannels
      })),
      sends: sendRows,
      plugins: pluginRows.map((plugin) => ({
        id: plugin.id,
        channelId: plugin.channelId,
        role: plugin.role,
        slotOrder: plugin.slotOrder,
        locator: {
          format: plugin.locatorFormat,
          artifactPath: plugin.artifactPath,
          nativeId: plugin.nativeId
        },
        descriptor: pluginDescriptor(plugin.descriptorSnapshot),
        audioMode: plugin.audioMode,
        enabled: plugin.enabled,
        controlAlias: plugin.controlAlias,
        sidechainInputs: routeRows
          .filter((route) => route.pluginId === plugin.id)
          .map((route) => ({
            inputPortKey: route.inputPortKey,
            sourceChannelId: route.sourceChannelId
          })),
        state: {
          version: 1 as const,
          chunks: chunkRows
            .filter((chunk) => chunk.pluginId === plugin.id)
            .map((chunk) => ({
              key: chunk.chunkKey,
              bytes: bytes(chunk.bytes)
            }))
        }
      }))
    }
  }

  async midiBindings(): Promise<LiveMidiBinding[]> {
    const rows = await this.db.select().from(liveMidiBindings).orderBy(asc(liveMidiBindings.id))
    return rows.map((row) => ({
      id: row.id,
      address: {
        portId: row.portId,
        portName: row.portId,
        channel: row.channel,
        type: row.messageKind,
        number: row.number
      },
      input: row.inputMode,
      target: row.target,
      ...(row.transformProfileId ? { transformProfileId: row.transformProfileId } : {})
    }))
  }

  async pluginParameterValues(): Promise<Array<typeof livePluginParameterValues.$inferSelect>> {
    return this.db.select().from(livePluginParameterValues)
  }

  async dump(outputPath: string): Promise<void> {
    await dumpDataDirectory(this.client, outputPath)
  }

  async close(): Promise<void> {
    await this.client.close()
  }
}
