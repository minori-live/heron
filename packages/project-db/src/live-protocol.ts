import type {
  LiveDocumentConfiguration,
  LiveMidiBinding,
  LivePluginParameterValue,
  LiveRuntimeSnapshot,
  MixerGraphSnapshot
} from "@heron/contracts"

export type LiveWorkerRequest =
  | { id: number; type: "create"; dataDir: string; configuration: LiveDocumentConfiguration }
  | { id: number; type: "open"; dataDir: string; archivePath?: string }
  | { id: number; type: "configuration" }
  | {
      id: number
      type: "update-configuration"
      configuration: LiveDocumentConfiguration
      expectedRevision: number
    }
  | { id: number; type: "revision" }
  | { id: number; type: "mixer-snapshot" }
  | { id: number; type: "midi-bindings" }
  | { id: number; type: "plugin-parameters" }
  | {
      id: number
      type: "replace-baseline"
      snapshot: LiveRuntimeSnapshot
      bindings: LiveMidiBinding[]
      expectedRevision: number
    }
  | { id: number; type: "dump"; outputPath: string }
  | { id: number; type: "close" }

export interface LiveWorkerResultMap {
  create: void
  open: void
  configuration: LiveDocumentConfiguration
  "update-configuration": number
  revision: number
  "mixer-snapshot": MixerGraphSnapshot
  "midi-bindings": LiveMidiBinding[]
  "plugin-parameters": LivePluginParameterValue[]
  "replace-baseline": number
  dump: void
  close: void
}

export type LiveWorkerResponse =
  | {
      id: number
      type: LiveWorkerRequest["type"]
      ok: true
      value: LiveWorkerResultMap[keyof LiveWorkerResultMap]
    }
  | {
      id: number
      type: LiveWorkerRequest["type"]
      ok: false
      error: { code: string; message: string }
    }
