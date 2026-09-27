import { asc, eq, sql } from "drizzle-orm"
import type { ProjectAssetSummary } from "@heron/contracts"
import { assets, midiSources } from "../schema"
import type { ProjectDb } from "./database-types"

const audioColumns = {
  id: assets.id,
  name: assets.name,
  contentHash: assets.contentHash,
  sampleRate: assets.sampleRate,
  channels: assets.channels,
  bitDepth: assets.bitDepth,
  frameCount: assets.frameCount
}

// PostgreSQL obtains the length without sending a source's bytea payload to JS.
const midiColumns = {
  id: midiSources.id,
  name: midiSources.name,
  contentHash: midiSources.contentHash,
  byteLength: sql<number>`octet_length(${midiSources.rawBytes})`.mapWith(Number)
}

export async function listAssetMetadata(db: ProjectDb): Promise<ProjectAssetSummary[]> {
  const [audio, midi] = await Promise.all([
    db.select(audioColumns).from(assets).orderBy(asc(assets.createdAt), asc(assets.id)),
    db.select(midiColumns).from(midiSources).orderBy(asc(midiSources.name), asc(midiSources.id))
  ])
  return [
    ...audio.map((row) => ({ ...row, kind: "audio" as const })),
    ...midi.map((row) => ({ ...row, kind: "midi" as const }))
  ]
}

export async function findAssetByContentHash(
  db: ProjectDb,
  kind: ProjectAssetSummary["kind"],
  contentHash: string
): Promise<ProjectAssetSummary | null> {
  if (kind === "audio") {
    const [row] = await db
      .select(audioColumns)
      .from(assets)
      .where(eq(assets.contentHash, contentHash))
      .limit(1)
    return row ? { ...row, kind } : null
  }
  const [row] = await db
    .select(midiColumns)
    .from(midiSources)
    .where(eq(midiSources.contentHash, contentHash))
    .limit(1)
  return row ? { ...row, kind } : null
}
