import type {
  LiveCaptureField,
  LiveEditCommand,
  LiveMidiBinding,
  LivePluginParameterValue,
  LivePerformanceCommand,
  LiveRuntimeSnapshot,
  MixerGraphSnapshot,
  PluginInstanceState,
  PluginStateEnvelope
} from "@heron/contracts"
import { validateMixerGraph } from "./mixer-validation"

export interface LiveEditResult {
  graph: MixerGraphSnapshot
  bindings: LiveMidiBinding[]
}

function uniqueIds(values: readonly { id: string }[], label: string): void {
  if (new Set(values.map((value) => value.id)).size !== values.length) {
    throw new Error(`${label} IDs must be unique`)
  }
}

function requireIndex(values: readonly { id: string }[], id: string, label: string): number {
  const index = values.findIndex((value) => value.id === id)
  if (index < 0) throw new Error(`${label} '${id}' was not found`)
  return index
}

function insertPlugin(graph: MixerGraphSnapshot, plugin: PluginInstanceState): void {
  if (!Number.isSafeInteger(plugin.slotOrder) || plugin.slotOrder < 0) {
    throw new Error("Plugin slot order must be a non-negative safe integer")
  }
  const peers = graph.plugins
    .filter(
      (candidate) => candidate.channelId === plugin.channelId && candidate.role === plugin.role
    )
    .sort((left, right) => left.slotOrder - right.slotOrder)
  if (plugin.role === "instrument" && peers.length > 0) {
    throw new Error("Replace the assigned instrument instead of inserting into an occupied slot")
  }
  peers.splice(Math.min(plugin.slotOrder, peers.length), 0, plugin)
  peers.forEach((candidate, index) => {
    candidate.slotOrder = index
  })
  graph.plugins.push(plugin)
}

function removePlugin(graph: MixerGraphSnapshot, pluginId: string): PluginInstanceState {
  const plugin = graph.plugins.splice(requireIndex(graph.plugins, pluginId, "Plugin"), 1)[0]!
  graph.plugins
    .filter(
      (candidate) => candidate.channelId === plugin.channelId && candidate.role === plugin.role
    )
    .sort((left, right) => left.slotOrder - right.slotOrder)
    .forEach((candidate, index) => {
      candidate.slotOrder = index
    })
  return plugin
}

export function applyLiveEdit(current: LiveEditResult, command: LiveEditCommand): LiveEditResult {
  const next = structuredClone(current)
  switch (command.type) {
    case "create-channel":
      next.graph.channels.push(structuredClone(command.channel))
      break
    case "update-channel":
      Object.assign(
        next.graph.channels[requireIndex(next.graph.channels, command.channelId, "Channel")]!,
        structuredClone(command.patch)
      )
      break
    case "delete-channel": {
      const channel =
        next.graph.channels[requireIndex(next.graph.channels, command.channelId, "Channel")]!
      if (channel.kind === "master") throw new Error("Master cannot be deleted")
      if (
        channel.kind === "output" &&
        (next.graph.channels.some((candidate) => candidate.outputChannelId === channel.id) ||
          next.graph.sends.some((send) => send.targetChannelId === channel.id))
      ) {
        throw new Error("An Output must be unused before it can be deleted")
      }
      next.graph.channels = next.graph.channels.filter((candidate) => candidate.id !== channel.id)
      next.graph.sends = next.graph.sends.filter((send) => send.sourceChannelId !== channel.id)
      next.graph.plugins = next.graph.plugins.filter((plugin) => plugin.channelId !== channel.id)
      for (const plugin of next.graph.plugins) {
        plugin.sidechainInputs = plugin.sidechainInputs.filter(
          (route) => route.sourceChannelId !== channel.id
        )
      }
      break
    }
    case "create-send":
      next.graph.sends.push(structuredClone(command.send))
      break
    case "update-send":
      Object.assign(
        next.graph.sends[requireIndex(next.graph.sends, command.sendId, "Send")]!,
        structuredClone(command.patch)
      )
      break
    case "delete-send":
      next.graph.sends.splice(requireIndex(next.graph.sends, command.sendId, "Send"), 1)
      break
    case "create-plugin":
      next.graph.plugins.push(structuredClone(command.plugin))
      break
    case "insert-plugin":
      insertPlugin(next.graph, structuredClone(command.plugin))
      break
    case "update-plugin":
      Object.assign(
        next.graph.plugins[requireIndex(next.graph.plugins, command.pluginId, "Plugin")]!,
        structuredClone(command.patch)
      )
      break
    case "delete-plugin":
      removePlugin(next.graph, command.pluginId)
      break
    case "move-plugin": {
      const plugin = removePlugin(next.graph, command.pluginId)
      if (plugin.role !== "insert") throw new Error("Only insert effects can be moved")
      plugin.channelId = command.channelId
      plugin.slotOrder = command.slotOrder
      insertPlugin(next.graph, plugin)
      break
    }
    case "replace-plugin": {
      const index = requireIndex(next.graph.plugins, command.pluginId, "Plugin")
      const current = next.graph.plugins[index]!
      if (
        command.plugin.id !== current.id ||
        command.plugin.channelId !== current.channelId ||
        command.plugin.role !== current.role ||
        command.plugin.slotOrder !== current.slotOrder
      ) {
        throw new Error("Replacing a plugin must preserve its slot and stable identity")
      }
      next.graph.plugins[index] = structuredClone(command.plugin)
      break
    }
    case "set-midi-bindings":
      next.bindings = structuredClone(command.bindings)
      break
  }
  uniqueIds(next.bindings, "MIDI binding")
  validateMixerGraph(next.graph)
  return next
}

export function applyLivePerformanceCommand(
  current: LiveRuntimeSnapshot,
  command: LivePerformanceCommand
): LiveRuntimeSnapshot {
  const next = structuredClone(current)
  switch (command.type) {
    case "channel": {
      const channel = next.graph.channels[requireIndex(next.graph.channels, command.id, "Channel")]!
      if (command.parameter === "gainDb" || command.parameter === "pan") {
        if (typeof command.value !== "number") throw new TypeError("Expected numeric Mixer value")
        channel[command.parameter] = command.value
      } else {
        if (typeof command.value !== "boolean") throw new TypeError("Expected boolean Mixer value")
        channel[command.parameter] = command.value
      }
      break
    }
    case "send": {
      const send = next.graph.sends[requireIndex(next.graph.sends, command.id, "Send")]!
      if (command.parameter === "levelDb") {
        if (typeof command.value !== "number") throw new TypeError("Expected numeric Send value")
        send.levelDb = command.value
      } else {
        if (typeof command.value !== "boolean") throw new TypeError("Expected boolean Send value")
        send.enabled = command.value
      }
      break
    }
    case "plugin": {
      if (typeof command.value !== "boolean") throw new TypeError("Expected boolean plug-in value")
      next.graph.plugins[requireIndex(next.graph.plugins, command.id, "Plugin")]!.enabled =
        command.value
      break
    }
    case "plugin-parameter": {
      requireIndex(next.graph.plugins, command.id, "Plugin")
      if (!command.parameterKey || !Number.isFinite(command.value)) {
        throw new TypeError("Invalid plug-in parameter adjustment")
      }
      const entry = next.parameterValues.find(
        (value) => value.pluginId === command.id && value.parameterKey === command.parameterKey
      )
      if (entry) entry.value = command.value
      else
        next.parameterValues.push({
          pluginId: command.id,
          parameterKey: command.parameterKey,
          value: command.value
        })
      break
    }
  }
  validateMixerGraph(next.graph)
  parameterMap(next.parameterValues)
  return next
}

function sameState(left: PluginStateEnvelope, right: PluginStateEnvelope): boolean {
  if (left.version !== right.version || left.chunks.length !== right.chunks.length) return false
  const rightChunks = new Map(right.chunks.map((chunk) => [chunk.key, chunk.bytes]))
  return left.chunks.every((chunk) => {
    const bytes = rightChunks.get(chunk.key)
    return (
      bytes?.length === chunk.bytes.length &&
      chunk.bytes.every((value, index) => value === bytes[index])
    )
  })
}

export function captureFieldKey(field: LiveCaptureField): string {
  return JSON.stringify([
    field.type,
    field.id,
    "parameter" in field ? field.parameter : "parameterKey" in field ? field.parameterKey : null
  ])
}

function parameterMap(values: readonly LivePluginParameterValue[]): Map<string, number> {
  const result = new Map<string, number>()
  for (const value of values) {
    if (!Number.isFinite(value.value) || !value.pluginId || !value.parameterKey) {
      throw new Error("Invalid Live plug-in parameter value")
    }
    const key = `${value.pluginId}\u0000${value.parameterKey}`
    if (result.has(key)) throw new Error("Duplicate Live plug-in parameter value")
    result.set(key, value.value)
  }
  return result
}

export function diffLiveCapture(
  baseline: LiveRuntimeSnapshot,
  runtime: LiveRuntimeSnapshot
): LiveCaptureField[] {
  const result: LiveCaptureField[] = []
  const baseChannels = new Map(baseline.graph.channels.map((channel) => [channel.id, channel]))
  const baseSends = new Map(baseline.graph.sends.map((send) => [send.id, send]))
  const basePlugins = new Map(baseline.graph.plugins.map((plugin) => [plugin.id, plugin]))
  for (const channel of runtime.graph.channels) {
    const base = baseChannels.get(channel.id)
    if (!base) throw new Error("Perform channel structure changed")
    for (const parameter of ["gainDb", "pan", "muted", "soloed"] as const) {
      if (channel[parameter] !== base[parameter])
        result.push({ type: "channel", id: channel.id, parameter })
    }
  }
  for (const send of runtime.graph.sends) {
    const base = baseSends.get(send.id)
    if (!base) throw new Error("Perform send structure changed")
    for (const parameter of ["levelDb", "enabled"] as const) {
      if (send[parameter] !== base[parameter]) result.push({ type: "send", id: send.id, parameter })
    }
  }
  for (const plugin of runtime.graph.plugins) {
    const base = basePlugins.get(plugin.id)
    if (!base) throw new Error("Perform plug-in structure changed")
    if (plugin.enabled !== base.enabled)
      result.push({ type: "plugin", id: plugin.id, parameter: "enabled" })
    if (!sameState(plugin.state, base.state)) result.push({ type: "plugin-state", id: plugin.id })
  }
  if (
    baseChannels.size !== runtime.graph.channels.length ||
    baseSends.size !== runtime.graph.sends.length ||
    basePlugins.size !== runtime.graph.plugins.length
  ) {
    throw new Error("Perform Mixer structure changed")
  }
  const baseParameters = parameterMap(baseline.parameterValues)
  const liveParameters = parameterMap(runtime.parameterValues)
  for (const [key, value] of liveParameters) {
    if (value !== baseParameters.get(key)) {
      const [id, parameterKey] = key.split("\u0000") as [string, string]
      if (!basePlugins.has(id)) throw new Error("Perform parameter target is missing")
      result.push({ type: "plugin-parameter", id, parameterKey })
    }
  }
  for (const key of baseParameters.keys()) {
    if (!liveParameters.has(key)) throw new Error("Perform parameter value disappeared")
  }
  return result
}

/** Applies values from the frozen preview; later runtime adjustments stay untouched. */
export function applyLiveCapture(
  baseline: LiveRuntimeSnapshot,
  frozen: LiveRuntimeSnapshot,
  available: readonly LiveCaptureField[],
  selected: readonly LiveCaptureField[]
): LiveRuntimeSnapshot {
  const allowed = new Set(available.map(captureFieldKey))
  const seen = new Set<string>()
  const next = structuredClone(baseline)
  for (const field of selected) {
    const key = captureFieldKey(field)
    if (!allowed.has(key) || seen.has(key))
      throw new Error("Capture selection is stale or duplicated")
    seen.add(key)
    switch (field.type) {
      case "channel": {
        const target = next.graph.channels[requireIndex(next.graph.channels, field.id, "Channel")]!
        const source =
          frozen.graph.channels[requireIndex(frozen.graph.channels, field.id, "Channel")]!
        target[field.parameter] = source[field.parameter] as never
        break
      }
      case "send": {
        const target = next.graph.sends[requireIndex(next.graph.sends, field.id, "Send")]!
        const source = frozen.graph.sends[requireIndex(frozen.graph.sends, field.id, "Send")]!
        target[field.parameter] = source[field.parameter] as never
        break
      }
      case "plugin": {
        const target = next.graph.plugins[requireIndex(next.graph.plugins, field.id, "Plugin")]!
        const source = frozen.graph.plugins[requireIndex(frozen.graph.plugins, field.id, "Plugin")]!
        target.enabled = source.enabled
        break
      }
      case "plugin-state": {
        const target = next.graph.plugins[requireIndex(next.graph.plugins, field.id, "Plugin")]!
        const source = frozen.graph.plugins[requireIndex(frozen.graph.plugins, field.id, "Plugin")]!
        target.state = structuredClone(source.state)
        break
      }
      case "plugin-parameter": {
        const value = frozen.parameterValues.find(
          (entry) => entry.pluginId === field.id && entry.parameterKey === field.parameterKey
        )
        if (!value) throw new Error("Capture plug-in parameter is missing")
        const index = next.parameterValues.findIndex(
          (entry) => entry.pluginId === field.id && entry.parameterKey === field.parameterKey
        )
        if (index < 0) next.parameterValues.push(structuredClone(value))
        else next.parameterValues[index] = structuredClone(value)
        break
      }
    }
  }
  validateMixerGraph(next.graph)
  parameterMap(next.parameterValues)
  return next
}
