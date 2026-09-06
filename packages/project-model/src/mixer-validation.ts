import type { MixerGraphSnapshot, MixerChannelState } from "@heron/contracts"
import { pluginLocator, pluginSupportsHostedAudioMode } from "@heron/contracts"
import { MixerValidationError } from "./validation-error"

export function finiteRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new MixerValidationError(`${label} must be between ${minimum} and ${maximum}`)
  }
}

export function mixerChannelById(graph: MixerGraphSnapshot, id: string): MixerChannelState {
  const channel = graph.channels.find((candidate) => candidate.id === id)
  if (!channel) throw new MixerValidationError(`Mixer channel '${id}' was not found`)
  return channel
}

/** Routing and plug-in invariants shared by every document kind. */
export function validateMixerGraph(graph: MixerGraphSnapshot): void {
  const ids = new Set<string>()
  for (const channel of graph.channels) {
    if (!channel.id || ids.has(channel.id))
      throw new MixerValidationError("Mixer channel IDs must be unique")
    if (new TextEncoder().encode(channel.id).length > 64) {
      throw new MixerValidationError("Mixer channel IDs must be at most 64 UTF-8 bytes")
    }
    ids.add(channel.id)
    finiteRange(channel.gainDb, -90, 12, "Channel gain")
    finiteRange(channel.pan, -1, 1, "Channel pan")
    const supportsAudioInput = channel.kind === "audio" || channel.kind === "aux"
    if (
      supportsAudioInput &&
      channel.inputChannels.length !== (channel.inputFormat === "mono" ? 1 : 2)
    ) {
      throw new MixerValidationError("Audio and Aux input mappings must match their input format")
    }
    if (supportsAudioInput) {
      const maximumInput =
        channel.inputSource === "bus" ? 256 : channel.inputSource === "application" ? 2 : 32
      if (
        channel.inputSource === null ||
        channel.inputFormat === null ||
        (channel.inputSource === "application" && !channel.applicationCapture) ||
        (channel.inputSource !== "application" && channel.applicationCapture != null) ||
        channel.inputChannels.some(
          (input) => !Number.isInteger(input) || input < 1 || input > maximumInput
        ) ||
        new Set(channel.inputChannels).size !== channel.inputChannels.length
      ) {
        throw new MixerValidationError(
          "Audio and Aux channels require a valid hardware, BUS, or application input"
        )
      }
    } else if (
      channel.inputSource !== null ||
      channel.inputFormat !== null ||
      channel.inputChannels.length > 0 ||
      channel.applicationCapture != null
    ) {
      throw new MixerValidationError("Only Audio and Aux channels can map audio inputs")
    }
    const supportsMidiInput = channel.kind === "instrument" && channel.systemRole === null
    const midiInput =
      channel.midiInput === undefined
        ? supportsMidiInput
          ? { portId: null, portName: null, channel: null }
          : null
        : channel.midiInput
    if (supportsMidiInput) {
      if (midiInput === null) {
        throw new MixerValidationError("Instrument channels require a MIDI input route")
      }
      const hasPortId = midiInput.portId !== null
      const hasPortName = midiInput.portName !== null
      if (
        hasPortId !== hasPortName ||
        (hasPortId && !midiInput.portId?.trim()) ||
        (hasPortName && !midiInput.portName?.trim()) ||
        (midiInput.channel !== null &&
          (!Number.isInteger(midiInput.channel) || midiInput.channel < 0 || midiInput.channel > 15))
      ) {
        throw new MixerValidationError("Instrument MIDI routes require a valid port and channel")
      }
    } else if (midiInput !== null) {
      throw new MixerValidationError("Only ordinary Instrument channels can map MIDI inputs")
    }
    if (channel.kind !== "audio" && !supportsMidiInput && channel.recordArmed) {
      throw new MixerValidationError(
        "Only Audio and ordinary Instrument channels can arm recording"
      )
    }
    if (
      channel.kind !== "audio" &&
      channel.kind !== "aux" &&
      !supportsMidiInput &&
      channel.inputMonitoring
    ) {
      throw new MixerValidationError(
        "Only Audio and ordinary Instrument channels can enable input monitoring"
      )
    }
    if (channel.kind === "master" && channel.soloed) {
      throw new MixerValidationError("Master cannot be soloed")
    }
    if (channel.systemRole !== null && channel.kind !== "instrument") {
      throw new MixerValidationError("System channels must be Instrument channels")
    }
    if (channel.kind === "output") {
      if (
        channel.hardwareOutputChannels.length !== 2 ||
        channel.hardwareOutputChannels[0] === channel.hardwareOutputChannels[1] ||
        channel.hardwareOutputChannels.some(
          (output) => !Number.isInteger(output) || output < 1 || output > 32
        )
      ) {
        throw new MixerValidationError(
          "Output channels must map two distinct hardware channels 1 through 32"
        )
      }
    } else if (channel.hardwareOutputChannels.length > 0) {
      throw new MixerValidationError("Only Output channels can map hardware outputs")
    }
    if (!Number.isSafeInteger(channel.sortOrder) || channel.sortOrder < 0) {
      throw new MixerValidationError("Mixer channel order must be a non-negative safe integer")
    }
  }
  const masters = graph.channels.filter((channel) => channel.kind === "master")
  if (masters.length !== 1)
    throw new MixerValidationError("Mixer graph requires exactly one Master")
  const systemRoles = graph.channels
    .map((channel) => channel.systemRole)
    .filter((role): role is NonNullable<typeof role> => role !== null)
  if (new Set(systemRoles).size !== systemRoles.length) {
    throw new MixerValidationError("Mixer system channel roles must be unique")
  }
  const outputs = graph.channels.filter((channel) => channel.kind === "output")
  if (outputs.length === 0)
    throw new MixerValidationError("Mixer graph requires at least one hardware Output")
  const outputMappings = new Set(outputs.map((channel) => channel.hardwareOutputChannels.join(",")))
  if (outputMappings.size !== outputs.length) {
    throw new MixerValidationError("Hardware Output channel pairs must be unique")
  }
  const edges = new Map(graph.channels.map((channel) => [channel.id, [] as string[]]))
  for (const channel of graph.channels) {
    if (channel.kind === "master" || channel.kind === "output") {
      if (channel.outputChannelId !== null || channel.outputBus != null) {
        throw new MixerValidationError("Master and hardware Outputs cannot route onward")
      }
    } else {
      const targetCount =
        Number(channel.outputChannelId !== null) + Number(channel.outputBus != null)
      if (targetCount !== 1) {
        throw new MixerValidationError(
          "Audio, Instrument, and Aux channels must target one BUS or Output"
        )
      }
      if (channel.outputChannelId !== null) {
        const output = mixerChannelById(graph, channel.outputChannelId)
        if (output.kind !== "output") {
          throw new MixerValidationError(
            "Mixer output channel targets must reference a hardware Output"
          )
        }
        edges.get(channel.id)!.push(output.id)
      } else if (
        !Number.isSafeInteger(channel.outputBus) ||
        channel.outputBus! < 1 ||
        channel.outputBus! > 256
      ) {
        throw new MixerValidationError("Mixer BUS output targets must be between 1 and 256")
      } else {
        for (const consumer of graph.channels) {
          if (
            consumer.inputSource === "bus" &&
            consumer.inputChannels.includes(channel.outputBus!)
          ) {
            edges.get(channel.id)!.push(consumer.id)
          }
        }
      }
    }
  }
  const sendIds = new Set<string>()
  const sendRoutes = new Set<string>()
  for (const send of graph.sends) {
    if (!send.id || sendIds.has(send.id))
      throw new MixerValidationError("Mixer send IDs must be unique")
    if (new TextEncoder().encode(send.id).length > 64) {
      throw new MixerValidationError("Mixer send IDs must be at most 64 UTF-8 bytes")
    }
    sendIds.add(send.id)
    const source = mixerChannelById(graph, send.sourceChannelId)
    if (source.kind === "master" || source.kind === "output") {
      throw new MixerValidationError("Only Audio, Instrument, and Aux channels can source sends")
    }
    const targetCount = Number(send.targetChannelId != null) + Number(send.targetBus !== null)
    if (targetCount !== 1) {
      throw new MixerValidationError("A send must target exactly one BUS or Output")
    }
    let route: string
    if (send.targetChannelId != null) {
      const output = mixerChannelById(graph, send.targetChannelId)
      if (output.kind !== "output") {
        throw new MixerValidationError("Send Output targets must reference a hardware Output")
      }
      route = `${source.id}:output:${output.id}`
      edges.get(source.id)!.push(output.id)
    } else if (
      !Number.isSafeInteger(send.targetBus) ||
      send.targetBus! < 1 ||
      send.targetBus! > 256
    ) {
      throw new MixerValidationError("Send BUS targets must be between 1 and 256")
    } else {
      route = `${source.id}:bus:${send.targetBus}`
      for (const consumer of graph.channels) {
        if (consumer.inputSource === "bus" && consumer.inputChannels.includes(send.targetBus!)) {
          edges.get(source.id)!.push(consumer.id)
        }
      }
    }
    if (sendRoutes.has(route))
      throw new MixerValidationError("A channel can only send to each destination once")
    sendRoutes.add(route)
    finiteRange(send.levelDb, -90, 12, "Send level")
    if (!Number.isSafeInteger(send.sortOrder) || send.sortOrder < 0) {
      throw new MixerValidationError("Mixer send order must be a non-negative safe integer")
    }
  }
  const pluginIds = new Set<string>()
  const pluginSlots = new Set<string>()
  const pluginControlAliases = new Set<string>()
  for (const plugin of graph.plugins) {
    if (!plugin.id || pluginIds.has(plugin.id))
      throw new MixerValidationError("Plugin instance IDs must be unique")
    pluginIds.add(plugin.id)
    const channel = mixerChannelById(graph, plugin.channelId)
    if (!Number.isSafeInteger(plugin.slotOrder) || plugin.slotOrder < 0) {
      throw new MixerValidationError("Plugin slot order must be a non-negative safe integer")
    }
    const slot = `${plugin.channelId}:${plugin.role}:${plugin.slotOrder}`
    if (pluginSlots.has(slot))
      throw new MixerValidationError("Plugin slots must be unique within a channel")
    pluginSlots.add(slot)
    if (plugin.controlAlias != null) {
      if (
        !/^[a-z0-9][a-z0-9._-]*$/.test(plugin.controlAlias) ||
        new TextEncoder().encode(plugin.controlAlias).byteLength > 64
      ) {
        throw new MixerValidationError(
          "Plugin control aliases must be 1–64 byte lowercase slugs containing letters, digits, dots, underscores, or hyphens"
        )
      }
      if (pluginControlAliases.has(plugin.controlAlias)) {
        throw new MixerValidationError("Plugin control aliases must be unique within a project")
      }
      pluginControlAliases.add(plugin.controlAlias)
    }
    if (plugin.role === "instrument") {
      if (
        channel.kind !== "instrument" ||
        plugin.slotOrder !== 0 ||
        plugin.descriptor.kind !== "instrument" ||
        !["mono", "stereo"].includes(plugin.audioMode)
      ) {
        throw new MixerValidationError(
          "An instrument slot requires an instrument plugin on an Instrument channel"
        )
      }
    } else if (
      plugin.descriptor.kind !== "effect" ||
      !["mono", "mono-to-stereo", "stereo", "dual-mono"].includes(plugin.audioMode)
    ) {
      throw new MixerValidationError(
        "Insert slots only accept effect plug-ins with a valid audio mode"
      )
    }
    const locator = plugin.locator ?? pluginLocator(plugin.descriptor)
    const descriptorLocator = pluginLocator(plugin.descriptor)
    if (
      locator.format !== descriptorLocator.format ||
      locator.artifactPath !== descriptorLocator.artifactPath ||
      locator.nativeId !== descriptorLocator.nativeId
    ) {
      throw new MixerValidationError("Plugin locator must match its descriptor snapshot")
    }
    if (!pluginSupportsHostedAudioMode(plugin.descriptor, plugin.audioMode)) {
      throw new MixerValidationError(
        "Plugin audio mode must be supported by its descriptor snapshot"
      )
    }
    const sidechainPortKeys = new Set<string>()
    for (const route of plugin.sidechainInputs) {
      if (!route.inputPortKey.trim()) {
        throw new MixerValidationError("Plugin side-chain port keys cannot be empty")
      }
      if (sidechainPortKeys.has(route.inputPortKey)) {
        throw new MixerValidationError(
          "Each plugin aux input port can have at most one side-chain source"
        )
      }
      sidechainPortKeys.add(route.inputPortKey)
      const bus = plugin.descriptor.buses.find(
        (candidate) =>
          candidate.direction === "input" &&
          candidate.kind === "aux" &&
          candidate.portKey === route.inputPortKey
      )
      if (!bus || (bus.channels !== 1 && bus.channels !== 2)) {
        throw new MixerValidationError(
          "Plugin side-chain routes must target an exposed mono or stereo aux bus"
        )
      }
      const source = mixerChannelById(graph, route.sourceChannelId)
      const isOrdinaryChannel =
        source.systemRole === null && (source.kind === "audio" || source.kind === "instrument")
      if ((!isOrdinaryChannel && source.kind !== "aux") || source.systemRole !== null) {
        throw new MixerValidationError(
          "Plugin side-chain sources must be ordinary Audio, Instrument, or Aux channels"
        )
      }
      if (source.id === channel.id) {
        throw new MixerValidationError("A plugin cannot use its own channel as a side-chain source")
      }
      edges.get(source.id)!.push(channel.id)
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  function visit(id: string): void {
    if (visiting.has(id))
      throw new MixerValidationError("Mixer routing would create a feedback loop")
    if (visited.has(id)) return
    visiting.add(id)
    for (const target of edges.get(id) ?? []) visit(target)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of ids) visit(id)
}
