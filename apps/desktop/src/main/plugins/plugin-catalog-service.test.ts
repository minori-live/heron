import { describe, expect, it, vi } from "vitest"
import type { PluginDescriptor } from "@heron/contracts"
import {
  canReuseCachedBundle,
  descriptorFromProbe,
  descriptorsFromModuleInfo,
  parseProbeStdout,
  PluginCatalogService
} from "./plugin-catalog-service"

const plugin = {
  compatibility: "compatible"
} as PluginDescriptor

describe("canReuseCachedBundle", () => {
  it("reuses unchanged bundles unless a forced rescan is requested", () => {
    expect(
      canReuseCachedBundle({
        force: false,
        retryQuarantined: false,
        fingerprintMatches: true,
        previousPlugins: [plugin]
      })
    ).toBe(true)
    expect(
      canReuseCachedBundle({
        force: false,
        retryQuarantined: false,
        fingerprintMatches: false,
        previousPlugins: [plugin]
      })
    ).toBe(false)
    expect(
      canReuseCachedBundle({
        force: true,
        retryQuarantined: false,
        fingerprintMatches: true,
        previousPlugins: [plugin]
      })
    ).toBe(false)
  })

  it("retries quarantined bundles when requested", () => {
    expect(
      canReuseCachedBundle({
        force: false,
        retryQuarantined: true,
        fingerprintMatches: true,
        previousPlugins: [{ ...plugin, compatibility: "quarantined" }]
      })
    ).toBe(false)
  })
})

describe("parseProbeStdout", () => {
  it("accepts pure JSON and recovers JSON after plug-in stdout noise", () => {
    const payload = JSON.stringify({
      module: { path: "demo.vst3", vendor: "", classes: [{ classId: "1", categories: ["Fx"] }] }
    })
    expect(parseProbeStdout(payload).module?.classes?.[0]?.classId).toBe("1")
    expect(
      parseProbeStdout(`[info] initializing...\n${payload}\n`).module?.classes?.[0]?.classId
    ).toBe("1")
  })
})

describe("descriptorsFromModuleInfo", () => {
  it("builds soft catalog entries from moduleinfo without requiring a probe", () => {
    const descriptors = descriptorsFromModuleInfo("/Library/Audio/Plug-Ins/VST3/Demo.vst3", {
      Version: "1.2.3",
      "Factory Info": { Vendor: "Acme" },
      Classes: [
        {
          CID: "ABCDEF0123456789ABCDEF0123456789",
          Category: "Audio Module Class",
          Name: "Demo Delay",
          Vendor: "Acme Audio",
          Version: "1.2.3",
          "Sub Categories": ["Fx", "Delay"]
        },
        {
          CID: "FEDCBA9876543210FEDCBA9876543210",
          Category: "Audio Module Class",
          Name: "Demo Synth",
          "Sub Categories": ["Instrument", "Synth"]
        },
        {
          CID: "ignored",
          Category: "Service Class",
          Name: "Helper"
        }
      ]
    })

    expect(descriptors).toHaveLength(2)
    expect(descriptors[0]).toMatchObject({
      locator: {
        format: "vst3",
        artifactPath: "/Library/Audio/Plug-Ins/VST3/Demo.vst3",
        nativeId: "ABCDEF0123456789ABCDEF0123456789"
      },
      name: "Demo Delay",
      vendor: "Acme Audio",
      kind: "effect",
      categories: ["Fx", "Delay"],
      compatibility: "compatible",
      supportedAudioModes: ["mono", "mono-to-stereo", "stereo", "dual-mono"]
    })
    expect(descriptors[1]).toMatchObject({
      locator: {
        format: "vst3",
        artifactPath: "/Library/Audio/Plug-Ins/VST3/Demo.vst3",
        nativeId: "FEDCBA9876543210FEDCBA9876543210"
      },
      name: "Demo Synth",
      kind: "instrument",
      categories: ["Instrument", "Synth"],
      compatibility: "compatible",
      supportedAudioModes: ["mono", "stereo"]
    })
  })

  it("marks modules without Audio Module classes as needing factory enumeration", () => {
    const [descriptor] = descriptorsFromModuleInfo("legacy.vst3", {
      "Factory Info": { Vendor: "Legacy" },
      Classes: []
    })
    expect(descriptor).toMatchObject({
      locator: {
        format: "vst3",
        artifactPath: "legacy.vst3",
        nativeId: "unprobed:legacy.vst3"
      },
      compatibility: "load-error",
      supportedAudioModes: []
    })
  })

  it("still exposes Audio Module classes when an ARA factory is also listed", () => {
    const descriptors = descriptorsFromModuleInfo("melody.vst3", {
      "Factory Info": { Vendor: "Acme" },
      Classes: [
        {
          CID: "ABCDEF0123456789ABCDEF0123456789",
          Category: "Audio Module Class",
          Name: "Melody",
          "Sub Categories": ["Fx"]
        },
        {
          CID: "ARAFACTORY0123456789ABCDEF012345",
          Category: "ARA Main Factory Class",
          Name: "Melody"
        }
      ]
    })
    expect(descriptors).toHaveLength(1)
    expect(descriptors[0]?.name).toBe("Melody")
    expect(descriptors[0]?.ara).toBeUndefined()
  })
})

describe("descriptorFromProbe", () => {
  it("derives dual mono only from native mono effect support", () => {
    const descriptor = descriptorFromProbe("effect.vst3", "Vendor", {
      classId: "effect",
      categories: ["Fx"],
      initialized: true,
      sample32: true,
      audioInputs: 1,
      audioOutputs: 1,
      supportedAudioModes: ["mono", "mono-to-stereo"]
    })

    expect(descriptor?.supportedAudioModes).toEqual(["mono", "mono-to-stereo", "dual-mono"])
    expect(descriptor?.categories).toEqual(["Fx"])
  })

  it("rejects probes that cannot negotiate an applicable main-bus mode", () => {
    const descriptor = descriptorFromProbe("instrument.vst3", "Vendor", {
      classId: "instrument",
      categories: ["Instrument", "Synth"],
      initialized: true,
      sample32: true,
      audioInputs: 0,
      audioOutputs: 1,
      eventInputs: 1,
      supportedAudioModes: ["mono-to-stereo"]
    })

    expect(descriptor).toMatchObject({
      compatibility: "unsupported-buses",
      supportedAudioModes: [],
      categories: ["Instrument", "Synth"]
    })
  })

  it("accepts legacy pipe-separated category strings from older probes", () => {
    const descriptor = descriptorFromProbe("legacy.vst3", "Vendor", {
      classId: "legacy",
      category: "Instrument|Sampler",
      initialized: true,
      sample32: true,
      audioInputs: 0,
      audioOutputs: 1,
      eventInputs: 1,
      supportedAudioModes: ["stereo"]
    })

    expect(descriptor).toMatchObject({
      kind: "instrument",
      categories: ["Instrument", "Sampler"]
    })
  })

  it("retains verified ARA factory metadata without changing insertion compatibility", () => {
    const descriptor = descriptorFromProbe("melody.vst3", "Vendor", {
      classId: "audio-module-class",
      categories: ["Fx"],
      initialized: true,
      sample32: true,
      audioInputs: 1,
      audioOutputs: 1,
      supportedAudioModes: ["stereo"],
      ara: {
        factoryClassId: "ara-main-factory-class",
        factoryId: "com.vendor.melody",
        documentArchiveId: "com.vendor.melody.archive",
        lowestApiGeneration: 4,
        highestApiGeneration: 6,
        playbackTransformationFlags: 7,
        supportsStoringAudioFileChunks: true
      }
    })

    expect(descriptor).toMatchObject({
      compatibility: "compatible",
      supportedAudioModes: ["stereo"],
      ara: {
        apiGeneration: 2,
        factoryClassId: "ara-main-factory-class",
        factoryId: "com.vendor.melody",
        documentArchiveId: "com.vendor.melody.archive",
        lowestApiGeneration: 4,
        highestApiGeneration: 6,
        playbackTransformationFlags: 7,
        supportsStoringAudioFileChunks: true
      }
    })
  })

  it("does not derive dual mono for an ARA effect", () => {
    const descriptor = descriptorFromProbe("ara-effect.vst3", "Vendor", {
      classId: "ara-effect",
      categories: ["Fx"],
      initialized: true,
      sample32: true,
      audioInputs: 1,
      audioOutputs: 1,
      supportedAudioModes: ["mono", "mono-to-stereo", "stereo"],
      ara: {
        factoryClassId: "ara-main-factory-class",
        factoryId: "com.vendor.ara-effect",
        documentArchiveId: "com.vendor.ara-effect.archive",
        lowestApiGeneration: 4,
        highestApiGeneration: 5,
        playbackTransformationFlags: 0,
        supportsStoringAudioFileChunks: false
      }
    })

    expect(descriptor?.supportedAudioModes).toEqual(["mono", "mono-to-stereo", "stereo"])
  })
})

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
