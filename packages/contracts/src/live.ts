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
import type { PluginInstanceState } from "./plugins.ts"
import type { ProjectGraphRef, ProjectSessionRef } from "./rpc.ts"

export type DocumentKind = "studio" | "live"
export interface DocumentOpenPreparation {
  kind: DocumentKind
  path: string
}
export type LiveMode = "edit" | "preparing-perform" | "perform" | "leaving-perform"

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
  bindings: LiveMidiBinding[]
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
  fields: LiveCaptureField[]
}

export type LiveChannelPatch = Omit<MixerChannelPatch, "recordArmed">

export type LiveEditCommand =
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
