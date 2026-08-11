import { AraCallbackSequenceTracker } from "./audio-host-events"
import type {
  AraHostCallback,
  NativeAudioDeviceRecoverySnapshot,
  PluginSidechainRouteRequest,
  PluginHostNotification
} from "./audio-host-events"
import type { PluginRuntimeFailure } from "@heron/contracts"

export interface AudioHostEventOperations {
  helperEpoch(): string | null
  rejectSidechainRoute(request: PluginSidechainRouteRequest): Promise<void>
}

export class AudioHostEventDispatcher {
  private readonly pending = new Set<Promise<void>>()
  private readonly araSequences = new AraCallbackSequenceTracker()
  private araHandler: (callback: AraHostCallback) => void | Promise<void> = () => {}
  private pluginHandler: (notification: PluginHostNotification) => void | Promise<void> = () => {}
  private sidechainHandler: (request: PluginSidechainRouteRequest) => void | Promise<void> =
    () => {}
  private recoveryHandler: (
    recovery: NativeAudioDeviceRecoverySnapshot | null
  ) => void | Promise<void> = () => {}
  private pluginFailureHandler: (failure: PluginRuntimeFailure) => void | Promise<void> = () => {}

  constructor(private readonly operations: AudioHostEventOperations) {}

  setAraHandler(handler: (callback: AraHostCallback) => void | Promise<void>): void {
    this.araHandler = handler
  }

  setPluginHandler(handler: (notification: PluginHostNotification) => void | Promise<void>): void {
    this.pluginHandler = handler
  }

  setSidechainHandler(
    handler: (request: PluginSidechainRouteRequest) => void | Promise<void>
  ): void {
    this.sidechainHandler = handler
  }

  setDeviceRecoveryHandler(
    handler: (recovery: NativeAudioDeviceRecoverySnapshot | null) => void | Promise<void>
  ): void {
    this.recoveryHandler = handler
  }

  setPluginFailureHandler(handler: (failure: PluginRuntimeFailure) => void | Promise<void>): void {
    this.pluginFailureHandler = handler
  }

  dispatchAra(callback: AraHostCallback): void {
    if (callback.helperEpoch !== this.operations.helperEpoch()) return
    if (!this.araSequences.accept(callback.helperEpoch, callback.sequence)) return
    this.track(
      Promise.resolve()
        .then(() => this.araHandler(callback))
        .catch((error: unknown) => {
          console.error("Could not reconcile an ARA host callback", error)
        })
    )
  }

  dispatchPlugin(notification: PluginHostNotification): void {
    this.track(
      Promise.resolve()
        .then(() => this.pluginHandler(notification))
        .catch((error: unknown) => {
          console.error("Could not reconcile an audio plug-in host notification", error)
        })
    )
  }

  dispatchSidechain(request: PluginSidechainRouteRequest): void {
    this.track(
      Promise.resolve()
        .then(() => this.sidechainHandler(request))
        .catch(async (error: unknown) => {
          console.error("Could not commit a VST3 side-chain route", error)
          await this.operations.rejectSidechainRoute(request)
        })
    )
  }

  dispatchDeviceRecovery(recovery: NativeAudioDeviceRecoverySnapshot | null): void {
    this.track(
      Promise.resolve()
        .then(() => this.recoveryHandler(recovery))
        .catch((error: unknown) => {
          console.error("Could not reconcile audio device recovery", error)
        })
    )
  }

  dispatchPluginFailure(failure: PluginRuntimeFailure): void {
    this.track(
      Promise.resolve()
        .then(() => this.pluginFailureHandler(failure))
        .catch((error: unknown) => {
          console.error("Could not reconcile an audio plug-in failure", error)
        })
    )
  }

  resetHelper(): void {
    this.araSequences.clear()
  }

  async settle(): Promise<void> {
    await Promise.allSettled([...this.pending])
    this.araSequences.clear()
  }

  private track(pending: Promise<void>): void {
    this.pending.add(pending)
    void pending.finally(() => this.pending.delete(pending))
  }
}
