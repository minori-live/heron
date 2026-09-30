import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { IPC_PROTOCOL_VERSION } from "@heron/contracts"
import { decode } from "@msgpack/msgpack"
import { describe, expect, it } from "vitest"

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
