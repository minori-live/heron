import type {
  ApplicationCommandId,
  MidiControlBinding,
  MidiControlEvent,
  MidiControlPreferences,
  MidiControlTarget,
  PluginParameterInfo,
  ProjectGraphSnapshot
} from "@heron/contracts"
import {
  decodeRelativeMidiValue,
  evaluateAbsoluteMidiTransform,
  evaluateRelativeMidiTransform,
  isContinuousMidiControlTarget,
  midiControlAddressKey,
  midiTransformProfile
} from "@heron/contracts"
import { midiControlChannels } from "@heron/project-model"

export type MidiMixerControlParameter = "gainDb" | "pan" | "muted" | "soloed"

export interface MidiControlServiceOperations {
  graph(): ProjectGraphSnapshot | null
  learning(): boolean
  dispatchApplicationCommand(command: ApplicationCommandId): void
  applyMixerControl(
    channelId: string,
    parameter: MidiMixerControlParameter,
    value: number | boolean
  ): void | Promise<void>
  pluginParameters(instanceId: string): Promise<PluginParameterInfo[]>
  applyPluginParameter(
    instanceId: string,
    parameter: PluginParameterInfo,
    value: number
  ): void | Promise<void>
  markDirty(): void | Promise<void>
}

/** Main-process, best-effort MIDI fan-out. Target failures never stop sibling bindings. */
export class MidiControlService {
  private preferences: MidiControlPreferences = { bindings: [], transformProfiles: [] }
  private bindingsByAddress = new Map<string, MidiControlBinding[]>()
  private readonly activeDiscreteControls = new Set<string>()
  private readonly effectiveBooleans = new Map<string, boolean>()
  private readonly effectiveContinuous = new Map<string, number>()
  private readonly lastEventTimestamp = new Map<string, number>()
  private readonly pendingContinuous = new Map<
    string,
    { binding: MidiControlBinding; event: MidiControlEvent }
  >()
  private continuousFlushScheduled = false

  constructor(private readonly operations: MidiControlServiceOperations) {}

  configure(preferences: MidiControlPreferences): void {
    this.preferences = structuredClone(preferences)
    const index = new Map<string, MidiControlBinding[]>()
    for (const binding of preferences.bindings) {
      const key = midiControlAddressKey(binding.address)
      const group = index.get(key) ?? []
      group.push(structuredClone(binding))
      index.set(key, group)
    }
    this.bindingsByAddress = index
    this.activeDiscreteControls.clear()
  }

  receive(event: MidiControlEvent): void {
    if (this.operations.learning()) return
    const bindings = this.bindingsByAddress.get(
      midiControlAddressKey({
        portId: event.portId,
        portName: event.portName,
        channel: event.channel,
        type: event.type,
        number: event.number
      })
    )
    if (!bindings) return
    for (const binding of bindings) {
      if (isContinuousMidiControlTarget(binding.target)) {
        this.pendingContinuous.set(binding.id, { binding, event })
        this.scheduleContinuousFlush()
      } else {
        void this.applyDiscrete(binding, event).catch(() => {})
      }
    }
  }

  private scheduleContinuousFlush(): void {
    if (this.continuousFlushScheduled) return
    this.continuousFlushScheduled = true
    setImmediate(() => {
      this.continuousFlushScheduled = false
      const work = [...this.pendingContinuous.values()]
      this.pendingContinuous.clear()
      for (const item of work) void this.applyContinuous(item.binding, item.event).catch(() => {})
    })
  }

  private async applyDiscrete(binding: MidiControlBinding, event: MidiControlEvent): Promise<void> {
    if (event.type === "control-change" && binding.input.type === "absolute") {
      if (isAbsoluteBoolean(binding.target)) {
        await this.applyBoolean(binding.target, event.value !== 0)
        return
      }
      const activeKey = `${binding.id}:active`
      if (event.value < 64) {
        this.activeDiscreteControls.delete(activeKey)
        return
      }
      if (this.activeDiscreteControls.has(activeKey)) return
      this.activeDiscreteControls.add(activeKey)
    }
    if (binding.target.type === "application-command") {
      this.operations.dispatchApplicationCommand(binding.target.command)
      return
    }
    if (isBooleanTarget(binding.target)) {
      await this.applyBoolean(binding.target, !this.booleanValue(binding.target))
    }
  }

  private async applyBoolean(target: BooleanTarget, value: boolean): Promise<void> {
    const channel = this.resolveMixerChannel(target.channelIndex)
    if (!channel) return
    const parameter = target.parameter === "mute" ? "muted" : "soloed"
    this.effectiveBooleans.set(`${channel.id}:${parameter}`, value)
    await this.operations.applyMixerControl(channel.id, parameter, value)
    await this.operations.markDirty()
  }

  private booleanValue(target: BooleanTarget): boolean {
    const channel = this.resolveMixerChannel(target.channelIndex)
    if (!channel) return false
    const parameter = target.parameter === "mute" ? "muted" : "soloed"
    return this.effectiveBooleans.get(`${channel.id}:${parameter}`) ?? channel[parameter]
  }

  private async applyContinuous(
    binding: MidiControlBinding,
    event: MidiControlEvent
  ): Promise<void> {
    const profile = binding.transformProfileId
      ? midiTransformProfile(this.preferences, binding.transformProfileId)
      : undefined
    if (!profile) return
    const current = await this.currentNormalized(binding.target)
    if (current === null) return
    let normalized: number
    if (binding.input.type === "relative") {
      if (profile.type !== "relative") return
      const delta = decodeRelativeMidiValue(event.value, binding.input.encoding)
      if (delta === 0) return
      const previous = this.lastEventTimestamp.get(binding.id)
      this.lastEventTimestamp.set(binding.id, event.timestampMicroseconds)
      const elapsed = previous === undefined ? 0 : event.timestampMicroseconds - previous
      normalized = clamp01(
        current +
          evaluateRelativeMidiTransform(profile, delta, elapsed > 0 ? 1_000_000 / elapsed : 0)
      )
    } else {
      if (profile.type !== "absolute") return
      normalized = evaluateAbsoluteMidiTransform(profile, event.value / 127)
    }
    await this.applyNormalized(binding.target, normalized)
    this.effectiveContinuous.set(targetKey(binding.target), normalized)
    await this.operations.markDirty()
  }

  private async currentNormalized(target: MidiControlTarget): Promise<number | null> {
    const cached = this.effectiveContinuous.get(targetKey(target))
    if (cached !== undefined) return cached
    if (target.type === "mixer") {
      const channel = this.resolveMixerChannel(target.channelIndex)
      if (!channel) return null
      if (target.parameter === "gain") return clamp01((channel.gainDb + 90) / 102)
      if (target.parameter === "pan") return clamp01((channel.pan + 1) / 2)
      return null
    }
    if (target.type !== "plugin-parameter") return null
    const resolved = await this.resolvePluginParameter(target)
    if (!resolved) return null
    const width = resolved.parameter.maxValue - resolved.parameter.minValue
    return width > 0 ? clamp01((resolved.parameter.value - resolved.parameter.minValue) / width) : 0
  }

  private async applyNormalized(target: MidiControlTarget, normalized: number): Promise<void> {
    if (target.type === "mixer") {
      const channel = this.resolveMixerChannel(target.channelIndex)
      if (!channel) return
      if (target.parameter === "gain") {
        await this.operations.applyMixerControl(channel.id, "gainDb", -90 + normalized * 102)
      } else if (target.parameter === "pan") {
        await this.operations.applyMixerControl(channel.id, "pan", normalized * 2 - 1)
      }
      return
    }
    if (target.type !== "plugin-parameter") return
    const resolved = await this.resolvePluginParameter(target)
    if (!resolved) return
    const value =
      resolved.parameter.minValue +
      normalized * (resolved.parameter.maxValue - resolved.parameter.minValue)
    await this.operations.applyPluginParameter(resolved.instanceId, resolved.parameter, value)
  }

  private resolveMixerChannel(index: number) {
    const graph = this.operations.graph()
    return graph ? midiControlChannels(graph.channels)[index] : undefined
  }

  private async resolvePluginParameter(
    target: Extract<MidiControlTarget, { type: "plugin-parameter" }>
  ): Promise<{ instanceId: string; parameter: PluginParameterInfo } | null> {
    const plugin = this.operations
      .graph()
      ?.plugins.find((candidate) => candidate.controlAlias === target.controlAlias)
    if (!plugin) return null
    const parameter = (await this.operations.pluginParameters(plugin.id)).find(
      (candidate) =>
        candidate.parameterKey === target.parameterKey &&
        !candidate.hidden &&
        !candidate.readOnly &&
        candidate.automatable !== false
    )
    return parameter ? { instanceId: plugin.id, parameter } : null
  }
}

type BooleanTarget = Extract<MidiControlTarget, { type: "mixer" }> & {
  parameter: "mute" | "solo"
}

function isBooleanTarget(target: MidiControlTarget): target is BooleanTarget {
  return target.type === "mixer" && (target.parameter === "mute" || target.parameter === "solo")
}

function isAbsoluteBoolean(target: MidiControlTarget): target is BooleanTarget {
  return isBooleanTarget(target) && target.behavior === "absolute"
}

function targetKey(target: MidiControlTarget): string {
  if (target.type === "application-command") return `command:${target.command}`
  if (target.type === "plugin-parameter")
    return `plugin:${target.controlAlias}:${target.parameterKey}`
  return `mixer:${target.channelIndex}:${target.parameter}`
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
