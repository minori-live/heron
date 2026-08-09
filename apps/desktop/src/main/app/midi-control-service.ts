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
  ): boolean | void | Promise<boolean | void>
  pluginParameters(instanceId: string): Promise<PluginParameterInfo[]>
  applyPluginParameter(
    instanceId: string,
    parameter: PluginParameterInfo,
    value: number
  ): boolean | void | Promise<boolean | void>
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
  private continuousFlush: NodeJS.Immediate | null = null

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
    this.effectiveBooleans.clear()
    this.effectiveContinuous.clear()
    this.lastEventTimestamp.clear()
    this.pendingContinuous.clear()
    if (this.continuousFlush) clearImmediate(this.continuousFlush)
    this.continuousFlush = null
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
    if (this.continuousFlush) return
    this.continuousFlush = setImmediate(() => {
      this.continuousFlush = null
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
    const applied = await this.operations.applyMixerControl(channel.id, parameter, value)
    if (applied === false) return
    this.effectiveBooleans.set(`${channel.id}:${parameter}`, value)
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
    const applied = await this.applyNormalized(binding.target, normalized)
    if (!applied) return
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

  private async applyNormalized(target: MidiControlTarget, normalized: number): Promise<boolean> {
    if (target.type === "mixer") {
      const channel = this.resolveMixerChannel(target.channelIndex)
      if (!channel) return false
      let applied: boolean | void
      if (target.parameter === "gain") {
        applied = await this.operations.applyMixerControl(
          channel.id,
          "gainDb",
          -90 + normalized * 102
        )
      } else if (target.parameter === "pan") {
        applied = await this.operations.applyMixerControl(channel.id, "pan", normalized * 2 - 1)
      } else {
        return false
      }
      return applied !== false
    }
    if (target.type !== "plugin-parameter") return false
    const resolved = await this.resolvePluginParameter(target)
    if (!resolved) return false
    const value =
      resolved.parameter.minValue +
      normalized * (resolved.parameter.maxValue - resolved.parameter.minValue)
    return (
      (await this.operations.applyPluginParameter(
        resolved.instanceId,
        resolved.parameter,
        value
      )) !== false
    )
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
