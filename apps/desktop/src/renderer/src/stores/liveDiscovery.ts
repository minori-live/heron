import { acceptHMRUpdate, defineStore } from "pinia"
import type {
  AudioBackend,
  AudioBackendDescriptor,
  AudioDeviceList,
  AudioHostRef,
  DesktopSessionRef,
  MidiRuntimeRef,
  MidiRuntimeResourceSnapshot,
  PluginCatalogSnapshot,
  RpcResult
} from "@heron/contracts"
import { readMeta } from "../rpc"

/** Read-only discovery for a Live document; it never applies application preferences. */
export const useLiveDiscoveryStore = defineStore("live-discovery", () => {
  function listAudioBackends(target: AudioHostRef): Promise<RpcResult<AudioBackendDescriptor[]>> {
    return window.heron.listAudioBackends(readMeta(target))
  }

  function listAudioDevices(
    target: AudioHostRef,
    backend: AudioBackend
  ): Promise<RpcResult<AudioDeviceList>> {
    return window.heron.listAudioDevices(readMeta(target), backend)
  }

  function midiInputSnapshot(
    target: MidiRuntimeRef
  ): Promise<RpcResult<MidiRuntimeResourceSnapshot>> {
    return window.heron.midiInputSnapshot(readMeta(target))
  }

  function listPluginCatalog(target: DesktopSessionRef): Promise<RpcResult<PluginCatalogSnapshot>> {
    return window.heron.listPlugins(readMeta(target))
  }

  function subscribeMidiInput(
    target: MidiRuntimeRef,
    listener: (snapshot: MidiRuntimeResourceSnapshot) => void
  ): () => void {
    return window.heron.subscribeMidiInput((event) => {
      const resource = event.payload.runtime
      if (
        resource.id === target.id &&
        resource.epoch === target.epoch &&
        resource.generation === target.generation
      ) {
        listener(event.payload)
      }
    })
  }

  return {
    listAudioBackends,
    listAudioDevices,
    midiInputSnapshot,
    listPluginCatalog,
    subscribeMidiInput
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useLiveDiscoveryStore, import.meta.hot))
}
