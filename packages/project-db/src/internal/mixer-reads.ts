import { asc } from "drizzle-orm"
import type { MixerGraphSnapshot } from "@heron/contracts"
import {
  mixerChannels,
  mixerSends,
  pluginInstances,
  pluginSidechainRoutes,
  pluginStateChunks
} from "../mixer-schema"
import type { PgliteDatabase } from "drizzle-orm/pglite"
import { bytes, pluginDescriptor } from "./serialization"

/** Reads only shared Mixer tables; sample rate belongs to the enclosing document. */
export async function readMixerGraphSnapshot(
  db: Pick<PgliteDatabase, "select">,
  sampleRate: number
): Promise<MixerGraphSnapshot> {
  const [channelRows, sendRows, pluginRows, pluginSidechainRouteRows, pluginStateChunkRows] =
    await Promise.all([
      db.select().from(mixerChannels).orderBy(asc(mixerChannels.sortOrder), asc(mixerChannels.id)),
      db
        .select()
        .from(mixerSends)
        .orderBy(asc(mixerSends.sourceChannelId), asc(mixerSends.sortOrder), asc(mixerSends.id)),
      db
        .select()
        .from(pluginInstances)
        .orderBy(
          asc(pluginInstances.channelId),
          asc(pluginInstances.role),
          asc(pluginInstances.slotOrder),
          asc(pluginInstances.id)
        ),
      db
        .select()
        .from(pluginSidechainRoutes)
        .orderBy(asc(pluginSidechainRoutes.pluginId), asc(pluginSidechainRoutes.inputPortKey)),
      db
        .select()
        .from(pluginStateChunks)
        .orderBy(asc(pluginStateChunks.pluginId), asc(pluginStateChunks.chunkKey))
    ])

  const kindOrder = new Map([
    ["audio", 0],
    ["instrument", 1],
    ["aux", 2],
    ["master", 3],
    ["output", 4]
  ])
  channelRows.sort(
    (left, right) =>
      (kindOrder.get(left.kind) ?? 5) - (kindOrder.get(right.kind) ?? 5) ||
      left.sortOrder - right.sortOrder ||
      left.id.localeCompare(right.id)
  )

  const sidechainRoutesByPlugin = new Map<
    string,
    MixerGraphSnapshot["plugins"][number]["sidechainInputs"]
  >()
  const stateChunksByPlugin = new Map<string, Array<{ key: string; bytes: Uint8Array }>>()
  for (const chunk of pluginStateChunkRows) {
    const chunks = stateChunksByPlugin.get(chunk.pluginId) ?? []
    chunks.push({ key: chunk.chunkKey, bytes: bytes(chunk.bytes) })
    stateChunksByPlugin.set(chunk.pluginId, chunks)
  }
  for (const route of pluginSidechainRouteRows) {
    const routes = sidechainRoutesByPlugin.get(route.pluginId) ?? []
    routes.push({
      inputPortKey: route.inputPortKey,
      sourceChannelId: route.sourceChannelId
    })
    sidechainRoutesByPlugin.set(route.pluginId, routes)
  }
  return {
    sampleRate,
    channels: channelRows.map((channel) => ({
      id: channel.id,
      kind: channel.kind,
      systemRole: channel.systemRole,
      name: channel.name,
      color: channel.color,
      sortOrder: channel.sortOrder,
      inputSource: channel.inputSource,
      inputFormat: channel.inputFormat,
      // Older projects (and graphs produced by the pre-application-input UI)
      // can contain a stale target after switching back to a hardware/BUS
      // route. Do not rehydrate that invalid combination into the graph.
      applicationCapture: channel.inputSource === "application" ? channel.applicationCapture : null,
      midiInput:
        channel.kind === "instrument" && channel.systemRole === null
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
      recordArmed: channel.recordArmed,
      inputMonitoring: channel.inputMonitoring,
      inputChannels: channel.inputChannels,
      hardwareOutputChannels: channel.hardwareOutputChannels
    })),
    sends: sendRows,
    plugins: pluginRows.map((plugin) => {
      const chunks = stateChunksByPlugin.get(plugin.id) ?? []
      return {
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
        sidechainInputs: sidechainRoutesByPlugin.get(plugin.id) ?? [],
        state: { version: 1 as const, chunks }
      }
    })
  }
}
