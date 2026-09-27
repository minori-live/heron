import { types } from "@electric-sql/pglite"
import { describe, expect, it } from "vitest"
import { pgliteByteaOptions } from "../internal/bytea-codecs"

const serialize = pgliteByteaOptions.serializers[types.BYTEA]
const parse = pgliteByteaOptions.parsers[types.BYTEA]

describe("project bytea codec boundary", () => {
  it("encodes only a byte view's visible range and preserves every byte on decode", () => {
    const view = new Uint8Array([90, 0, 127, 128, 255, 91]).subarray(1, 5)
    expect(serialize(view)).toBe("\\x007f80ff")
    expect(parse(serialize(view))).toEqual(view)
    expect(parse(serialize(new Uint8Array()))).toHaveLength(0)
  })

  it("rejects bytea types that would reinterpret multi-byte elements or arbitrary objects", () => {
    expect(() => serialize(new Uint16Array([0xffff]))).toThrow(TypeError)
    expect(() => serialize({ byteLength: 4 })).toThrow(TypeError)
  })

  it("rejects malformed server bytes instead of returning silently truncated data", () => {
    for (const value of ["00ff", "\\x0", "\\xgg", "\\x00zz", "\\x00  "]) {
      expect(() => parse(value)).toThrow(TypeError)
    }
  })
})
