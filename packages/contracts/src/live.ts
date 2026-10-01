import type { AudioPreferences } from "./audio.ts"
import type { MidiControlAddress, MidiControlInputMode } from "./midi-control.ts"
import type {
  MixerChannelCoreState,
  MixerGraphSnapshot,
  MixerSendState,
  MixerChannelPatch,
  MixerSendPatch,
  PluginInstancePatch
} from "./mixer.ts"
import type { PluginInstanceState, PluginStateEnvelope } from "./plugins.ts"
import type { ProjectGraphRef, ProjectSessionRef } from "./rpc.ts"

export type DocumentKind = "studio" | "live"
export interface DocumentOpenPreparation {
  kind: DocumentKind
  path: string
}
/** Preserve closes a quarantined document without saving or deleting its recovery copy. */
export type LiveCloseDisposition = "save" | "discard" | "cancel" | "preserve"

export type LiveMode = "edit" | "preparing-perform" | "perform" | "leaving-perform" | "quarantined"

export interface LiveDocumentConfiguration {
  name: string
  sampleRate: number
  /** Null until the performer explicitly chooses a physical rig. */
  audio: AudioPreferences | null
  enabledMidiDeviceIds: string[]
}

export interface LiveSession {
  kind: "live"
  id: string
  path: string
  configuration: LiveDocumentConfiguration
  dirty: boolean
  recoveredWorkingCopy: boolean
}

export type LiveMidiControlTarget =
  | {
      type: "channel"
      channelId: string
      parameter: "gain" | "pan" | "mute" | "solo"
      behavior?: "toggle" | "absolute"
    }
  | { type: "plugin-parameter"; pluginId: string; parameterKey: string }

export interface LiveMidiBinding {
  id: string
  address: MidiControlAddress
  input: MidiControlInputMode
  target: LiveMidiControlTarget
  transformProfileId?: string
}

export interface LiveWorkspaceSnapshot {
  kind: "live"
  project: ProjectSessionRef
  projectGraph: ProjectGraphRef
  revision: number
  mode: LiveMode
  history: { canUndo: boolean; canRedo: boolean }
  session: LiveSession
  graph: MixerGraphSnapshot
  parameterValues: LivePluginParameterValue[]
  bindings: LiveMidiBinding[]
  hierarchy: LiveHierarchy
  performance?: LivePerformanceSnapshot | null
}

export type LiveCaptureField =
  | { type: "channel"; id: string; parameter: "gainDb" | "pan" | "muted" | "soloed" }
  | { type: "send"; id: string; parameter: "levelDb" | "enabled" }
  | { type: "plugin"; id: string; parameter: "enabled" }
  | { type: "plugin-state"; id: string }
  | { type: "plugin-parameter"; id: string; parameterKey: string }

export interface LiveCapturePreview {
  captureId: string
  documentRevision: number
  runtimeRevision: number
  generation: number
  activeLayerId: LiveLayerId
  baseline: LiveRuntimeSnapshot
  runtime: LiveRuntimeSnapshot
  fields: LiveCaptureField[]
  /** Reserved for fields unavailable to the active Capture policy. */
  blockedFields: LiveCaptureField[]
}

export interface LiveCaptureStateTarget {
  pluginId: string
  layerId: LiveLayerId
}

export interface LivePerformanceSnapshot {
  activeLayerId: LiveLayerId
  generation: number
  runtimeRevision: number
  snapshot: LiveRuntimeSnapshot
  uncapturedFields: LiveCaptureField[]
  /** Current generation document plug-in IDs mapped to native IDs for event attribution. */
  runtimePluginIds?: Record<string, string>
}

export type LivePerformCommand =
  | { type: "enter" }
  | {
      type: "activate"
      layerId: LiveLayerId
      disposition: "discard" | "cancel"
      generation: number
    }
  | { type: "adjust"; command: LivePerformanceCommand; generation: number }
  | {
      type: "capture"
      captureId: string
      fields: LiveCaptureField[]
      stateTargets?: LiveCaptureStateTarget[]
    }
  | { type: "leave"; disposition: "discard" | "cancel"; generation: number }

export type LiveChannelPatch = Omit<MixerChannelPatch, "recordArmed">

export type LiveMixerEditCommand =
  | { type: "create-channel"; channel: MixerChannelCoreState }
  | { type: "update-channel"; channelId: string; patch: LiveChannelPatch }
  | { type: "delete-channel"; channelId: string }
  | { type: "create-send"; send: MixerSendState }
  | { type: "update-send"; sendId: string; patch: MixerSendPatch }
  | { type: "delete-send"; sendId: string }
  | { type: "create-plugin"; plugin: PluginInstanceState }
  | { type: "insert-plugin"; plugin: PluginInstanceState }
  | { type: "update-plugin"; pluginId: string; patch: PluginInstancePatch }
  | { type: "delete-plugin"; pluginId: string }
  | { type: "move-plugin"; pluginId: string; channelId: string; slotOrder: number }
  | { type: "replace-plugin"; pluginId: string; plugin: PluginInstanceState }
  | { type: "set-midi-bindings"; bindings: LiveMidiBinding[] }

export interface LivePluginParameterValue {
  pluginId: string
  parameterKey: string
  value: number
}

export interface LiveRuntimeSnapshot {
  graph: MixerGraphSnapshot
  parameterValues: LivePluginParameterValue[]
}

export type LivePerformanceCommand =
  | {
      type: "channel"
      id: string
      parameter: "gainDb" | "pan" | "muted" | "soloed"
      value: number | boolean
    }
  | { type: "send"; id: string; parameter: "levelDb" | "enabled"; value: number | boolean }
  | { type: "plugin"; id: string; parameter: "enabled"; value: boolean }
  | { type: "plugin-parameter"; id: string; parameterKey: string; value: number }

/** Null addresses the Project layer. Layer IDs are unique within the document. */
export type LiveLayerId = string | null
export type LiveLayerField = LiveCaptureField

export interface LivePluginStateOverride {
  pluginId: string
  state: PluginStateEnvelope
}

export interface LiveSet {
  id: string
  name: string
  sortOrder: number
  overrides: LivePerformanceCommand[]
  /** Absent entries inherit; an entry with an empty envelope remains an explicit override. */
  pluginStates?: LivePluginStateOverride[]
}

export interface LivePatch extends LiveSet {
  setId: string
}

export interface LiveHierarchy {
  sets: LiveSet[]
  patches: LivePatch[]
}

export type LiveLayerEditCommand =
  | { type: "create-set"; setId: string; name: string }
  | { type: "create-patch"; patchId: string; setId: string; name: string }
  | { type: "rename-live-layer"; layerId: string; name: string }
  | { type: "delete-live-layer"; layerId: string }
  | {
      type: "copy-live-set"
      sourceId: string
      setId: string
      patchIds: Record<string, string>
      name: string
    }
  | { type: "copy-live-patch"; sourceId: string; patchId: string; setId: string; name: string }
  | { type: "set-live-override"; layerId: string; override: LivePerformanceCommand }
  | {
      type: "set-live-plugin-state"
      layerId: string
      pluginId: string
      state: PluginStateEnvelope
    }
  | { type: "revert-live-override"; layerId: string; field: LiveLayerField }
  | { type: "edit-live-layer"; layerId: string; command: LiveMixerEditCommand }

export type LiveEditCommand = LiveMixerEditCommand | LiveLayerEditCommand
