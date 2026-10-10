import { join } from "node:path"
import {
  defaultPluginCategories,
  normalizePluginDescriptor,
  pluginLocator,
  pluginTypeKey,
  type PluginCatalogSnapshot,
  type PluginDescriptor,
  type PluginParameterChange,
  type PluginParameterInfo,
  type PluginRuntimeStatus,
  type PluginScanEvent,
  type PluginScanRequest
} from "@heron/contracts"
import { PluginDiscoveryService, PLUGIN_SCANNER_VERSION } from "./plugin-discovery-service"
import { PluginProbeClient } from "./plugin-probe-client"
import { PluginRuntimeService, type PluginRuntime } from "./plugin-runtime-service"
import { PluginScanner } from "./plugin-scanner"
import { loadBuiltinPluginInventory, type BuiltinPluginInventory } from "./builtin-plugin-manifest"

export { canReuseCachedBundle } from "./plugin-discovery-service"
export { descriptorFromProbe, descriptorsFromModuleInfo } from "./plugin-descriptor-normalizer"
export { parseProbeStdout } from "./plugin-descriptor-decoder"

type ScanListener = (event: PluginScanEvent) => void

export interface PluginCatalogDependencies {
  probeClient?: PluginProbeClient
  discovery?: PluginDiscoveryService
  builtinInventory?: (directory: string) => Promise<BuiltinPluginInventory>
}

export class PluginCatalogService {
  private catalog: PluginCatalogSnapshot = {
    scannerVersion: PLUGIN_SCANNER_VERSION,
    scanning: false,
    scannedAt: null,
    plugins: []
  }
  private readonly listeners = new Set<ScanListener>()
  private readonly scanner = new PluginScanner<PluginScanRequest, PluginCatalogSnapshot>()
  private readonly runtime = new PluginRuntimeService()
  private readonly runtimePluginProbes = new Map<string, Promise<PluginDescriptor[]>>()
  private readonly probeClient: PluginProbeClient
  private readonly discovery: PluginDiscoveryService
  private readonly builtinInventory: (directory: string) => Promise<BuiltinPluginInventory>

  constructor(
    userData: string,
    probePath: string,
    private readonly builtinDirectory: string,
    dependencies: PluginCatalogDependencies = {}
  ) {
    this.probeClient = dependencies.probeClient ?? new PluginProbeClient(probePath)
    this.discovery =
      dependencies.discovery ?? new PluginDiscoveryService(userData, this.probeClient)
    this.builtinInventory = dependencies.builtinInventory ?? loadBuiltinPluginInventory
  }

  attachRuntime(runtime: PluginRuntime): void {
    this.runtime.attach(runtime)
  }

  async initialize(): Promise<void> {
    this.catalog = (await this.discovery.loadCachedCatalog()) ?? this.catalog
    await this.refreshBuiltins()
  }

  private async refreshBuiltins(): Promise<void> {
    const external = this.catalog.plugins.filter((plugin) => plugin.source.kind === "external")
    const builtins: PluginDescriptor[] = []
    const inventory = await this.builtinInventory(this.builtinDirectory)
    for (const spec of inventory.plugins) {
      const modulePath = join(this.builtinDirectory, spec.bundleName)
      try {
        if (inventory.error) throw new Error(inventory.error)
        const descriptors = await this.probeClient.probe(modulePath)
        const descriptor = descriptors.find(
          (candidate) =>
            pluginLocator(candidate).format === "vst3" &&
            pluginLocator(candidate).nativeId === spec.classId
        )
        if (!descriptor) throw new Error(`Built-in Class ID changed; expected ${spec.classId}`)
        if (descriptor.kind !== spec.kind) throw new Error("Built-in plug-in kind changed")
        builtins.push({
          ...descriptor,
          source: { kind: "builtin", id: spec.id },
          vendor: descriptor.vendor === "Unknown vendor" ? "Heron Studio" : descriptor.vendor
        })
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Built-in VST3 probe failed"
        const inputBus = {
          portKey: "vst3:audio:input:0",
          direction: "input" as const,
          kind: "main" as const,
          name: "Stereo In",
          channels: 2,
          defaultActive: true
        }
        const outputBus = {
          portKey: "vst3:audio:output:0",
          direction: "output" as const,
          kind: "main" as const,
          name: "Stereo Out",
          channels: 2,
          defaultActive: true
        }
        builtins.push({
          source: { kind: "builtin", id: spec.id },
          locator: { format: "vst3", artifactPath: modulePath, nativeId: spec.classId },
          name: spec.name,
          vendor: "Heron Studio",
          version: "",
          categories: defaultPluginCategories(spec.kind),
          kind: spec.kind,
          architecture: process.arch,
          buses: spec.kind === "instrument" ? [outputBus] : [inputBus, outputBus],
          supportedAudioModes: [],
          hasEditor: true,
          compatibility: "load-error",
          compatibilityReason: reason
        })
      }
    }
    const builtinTypeKeys = new Set(builtins.map(pluginTypeKey))
    this.catalog = {
      ...this.catalog,
      plugins: [
        ...builtins,
        ...external.filter((plugin) => !builtinTypeKeys.has(pluginTypeKey(plugin)))
      ]
    }
  }

  resolveDescriptor(snapshot: PluginDescriptor): PluginDescriptor {
    const descriptor = this.catalog.plugins.find((candidate) => {
      const candidateLocator = pluginLocator(candidate)
      const snapshotLocator = pluginLocator(snapshot)
      if (snapshot.source.kind === "builtin") {
        return (
          candidate.source.kind === "builtin" &&
          candidate.source.id === snapshot.source.id &&
          pluginTypeKey(candidateLocator) === pluginTypeKey(snapshotLocator)
        )
      }
      return (
        candidate.source.kind === "external" &&
        candidateLocator.format === snapshotLocator.format &&
        candidateLocator.nativeId === snapshotLocator.nativeId &&
        candidateLocator.artifactPath === snapshotLocator.artifactPath
      )
    })
    if (!descriptor && snapshot.source.kind === "builtin") {
      return normalizePluginDescriptor({
        ...structuredClone(snapshot),
        supportedAudioModes: [],
        compatibility: "load-error",
        compatibilityReason: "Bundled plug-in is absent from the installed suite"
      })
    }
    return normalizePluginDescriptor(descriptor ? structuredClone(descriptor) : snapshot)
  }

  async resolveDescriptorForRuntime(snapshot: PluginDescriptor): Promise<PluginDescriptor> {
    const resolved = this.resolveDescriptor(snapshot)
    if (resolved.source.kind === "builtin") return resolved
    const locator = pluginLocator(resolved)
    const probeKey = JSON.stringify([locator.format, locator.artifactPath, locator.nativeId])
    let pending = this.runtimePluginProbes.get(probeKey)
    if (!pending) {
      pending = this.probeClient.probe(locator.artifactPath, "deep", locator.nativeId)
      this.runtimePluginProbes.set(probeKey, pending)
    }
    try {
      const descriptors = await pending
      const descriptor = descriptors.find((candidate) => {
        const candidateLocator = pluginLocator(candidate)
        return (
          candidateLocator.format === locator.format &&
          candidateLocator.artifactPath === locator.artifactPath &&
          candidateLocator.nativeId === locator.nativeId
        )
      })
      if (!descriptor) {
        this.runtimePluginProbes.delete(probeKey)
        return this.markRuntimeProbeUnavailable(
          resolved,
          "Deep probe did not return the requested plug-in class"
        )
      }
      this.catalog = {
        ...this.catalog,
        plugins: this.catalog.plugins.map((candidate) => {
          const candidateLocator = pluginLocator(candidate)
          return candidate.source.kind === "external" &&
            candidateLocator.format === locator.format &&
            candidateLocator.artifactPath === locator.artifactPath &&
            candidateLocator.nativeId === locator.nativeId
            ? descriptor
            : candidate
        })
      }
      return structuredClone(descriptor)
    } catch (error) {
      this.runtimePluginProbes.delete(probeKey)
      return this.markRuntimeProbeUnavailable(
        resolved,
        error instanceof Error ? error.message : "Deep plug-in capability probe failed"
      )
    }
  }

  private markRuntimeProbeUnavailable(
    descriptor: PluginDescriptor,
    reason: string
  ): PluginDescriptor {
    const unavailable: PluginDescriptor = {
      ...descriptor,
      supportedAudioModes: [],
      compatibility: "load-error",
      compatibilityReason: reason
    }
    const unavailableLocator = pluginLocator(unavailable)
    this.catalog = {
      ...this.catalog,
      plugins: this.catalog.plugins.map((candidate) => {
        const candidateLocator = pluginLocator(candidate)
        return candidate.source.kind === "external" &&
          candidateLocator.format === unavailableLocator.format &&
          candidateLocator.artifactPath === unavailableLocator.artifactPath &&
          candidateLocator.nativeId === unavailableLocator.nativeId
          ? unavailable
          : candidate
      })
    }
    return structuredClone(unavailable)
  }

  subscribe(listener: ScanListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private publish(event: PluginScanEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  list(): PluginCatalogSnapshot {
    return structuredClone(this.catalog)
  }

  scan(request: PluginScanRequest = {}): Promise<PluginCatalogSnapshot> {
    return this.scanner.run(request, async (value) => {
      this.catalog = { ...this.catalog, scanning: true }
      try {
        // Re-probe bundled artifacts too: a dev build may finish after startup.
        await this.refreshBuiltins()
        if (value.force || value.retryQuarantined) this.runtimePluginProbes.clear()
        this.catalog = await this.discovery.scan(this.catalog, value, (event) =>
          this.publish(event)
        )
        this.publish({ type: "completed", catalog: this.list() })
        return this.list()
      } catch (error) {
        this.catalog = { ...this.catalog, scanning: false }
        throw error
      }
    })
  }

  async openEditor(instanceId: string): Promise<PluginRuntimeStatus> {
    return this.runtime.openEditor(instanceId)
  }

  async closeEditor(instanceId: string): Promise<void> {
    await this.runtime.closeEditor(instanceId)
  }

  retry(instanceId: string): Promise<PluginRuntimeStatus> {
    return this.runtime.retry(instanceId)
  }

  parameters(instanceId: string): Promise<PluginParameterInfo[]> {
    return this.runtime.parameters(instanceId)
  }

  async setParameter(change: PluginParameterChange): Promise<void> {
    await this.runtime.setParameter(change)
  }
}
