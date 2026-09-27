import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import type { Results } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { SQL } from "drizzle-orm"
import {
  closeLargeObject,
  createLargeObject,
  openLargeObject,
  readLargeObject,
  unlinkLargeObject,
  writeLargeObject
} from "../large-object"
import { listLargeObjectOids, vacuumAndAnalyze } from "../maintenance"
import { PgliteBinaryFiles } from "../internal/binary-files"

function mockResults(
  rows: Array<Record<string, unknown>>,
  affectedRows = 0
): Results<Record<string, unknown>> {
  return { rows, affectedRows, fields: [] }
}

function createExecutor(responses: Array<Results<Record<string, unknown>>>) {
  let index = 0
  const queries: SQL[] = []
  return {
    queries,
    execute(query: SQL): Promise<Results<Record<string, unknown>>> {
      queries.push(query)
      const result = responses[index++]
      if (!result) {
        throw new Error(`Unexpected query at index ${index - 1}`)
      }
      return Promise.resolve(result)
    }
  }
}

describe("large-object helpers", () => {
  let client: PGlite
  let files: PgliteBinaryFiles
  beforeAll(async () => {
    client = await PGlite.create()
    files = new PgliteBinaryFiles(client)
  })
  afterAll(async () => {
    await client?.close()
  })
  const temporaryFiles = () =>
    client.Module.FS.readdir("/tmp").filter((name: string) => name.startsWith("heron-binary-"))

  it("round-trips multiple binary chunks and empty objects without bytea text codecs", async () => {
    const payload = Uint8Array.from({ length: 8197 }, (_, index) => index % 256).subarray(3, 8195)
    const executor = drizzle(client)
    client.serializers[17] = () => {
      throw new Error("Audio must not use the bytea serializer")
    }
    client.parsers[17] = () => {
      throw new Error("Audio must not use the bytea parser")
    }
    for (const bytes of [payload, new Uint8Array()]) {
      const oid = await executor.transaction(async (tx) => {
        const oid = await createLargeObject(tx)
        const descriptor = await openLargeObject(tx, oid)
        await writeLargeObject(tx, descriptor, bytes.subarray(0, 4096), files)
        await writeLargeObject(tx, descriptor, bytes.subarray(4096), files)
        await closeLargeObject(tx, descriptor)
        return oid
      })
      expect(await readLargeObject(executor, oid, files)).toEqual(bytes)
      await unlinkLargeObject(executor, oid)
    }
    expect(temporaryFiles()).toEqual([])
  })

  it("rejects invalid oid and descriptor values", async () => {
    const executor = createExecutor([mockResults([{ oid: "bad" }])])

    await expect(createLargeObject(executor)).rejects.toThrow(/creation failed/)
  })

  it("rolls back a failed binary write and reclaims temporary input and output paths", async () => {
    const executor = drizzle(client)
    const before = await listLargeObjectOids(executor)
    await expect(
      executor.transaction(async (tx) => {
        const oid = await createLargeObject(tx)
        const descriptor = await openLargeObject(tx, oid)
        await writeLargeObject(tx, descriptor, new Uint8Array([0, 255]), files)
        await closeLargeObject(tx, descriptor)
        await writeLargeObject(tx, descriptor, new Uint8Array([128]), files)
      })
    ).rejects.toThrow()
    expect(await listLargeObjectOids(executor)).toEqual(before)
    await expect(readLargeObject(executor, 0, files)).rejects.toThrow()
    expect(temporaryFiles()).toEqual([])
  })

  it("cleans partially produced exports and keeps concurrent transfer paths independent", async () => {
    const failure = new Error("Export interrupted")
    await expect(
      files.readFrom(async (path) => {
        client.copyToFS(path, new Uint8Array([1, 2]))
        throw failure
      })
    ).rejects.toBe(failure)
    const paths = new Set<string>()
    await Promise.all(
      [3, 7].map((byte) =>
        files.withBytes(new Uint8Array([byte]), async (path) => {
          paths.add(path)
          await Promise.resolve()
          expect(client.Module.FS.readFile(path, { encoding: "binary" })).toEqual(
            new Uint8Array([byte])
          )
        })
      )
    )
    expect(paths.size).toBe(2)
    expect(temporaryFiles()).toEqual([])
  })
})

describe("maintenance helpers", () => {
  it("lists large-object oids and ignores invalid rows", async () => {
    const executor = createExecutor([
      mockResults([{ oid: 1 }, { oid: "bad" }, { oid: 0 }, { oid: 3 }])
    ])

    await expect(listLargeObjectOids(executor)).resolves.toEqual([1, 3])
  })

  it("runs vacuum analyze outside transactions", async () => {
    const executor = createExecutor([mockResults([])])

    await vacuumAndAnalyze(executor)

    expect(executor.queries).toHaveLength(1)
  })
})
