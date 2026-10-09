import { types } from "@electric-sql/pglite"
import { describe, expect, it } from "vitest"
import { pgliteByteaOptions } from "../internal/bytea-codecs"
import { bytes, pluginDescriptor } from "../internal/serialization"

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

describe("serialization helpers", () => {
  it("returns Uint8Array values unchanged", () => {
    const value = new Uint8Array([1, 2, 3])
    expect(bytes(value)).toBe(value)
  })

  it("copies ArrayBuffer views into Uint8Array", () => {
    const source = new Uint16Array([0x0102, 0x0304])
    const copied = bytes(source)
    expect(copied).toBeInstanceOf(Uint8Array)
    expect(copied.byteLength).toBe(source.byteLength)
  })

  it("returns an empty buffer for unsupported values", () => {
    expect(bytes(null)).toEqual(new Uint8Array())
    expect(bytes("text")).toEqual(new Uint8Array())
  })

  it("parses plugin descriptor snapshots", () => {
    const descriptor = {
      source: { kind: "external" },
      locator: {
        format: "vst3",
        artifactPath: "/plugin.vst3",
        nativeId: "ABCDEF0123456789ABCDEF0123456789"
      },
      name: "Effect",
      vendor: "Heron Studio",
      version: "1.0",
      categories: ["Fx"],
      kind: "effect",
      architecture: "x86_64",
      buses: [],
      supportedAudioModes: ["stereo"],
      hasEditor: true,
      compatibility: "compatible",
      compatibilityReason: null,
      category: "legacy-category"
    }

    expect(pluginDescriptor(JSON.stringify(descriptor))).toMatchObject({
      locator: descriptor.locator,
      name: "Effect",
      kind: "effect"
    })
  })
})
