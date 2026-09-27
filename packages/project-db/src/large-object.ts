import type { Results } from "@electric-sql/pglite"
import { sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import type { PgliteBinaryFiles } from "./internal/binary-files"

export interface LargeObjectExecutor {
  execute(query: SQL): PromiseLike<Results<Record<string, unknown>>>
}

function requiredNumber(value: unknown, operation: string, minimum = 1): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`PostgreSQL large-object ${operation} failed`)
  }
  return parsed
}

export async function createLargeObject(executor: LargeObjectExecutor): Promise<number> {
  const result = await executor.execute(sql`select lo_create(0) as oid`)
  return requiredNumber(result.rows[0]?.oid, "creation")
}

export async function openLargeObject(executor: LargeObjectExecutor, oid: number): Promise<number> {
  const result = await executor.execute(sql`select lo_open(${oid}, 131072) as descriptor`)
  return requiredNumber(result.rows[0]?.descriptor, "open", 0)
}

export async function writeLargeObject(
  executor: LargeObjectExecutor,
  descriptor: number,
  chunk: Uint8Array,
  files: PgliteBinaryFiles
): Promise<void> {
  await files.withBytes(chunk, async (path) => {
    const result = await executor.execute(
      sql`select lowrite(${descriptor}, pg_read_binary_file(${path})) as written`
    )
    if (requiredNumber(result.rows[0]?.written, "write", 0) !== chunk.byteLength) {
      throw new Error("PostgreSQL large-object write was incomplete")
    }
  })
}

export async function closeLargeObject(
  executor: LargeObjectExecutor,
  descriptor: number
): Promise<void> {
  await executor.execute(sql`select lo_close(${descriptor})`)
}

export async function readLargeObject(
  executor: LargeObjectExecutor,
  oid: number,
  files: PgliteBinaryFiles
): Promise<Uint8Array> {
  return files.readFrom(async (path) => {
    const result = await executor.execute(sql`select lo_export(${oid}, ${path}) as exported`)
    if (requiredNumber(result.rows[0]?.exported, "export") !== 1) {
      throw new Error(`PostgreSQL large object '${oid}' was not exported`)
    }
  })
}

export async function unlinkLargeObject(executor: LargeObjectExecutor, oid: number): Promise<void> {
  await executor.execute(sql`select lo_unlink(${oid})`)
}
