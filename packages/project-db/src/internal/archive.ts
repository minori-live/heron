import { open } from "node:fs/promises"
import { dirname } from "node:path"
import type { PGlite } from "@electric-sql/pglite"
import type { PgliteDatabase } from "drizzle-orm/pglite"
import { unlinkLargeObject } from "../large-object"
import { listLargeObjectOids, vacuumAndAnalyze } from "../maintenance"
import { assets } from "../schema"
import * as schema from "../schema"

type ProjectDb = PgliteDatabase<typeof schema>

async function maintainForSave(db: ProjectDb): Promise<void> {
  await db.transaction(async (tx) => {
    const referencedRows = await tx.select({ oid: assets.largeObjectOid }).from(assets)
    const referenced = new Set(referencedRows.map((row) => row.oid))
    const largeObjectOids = await listLargeObjectOids(tx)
    const orphaned = largeObjectOids.filter((oid) => !referenced.has(oid))
    for (const oid of orphaned) await unlinkLargeObject(tx, oid)
  })
  await vacuumAndAnalyze(db)
}

export async function dumpProjectArchive(
  db: ProjectDb,
  client: PGlite,
  outputPath: string
): Promise<void> {
  await maintainForSave(db)
  await dumpDataDirectory(client, outputPath)
}

/** Write the PGlite image durably; each document kind performs its own maintenance first. */
export async function dumpDataDirectory(client: PGlite, outputPath: string): Promise<void> {
  const dump = await client.dumpDataDir("none")
  const handle = await open(outputPath, "w")
  const reader = dump.stream().getReader()
  try {
    // PGlite owns the archive Blob. Avoid another archive-sized ArrayBuffer.
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      await handle.writeFile(chunk.value)
    }
    await handle.sync()
  } finally {
    reader.releaseLock()
    await handle.close()
  }
  try {
    const directory = await open(dirname(outputPath), "r")
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== "EPERM" && code !== "EINVAL") throw error
  }
}
