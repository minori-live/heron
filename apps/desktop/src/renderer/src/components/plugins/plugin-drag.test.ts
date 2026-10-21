import { describe, expect, it } from "vitest"
import type { PluginDescriptor } from "@heron/contracts"
import { parsePluginDrag, serializePluginDrag } from "./plugin-drag"

const descriptor = {
  source: { kind: "external" },
  locator: { format: "vst3", artifactPath: "/Effect.vst3", nativeId: "effect" },
  name: "Effect",
  vendor: "Heron Studio",
  version: "1.0",
  categories: ["Fx"],
  kind: "effect",
  architecture: "x86_64",
  buses: [],
  supportedAudioModes: ["stereo"],
  hasEditor: false,
  compatibility: "compatible",
  compatibilityReason: null
} satisfies PluginDescriptor

describe("plugin drag helpers", () => {
  it("serializes catalog and rack payloads", () => {
    expect(serializePluginDrag({ source: "catalog", descriptor })).toBe(
      JSON.stringify({ source: "catalog", descriptor })
    )
    expect(serializePluginDrag({ source: "rack", instanceId: "plugin-1" })).toBe(
      JSON.stringify({ source: "rack", instanceId: "plugin-1" })
    )
  })

  it("parses valid payloads and ignores malformed data", () => {
    expect(parsePluginDrag(JSON.stringify({ source: "rack", instanceId: "p1" }))).toEqual({
      source: "rack",
      instanceId: "p1"
    })
    expect(parsePluginDrag(JSON.stringify({ source: "catalog", descriptor }))).toEqual({
      source: "catalog",
      descriptor
    })
    expect(parsePluginDrag("")).toBeNull()
    expect(parsePluginDrag("{")).toBeNull()
    expect(parsePluginDrag(JSON.stringify({ source: "rack" }))).toBeNull()
  })
})
