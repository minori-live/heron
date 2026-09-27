import type { ProjectCommand } from "@heron/contracts"
import type { midiEvents, midiNotes, pluginStateChunks } from "../schema"

/** Only immutable payload rows are reused; graph metadata is always read from SQL. */
export class SnapshotPayloadCache {
  notes?: Array<typeof midiNotes.$inferSelect>
  events?: Array<typeof midiEvents.$inferSelect>
  pluginChunks?: Array<typeof pluginStateChunks.$inferSelect>
  dirtyNoteClipIds = new Set<string>()
  dirtyEventClipIds = new Set<string>()

  fork(command?: ProjectCommand): SnapshotPayloadCache {
    const next = new SnapshotPayloadCache()
    next.notes = this.notes
    next.events = this.events
    next.pluginChunks = this.pluginChunks
    next.dirtyNoteClipIds = new Set(this.dirtyNoteClipIds)
    next.dirtyEventClipIds = new Set(this.dirtyEventClipIds)
    if (command) next.invalidate(command)
    return next
  }

  private invalidate(command: ProjectCommand): void {
    switch (command.type) {
      case "batch":
        for (const child of command.commands) this.invalidate(child)
        return
      case "create-midi-clip":
        this.dirtyNoteClipIds.add(command.clip.id)
        this.dirtyEventClipIds.add(command.clip.id)
        return
      case "delete-midi-clip":
      case "rebase-midi-clip-content":
        this.dirtyNoteClipIds.add(command.clipId)
        this.dirtyEventClipIds.add(command.clipId)
        return
      case "create-midi-notes":
      case "delete-midi-notes":
      case "update-midi-notes":
        this.dirtyNoteClipIds.add(command.clipId)
        return
      case "create-plugin":
      case "delete-plugin":
      case "replace-plugin":
        this.pluginChunks = undefined
        return
      case "update-plugin":
        if (command.patch.state !== undefined) this.pluginChunks = undefined
        return
      case "delete-track":
      case "delete-channel":
        // Cascades remove clip content and plug-in state.
        this.notes = undefined
        this.events = undefined
        this.pluginChunks = undefined
        this.dirtyNoteClipIds.clear()
        this.dirtyEventClipIds.clear()
        return
      case "create-track":
      case "update-track":
      case "create-channel":
      case "update-channel":
      case "create-send":
      case "delete-send":
      case "update-send":
      case "create-audio-clip":
      case "delete-audio-clip":
      case "move-audio-clip":
      case "update-audio-clip":
      case "move-plugin":
      case "create-midi-source":
      case "delete-midi-source":
      case "move-midi-clip":
      case "update-midi-clip-range":
      case "update-project-notes":
      case "update-project-end":
      case "replace-tempo-map":
      case "replace-key-signature-map":
        return
    }
    command satisfies never
  }
}
