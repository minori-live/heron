import { randomUUID } from "node:crypto"
import {
  DEFAULT_PLUGIN_ANALYSIS_SETTINGS,
  pluginDescriptorKey,
  pluginLocator,
  pluginSupportsHostedAudioMode,
  validPluginAnalysisSettings
} from "@heron/contracts"
import type {
  PluginAnalysisCommand,
  PluginAnalysisSnapshot,
  PluginAnalysisReport,
  PluginDescriptor,
  PluginInstanceState,
  PluginParameterInfo
} from "@heron/contracts"
import type { PluginAnalysisJobStatus } from "../audio-host/wire/generated/PluginAnalysisJobStatus"
import type { AudioHostService } from "../audio-host"

type Host = Pick<
  AudioHostService,
  | "loadPlugin"
  | "unloadPluginAnalysisPlugin"
  | "savePluginState"
  | "pluginParameters"
  | "setPluginParameter"
  | "openPluginEditor"
  | "closePluginEditor"
  | "pluginAnalysisRequest"
  | "subscribePluginAnalysisNotifications"
>

export class PluginAnalysisService {
  private readonly value: PluginAnalysisSnapshot
  private timer: NodeJS.Timeout | null = null
  private run: Promise<void> | null = null
  private activeId: string | null = null
  private wanted = false
  private immediatePending = false
  private closing = false
  private mutation: Promise<void> = Promise.resolve()
  private readonly receipts = new Map<
    string,
    { signature: string; key: string; result: Promise<PluginAnalysisSnapshot>; settled: boolean }
  >()
  private readonly unsubscribe: () => void
  private readonly parameterFingerprints = new Map<string, string>()
  private readonly parameterTimer: NodeJS.Timeout
  private checkingParameters = false
  private readonly owned = new Set<string>()
  private quarantined = false
  private cancellation = 0

  constructor(
    private readonly host: Host,
    private readonly catalog: () => PluginDescriptor[],
    appearance: Pick<PluginAnalysisSnapshot, "locale" | "theme">,
    private readonly memoryBytes: () => number = () => process.memoryUsage().rss,
    private readonly resolveDescriptor: (
      descriptor: PluginDescriptor
    ) => Promise<PluginDescriptor> = async (descriptor) => descriptor,
    private readonly refreshCatalog: () => Promise<unknown> = async () => {}
  ) {
    this.value = {
      ref: { kind: "plugin-analysis", id: randomUUID(), epoch: randomUUID(), generation: 1 },
      revision: 0,
      plugins: [],
      runtime: {},
      catalog: [],
      settings: { ...DEFAULT_PLUGIN_ANALYSIS_SETTINGS },
      automatic: true,
      comparisonEnabled: false,
      repeating: false,
      status: "idle",
      phase: "",
      progress: 0,
      report: null,
      comparisonReport: null,
      differenceReport: null,
      reportId: null,
      reportRevision: null,
      memory: null,
      failure: null,
      ...appearance
    }
    this.unsubscribe = host.subscribePluginAnalysisNotifications((event) => {
      if (!this.value.plugins.some((p) => p.id === event.instanceId) || this.closing) return
      if (
        (event.kind === "dirty-changed" && event.value === "true") ||
        event.kind === "parameter-output" ||
        event.kind === "clap-reconfigure-requested"
      )
        this.changed()
    })
    this.parameterTimer = setInterval(() => void this.checkParameters(), 300)
    this.parameterTimer.unref()
  }

  get ref(): PluginAnalysisSnapshot["ref"] {
    return this.value.ref
  }

  snapshot(knownReportId?: string): PluginAnalysisSnapshot {
    return structuredClone({
      ...this.value,
      // Omit the report body while the caller already holds this run's report so
      // frequent polling does not deep-clone and transfer the full measurement.
      report:
        knownReportId !== undefined && knownReportId === this.value.reportId
          ? null
          : this.value.report,
      comparisonReport: knownReportId === this.value.reportId ? null : this.value.comparisonReport,
      differenceReport: knownReportId === this.value.reportId ? null : this.value.differenceReport,
      catalog: this.catalog().filter((p) => p.kind === "effect")
    })
  }

  acknowledge(id: string): void {
    if (this.receipts.get(id)?.settled) this.receipts.delete(id)
  }

  get receiptCapacityAvailable(): boolean {
    return this.receipts.size < 128
  }

  command(
    command: PluginAnalysisCommand,
    operationId: string,
    key = operationId
  ): Promise<PluginAnalysisSnapshot> {
    const signature = JSON.stringify(command)
    const receipt = this.receipts.get(operationId)
    if (receipt)
      return receipt.signature === signature ? receipt.result : Promise.resolve(this.snapshot())
    const result = this.mutation.then(async () => {
      if (this.closing || this.quarantined) return this.snapshot()
      await this.apply(command)
      return this.snapshot()
    })
    this.mutation = result.then(
      () => {},
      () => {}
    )
    const retained = { signature, key, result, settled: false }
    this.receipts.set(operationId, retained)
    void result.then(
      () => {
        retained.settled = true
      },
      () => {
        retained.settled = true
      }
    )
    return result
  }

  hasReceipt(operationId: string, command: PluginAnalysisCommand, key = operationId): boolean {
    const receipt = this.receipts.get(operationId)
    return receipt?.signature === JSON.stringify(command) && receipt.key === key
  }

  hasOperation(operationId: string): boolean {
    return this.receipts.has(operationId)
  }
  hasIdempotencyKey(key: string): boolean {
    return [...this.receipts.values()].some((receipt) => receipt.key === key)
  }

  private async apply(command: PluginAnalysisCommand): Promise<void> {
    switch (command.type) {
      case "insert": {
        let descriptor = this.catalog().find((p) => pluginDescriptorKey(p) === command.pluginKey)
        if (
          !descriptor ||
          descriptor.kind !== "effect" ||
          descriptor.compatibility !== "compatible" ||
          this.value.plugins.filter((p) => p.channelId === this.chainId(command.chain ?? 0))
            .length >= 16 ||
          !pluginSupportsHostedAudioMode(descriptor, command.audioMode)
        )
          return
        try {
          descriptor = await this.resolveDescriptor(descriptor)
        } catch {
          this.value.failure = "prepare-failed"
          this.value.status = "failed"
          return
        }
        if (this.closing) return
        if (
          descriptor.compatibility !== "compatible" ||
          !pluginSupportsHostedAudioMode(descriptor, command.audioMode)
        ) {
          this.value.failure = "prepare-failed"
          this.value.status = "failed"
          return
        }
        const audioMode = command.audioMode
        const id = `plugin-analysis-lab-${randomUUID()}`
        const plugin: PluginInstanceState = {
          id,
          channelId: this.chainId(command.chain ?? 0),
          role: "insert",
          slotOrder: command.slotOrder,
          locator: pluginLocator(descriptor),
          descriptor,
          audioMode,
          enabled: true,
          controlAlias: null,
          sidechainInputs: [],
          state: { version: 1, chunks: [] }
        }
        this.owned.add(id)
        try {
          const timing = await this.host.loadPlugin(plugin, this.value.settings.sample_rate)
          this.parameterFingerprints.set(id, this.fingerprint(await this.host.pluginParameters(id)))
          this.insertAt(plugin, command.slotOrder)
          this.value.runtime[id] = {
            instanceId: id,
            state: "active",
            editorOpen: false,
            error: null,
            ...timing
          }
          this.reorder()
          // A successful insert supersedes an earlier rejected/prepare failure.
          this.value.failure = null
          this.changed("chain")
        } catch {
          this.value.failure = "prepare-failed"
          await this.releaseInstance(id)
          if (!this.quarantined) this.value.status = "failed"
        }
        break
      }
      case "remove": {
        const index = this.value.plugins.findIndex((p) => p.id === command.instanceId)
        if (index < 0) return
        if (!(await this.releaseInstance(command.instanceId))) return
        this.value.plugins.splice(index, 1)
        delete this.value.runtime[command.instanceId]
        this.parameterFingerprints.delete(command.instanceId)
        this.reorder()
        // Removing the effect resolves a reported prepare failure.
        if (this.value.failure === "prepare-failed") this.value.failure = null
        this.changed("chain")
        break
      }
      case "move": {
        const index = this.value.plugins.findIndex((p) => p.id === command.instanceId)
        if (index < 0) return
        const [plugin] = this.value.plugins.splice(index, 1)
        if (plugin) this.insertAt(plugin, command.slotOrder)
        this.reorder()
        this.changed("chain")
        break
      }
      case "toggle": {
        const plugin = this.value.plugins.find((p) => p.id === command.instanceId)
        if (plugin) {
          plugin.enabled = command.enabled
          this.changed("chain")
        }
        break
      }
      case "editor": {
        const plugin = this.value.plugins.find((p) => p.id === command.instanceId)
        if (!plugin) return
        try {
          const result = await this.host.openPluginEditor(
            plugin.id,
            { mode: plugin.descriptor.hasEditor ? "native" : "parameters", zoomPercent: 100 },
            {
              channelName: "Plugin Analysis",
              channelColor: "#58cdb6",
              pluginName: plugin.descriptor.name,
              appearance: { locale: this.value.locale, theme: this.value.theme }
            }
          )
          Object.assign(this.value.runtime[plugin.id]!, {
            editorOpen: result.open,
            editorMode: result.editorMode
          })
          // A successful editor open resolves a reported prepare failure.
          if (this.value.failure === "prepare-failed") this.value.failure = null
        } catch {
          this.value.failure = "prepare-failed"
        }
        break
      }
      case "configure":
        if (validPluginAnalysisSettings(command.settings)) {
          this.value.settings = { ...command.settings }
          this.changed()
        }
        break
      case "comparison":
        this.value.comparisonEnabled = command.enabled
        this.changed("chain")
        break
      case "repeat":
        this.value.repeating = command.enabled
        if (command.enabled) this.schedule(0)
        break
      case "automatic":
        this.value.automatic = command.enabled
        if (command.enabled) {
          this.immediatePending = true
          this.schedule(0)
        } else {
          this.wanted = false
          this.immediatePending = false
          if (this.timer) clearTimeout(this.timer)
          this.timer = null
          if (!this.run) this.value.status = this.value.report ? "complete" : "idle"
        }
        break
      case "analyze":
        this.immediatePending = true
        this.schedule(0)
        break
      case "refresh-catalog":
        try {
          await this.refreshCatalog()
          if (this.value.failure === "catalog-unavailable") this.value.failure = null
        } catch {
          this.value.failure = "catalog-unavailable"
        }
        break
      case "cancel":
        this.value.repeating = false
        this.cancellation += 1
        this.wanted = false
        this.immediatePending = false
        if (this.timer) clearTimeout(this.timer)
        this.timer = null
        await this.cancelActive()
        if (!this.run) this.value.status = "cancelled"
        break
      case "window":
        break
    }
  }

  private fingerprint(parameters: PluginParameterInfo[]): string {
    return JSON.stringify(
      parameters.filter((p) => !p.readOnly).map((p) => [p.parameterKey, p.value])
    )
  }

  private async checkParameters(): Promise<void> {
    if (this.checkingParameters || this.closing || this.quarantined) return
    this.checkingParameters = true
    try {
      for (const plugin of [...this.value.plugins]) {
        const fingerprint = this.fingerprint(await this.host.pluginParameters(plugin.id))
        if (this.closing || this.quarantined) return
        const previous = this.parameterFingerprints.get(plugin.id)
        if (!this.value.plugins.some((p) => p.id === plugin.id)) continue
        this.parameterFingerprints.set(plugin.id, fingerprint)
        if (previous !== undefined && previous !== fingerprint) this.changed()
      }
    } catch {
      /* A concurrent removal may retire the queried instance. */
    } finally {
      this.checkingParameters = false
    }
  }

  private chainId(chain: 0 | 1): string {
    return chain === 0 ? this.value.ref.id : `${this.value.ref.id}:comparison`
  }

  private insertAt(plugin: PluginInstanceState, order: number): void {
    const siblings = this.value.plugins.filter((p) => p.channelId === plugin.channelId)
    const next = siblings[Math.min(order, siblings.length)]
    const index = next ? this.value.plugins.indexOf(next) : this.value.plugins.length
    this.value.plugins.splice(index, 0, plugin)
  }

  private reorder(): void {
    for (const chain of [0, 1] as const)
      this.value.plugins
        .filter((p) => p.channelId === this.chainId(chain))
        .forEach((p, i) => {
          p.slotOrder = i
        })
  }

  private changed(source: "chain" | "parameters" = "parameters"): void {
    this.value.revision += 1
    if (this.activeId) void this.cancelActive().catch(() => {})
    if (this.value.automatic) {
      if (source === "chain") this.immediatePending = true
      this.schedule()
    }
  }

  private schedule(delay = 600): void {
    if (this.closing || this.quarantined) return
    if (this.timer) clearTimeout(this.timer)
    this.wanted = false
    if (!this.run) this.value.status = "debouncing"
    this.timer = setTimeout(
      () => {
        this.timer = null
        this.wanted = true
        // Begin only after the current chain mutation has committed. Preserve an
        // immediate chain request while a cancelled job is still releasing its endpoints.
        void this.mutation.then(() => this.launch())
      },
      this.immediatePending ? 0 : delay
    )
  }

  private launch(): void {
    if (this.run || !this.wanted || this.closing || this.quarantined) return
    this.wanted = false
    this.immediatePending = false
    this.run = this.measure().finally(() => {
      this.run = null
      if (this.value.repeating && this.value.status === "complete" && !this.timer) this.schedule(0)
      void this.mutation.then(() => this.launch())
    })
  }

  private async cancelActive(): Promise<void> {
    if (this.activeId)
      await this.host.pluginAnalysisRequest({
        type: "cancel-plugin-analysis",
        operation_id: this.activeId
      })
  }

  private async measure(): Promise<void> {
    const revision = this.value.revision
    const cancellation = this.cancellation
    const modes: Array<"primary" | "comparison" | "difference"> = this.value.comparisonEnabled
      ? ["primary", "comparison", "difference"]
      : ["primary"]
    const results: Array<{
      report: PluginAnalysisReport
      memory: PluginAnalysisSnapshot["memory"]
    }> = []
    for (const mode of modes) {
      const result = await this.measureGroup(revision, cancellation, mode)
      if (
        !result ||
        revision !== this.value.revision ||
        cancellation !== this.cancellation ||
        this.closing ||
        this.quarantined
      )
        return
      results.push(result)
    }
    // All three reports belong to one revision; publish only after every job and clone retires.
    this.value.report = results[0]!.report
    this.value.comparisonReport = results[1]?.report ?? null
    this.value.differenceReport = results[2]?.report ?? null
    this.value.reportId = randomUUID()
    this.value.reportRevision = revision
    this.value.memory = results[0]!.memory
    this.value.status = "complete"
    this.value.progress = 1
    this.value.failure = null
  }

  private async measureGroup(
    revision: number,
    cancellation: number,
    mode: "primary" | "comparison" | "difference"
  ): Promise<{ report: PluginAnalysisReport; memory: PluginAnalysisSnapshot["memory"] } | null> {
    const settings = { ...this.value.settings }
    const plugins = structuredClone(
      this.value.plugins.filter(
        (p) =>
          p.enabled &&
          (mode === "difference" || p.channelId === this.chainId(mode === "primary" ? 0 : 1))
      )
    )
    const id = randomUUID()
    const instances: string[] = []
    const comparisonInstances: string[] = []
    let nativeStarted = false
    let memoryTimer: NodeJS.Timeout | null = null
    const baselineBytes = this.memoryBytes()
    let peakBytes = baselineBytes
    let loadedBytes = baselineBytes
    let terminal: PluginAnalysisJobStatus | null = null
    this.value.status = "running"
    this.value.phase = "preparing"
    this.value.progress = 0
    this.value.failure = null
    try {
      let latency = 0
      let comparisonLatency = 0
      for (const plugin of plugins) {
        if (
          this.closing ||
          this.quarantined ||
          revision !== this.value.revision ||
          cancellation !== this.cancellation
        )
          return null
        plugin.state = await this.host.savePluginState(plugin.id)
        const parameters = await this.host.pluginParameters(plugin.id)
        plugin.id = `plugin-analysis-measure-${randomUUID()}`
        if (mode === "difference" && plugin.channelId === this.chainId(1))
          comparisonInstances.push(plugin.id)
        else instances.push(plugin.id)
        this.owned.add(plugin.id)
        const timing = await this.host.loadPlugin(plugin, settings.sample_rate)
        if (mode === "difference" && plugin.channelId === this.chainId(1))
          comparisonLatency += timing.latencySamples
        else latency += timing.latencySamples
        // Controller edits can precede their next audio block; replay authoritative values.
        for (const parameter of parameters.filter((p) => !p.readOnly)) {
          await this.host.setPluginParameter({
            instanceId: plugin.id,
            parameterKey: parameter.parameterKey,
            value: parameter.value,
            gesture: "end"
          })
        }
      }
      if (
        this.closing ||
        this.quarantined ||
        revision !== this.value.revision ||
        cancellation !== this.cancellation
      )
        return null
      loadedBytes = this.memoryBytes()
      peakBytes = Math.max(peakBytes, loadedBytes)
      memoryTimer = setInterval(() => {
        peakBytes = Math.max(peakBytes, this.memoryBytes())
      }, 100)
      this.activeId = id
      nativeStarted = true
      const response = await this.host.pluginAnalysisRequest({
        type: "start-plugin-analysis",
        operation_id: id,
        instance_ids: instances,
        settings,
        comparison_instance_ids: mode === "difference" ? comparisonInstances : null,
        reported_latency_samples: Math.max(latency, comparisonLatency)
      })
      if (response.result.type !== "plugin-analysis" || !response.result.plugin_analysis_status) {
        this.quarantine()
        return null
      }
      let status = response.result.plugin_analysis_status
      nativeStarted = status.state === "running" || status.state === "completed"
      while (status.state === "running") {
        this.value.phase = status.phase
        this.value.progress = status.progress
        if (
          this.closing ||
          this.quarantined ||
          revision !== this.value.revision ||
          cancellation !== this.cancellation
        )
          await this.cancelActive()
        await new Promise((resolve) => setTimeout(resolve, 100))
        const response = await this.host.pluginAnalysisRequest({
          type: "plugin-analysis-status",
          operation_id: id
        })
        if (response.result.type !== "plugin-analysis" || !response.result.plugin_analysis_status) {
          this.quarantine()
          return null
        }
        status = response.result.plugin_analysis_status
      }
      terminal = status
    } catch {
      this.value.failure = "prepare-failed"
      if (!this.quarantined) this.value.status = "failed"
    } finally {
      if (memoryTimer) clearInterval(memoryTimer)
      // Never unload endpoints when the worker's terminal outcome is unknown.
      if (nativeStarted && !terminal) {
        await this.cancelActive().catch(() => {})
        this.quarantine()
      }
      this.activeId = null
      if (!this.quarantined) {
        if (nativeStarted) {
          try {
            await this.host.pluginAnalysisRequest({
              type: "release-plugin-analysis",
              operation_id: id
            })
          } catch {
            this.quarantine()
          }
        }
        if (!this.quarantined)
          for (const instanceId of [...instances, ...comparisonInstances])
            await this.releaseInstance(instanceId)
      }
      if (!this.quarantined && !this.closing && cancellation !== this.cancellation) {
        this.value.status = "cancelled"
      } else if (
        !this.quarantined &&
        !this.closing &&
        revision === this.value.revision &&
        terminal
      ) {
        if (terminal.state === "failed") {
          this.value.status = terminal.failure === "cancelled" ? "cancelled" : "failed"
          this.value.failure = terminal.failure
        }
      } else if (!this.quarantined && !this.closing && revision !== this.value.revision) {
        this.value.status = this.value.automatic ? "debouncing" : "idle"
      }
    }
    return !this.quarantined &&
      !this.closing &&
      revision === this.value.revision &&
      cancellation === this.cancellation &&
      terminal?.state === "completed"
      ? {
          report: terminal.report,
          memory: { baselineBytes, loadedBytes, peakBytes, releasedBytes: this.memoryBytes() }
        }
      : null
  }

  private quarantine(): void {
    this.quarantined = true
    this.wanted = false
    this.immediatePending = false
    this.value.status = "quarantined"
    this.value.failure = "cleanup-failed"
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.activeId) void this.cancelActive().catch(() => {})
  }

  private async releaseInstance(id: string): Promise<boolean> {
    try {
      await this.host.closePluginEditor(id)
      await this.host.unloadPluginAnalysisPlugin(id)
      this.owned.delete(id)
      return true
    } catch {
      this.quarantine()
      return false
    }
  }

  async close(): Promise<void> {
    this.closing = true
    this.wanted = false
    this.immediatePending = false
    if (this.timer) clearTimeout(this.timer)
    clearInterval(this.parameterTimer)
    this.unsubscribe()
    await this.mutation
    await this.cancelActive().catch(() => {})
    await this.run
    if (!this.quarantined) for (const id of [...this.owned]) await this.releaseInstance(id)
    this.receipts.clear()
  }
}
