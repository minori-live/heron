import { types } from "@electric-sql/pglite"
import type { PGliteOptions } from "@electric-sql/pglite"

function serializeBytea(value: unknown): string {
  if (!(value instanceof Uint8Array)) throw new TypeError("bytea requires a Uint8Array")
  return "\\x" + Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("hex")
}

function parseBytea(value: string): Uint8Array {
  if (!value.startsWith("\\x") || value.length % 2 !== 0) {
    throw new TypeError("bytea must use PostgreSQL hexadecimal output")
  }
  const bytes = Buffer.from(value.slice(2), "hex")
  // Buffer's hex decoder otherwise silently truncates malformed input.
  if (bytes.byteLength !== (value.length - 2) / 2)
    throw new TypeError("Invalid bytea hexadecimal data")
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/** Residual bytea fields retain PGlite's text protocol; audio uses binary files. */
export const pgliteByteaOptions = {
  serializers: { [types.BYTEA]: serializeBytea },
  parsers: { [types.BYTEA]: parseBytea }
} satisfies Pick<PGliteOptions, "serializers" | "parsers">
