import { randomUUID } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import { IPC_PROTOCOL_VERSION, pluginLocator } from "@heron/contracts"
import type {
  LiveDocumentConfiguration,
  LivePerformanceCommand,
  LiveRuntimeSnapshot,
  PluginParameterInfo,
  PluginStateEnvelope,
  ProjectGraphRef,
  RpcError,
  RpcRequestMeta
} from "@heron/contracts"
import { applyLivePerformanceCommand, validateMixerGraph } from "@heron/project-model"
import {
  AudioHostRequestError,
  type AudioHostService,
  type PreparedGraphDeployment
} from "../audio-host"
import type { PluginCatalogService } from "../plugins"
import { AudioGraphCompiler } from "./audio-graph-compiler"
import { LiveRuntimeFailure, type LiveRuntimePort } from "./live-performance-controller"

interface Candidate {
  generation: number
  snapshot: LiveRuntimeSnapshot
  ids: Map<string, string>
  initialParameters: Map<string, PluginParameterInfo[]>
  initialStates: Map<string, { native: PluginStateEnvelope; document: PluginStateEnvelope }>
  deployment: PreparedGraphDeployment | null
  state: "preparing" | "prepared" | "active" | "aborted" | "unknown"
}

export interface LiveAudioRuntimeOptions {
  audioHost: AudioHostService
  plugins: Pick<PluginCatalogService, "resolveDescriptorForRuntime">
  projectGraph: ProjectGraphRef
}

/** Owns one Live document's native instances. Document IDs never become native instance IDs. */
export class LiveAudioRuntime implements LiveRuntimePort {
  private readonly compiler = new AudioGraphCompiler()
  private active: Candidate | null = null
  private candidate: Candidate | null = null
  private configuration: LiveDocumentConfiguration | null = null
  private lastSnapshot: LiveRuntimeSnapshot | null = null
  private readonly ownedIds = new Set<string>()
  private pendingDeployment: PreparedGraphDeployment | null = null

  constructor(private readonly options: LiveAudioRuntimeOptions) {}

  get runtimePluginIds(): Record<string, string> {
    return this.active?.state === "active" ? Object.fromEntries(this.active.ids) : {}
  }

  async synchronizeEditState(snapshot: LiveRuntimeSnapshot): Promise<LiveRuntimeSnapshot> {
    // Edit currently has no native audition or plug-in editor. Its baseline is authoritative.
    return structuredClone(snapshot)
  }

  async prepare(
    configuration: LiveDocumentConfiguration,
    snapshot: LiveRuntimeSnapshot,
    generation: number
  ): Promise<Candidate> {
    if (this.candidate) throw this.failure("busy")
    const candidate: Candidate = {
      generation,
      snapshot: structuredClone(snapshot),
      ids: new Map(),
      initialParameters: new Map(),
      initialStates: new Map(),
      deployment: null,
      state: "preparing"
    }
    this.candidate = candidate
    try {
      validateMixerGraph(snapshot.graph)
      this.lastSnapshot = structuredClone(snapshot)
      await this.prepareDevices(configuration, snapshot)
      const project = structuredClone(snapshot.graph)
      for (const plugin of project.plugins) {
        const documentId = plugin.id
        const id = `live:${randomUUID()}`
        candidate.ids.set(documentId, id)
        this.ownedIds.add(id)
        const descriptor = await this.options.plugins.resolveDescriptorForRuntime(plugin.descriptor)
        plugin.id = id
        plugin.descriptor = descriptor
        plugin.locator = pluginLocator(descriptor)
        await this.options.audioHost.loadPlugin(plugin, project.sampleRate)
        const parameters = await this.options.audioHost.pluginParameters(id)
        for (const override of snapshot.parameterValues.filter(
          (value) => value.pluginId === documentId
        )) {
          this.parameter(parameters, override.parameterKey, override.value)
          await this.options.audioHost.setPluginParameter({
            instanceId: id,
            parameterKey: override.parameterKey,
            value: override.value,
            gesture: "perform"
          })
        }
        // Saving a fresh candidate flushes its queued parameter values before the baseline read.
        // Keep this mapping fixed for the generation; Capture changes the document baseline only.
        candidate.initialStates.set(documentId, {
          native: await this.options.audioHost.savePluginState(id),
          document: structuredClone(plugin.state)
        })
        candidate.initialParameters.set(
          documentId,
          await this.options.audioHost.pluginParameters(id)
        )
      }
      const runtime = this.compiler.compile(project, new Map(), {
        softwareMonitoringEnabled: true,
        latencyPolicy: { type: "normal" }
      })
      candidate.deployment = await this.prepareDeployment(project, runtime)
      candidate.state = "prepared"
      return candidate
    } catch (error) {
      const failure = this.wrap(error)
      if (failure.error.outcome === "unknown" || failure.error.outcome === "quarantined") {
        candidate.state = "unknown"
      } else {
        try {
          await this.abort(candidate)
          if (!this.active) await this.options.audioHost.stopAudioEngine()
        } catch {
          candidate.state = "unknown"
          throw this.unknown()
        }
      }
      throw failure
    }
  }

  async activate(value: unknown, isCurrent: () => boolean): Promise<void> {
    const candidate = this.requireCandidate(value)
    if (candidate.state !== "prepared" || !candidate.deployment) throw this.failure("stale")
    let dispatched = false
    let committed = false
    try {
      const result = await this.options.audioHost.activateGraphDeployment(candidate.deployment, {
        cut: true,
        isCurrent: () => {
          if (!isCurrent()) return false
          dispatched = true
          return true
        }
      })
      if (!result.ok) throw new LiveRuntimeFailure(result.error)
      committed = true
      candidate.state = "active"
      this.pendingDeployment = null
      this.active = candidate
      this.candidate = null
      this.lastSnapshot = structuredClone(candidate.snapshot)
      // The host closes removed editors and retires processors after their final graph lease.
      const currentIds = new Set(candidate.ids.values())
      for (const id of this.ownedIds) {
        if (currentIds.has(id)) continue
        try {
          await this.options.audioHost.unloadPlugin(id)
        } catch {
          throw this.unknown()
        }
        this.ownedIds.delete(id)
      }
    } catch (error) {
      const failure = committed ? this.unknown() : this.wrap(error, dispatched)
      if (failure.error.outcome === "unknown" || failure.error.outcome === "quarantined")
        candidate.state = "unknown"
      throw failure
    }
  }

  async abort(value: unknown): Promise<void> {
    if (!value || typeof value !== "object") return
    const candidate = value as Candidate
    if (
      candidate.state === "active" ||
      candidate.state === "aborted" ||
      candidate.state === "unknown"
    )
      return
    if (candidate !== this.candidate) throw this.failure("stale")
    const deployment = candidate.deployment ?? this.pendingDeployment
    if (deployment) {
      const result = await this.options.audioHost.abortGraphDeployment(deployment)
      if (!result.ok && result.error.code !== "stale-resource")
        throw new LiveRuntimeFailure(result.error)
    }
    for (const id of candidate.ids.values()) {
      await this.options.audioHost.unloadPlugin(id)
      this.ownedIds.delete(id)
    }
    candidate.state = "aborted"
    this.pendingDeployment = null
    this.candidate = null
  }

  async apply(command: LivePerformanceCommand, generation: number): Promise<void> {
    const active = this.requireActive(generation)
    const next = applyLivePerformanceCommand(active.snapshot, command)
    let dispatched = false
    try {
      if (command.type === "plugin-parameter") {
        const id = active.ids.get(command.id)
        if (!id) throw this.failure("stale")
        const parameters = await this.options.audioHost.pluginParameters(id)
        this.parameter(parameters, command.parameterKey, command.value)
        dispatched = true
        await this.options.audioHost.setPluginParameter({
          instanceId: id,
          parameterKey: command.parameterKey,
          value: command.value,
          gesture: "perform"
        })
      } else {
        const id = command.type === "plugin" ? active.ids.get(command.id) : command.id
        if (!id) throw this.failure("stale")
        // Acknowledged control delivery preserves the full dB range and reports queue failure.
        dispatched = true
        if (command.type === "channel")
          await this.options.audioHost.applyLiveMixerParameter({
            target: "channel",
            id,
            parameter: command.parameter,
            value: Number(command.value)
          })
        else if (command.type === "send")
          await this.options.audioHost.applyLiveMixerParameter({
            target: "send",
            id,
            parameter: command.parameter,
            value: Number(command.value)
          })
        else
          await this.options.audioHost.applyLiveMixerParameter({
            target: "plugin",
            id,
            parameter: "enabled",
            value: Number(command.value)
          })
      }
      active.snapshot = next
      this.lastSnapshot = structuredClone(next)
    } catch (error) {
      throw this.wrap(error, dispatched)
    }
  }

  async snapshot(generation: number): Promise<LiveRuntimeSnapshot> {
    const active = this.requireActive(generation)
    const snapshot = structuredClone(active.snapshot)
    try {
      for (const plugin of snapshot.graph.plugins) {
        const id = active.ids.get(plugin.id)
        if (!id) throw this.failure("stale")
        const state = await this.options.audioHost.savePluginState(id)
        const initialState = active.initialStates.get(plugin.id)
        plugin.state =
          initialState && isDeepStrictEqual(state, initialState.native)
            ? structuredClone(initialState.document)
            : state
        const parameters = await this.options.audioHost.pluginParameters(id)
        for (const parameter of parameters.filter((value) => !value.readOnly)) {
          const captured = snapshot.parameterValues.find(
            (value) => value.pluginId === plugin.id && value.parameterKey === parameter.parameterKey
          )
          const initial = active.initialParameters
            .get(plugin.id)
            ?.find((value) => value.parameterKey === parameter.parameterKey)
          if (captured) captured.value = parameter.value
          else if (initial && initial.value !== parameter.value)
            snapshot.parameterValues.push({
              pluginId: plugin.id,
              parameterKey: parameter.parameterKey,
              value: parameter.value
            })
        }
      }
      this.requireActive(generation)
      active.snapshot = structuredClone(snapshot)
      return snapshot
    } catch (error) {
      throw this.wrap(error)
    }
  }

  async leave(generation: number): Promise<void> {
    const active = this.requireActive(generation)
    try {
      await this.publishSilence(active.snapshot, true)
    } catch (error) {
      throw this.wrap(error, true)
    }
    await this.close()
  }

  /** Stop first, reconcile any candidate, then replace all native document state with silence. */
  async close(): Promise<void> {
    let stopped = false
    try {
      const audio = await this.options.audioHost.stopAudioEngine()
      if (audio.state !== "stopped") throw this.failure("unavailable")
      stopped = true
      const status = await this.options.audioHost.graphDeploymentSnapshot(this.meta())
      if (!status.ok) throw new LiveRuntimeFailure(status.error)
      if (status.value.snapshot.candidate) {
        const deployment = this.pendingDeployment ?? this.candidate?.deployment
        if (
          !deployment ||
          status.value.snapshot.candidate.operationId !== deployment.meta.mutation?.operationId
        )
          throw this.failure("busy")
        const aborted = await this.options.audioHost.abortGraphDeployment(deployment)
        if (!aborted.ok) throw new LiveRuntimeFailure(aborted.error)
      }
      if (this.lastSnapshot) await this.publishSilence(this.lastSnapshot)
      for (const id of this.ownedIds) await this.options.audioHost.unloadPlugin(id)
      this.ownedIds.clear()
      this.options.audioHost.forgetDocumentGraph()
      this.active = null
      this.candidate = null
      this.configuration = null
      this.pendingDeployment = null
      this.lastSnapshot = null
    } catch (error) {
      throw stopped ? this.unknown() : this.wrap(error, true)
    }
  }

  private async prepareDevices(
    configuration: LiveDocumentConfiguration,
    snapshot: LiveRuntimeSnapshot
  ): Promise<void> {
    if (!configuration.audio || configuration.sampleRate !== snapshot.graph.sampleRate)
      throw this.failure("validation", "audio")
    const enabled = new Set(configuration.enabledMidiDeviceIds)
    for (const channel of snapshot.graph.channels) {
      if (
        channel.kind === "instrument" &&
        channel.inputMonitoring &&
        (!channel.midiInput?.portId || !enabled.has(channel.midiInput.portId))
      )
        throw this.failure("validation", "midiInput")
    }
    const devices = await this.options.audioHost.listAudioDevices(configuration.audio.backend)
    const input = devices.inputs.find((device) => device.id === configuration.audio?.inputDeviceId)
    const output = devices.outputs.find(
      (device) => device.id === configuration.audio?.outputDeviceId
    )
    if (!input || !output) throw this.failure("unavailable")
    for (const channel of snapshot.graph.channels) {
      if (
        channel.inputSource === "hardware" &&
        channel.inputChannels.some(
          (channelNumber) => input.channelCount !== null && channelNumber > input.channelCount
        )
      )
        throw this.failure("validation", "inputChannels")
      if (
        channel.hardwareOutputChannels.some(
          (channelNumber) => output.channelCount !== null && channelNumber > output.channelCount
        )
      )
        throw this.failure("validation", "hardwareOutputChannels")
    }
    if (this.active) {
      if (!isDeepStrictEqual(this.configuration, configuration))
        throw this.failure("validation", "configuration")
      const audio = await this.options.audioHost.audioEngineSnapshot()
      if (audio.state !== "running" || audio.sampleRate !== configuration.sampleRate)
        throw this.failure("unavailable")
      return
    }
    await this.options.audioHost.stopAudioEngine()
    await this.publishSilence(snapshot)
    const audio = await this.options.audioHost.startAudioEngine(
      configuration.audio,
      configuration.sampleRate
    )
    if (audio.state !== "running" || audio.sampleRate !== configuration.sampleRate)
      throw this.failure("unavailable")
    this.configuration = structuredClone(configuration)
  }

  private async publishSilence(snapshot: LiveRuntimeSnapshot, cut = false): Promise<void> {
    const graph = structuredClone(snapshot.graph)
    graph.plugins = []
    graph.sends = []
    for (const channel of graph.channels) {
      channel.muted = true
      channel.inputMonitoring = false
      channel.applicationCapture = null
    }
    const runtime = this.compiler.compile(graph, new Map(), false)
    const deployment = await this.prepareDeployment(graph, runtime)
    const result = await this.options.audioHost.activateGraphDeployment(deployment, { cut })
    if (!result.ok) throw new LiveRuntimeFailure(result.error)
    this.pendingDeployment = null
  }

  private async prepareDeployment(
    project: LiveRuntimeSnapshot["graph"],
    runtime: ReturnType<AudioGraphCompiler["compile"]>
  ): Promise<PreparedGraphDeployment> {
    const meta = this.meta()
    const status = await this.options.audioHost.graphDeploymentSnapshot(meta)
    if (!status.ok) throw new LiveRuntimeFailure(status.error)
    const baseRevision = status.value.snapshot.committedRevision
    const epoch = this.options.audioHost.helperEpoch()
    if (!epoch) throw this.failure("unavailable")
    this.pendingDeployment = {
      meta: {
        ...meta,
        target: { kind: "audio-engine", id: "engine", epoch, generation: 1 },
        expectedRevision: baseRevision
      },
      projectGraph: this.options.projectGraph,
      baseRevision,
      graphRevision: baseRevision + 1,
      project,
      runtime
    }
    let result
    try {
      result = await this.options.audioHost.prepareGraphDeployment(
        meta,
        this.options.projectGraph,
        baseRevision + 1,
        project,
        runtime
      )
    } catch (error) {
      throw this.wrap(error, true)
    }
    if (!result.ok) throw new LiveRuntimeFailure(result.error)
    return result.value
  }

  private meta(): RpcRequestMeta {
    const operationId = randomUUID()
    return {
      protocolVersion: IPC_PROTOCOL_VERSION,
      requestId: randomUUID(),
      target: this.options.projectGraph,
      mutation: { operationId, idempotencyKey: operationId }
    }
  }

  private parameter(parameters: PluginParameterInfo[], key: string, value: number): void {
    const parameter = parameters.find((item) => item.parameterKey === key)
    if (
      !parameter ||
      parameter.readOnly ||
      !Number.isFinite(value) ||
      value < parameter.minValue ||
      value > parameter.maxValue
    )
      throw this.failure("validation", "parameter")
  }

  private requireCandidate(value: unknown): Candidate {
    if (!this.candidate || value !== this.candidate) throw this.failure("stale")
    return this.candidate
  }

  private requireActive(generation: number): Candidate {
    if (
      !this.active ||
      this.active.state !== "active" ||
      this.candidate?.state === "unknown" ||
      this.active.generation !== generation
    )
      throw this.failure("stale")
    return this.active
  }

  private failure(
    kind: "busy" | "stale" | "validation" | "unavailable",
    field?: string
  ): LiveRuntimeFailure {
    const common = { correlationId: randomUUID(), resource: this.options.projectGraph }
    let error: RpcError
    if (kind === "busy")
      error = {
        ...common,
        code: "resource-busy",
        category: "busy",
        outcome: "not-committed",
        retry: "safe",
        userMessageKey: "errors.resourceBusy",
        details: { type: "resource-busy" }
      }
    else if (kind === "validation")
      error = {
        ...common,
        code: "validation-failed",
        category: "validation",
        outcome: "not-committed",
        retry: "never",
        userMessageKey: "errors.invalidRpcRequest",
        details: { type: "validation-failed", field }
      }
    else if (kind === "stale")
      error = {
        ...common,
        code: "stale-resource",
        category: "stale-resource",
        outcome: "not-committed",
        retry: "after-reconcile",
        userMessageKey: "errors.staleResource",
        details: { type: "stale-resource", reason: "generation-mismatch" }
      }
    else
      error = {
        ...common,
        code: "resource-unavailable",
        category: "unavailable",
        outcome: "not-committed",
        retry: "safe",
        userMessageKey: "errors.audioEngineUnavailable",
        details: { type: "resource-unavailable", component: "audio-host", dispatched: false }
      }
    return new LiveRuntimeFailure(error)
  }

  private wrap(error: unknown, dispatched = false): LiveRuntimeFailure {
    if (error instanceof LiveRuntimeFailure) return error
    if (error instanceof AudioHostRequestError) return new LiveRuntimeFailure(error.rpcError)
    if (dispatched) return this.unknown()
    return this.failure("unavailable")
  }

  private unknown(): LiveRuntimeFailure {
    return new LiveRuntimeFailure({
      code: "operation-timeout-unknown",
      category: "timeout-unknown",
      outcome: "unknown",
      retry: "after-reconcile",
      correlationId: randomUUID(),
      resource: this.options.projectGraph,
      userMessageKey: "errors.operationOutcomeUnknown",
      details: { type: "operation-timeout-unknown", dispatched: true }
    })
  }
}
