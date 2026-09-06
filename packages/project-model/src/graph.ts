import type {
  AudioClipState,
  MidiClipState,
  MixerChannelState,
  MixerSendState,
  PluginInstanceState,
  ProjectCommand,
  ProjectGraphSnapshot,
  TrackState
} from "@heron/contracts"
import { DEFAULT_PROJECT_END_TICK } from "@heron/contracts"
import { ProjectValidationError } from "./validation-error"
export { validateGraph } from "./studio-validation"
export { finiteRange } from "./mixer-validation"

export function cloneGraph(graph: ProjectGraphSnapshot): ProjectGraphSnapshot {
  return structuredClone(graph)
}

function channelById(graph: ProjectGraphSnapshot, id: string): MixerChannelState {
  const channel = graph.channels.find((candidate) => candidate.id === id)
  if (!channel) throw new ProjectValidationError(`Mixer channel '${id}' was not found`)
  return channel
}

function trackById(graph: ProjectGraphSnapshot, id: string): TrackState {
  const track = graph.tracks.find((candidate) => candidate.id === id)
  if (!track) throw new ProjectValidationError(`Project track '${id}' was not found`)
  return track
}

function sendById(graph: ProjectGraphSnapshot, id: string): MixerSendState {
  const send = graph.sends.find((candidate) => candidate.id === id)
  if (!send) throw new ProjectValidationError(`Mixer send '${id}' was not found`)
  return send
}

function clipById(graph: ProjectGraphSnapshot, id: string): AudioClipState {
  const clip = graph.audioClips.find((candidate) => candidate.id === id)
  if (!clip) throw new ProjectValidationError(`Timeline clip '${id}' was not found`)
  return clip
}

function pluginById(graph: ProjectGraphSnapshot, id: string): PluginInstanceState {
  const plugin = graph.plugins.find((candidate) => candidate.id === id)
  if (!plugin) throw new ProjectValidationError(`Plugin instance '${id}' was not found`)
  return plugin
}

function sidechainRoutesFromChannel(
  graph: ProjectGraphSnapshot,
  channelId: string,
  excludingPluginIds: ReadonlySet<string> = new Set()
): ProjectCommand[] {
  return graph.plugins
    .filter(
      (plugin) =>
        !excludingPluginIds.has(plugin.id) &&
        plugin.sidechainInputs.some((route) => route.sourceChannelId === channelId)
    )
    .map((plugin) => ({
      type: "update-plugin" as const,
      pluginId: plugin.id,
      patch: { sidechainInputs: structuredClone(plugin.sidechainInputs) }
    }))
}

function midiClipById(graph: ProjectGraphSnapshot, id: string): MidiClipState {
  const clip = graph.midiClips.find((candidate) => candidate.id === id)
  if (!clip) throw new ProjectValidationError(`MIDI clip '${id}' was not found`)
  return clip
}

function midiNoteById(clip: MidiClipState, id: string): MidiClipState["notes"][number] {
  const note = clip.notes.find((candidate) => candidate.id === id)
  if (!note)
    throw new ProjectValidationError(`MIDI note '${id}' was not found in clip '${clip.id}'`)
  return note
}

function movePluginInGraph(
  graph: ProjectGraphSnapshot,
  pluginId: string,
  channelId: string,
  role: PluginInstanceState["role"],
  slotOrder: number
): void {
  const plugin = pluginById(graph, pluginId)
  const sourceChannelId = plugin.channelId
  const sourceRole = plugin.role
  const source = graph.plugins
    .filter(
      (candidate) =>
        candidate.id !== pluginId &&
        candidate.channelId === sourceChannelId &&
        candidate.role === sourceRole
    )
    .sort((left, right) => left.slotOrder - right.slotOrder)
  source.forEach((candidate, index) => {
    candidate.slotOrder = sourceRole === "instrument" ? 0 : index
  })

  const destination = graph.plugins
    .filter(
      (candidate) =>
        candidate.id !== pluginId && candidate.channelId === channelId && candidate.role === role
    )
    .sort((left, right) => left.slotOrder - right.slotOrder)
  if (role === "instrument" && destination.length > 0) {
    throw new ProjectValidationError(
      "Replace the assigned instrument instead of moving into an occupied slot"
    )
  }
  const insertionIndex =
    role === "instrument" ? 0 : Math.max(0, Math.min(slotOrder, destination.length))
  destination.splice(insertionIndex, 0, plugin)
  destination.forEach((candidate, index) => {
    candidate.channelId = channelId
    candidate.role = role
    candidate.slotOrder = role === "instrument" ? 0 : index
  })
}

function patchFromKeys<T extends object>(source: T, patch: Partial<T>): Partial<T> {
  return Object.fromEntries(
    Object.keys(patch).map((key) => [key, source[key as keyof T]])
  ) as Partial<T>
}

export function inverseFor(graph: ProjectGraphSnapshot, command: ProjectCommand): ProjectCommand {
  switch (command.type) {
    case "update-project-notes":
      return { type: "update-project-notes", notes: graph.projectNotes ?? "" }
    case "update-project-end":
      return {
        type: "update-project-end",
        endTick: graph.projectEndTick ?? DEFAULT_PROJECT_END_TICK
      }
    case "create-track":
      return { type: "delete-track", trackId: command.track.id }
    case "delete-track": {
      const track = trackById(graph, command.trackId)
      const channel = channelById(graph, track.channelId)
      const affectedOutputs = graph.channels
        .filter((candidate) => candidate.outputChannelId === channel.id)
        .map<ProjectCommand>((candidate) => ({
          type: "update-channel",
          channelId: candidate.id,
          patch: { outputChannelId: channel.id, outputBus: null }
        }))
      const sends = graph.sends
        .filter((send) => send.sourceChannelId === channel.id)
        .map<ProjectCommand>((send) => ({ type: "create-send", send }))
      const audioClips = graph.audioClips
        .filter((clip) => clip.trackId === track.id)
        .map<ProjectCommand>((clip) => ({ type: "create-audio-clip", clip }))
      const plugins = graph.plugins
        .filter((plugin) => plugin.channelId === channel.id)
        .map<ProjectCommand>((plugin) => ({ type: "create-plugin", plugin }))
      const pluginIds = new Set(
        graph.plugins.filter((plugin) => plugin.channelId === channel.id).map((plugin) => plugin.id)
      )
      const sidechainRoutes = sidechainRoutesFromChannel(graph, channel.id, pluginIds)
      const midiClips = graph.midiClips
        .filter((clip) => clip.trackId === track.id)
        .map<ProjectCommand>((clip) => ({ type: "create-midi-clip", clip }))
      return {
        type: "batch",
        commands: [
          { type: "create-track", track, channel },
          ...affectedOutputs,
          ...sends,
          ...audioClips,
          ...plugins,
          ...sidechainRoutes,
          ...midiClips
        ]
      }
    }
    case "update-track": {
      const track = trackById(graph, command.trackId)
      return {
        type: "update-track",
        trackId: command.trackId,
        patch: patchFromKeys(track, command.patch)
      }
    }
    case "create-channel":
      return { type: "delete-channel", channelId: command.channel.id }
    case "delete-channel": {
      const channel = channelById(graph, command.channelId)
      if (graph.tracks.some((track) => track.channelId === channel.id)) {
        throw new ProjectValidationError(
          "Track-owned channels must be deleted through delete-track"
        )
      }
      if (channel.kind === "master") throw new ProjectValidationError("Master cannot be deleted")
      if (channel.systemRole !== null)
        throw new ProjectValidationError("System channels cannot be deleted")
      if (
        channel.kind === "output" &&
        (graph.channels.some((candidate) => candidate.outputChannelId === channel.id) ||
          graph.sends.some((send) => send.targetChannelId === channel.id))
      ) {
        throw new ProjectValidationError("An Output must be unused before it can be deleted")
      }
      const affectedOutputs = graph.channels
        .filter((candidate) => candidate.outputChannelId === channel.id)
        .map<ProjectCommand>((candidate) => ({
          type: "update-channel",
          channelId: candidate.id,
          patch: { outputChannelId: channel.id, outputBus: null }
        }))
      const sends = graph.sends
        .filter((send) => send.sourceChannelId === channel.id)
        .map<ProjectCommand>((send) => ({ type: "create-send", send }))
      const plugins = graph.plugins
        .filter((plugin) => plugin.channelId === channel.id)
        .map<ProjectCommand>((plugin) => ({ type: "create-plugin", plugin }))
      const pluginIds = new Set(
        graph.plugins.filter((plugin) => plugin.channelId === channel.id).map((plugin) => plugin.id)
      )
      const sidechainRoutes = sidechainRoutesFromChannel(graph, channel.id, pluginIds)
      return {
        type: "batch",
        commands: [
          { type: "create-channel", channel },
          ...affectedOutputs,
          ...sends,
          ...plugins,
          ...sidechainRoutes
        ]
      }
    }
    case "update-channel": {
      const channel = channelById(graph, command.channelId)
      const patch = patchFromKeys(channel, command.patch)
      // Application identities are only meaningful while the channel remains
      // application-backed. Keep the implicit cleanup invertible so undo can
      // restore a previous application route even when the UI sends only the
      // new hardware/BUS input fields.
      if (
        command.patch.inputSource !== undefined &&
        command.patch.inputSource !== "application" &&
        channel.applicationCapture != null
      ) {
        patch.applicationCapture = channel.applicationCapture
      }
      return {
        type: "update-channel",
        channelId: command.channelId,
        patch
      }
    }
    case "create-send":
      return { type: "delete-send", sendId: command.send.id }
    case "delete-send":
      return { type: "create-send", send: sendById(graph, command.sendId) }
    case "update-send": {
      const send = sendById(graph, command.sendId)
      return {
        type: "update-send",
        sendId: command.sendId,
        patch: patchFromKeys(send, command.patch)
      }
    }
    case "create-audio-clip":
      return { type: "delete-audio-clip", clipId: command.clip.id }
    case "delete-audio-clip":
      return { type: "create-audio-clip", clip: clipById(graph, command.clipId) }
    case "move-audio-clip": {
      const clip = clipById(graph, command.clipId)
      return {
        type: "move-audio-clip",
        clipId: command.clipId,
        trackId: clip.trackId,
        startFrame: clip.startFrame
      }
    }
    case "update-audio-clip": {
      const clip = clipById(graph, command.clipId)
      return {
        type: "update-audio-clip",
        clipId: clip.id,
        patch: patchFromKeys(clip, command.patch)
      }
    }
    case "create-plugin":
      return { type: "delete-plugin", pluginId: command.plugin.id }
    case "delete-plugin":
      return { type: "create-plugin", plugin: pluginById(graph, command.pluginId) }
    case "update-plugin": {
      const plugin = pluginById(graph, command.pluginId)
      return {
        type: "update-plugin",
        pluginId: command.pluginId,
        patch: patchFromKeys(plugin, command.patch)
      }
    }
    case "move-plugin": {
      const plugin = pluginById(graph, command.pluginId)
      return {
        type: "move-plugin",
        pluginId: plugin.id,
        channelId: plugin.channelId,
        role: plugin.role,
        slotOrder: plugin.slotOrder
      }
    }
    case "replace-plugin":
      return {
        type: "replace-plugin",
        pluginId: command.pluginId,
        plugin: pluginById(graph, command.pluginId)
      }
    case "create-midi-source":
      return { type: "delete-midi-source", source: structuredClone(command.source) }
    case "delete-midi-source":
      return { type: "create-midi-source", source: structuredClone(command.source) }
    case "create-midi-clip":
      return { type: "delete-midi-clip", clipId: command.clip.id }
    case "delete-midi-clip":
      return { type: "create-midi-clip", clip: midiClipById(graph, command.clipId) }
    case "move-midi-clip": {
      const clip = midiClipById(graph, command.clipId)
      return {
        type: "move-midi-clip",
        clipId: clip.id,
        trackId: clip.trackId,
        startTick: clip.startTick
      }
    }
    case "update-midi-clip-range": {
      const clip = midiClipById(graph, command.clipId)
      return {
        type: "update-midi-clip-range",
        clipId: clip.id,
        patch: patchFromKeys(clip, command.patch)
      }
    }
    case "create-midi-notes":
      return {
        type: "delete-midi-notes",
        clipId: command.clipId,
        noteIds: command.notes.map((note) => note.id)
      }
    case "delete-midi-notes": {
      const clip = midiClipById(graph, command.clipId)
      return {
        type: "create-midi-notes",
        clipId: clip.id,
        notes: command.noteIds.map((noteId) => structuredClone(midiNoteById(clip, noteId)))
      }
    }
    case "update-midi-notes": {
      const clip = midiClipById(graph, command.clipId)
      return {
        type: "update-midi-notes",
        clipId: clip.id,
        updates: command.updates.map(({ noteId, patch }) => ({
          noteId,
          patch: patchFromKeys(midiNoteById(clip, noteId), patch)
        }))
      }
    }
    case "rebase-midi-clip-content":
      midiClipById(graph, command.clipId)
      return {
        type: "rebase-midi-clip-content",
        clipId: command.clipId,
        deltaTicks: -command.deltaTicks
      }
    case "replace-tempo-map":
      return { type: "replace-tempo-map", tempoMap: structuredClone(graph.tempoMap) }
    case "replace-key-signature-map":
      return {
        type: "replace-key-signature-map",
        events: structuredClone(graph.keySignatureEvents)
      }
    case "batch": {
      let working = cloneGraph(graph)
      const inverses: ProjectCommand[] = []
      for (const nested of command.commands) {
        inverses.unshift(inverseFor(working, nested))
        working = applyToGraph(working, nested)
      }
      return { type: "batch", commands: inverses }
    }
  }
}

export function applyToGraph(
  graph: ProjectGraphSnapshot,
  command: ProjectCommand
): ProjectGraphSnapshot {
  const next = cloneGraph(graph)
  switch (command.type) {
    case "update-project-notes":
      next.projectNotes = command.notes
      break
    case "update-project-end":
      next.projectEndTick = command.endTick
      break
    case "create-track":
      next.channels.push(structuredClone(command.channel))
      next.tracks.push(structuredClone(command.track))
      break
    case "delete-track": {
      const track = trackById(next, command.trackId)
      next.tracks = next.tracks.filter((candidate) => candidate.id !== track.id)
      next.audioClips = next.audioClips.filter((clip) => clip.trackId !== track.id)
      next.midiClips = next.midiClips.filter((clip) => clip.trackId !== track.id)
      return applyToGraph(next, { type: "delete-channel", channelId: track.channelId })
    }
    case "update-track":
      Object.assign(trackById(next, command.trackId), command.patch)
      break
    case "create-channel":
      next.channels.push(structuredClone(command.channel))
      break
    case "delete-channel": {
      const master = next.channels.find((channel) => channel.kind === "master")
      if (!master || command.channelId === master.id)
        throw new ProjectValidationError("Master cannot be deleted")
      const removed = channelById(next, command.channelId)
      if (next.tracks.some((track) => track.channelId === removed.id)) {
        throw new ProjectValidationError(
          "Track-owned channels must be deleted through delete-track"
        )
      }
      if (removed.systemRole !== null)
        throw new ProjectValidationError("System channels cannot be deleted")
      const fallbackOutput = next.channels.find(
        (channel) => channel.kind === "output" && channel.id !== removed.id
      )
      if (
        removed.kind === "output" &&
        (next.channels.some((channel) => channel.outputChannelId === removed.id) ||
          next.sends.some((send) => send.targetChannelId === removed.id))
      ) {
        throw new ProjectValidationError("An Output must be unused before it can be deleted")
      }
      next.channels = next.channels.filter((channel) => channel.id !== command.channelId)
      for (const channel of next.channels) {
        if (channel.outputChannelId === command.channelId) {
          if (!fallbackOutput)
            throw new ProjectValidationError("Mixer graph requires a hardware Output")
          channel.outputChannelId = fallbackOutput.id
        }
      }
      next.sends = next.sends.filter((send) => send.sourceChannelId !== command.channelId)
      next.plugins = next.plugins.filter((plugin) => plugin.channelId !== command.channelId)
      for (const plugin of next.plugins) {
        plugin.sidechainInputs = plugin.sidechainInputs.filter(
          (route) => route.sourceChannelId !== command.channelId
        )
      }
      break
    }
    case "update-channel": {
      const channel = channelById(next, command.channelId)
      Object.assign(channel, command.patch)
      if (command.patch.inputSource !== undefined && command.patch.inputSource !== "application") {
        channel.applicationCapture = null
      }
      break
    }
    case "create-send":
      next.sends.push(structuredClone(command.send))
      break
    case "delete-send":
      next.sends = next.sends.filter((send) => send.id !== command.sendId)
      break
    case "update-send":
      Object.assign(sendById(next, command.sendId), command.patch)
      break
    case "create-audio-clip":
      next.audioClips.push(structuredClone(command.clip))
      break
    case "delete-audio-clip":
      next.audioClips = next.audioClips.filter((clip) => clip.id !== command.clipId)
      break
    case "move-audio-clip": {
      const clip = clipById(next, command.clipId)
      clip.trackId = command.trackId
      clip.startFrame = command.startFrame
      break
    }
    case "update-audio-clip":
      Object.assign(clipById(next, command.clipId), command.patch)
      break
    case "create-plugin":
      next.plugins.push(structuredClone(command.plugin))
      break
    case "delete-plugin":
      next.plugins = next.plugins.filter((plugin) => plugin.id !== command.pluginId)
      break
    case "update-plugin":
      Object.assign(pluginById(next, command.pluginId), command.patch)
      break
    case "move-plugin": {
      movePluginInGraph(next, command.pluginId, command.channelId, command.role, command.slotOrder)
      break
    }
    case "replace-plugin": {
      const index = next.plugins.findIndex((plugin) => plugin.id === command.pluginId)
      if (index < 0)
        throw new ProjectValidationError(`Plugin instance '${command.pluginId}' was not found`)
      next.plugins[index] = structuredClone(command.plugin)
      break
    }
    case "create-midi-source":
    case "delete-midi-source":
      break
    case "create-midi-clip":
      next.midiClips.push(structuredClone(command.clip))
      break
    case "delete-midi-clip":
      next.midiClips = next.midiClips.filter((clip) => clip.id !== command.clipId)
      break
    case "move-midi-clip": {
      const clip = midiClipById(next, command.clipId)
      clip.trackId = command.trackId
      clip.startTick = command.startTick
      break
    }
    case "update-midi-clip-range":
      Object.assign(midiClipById(next, command.clipId), command.patch)
      break
    case "create-midi-notes":
      midiClipById(next, command.clipId).notes.push(...structuredClone(command.notes))
      break
    case "delete-midi-notes": {
      const clip = midiClipById(next, command.clipId)
      const ids = new Set(command.noteIds)
      for (const id of ids) midiNoteById(clip, id)
      clip.notes = clip.notes.filter((note) => !ids.has(note.id))
      break
    }
    case "update-midi-notes": {
      const clip = midiClipById(next, command.clipId)
      for (const update of command.updates) {
        Object.assign(midiNoteById(clip, update.noteId), update.patch)
      }
      break
    }
    case "rebase-midi-clip-content": {
      const clip = midiClipById(next, command.clipId)
      for (const note of clip.notes) note.startTick += command.deltaTicks
      for (const event of clip.events) event.tick += command.deltaTicks
      break
    }
    case "replace-tempo-map":
      next.tempoMap = structuredClone(command.tempoMap)
      break
    case "replace-key-signature-map":
      next.keySignatureEvents = structuredClone(command.events)
      break
    case "batch":
      return command.commands.reduce(applyToGraph, next)
  }
  return next
}

export function onlyRealtimeParameters(command: ProjectCommand): boolean {
  if (command.type === "batch") return command.commands.every(onlyRealtimeParameters)
  if (command.type === "update-project-notes") return true
  if (command.type === "replace-key-signature-map") return true
  if (command.type === "update-track") {
    return Object.keys(command.patch).every((key) => key === "notes")
  }
  if (command.type === "update-channel") {
    return Object.keys(command.patch).every((key) => key === "gainDb" || key === "pan")
  }
  if (command.type === "update-send") {
    return Object.keys(command.patch).every((key) => key === "levelDb" || key === "pan")
  }
  return false
}

export function deletedChannelIds(
  graph: ProjectGraphSnapshot,
  command: ProjectCommand
): Set<string> {
  if (command.type === "delete-track") {
    return new Set([trackById(graph, command.trackId).channelId])
  }
  if (command.type === "delete-channel") return new Set([command.channelId])
  if (command.type !== "batch") return new Set()
  return new Set(command.commands.flatMap((nested) => [...deletedChannelIds(graph, nested)]))
}
