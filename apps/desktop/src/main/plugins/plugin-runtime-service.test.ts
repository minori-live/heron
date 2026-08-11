import { describe, expect, it, vi } from "vitest"
import type { PluginDescriptor, PluginInstanceState } from "@heron/contracts"
import { PluginRuntimeService, type PluginRuntime } from "./plugin-runtime-service"

const descriptor: PluginDescriptor = {
  source: { kind: "external" },
  locator: {
    format: "vst3",
    artifactPath: "/plugins/Effect.vst3",
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
  compatibilityReason: null
}

function plugin(enabled: boolean): PluginInstanceState {
  return {
    id: "plugin-1",
    channelId: "master",
    role: "insert",
    slotOrder: 0,
    locator: descriptor.locator,
    descriptor,
    audioMode: "stereo",
    enabled,
    sidechainInputs: [],
    state: { version: 1, chunks: [] }
  }
}

function runtime(enabled: boolean): PluginRuntime & {
  retry: ReturnType<typeof vi.fn>
  load: ReturnType<typeof vi.fn>
} {
  return {
    resolveInstance: vi.fn().mockResolvedValue({ plugin: plugin(enabled), sampleRate: 48_000 }),
    load: vi.fn().mockResolvedValue({ latencySamples: 32, tailSamples: 64 }),
    parameters: vi.fn().mockResolvedValue([]),
    setParameter: vi.fn().mockResolvedValue(undefined),
    openEditor: vi.fn().mockResolvedValue({ editorMode: "native", open: true }),
    closeEditor: vi.fn().mockResolvedValue(undefined),
    retry: vi.fn().mockResolvedValue(undefined)
  }
}

describe("PluginRuntimeService retry", () => {
  it("requires an attached native runtime", async () => {
    await expect(new PluginRuntimeService().retry("plugin-1")).rejects.toThrow(
      "The native audio plug-in runtime is not running"
    )
  })

  it.each([
    { enabled: true, state: "active" },
    { enabled: false, state: "bypassed" }
  ] as const)("retries and reloads committed state into $state", async ({ enabled, state }) => {
    const service = new PluginRuntimeService()
    const attached = runtime(enabled)
    service.attach(attached)

    await expect(service.retry("plugin-1")).resolves.toEqual({
      instanceId: "plugin-1",
      state,
      editorOpen: false,
      failureStage: null,
      failure: null,
      latencySamples: 32,
      tailSamples: 64,
      error: null
    })
    expect(attached.retry).toHaveBeenCalledWith("plugin-1")
    expect(attached.load).toHaveBeenCalledWith(plugin(enabled), 48_000)
    expect(attached.retry).toHaveBeenCalledBefore(attached.load)
  })
})
