import { describe, expect, it, vi } from "vitest"
import type { PluginDescriptor } from "@heron/contracts"
import { PluginCatalogService } from "./plugin-catalog-service"

function externalDescriptor(buses: PluginDescriptor["buses"] = []): PluginDescriptor {
  return {
    source: { kind: "external" },
    locator: {
      format: "vst3",
      artifactPath: "/plugins/Sidechain.vst3",
      nativeId: "sidechain-effect"
    },
    name: "Sidechain",
    vendor: "Acme",
    version: "1",
    categories: ["Fx"],
    kind: "effect",
    architecture: process.arch,
    buses,
    supportedAudioModes: ["stereo"],
    hasEditor: true,
    compatibility: "compatible",
    compatibilityReason: null
  }
}

describe("PluginCatalogService orchestration", () => {
  it("publishes built-in fallbacks when isolated probes fail", async () => {
    const probeClient = { probe: vi.fn().mockRejectedValue(new Error("probe unavailable")) }
    const discovery = { loadCachedCatalog: vi.fn().mockResolvedValue(null), scan: vi.fn() }
    const service = new PluginCatalogService("user-data", "probe", "builtins", {
      probeClient: probeClient as never,
      discovery: discovery as never
    })

    await service.initialize()

    expect(service.list().plugins).toHaveLength(4)
    expect(service.list().plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: { kind: "builtin", id: "live.minori.heron.eq" },
          locator: expect.objectContaining({ nativeId: "8A8341D5CA36B6C9A9572788F40EBB9F" }),
          name: "Heron EQ",
          kind: "effect",
          compatibility: "load-error",
          compatibilityReason: "probe unavailable"
        }),
        expect.objectContaining({
          source: { kind: "builtin", id: "live.minori.heron.gain" },
          compatibility: "load-error",
          compatibilityReason: "probe unavailable"
        })
      ])
    )
  })

  it("coalesces concurrent scans through the catalog facade", async () => {
    let finish!: () => void
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    const discovery = {
      loadCachedCatalog: vi.fn().mockResolvedValue(null),
      scan: vi.fn().mockImplementation(async (catalog) => {
        await pending
        return { ...catalog, scanning: false, scannedAt: 1 }
      })
    }
    const service = new PluginCatalogService("user-data", "probe", "builtins", {
      probeClient: { probe: vi.fn() } as never,
      discovery: discovery as never
    })

    const first = service.scan({ force: true })
    const second = service.scan({ retryQuarantined: true })
    finish()

    await expect(first).resolves.toMatchObject({ scannedAt: 1 })
    await expect(second).resolves.toMatchObject({ scannedAt: 1 })
    expect(discovery.scan).toHaveBeenCalledOnce()
  })

  it("coalesces deep probes of the requested class immediately before runtime loading", async () => {
    const deep = externalDescriptor([
      {
        portKey: "vst3:audio:input:0",
        direction: "input",
        kind: "main",
        name: "Stereo In",
        channels: 2,
        defaultActive: true
      },
      {
        portKey: "vst3:audio:input:1",
        direction: "input",
        kind: "aux",
        name: "Stereo Side Chain",
        channels: 2,
        defaultActive: true
      }
    ])
    const probeClient = { probe: vi.fn().mockResolvedValue([deep]) }
    const service = new PluginCatalogService("user-data", "probe", "builtins", {
      probeClient: probeClient as never
    })
    const startupDescriptor = externalDescriptor()

    const [first, second] = await Promise.all([
      service.resolveDescriptorForRuntime(startupDescriptor),
      service.resolveDescriptorForRuntime(startupDescriptor)
    ])

    expect(probeClient.probe).toHaveBeenCalledOnce()
    expect(probeClient.probe).toHaveBeenCalledWith(
      startupDescriptor.locator.artifactPath,
      "deep",
      startupDescriptor.locator.nativeId
    )
    expect(first.buses).toContainEqual(
      expect.objectContaining({
        portKey: "vst3:audio:input:1",
        direction: "input",
        kind: "aux"
      })
    )
    expect(second).toEqual(first)
  })

  it("resolves a mono class without waiting for a sibling class from the same bundle", async () => {
    const target: PluginDescriptor = {
      ...externalDescriptor(),
      supportedAudioModes: ["mono", "dual-mono"]
    }
    const sibling = {
      ...externalDescriptor(),
      locator: { ...target.locator, nativeId: "slow-sibling" }
    }
    let finishSibling!: (descriptors: PluginDescriptor[]) => void
    const pendingSibling = new Promise<PluginDescriptor[]>((resolve) => {
      finishSibling = resolve
    })
    const probeClient = {
      probe: vi
        .fn()
        .mockImplementation((_path, _mode, nativeId) =>
          nativeId === target.locator.nativeId ? Promise.resolve([target]) : pendingSibling
        )
    }
    const service = new PluginCatalogService("user-data", "probe", "builtins", {
      probeClient: probeClient as never
    })

    const siblingResult = service.resolveDescriptorForRuntime(sibling)
    const targetResult = service.resolveDescriptorForRuntime(externalDescriptor())
    try {
      expect(probeClient.probe).toHaveBeenCalledTimes(2)
      await expect(targetResult).resolves.toMatchObject({
        locator: target.locator,
        supportedAudioModes: ["mono", "dual-mono"],
        compatibility: "compatible"
      })
    } finally {
      finishSibling([sibling])
      await Promise.all([siblingResult, targetResult])
    }
  })

  it("updates only the requested catalog class after a runtime probe", async () => {
    const target = externalDescriptor()
    const sibling = {
      ...externalDescriptor(),
      locator: { ...target.locator, nativeId: "unrelated-effect" }
    }
    const probeClient = { probe: vi.fn().mockRejectedValue(new Error("builtins unavailable")) }
    const discovery = {
      loadCachedCatalog: vi.fn().mockResolvedValue({
        scannerVersion: 4,
        scanning: false,
        scannedAt: 1,
        plugins: [target, sibling]
      }),
      scan: vi.fn()
    }
    const service = new PluginCatalogService("user-data", "probe", "builtins", {
      probeClient: probeClient as never,
      discovery: discovery as never
    })
    await service.initialize()
    probeClient.probe.mockResolvedValue([
      { ...target, supportedAudioModes: ["mono", "dual-mono"] },
      { ...sibling, supportedAudioModes: [], compatibility: "load-error" }
    ])

    await service.resolveDescriptorForRuntime(target)

    expect(service.list().plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          locator: target.locator,
          supportedAudioModes: ["mono", "dual-mono"]
        }),
        sibling
      ])
    )
  })

  it("does not load a soft-advertised layout after the deep probe crashes", async () => {
    const probeClient = { probe: vi.fn().mockRejectedValue(new Error("probe crashed")) }
    const service = new PluginCatalogService("user-data", "probe", "builtins", {
      probeClient: probeClient as never
    })

    const resolved = await service.resolveDescriptorForRuntime({
      ...externalDescriptor(),
      supportedAudioModes: ["mono-to-stereo"]
    })

    expect(resolved).toMatchObject({
      compatibility: "load-error",
      compatibilityReason: "probe crashed",
      supportedAudioModes: []
    })
  })

  it("retries a failed class probe without invalidating a successful sibling", async () => {
    const target = externalDescriptor()
    const sibling = {
      ...target,
      locator: { ...target.locator, nativeId: "failing-sibling" }
    }
    const probeClient = {
      probe: vi
        .fn()
        .mockResolvedValueOnce([target])
        .mockRejectedValueOnce(new Error("sibling probe failed"))
        .mockResolvedValueOnce([sibling])
    }
    const service = new PluginCatalogService("user-data", "probe", "builtins", {
      probeClient: probeClient as never
    })

    await service.resolveDescriptorForRuntime(target)
    await expect(service.resolveDescriptorForRuntime(sibling)).resolves.toMatchObject({
      compatibility: "load-error"
    })
    await expect(service.resolveDescriptorForRuntime(target)).resolves.toEqual(target)
    await expect(service.resolveDescriptorForRuntime(sibling)).resolves.toEqual(sibling)

    expect(probeClient.probe.mock.calls.map((call) => call[2])).toEqual([
      target.locator.nativeId,
      sibling.locator.nativeId,
      sibling.locator.nativeId
    ])
  })

  it("persists a deep-probe failure only on the matching cached plug-in", async () => {
    const target = externalDescriptor()
    const unrelated = {
      ...externalDescriptor(),
      locator: { ...externalDescriptor().locator, nativeId: "unrelated-effect" },
      name: "Unrelated"
    }
    const probeClient = { probe: vi.fn().mockRejectedValue(new Error("probe crashed")) }
    const discovery = {
      loadCachedCatalog: vi.fn().mockResolvedValue({
        scannerVersion: 4,
        scanning: false,
        scannedAt: 1,
        plugins: [target, unrelated]
      }),
      scan: vi.fn()
    }
    const service = new PluginCatalogService("user-data", "probe", "builtins", {
      probeClient: probeClient as never,
      discovery: discovery as never
    })
    await service.initialize()

    await service.resolveDescriptorForRuntime(target)

    expect(service.list().plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          locator: target.locator,
          compatibility: "load-error",
          supportedAudioModes: []
        }),
        expect.objectContaining({
          locator: unrelated.locator,
          compatibility: "compatible",
          supportedAudioModes: ["stereo"]
        })
      ])
    )
  })

  it("rejects a missing requested class without fallback and permits a later probe", async () => {
    const probeClient = {
      probe: vi.fn().mockResolvedValue([
        {
          ...externalDescriptor(),
          locator: { ...externalDescriptor().locator, nativeId: "different-effect" }
        }
      ])
    }
    const service = new PluginCatalogService("user-data", "probe", "builtins", {
      probeClient: probeClient as never
    })

    const resolved = await service.resolveDescriptorForRuntime(externalDescriptor())

    expect(resolved.supportedAudioModes).toEqual([])
    expect(resolved.compatibility).toBe("load-error")
    expect(resolved.compatibilityReason).toContain("requested plug-in class")

    probeClient.probe.mockResolvedValueOnce([externalDescriptor()])
    await expect(service.resolveDescriptorForRuntime(externalDescriptor())).resolves.toEqual(
      externalDescriptor()
    )
    expect(probeClient.probe).toHaveBeenCalledTimes(2)
  })
})
