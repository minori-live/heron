import { asc } from "drizzle-orm"
import type { PgliteDatabase } from "drizzle-orm/pglite"
import type { LiveHierarchy, LivePluginStateOverride } from "@heron/contracts"
import * as schema from "../live-schema"
import { bytes } from "./serialization"

type LiveDb = PgliteDatabase<typeof schema>
const {
  liveSets,
  livePatches,
  liveSetPluginStates,
  livePatchPluginStates,
  liveSetPluginStateChunks,
  livePatchPluginStateChunks
} = schema

/** Binary state payloads never enter the scalar override JSON column. */
export async function readLiveHierarchy(db: Pick<LiveDb, "select">): Promise<LiveHierarchy> {
  const [sets, patches, setStates, patchStates, setChunks, patchChunks] = await Promise.all([
    db.select().from(liveSets).orderBy(asc(liveSets.sortOrder), asc(liveSets.id)),
    db
      .select()
      .from(livePatches)
      .orderBy(asc(livePatches.setId), asc(livePatches.sortOrder), asc(livePatches.id)),
    db.select().from(liveSetPluginStates).orderBy(asc(liveSetPluginStates.pluginId)),
    db.select().from(livePatchPluginStates).orderBy(asc(livePatchPluginStates.pluginId)),
    db.select().from(liveSetPluginStateChunks).orderBy(asc(liveSetPluginStateChunks.chunkKey)),
    db.select().from(livePatchPluginStateChunks).orderBy(asc(livePatchPluginStateChunks.chunkKey))
  ])
  const statesFor = (
    headers: Array<{ pluginId: string }>,
    chunks: Array<{ pluginId: string; chunkKey: string; bytes: Uint8Array }>
  ): { pluginStates?: LivePluginStateOverride[] } =>
    headers.length
      ? {
          pluginStates: headers.map(({ pluginId }) => ({
            pluginId,
            state: {
              version: 1,
              chunks: chunks
                .filter((chunk) => chunk.pluginId === pluginId)
                .map((chunk) => ({ key: chunk.chunkKey, bytes: bytes(chunk.bytes) }))
            }
          }))
        }
      : {}
  return {
    sets: sets.map((set) => ({
      ...set,
      ...statesFor(
        setStates.filter((state) => state.setId === set.id),
        setChunks.filter((chunk) => chunk.setId === set.id)
      )
    })),
    patches: patches.map((patch) => ({
      ...patch,
      ...statesFor(
        patchStates.filter((state) => state.patchId === patch.id),
        patchChunks.filter((chunk) => chunk.patchId === patch.id)
      )
    }))
  }
}

/** Called in the baseline transaction after root plug-in rows exist. */
export async function replaceLiveHierarchy(
  db: Pick<LiveDb, "delete" | "insert">,
  hierarchy: LiveHierarchy
): Promise<void> {
  await db.delete(liveSets)
  if (hierarchy.sets.length)
    await db.insert(liveSets).values(hierarchy.sets.map(({ pluginStates: _states, ...set }) => set))
  if (hierarchy.patches.length)
    await db
      .insert(livePatches)
      .values(hierarchy.patches.map(({ pluginStates: _states, ...patch }) => patch))

  const setStates = hierarchy.sets.flatMap((set) =>
    (set.pluginStates ?? []).map((state) => ({ setId: set.id, ...state }))
  )
  const patchStates = hierarchy.patches.flatMap((patch) =>
    (patch.pluginStates ?? []).map((state) => ({ patchId: patch.id, ...state }))
  )
  if (setStates.length)
    await db
      .insert(liveSetPluginStates)
      .values(setStates.map(({ setId, pluginId }) => ({ setId, pluginId })))
  if (patchStates.length)
    await db
      .insert(livePatchPluginStates)
      .values(patchStates.map(({ patchId, pluginId }) => ({ patchId, pluginId })))
  const setChunks = setStates.flatMap(({ setId, pluginId, state }) =>
    state.chunks.map((chunk) => ({ setId, pluginId, chunkKey: chunk.key, bytes: chunk.bytes }))
  )
  const patchChunks = patchStates.flatMap(({ patchId, pluginId, state }) =>
    state.chunks.map((chunk) => ({ patchId, pluginId, chunkKey: chunk.key, bytes: chunk.bytes }))
  )
  if (setChunks.length) await db.insert(liveSetPluginStateChunks).values(setChunks)
  if (patchChunks.length) await db.insert(livePatchPluginStateChunks).values(patchChunks)
}
