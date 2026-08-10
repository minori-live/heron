import { randomUUID } from "node:crypto"
import type {
  AudioDeviceRecoveryRecordingStatus,
  AudioDeviceRecoverySnapshot,
  AudioEngineSessionSnapshot,
  AudioPreferences,
  RpcError,
  TransportSnapshot
} from "@heron/contracts"
import type { AudioHostService, NativeAudioDeviceRecoverySnapshot } from "../audio-host"
import type { TransportService } from "../audio"
import type { LifecycleCoordinator } from "../kernel"
import type { ProjectGraphService } from "../project"
import type { RecordingService } from "../recording"
import { normalizeAudioRuntime } from "../ipc"

function recoveryFailure(): RpcError {
  return {
    code: "resource-unavailable",
    category: "unavailable",
    outcome: "not-committed",
    retry: "safe",
    correlationId: randomUUID(),
    userMessageKey: "errors.audioDeviceRecoveryFailed",
    details: { type: "resource-unavailable", component: "audio-host", dispatched: true }
  }
}

export class AudioDeviceRecoveryCoordinator {
  private tail: Promise<void> = Promise.resolve()
  private native: NativeAudioDeviceRecoverySnapshot | null = null
  private transportIntent: TransportSnapshot | null = null
  private recordingStatus: AudioDeviceRecoveryRecordingStatus = "not-active"
  private failure: RpcError | null = null
  private localDecision = 0

  constructor(
    private readonly audioHost: AudioHostService,
    private readonly lifecycle: LifecycleCoordinator,
    private readonly recordings: RecordingService,
    private readonly projectGraph: ProjectGraphService,
    private readonly transport: TransportService
  ) {
    this.audioHost.setDeviceRecoveryHandler((recovery) => this.handleNativeChange(recovery))
  }

  dispose(): void {
    this.audioHost.setDeviceRecoveryHandler(() => {})
  }

  handleNativeChange(recovery: NativeAudioDeviceRecoverySnapshot | null): void {
    void this.enqueue(async () => this.reconcileNative(recovery))
  }

  async initialize(): Promise<void> {
    const current = await this.audioHost.deviceRecoverySnapshot()
    await this.enqueue(async () => this.reconcileNative(current.recovery))
  }

  select(preferences: AudioPreferences): Promise<AudioEngineSessionSnapshot> {
    return this.enqueue(async () => {
      const native = this.requireNative()
      const decision = ++this.localDecision
      this.failure = null
      this.publish({ ...native, phase: "applying-selection" })
      try {
        const result = await this.audioHost.selectDeviceRecovery(native.recoveryId, preferences)
        if (decision !== this.localDecision || !result.runtime) {
          throw new Error("device recovery selection was superseded")
        }
        const runtime = normalizeAudioRuntime(result.runtime)
        const resources = await this.lifecycle.applicationState.commitAudioEngine(runtime)
        if (decision !== this.localDecision) throw new Error("device recovery was superseded")
        await this.restoreProjectAndTransport(decision)
        await this.lifecycle.applicationState.dropAudioDeviceRecovery()
        this.native = null
        this.lifecycle.completeAudio(runtime)
        return {
          ...this.lifecycle.applicationState.audioResourceSnapshot(),
          engine: resources.engine!,
          transport: resources.transport!,
          runtime
        }
      } catch (error) {
        this.failure = recoveryFailure()
        this.publish({ ...native, phase: "selection-failed" })
        throw error
      }
    })
  }

  keepRestored(): Promise<null> {
    return this.enqueue(async () => {
      const native = this.requireNative()
      if (native.phase !== "original-restored") {
        throw new Error("the original audio device has not been restored")
      }
      ++this.localDecision
      const result = await this.audioHost.keepRestoredDevice(native.recoveryId)
      const runtime = normalizeAudioRuntime(
        result.runtime ?? (await this.audioHost.audioEngineSnapshot())
      )
      await this.lifecycle.applicationState.dropAudioDeviceRecovery()
      this.native = null
      this.lifecycle.completeAudio(runtime)
      return null
    })
  }

  private async reconcileNative(recovery: NativeAudioDeviceRecoverySnapshot | null): Promise<void> {
    if (!recovery) {
      const state = this.lifecycle.applicationState
      if (!this.native && !state.currentAudioDeviceRecovery()) {
        return
      }
      const lifecycle = this.lifecycle.snapshot().audio
      this.native = null
      this.transportIntent = null
      ++this.localDecision
      await state.dropAudioDeviceRecovery()
      let runtime = lifecycle.runtime
      try {
        runtime = normalizeAudioRuntime(await this.audioHost.audioEngineSnapshot())
      } catch {
        // A host-side cancellation can race shutdown. The last canonical runtime
        // still provides a deterministic lifecycle projection in that case.
      }
      this.lifecycle.completeAudio(runtime)
      return
    }
    if (!this.native || this.native.recoveryId !== recovery.recoveryId) {
      this.transportIntent = this.audioHost.deviceRecoveryTransportIntent()
      this.recordingStatus = this.recordings.current ? "finalizing" : "not-active"
      this.failure = null
      this.native = recovery
      this.publish(recovery)
      if (this.recordings.current) await this.finalizeRecording(recovery.recoveryId)
      const authorized = await this.audioHost.authorizeDeviceRecovery(recovery.recoveryId)
      this.native = authorized
      this.publish(authorized)
      return
    }
    if (recovery.revision < this.native.revision) return
    this.native = recovery
    this.publish(recovery)
    if (recovery.phase === "original-restored") {
      const decision = this.localDecision
      const runtime = normalizeAudioRuntime(await this.audioHost.audioEngineSnapshot())
      await this.restoreProjectAndTransport(decision)
      if (decision === this.localDecision && this.native?.recoveryId === recovery.recoveryId) {
        this.lifecycle.updateAudioDeviceRecovery(this.currentSnapshot(), runtime)
      }
    }
  }

  private async finalizeRecording(recoveryId: number): Promise<void> {
    try {
      const session = this.lifecycle.beginRecordingStop()
      await this.recordings.stop(() => this.lifecycle.markRecordingFinalizing(session))
      this.lifecycle.completeRecordingStop()
      this.recordingStatus = "saved"
    } catch {
      this.lifecycle.failRecordingStop("errors.recordingFinalizationFailed")
      this.recordingStatus = "recoverable"
    }
    if (this.native?.recoveryId === recoveryId) this.publish(this.native)
  }

  private publish(native: NativeAudioDeviceRecoverySnapshot): void {
    this.native = native
    const state = this.lifecycle.applicationState
    const snapshot = state.currentAudioDeviceRecovery()
      ? state.updateAudioDeviceRecovery(this.snapshot(native))
      : state.beginAudioDeviceRecovery(this.snapshot(native))
    this.lifecycle.updateAudioDeviceRecovery(snapshot)
  }

  private snapshot(
    native: NativeAudioDeviceRecoverySnapshot
  ): Omit<AudioDeviceRecoverySnapshot, "recovery"> {
    return {
      decisionRevision: native.revision,
      attemptGeneration: native.attemptGeneration,
      phase:
        this.recordingStatus === "finalizing"
          ? "finalizing-recording"
          : native.phase === "waiting-for-authorization"
            ? "waiting-for-change"
            : native.phase,
      previousPreferences: structuredClone(native.originalPreferences),
      candidates: structuredClone(native.candidates),
      candidateRevision: native.candidateRevision,
      lostDirections: [...native.lostDirections],
      fault: native.fault,
      recordingStatus: this.recordingStatus,
      failure: this.failure ? structuredClone(this.failure) : null
    }
  }

  private currentSnapshot(): AudioDeviceRecoverySnapshot {
    const state = this.lifecycle.snapshot().audio
    if (state.status !== "recovering") throw new Error("audio device recovery is unavailable")
    return state.recovery
  }

  private requireNative(): NativeAudioDeviceRecoverySnapshot {
    if (!this.native) throw new Error("audio device recovery is unavailable")
    return structuredClone(this.native)
  }

  private async restoreProjectAndTransport(decision: number): Promise<void> {
    try {
      await this.projectGraph.load()
    } catch (error) {
      console.error("Could not republish the project graph after device recovery", error)
    }
    if (decision !== this.localDecision) return
    const intent = this.transportIntent
    if (!intent) return
    try {
      await this.transport.command({
        type: "set-loop",
        enabled: intent.loopEnabled,
        range: intent.loopRange ? { ...intent.loopRange } : null
      })
      if (decision !== this.localDecision) return
      await this.transport.command({ type: "seek", positionFrames: intent.positionFrames })
      if (decision !== this.localDecision) return
      if (intent.state === "playing" || intent.state === "waiting") {
        await this.transport.command({ type: "play" })
      }
    } catch (error) {
      console.error("Could not restore transport after device recovery", error)
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation)
    this.tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}
