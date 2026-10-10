import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { IPC_PROTOCOL_VERSION } from "@heron/contracts"
import { decode } from "@msgpack/msgpack"
import { describe, expect, it } from "vitest"
import {
  binaryBytes,
  extractLargeAttachments,
  hydrateAttachments,
  inlineBinary,
  percentile,
  stableRuntimeHandle
} from "./wire"

describe("stableRuntimeHandle", () => {
  it("returns a stable positive hash for a namespace and id", () => {
    const first = stableRuntimeHandle(1, "channel-a")
    const second = stableRuntimeHandle(1, "channel-a")
    const other = stableRuntimeHandle(1, "channel-b")

    expect(first).toBe(second)
    expect(first).toBeGreaterThanOrEqual(1)
    expect(first).not.toBe(other)
  })
})

describe("inlineBinary and binaryBytes", () => {
  it("wraps and unwraps inline payloads", () => {
    const bytes = new Uint8Array([1, 2, 3])
    const payload = inlineBinary(bytes)

    expect(payload).toEqual({ storage: "inline", bytes })
    expect(binaryBytes(payload)).toEqual(bytes)
  })

  it("returns an empty buffer for missing or attachment payloads", () => {
    expect(binaryBytes(undefined)).toEqual(new Uint8Array())
    expect(binaryBytes({ storage: "attachment", index: 0, offset: 0, length: 1 })).toEqual(
      new Uint8Array()
    )
  })
})

describe("extractLargeAttachments", () => {
  it("leaves small inline payloads in place", () => {
    const value = { payload: inlineBinary(new Uint8Array(16)) }
    const attachments: Buffer[] = []

    extractLargeAttachments(value, attachments)

    expect(attachments).toEqual([])
    expect(value.payload.storage).toBe("inline")
  })

  it("moves large nested payloads into attachments", () => {
    const large = new Uint8Array(64 * 1024 + 8)
    large.fill(7)
    const value = {
      nested: [{ payload: inlineBinary(large) }],
      ignored: null
    }
    const attachments: Buffer[] = []

    extractLargeAttachments(value, attachments)

    expect(attachments).toHaveLength(1)
    expect(attachments[0]?.equals(Buffer.from(large))).toBe(true)
    expect(value.nested[0]?.payload).toEqual({
      storage: "attachment",
      index: 0,
      offset: 0,
      length: large.byteLength
    })
  })

  it("ignores non-objects", () => {
    const attachments: Buffer[] = []
    extractLargeAttachments(null, attachments)
    extractLargeAttachments("text", attachments)
    expect(attachments).toEqual([])
  })
})

describe("hydrateAttachments", () => {
  it("restores attachment payloads into inline bytes", () => {
    const bytes = Buffer.from([9, 8, 7, 6, 5])
    const value = {
      payload: {
        storage: "attachment" as const,
        index: 0,
        offset: 1,
        length: 3
      }
    }

    hydrateAttachments(value, [bytes])

    expect(value.payload.storage).toBe("inline")
    expect(Uint8Array.from((value.payload as unknown as { bytes: Uint8Array }).bytes)).toEqual(
      new Uint8Array([8, 7, 6])
    )
  })

  it("hydrates nested arrays and rejects invalid references", () => {
    const value = {
      items: [{ storage: "attachment" as const, index: 0, offset: 0, length: 2 }]
    }
    hydrateAttachments(value, [Buffer.from([1, 2, 3])])
    expect(value.items[0]?.storage).toBe("inline")
    expect(Uint8Array.from((value.items[0] as unknown as { bytes: Uint8Array }).bytes)).toEqual(
      new Uint8Array([1, 2])
    )

    expect(() =>
      hydrateAttachments({ payload: { storage: "attachment", index: 0, offset: 0, length: 99 } }, [
        Buffer.from([1])
      ])
    ).toThrow("audio host returned an invalid attachment reference")
  })
})

describe("percentile", () => {
  it("returns 0 for an empty series", () => {
    expect(percentile([], 0.5)).toBe(0)
  })

  it("selects clamped percentile samples from a sorted copy", () => {
    const values = [40, 10, 30, 20]

    expect(percentile(values, 0)).toBe(10)
    expect(percentile(values, 1)).toBe(40)
    expect(percentile(values, 0.5)).toBe(30)
    expect(percentile(values, -1)).toBe(10)
    expect(percentile(values, 2)).toBe(40)
    expect(values).toEqual([40, 10, 30, 20])
  })
})

interface MessagePackFixture {
  name: string
  producer: "rust" | "typescript"
  wireType: string
  base64: string
  normalized: unknown
}

const fixturePath = resolve(
  import.meta.dirname,
  "../../../../../crates/dsp-runtime/tests/fixtures/audio-host-messagepack.json"
)
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8")) as MessagePackFixture[]

function normalizeWireValue(value: unknown): unknown {
  if (value instanceof Uint8Array) return Array.from(value)
  if (Array.isArray(value)) return value.map(normalizeWireValue)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, normalizeWireValue(child)])
    )
  }
  return value
}

describe("Rust MessagePack fixtures", () => {
  for (const fixture of fixtures.filter(({ producer }) => producer === "rust")) {
    it(`decodes and normalizes ${fixture.name}`, () => {
      const decoded = decode(Buffer.from(fixture.base64, "base64"))
      expect(normalizeWireValue(decoded)).toEqual(fixture.normalized)
    })
  }
})

describe("cross-language protocol constants", () => {
  // The Rust side owns the wire. These assert the TypeScript mirror still
  // agrees with bytes the Rust encoder produced, which a hand-maintained
  // constant alone cannot.
  it("agrees with the protocol version the Rust fixtures carry", () => {
    const versions = fixtures
      .filter(({ producer }) => producer === "rust")
      .flatMap((fixture) => {
        const decoded = normalizeWireValue(decode(Buffer.from(fixture.base64, "base64"))) as {
          command?: { meta?: { protocolVersion?: unknown } }
        }
        const version = decoded.command?.meta?.protocolVersion
        return typeof version === "number" ? [version] : []
      })

    expect(versions.length).toBeGreaterThan(0)
    for (const version of versions) expect(version).toBe(IPC_PROTOCOL_VERSION)
  })
})
