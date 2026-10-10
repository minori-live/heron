import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { PluginDescriptor } from "@heron/contracts"
import { BUILTIN_PLUGIN_BASELINE, parseBuiltinPluginManifest } from "./builtin-plugin-manifest"
import { PluginCatalogService } from "./plugin-catalog-service"

function manifest() {
  return {
    schemaVersion: 1,
    version: "0.6.5",
    sourceCommit: "a".repeat(40),
    platform:
      process.platform === "darwin"
        ? "macos-universal"
        : `${process.platform === "win32" ? "windows" : "linux"}-${process.arch}`,
    plugins: BUILTIN_PLUGIN_BASELINE.map((plugin) => ({
      builtinId: plugin.id,
      nativeId: plugin.classId,
      bundleName: plugin.bundleName,
      name: plugin.name,
      kind: plugin.kind,
      format: "vst3"
    }))
  }
}

function gain(path: string): PluginDescriptor {
  return {
    source: { kind: "builtin", id: "live.minori.heron.gain" },
    locator: { format: "vst3", artifactPath: path, nativeId: "46774F504DF84B4AC1F308AB88DD3677" },
    name: "Heron Gain",
    vendor: "Heron Studio",
    version: "0.6.5",
    categories: ["Fx"],
    kind: "effect",
    architecture: process.arch,
    buses: [],
    supportedAudioModes: ["stereo"],
    hasEditor: true,
    compatibility: "compatible",
    compatibilityReason: null
  }
}

async function suite(source: unknown, run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "heron-plugin-inventory-"))
  try {
    await writeFile(join(directory, "bundle-manifest.json"), JSON.stringify(source))
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe("bundled plug-in inventory", () => {
  it("loads new suite entries and takes capabilities from the actual probe", async () => {
    const source = manifest()
    source.plugins = [
      {
        ...source.plugins[0]!,
        builtinId: "live.minori.heron.new",
        nativeId: "B".repeat(32),
        bundleName: "New.vst3",
        name: "New"
      }
    ]
    await suite(source, async (directory) => {
      const descriptor = gain(join(directory, "New.vst3"))
      descriptor.source = { kind: "external" }
      descriptor.locator.nativeId = "B".repeat(32)
      descriptor.hasEditor = false
      const probeClient = { probe: vi.fn().mockResolvedValue([descriptor]) }
      const discovery = { loadCachedCatalog: vi.fn().mockResolvedValue(null) }
      const catalog = new PluginCatalogService("unused", "probe", directory, {
        probeClient: probeClient as never,
        discovery: discovery as never
      })
      await catalog.initialize()
      expect(probeClient.probe).toHaveBeenCalledWith(join(directory, "New.vst3"))
      expect(catalog.list().plugins).toEqual([
        { ...descriptor, source: { kind: "builtin", id: "live.minori.heron.new" } }
      ])
    })
  })

  it("replaces stale cached built-ins with unavailable entries when inventory is malformed", async () => {
    await suite({ ...manifest(), schemaVersion: 2 }, async (directory) => {
      const probeClient = { probe: vi.fn() }
      const discovery = {
        loadCachedCatalog: vi.fn().mockResolvedValue({
          scannerVersion: 4,
          scanning: false,
          scannedAt: 1,
          plugins: [gain("/old/Gain.vst3")]
        })
      }
      const catalog = new PluginCatalogService("unused", "probe", directory, {
        probeClient: probeClient as never,
        discovery: discovery as never
      })
      await catalog.initialize()
      expect(probeClient.probe).not.toHaveBeenCalled()
      expect(catalog.list().plugins).toHaveLength(4)
      expect(catalog.list().plugins).toContainEqual(
        expect.objectContaining({
          source: { kind: "builtin", id: "live.minori.heron.eq" },
          locator: expect.objectContaining({ nativeId: "8A8341D5CA36B6C9A9572788F40EBB9F" }),
          kind: "effect"
        })
      )
      expect(
        catalog
          .list()
          .plugins.every(
            (plugin) =>
              plugin.compatibility === "load-error" && plugin.supportedAudioModes.length === 0
          )
      ).toBe(true)
    })
  })

  it("marks a saved built-in unavailable after it leaves the installed inventory", async () => {
    const source = manifest()
    source.plugins = source.plugins.filter((entry) => entry.builtinId !== "live.minori.heron.gain")
    await suite(source, async (directory) => {
      const catalog = new PluginCatalogService("unused", "probe", directory, {
        probeClient: { probe: vi.fn().mockResolvedValue([]) } as never,
        discovery: { loadCachedCatalog: vi.fn().mockResolvedValue(null) } as never
      })
      await catalog.initialize()
      const snapshot = gain("/old/Gain.vst3")
      const resolved = await catalog.resolveDescriptorForRuntime(snapshot)
      expect(resolved).toMatchObject({
        source: snapshot.source,
        compatibility: "load-error",
        supportedAudioModes: []
      })
      expect(snapshot.compatibility).toBe("compatible")
    })
  })

  it("rejects paths escaping resources and changes to saved plug-in identities", () => {
    const escaping = manifest()
    escaping.plugins[0]!.bundleName = "../Gain.vst3"
    expect(() => parseBuiltinPluginManifest(escaping)).toThrow()
    const changed = manifest()
    changed.plugins[0]!.nativeId = "C".repeat(32)
    expect(() => parseBuiltinPluginManifest(changed)).toThrow()
  })
})
