import { randomUUID } from "node:crypto"
import { rpcFailure } from "@heron/contracts"
import type {
  AudioPreferences,
  AudioRuntimeSnapshot,
  MixerGraphSnapshot,
  ProjectGraphRef,
  RpcRequestMeta,
  RpcResult,
  TransportCommand,
  TransportSnapshot
} from "@heron/contracts"
import type {
  AudioHostGraphTransactions,
  PreparedGraphDeployment
} from "./audio-host-graph-transactions"
import type { AudioHostGraph, GraphDeploymentSnapshot, GraphTransactionValue } from "./wire"

interface Dependencies {
  transactions: AudioHostGraphTransactions
  epoch(): string | null
  audioSnapshot(): Promise<AudioRuntimeSnapshot>
  preferences(): AudioPreferences | null
  startAudio(preferences: AudioPreferences, rate: number): Promise<AudioRuntimeSnapshot>
  transportSnapshot(): Promise<TransportSnapshot>
  transport(command: TransportCommand): Promise<TransportSnapshot>
  invalidatePublication(): void
  waitForPublication(revision: number): Promise<void>
  commit(deployment: PreparedGraphDeployment): Promise<void>
}

interface Transition {
  preferences: AudioPreferences
  previous: TransportSnapshot
  sampleRate: number
  snapshot: GraphDeploymentSnapshot
  restartAttempted: boolean
}

interface Reservation {
  epoch: string | null
  meta: RpcRequestMeta
  projectGraph: ProjectGraphRef
  graphRevision: number
  preparation?: Promise<RpcResult<PreparedGraphDeployment>>
  deployment?: PreparedGraphDeployment
  transition?: Transition
  action?: Promise<RpcResult<GraphTransactionValue>>
  committed: boolean
  preparing: boolean
  prepared: boolean
  stop?: Promise<AudioRuntimeSnapshot>
}

/** Own the session rate for the entire prepare/activate/abort lifetime. */
export class AudioHostGraphSession {
  private active: Reservation | null = null
  private readonly activated = new WeakMap<
    PreparedGraphDeployment,
    RpcResult<GraphTransactionValue>
  >()

  constructor(private readonly dependencies: Dependencies) {}

  reset(): void {
    this.active = null
  }

  stopAudio(stop: () => Promise<AudioRuntimeSnapshot>): Promise<AudioRuntimeSnapshot> {
    const pending = stop()
    if (this.active) this.active.stop = pending
    return pending
  }

  acceptsCommit(deployment: PreparedGraphDeployment): boolean {
    return this.owner(deployment) !== null
  }

  prepare(
    meta: RpcRequestMeta,
    projectGraph: ProjectGraphRef,
    graphRevision: number,
    project: MixerGraphSnapshot,
    runtime: AudioHostGraph
  ): Promise<RpcResult<PreparedGraphDeployment>> {
    if (this.active) {
      if (this.matches(this.active, meta, projectGraph, graphRevision) && this.active.preparation) {
        return this.active.preparation
      }
      return Promise.resolve(this.busy(meta, projectGraph))
    }
    // Reserve before the first await: a competing preparation must not restart
    // the streams underneath a native candidate which already owns its rate.
    const reservation: Reservation = {
      epoch: this.dependencies.epoch(),
      meta,
      projectGraph,
      graphRevision,
      committed: false,
      preparing: true,
      prepared: false
    }
    this.active = reservation
    reservation.preparation = this.prepareOwned(reservation, project, runtime)
    return reservation.preparation
  }

  private async prepareOwned(
    owner: Reservation,
    project: MixerGraphSnapshot,
    runtime: AudioHostGraph
  ): Promise<RpcResult<PreparedGraphDeployment>> {
    try {
      const snapshot = await this.dependencies.transactions.snapshot(owner.meta)
      this.assertCurrent(owner)
      if (!snapshot.ok) {
        this.release(owner)
        return snapshot
      }
      if (snapshot.value.snapshot.candidate) {
        const busy = this.busy(owner.meta, owner.projectGraph)
        this.release(owner)
        return busy
      }
      owner.deployment = {
        meta: {
          ...owner.meta,
          target: snapshot.value.snapshot.engine,
          expectedRevision: snapshot.value.snapshot.committedRevision
        },
        projectGraph: owner.projectGraph,
        baseRevision: snapshot.value.snapshot.committedRevision,
        graphRevision: owner.graphRevision,
        project: structuredClone(project),
        runtime: structuredClone(runtime)
      }
      await this.transition(owner, project.sampleRate, snapshot.value.snapshot)
      this.assertCurrent(owner)
      const result = await this.dependencies.transactions.prepare(
        owner.meta,
        owner.projectGraph,
        owner.graphRevision,
        project,
        runtime
      )
      this.assertCurrent(owner)
      if (result.ok) {
        owner.deployment = result.value
        owner.prepared = true
      } else if (result.error.outcome === "not-committed") {
        // Keep preparation ownership until recovery finishes so snapshot cannot
        // start a competing rollback while the previous streams are restarting.
        try {
          await this.rollback(owner)
        } catch (error) {
          return this.quarantined(owner, error)
        }
      }
      return result
    } catch (error) {
      // A thrown native request can have dispatched. Confirm/abort its candidate
      // before returning the streams to their previous rate.
      try {
        if (this.isCurrent(owner)) {
          if (owner.deployment) await this.rollback(owner)
          else this.release(owner)
        }
      } catch (rollbackError) {
        return this.quarantined(owner, rollbackError)
      }
      throw error
    } finally {
      owner.preparing = false
    }
  }

  activate(
    deployment: PreparedGraphDeployment,
    options: { cut?: boolean; isCurrent?: () => boolean } = {}
  ): Promise<RpcResult<GraphTransactionValue>> {
    if (deployment.meta.target?.epoch !== this.dependencies.epoch())
      return Promise.resolve(this.stale(deployment))
    const completed = this.activated.get(deployment)
    if (completed) return Promise.resolve(completed)
    const owner = this.owner(deployment)
    if (!owner) return Promise.resolve(this.stale(deployment))
    if (owner.action) return Promise.resolve(this.busy(deployment.meta, deployment.projectGraph))
    return this.runAction(owner, async () => {
      const result = await this.dependencies.transactions.activate(deployment, options)
      this.assertCurrent(owner)
      if (result.ok) {
        owner.committed = true
        await this.finishCommit(owner)
        this.activated.set(deployment, result)
      } else if (result.error.outcome === "not-committed") {
        await this.rollback(owner)
      }
      // Unknown/quarantined results retain the target rate and reservation.
      // Snapshot reconciliation or an explicit abort resolves that ownership.
      return result
    })
  }

  abort(deployment: PreparedGraphDeployment): Promise<RpcResult<GraphTransactionValue>> {
    if (deployment.meta.target?.epoch !== this.dependencies.epoch())
      return Promise.resolve(this.stale(deployment))
    const owner = this.owner(deployment)
    if (!owner) return this.dependencies.transactions.abort(deployment)
    if (owner.action) return Promise.resolve(this.busy(deployment.meta, deployment.projectGraph))
    return this.runAction(owner, async () => {
      const result = await this.dependencies.transactions.abort(deployment)
      this.assertCurrent(owner)
      if (result.ok) await this.rollback(owner)
      return result
    })
  }

  async snapshot(meta: RpcRequestMeta): Promise<RpcResult<GraphTransactionValue>> {
    const result = await this.dependencies.transactions.snapshot(meta)
    const owner = this.active
    if (
      !result.ok ||
      !owner?.deployment ||
      owner.preparing ||
      owner.action ||
      !this.isCurrent(owner)
    )
      return result
    const snapshot = result.value.snapshot
    if (!owner.prepared && snapshot.committedRevision === owner.deployment.baseRevision) {
      // Preparation never activates. Reconcile and abort an unknown candidate
      // even when its caller did not receive a prepared handle.
      return this.runAction(owner, async () => {
        await this.rollback(owner)
        return this.dependencies.transactions.snapshot(meta)
      })
    }
    const operation = snapshot.lastOperation
    if (operation?.operationId !== owner.meta.mutation?.operationId) return result
    if (operation?.outcome === "committed" && snapshot.observedRevision >= owner.graphRevision) {
      return this.runAction(owner, async () => {
        owner.committed = true
        await this.dependencies.commit(owner.deployment!)
        await this.finishCommit(owner)
        return result
      })
    }
    if (operation?.outcome === "not-committed" && !snapshot.candidate) {
      return this.runAction(owner, async () => {
        await this.rollback(owner)
        return result
      })
    }
    return result
  }

  private async transition(
    owner: Reservation,
    rate: number,
    snapshot: GraphDeploymentSnapshot
  ): Promise<void> {
    const audio = await this.dependencies.audioSnapshot()
    this.assertCurrent(owner)
    const stoppedBeforeTransition = this.pendingStop(owner)
    if (stoppedBeforeTransition) {
      await stoppedBeforeTransition
      return
    }
    if (audio.state !== "running" || audio.sampleRate === rate) return
    const preferences = this.dependencies.preferences()
    if (!preferences) throw new Error("Audio preferences are unavailable for a session-rate change")
    const previous = await this.dependencies.transportSnapshot()
    this.assertCurrent(owner)
    if (previous.state === "recording")
      throw new Error("Stop recording before changing the project sample rate")
    const previousRate = previous.sampleRate || audio.sampleRate
    if (!previousRate) throw new Error("Previous audio session rate is unavailable")
    const transition: Transition = {
      preferences,
      previous: { ...previous, sampleRate: previousRate },
      sampleRate: rate,
      snapshot,
      restartAttempted: false
    }
    owner.transition = transition
    if (previous.state === "playing") await this.dependencies.transport({ type: "pause" })
    this.assertCurrent(owner)
    const stoppedWhilePausing = this.pendingStop(owner)
    if (stoppedWhilePausing) {
      await stoppedWhilePausing
      return
    }
    transition.restartAttempted = true
    this.dependencies.invalidatePublication()
    const started = await this.dependencies.startAudio(preferences, rate)
    this.assertCurrent(owner)
    if (started.state !== "running" || started.sampleRate !== rate) {
      throw new Error("Audio engine did not adopt the project sample rate")
    }
  }

  private async rollback(owner: Reservation): Promise<void> {
    this.assertCurrent(owner)
    if (owner.committed) throw new Error("Cannot roll back a committed graph session")
    const result = await this.dependencies.transactions.snapshot(owner.meta)
    this.assertCurrent(owner)
    if (!result.ok) throw new Error(result.error.userMessageKey)
    const snapshot = result.value.snapshot
    if (
      snapshot.lastOperation?.operationId === owner.meta.mutation?.operationId &&
      snapshot.lastOperation?.outcome === "committed"
    ) {
      throw new Error("Graph activation committed before rollback")
    }
    if (snapshot.candidate) {
      if (snapshot.candidate.operationId !== owner.meta.mutation?.operationId) {
        throw new Error("Another operation owns the native graph candidate")
      }
      const aborted = await this.dependencies.transactions.abort(
        owner.deployment ?? {
          meta: {
            ...owner.meta,
            target: snapshot.engine,
            expectedRevision: snapshot.candidate.baseRevision
          },
          projectGraph: owner.projectGraph,
          baseRevision: snapshot.candidate.baseRevision
        }
      )
      this.assertCurrent(owner)
      if (!aborted.ok) throw new Error(aborted.error.userMessageKey)
    }
    const transition = owner.transition
    if (transition) {
      if (snapshot.committedRevision !== transition.snapshot.committedRevision) {
        throw new Error("Committed graph changed during a session-rate transition")
      }
      if (transition.restartAttempted) {
        if (owner.stop) await owner.stop
        else {
          const restored = await this.dependencies.startAudio(
            transition.preferences,
            transition.previous.sampleRate
          )
          this.assertCurrent(owner)
          if (
            restored.state !== "running" ||
            restored.sampleRate !== transition.previous.sampleRate
          ) {
            throw new Error("Audio engine did not restore the previous session rate")
          }
        }
        if (transition.snapshot.committedProjectGraph) {
          const restoredGraph = await this.dependencies.transactions.restoreCommitted(
            owner.meta,
            transition.snapshot
          )
          this.assertCurrent(owner)
          if (!restoredGraph.ok) throw new Error(restoredGraph.error.userMessageKey)
          if (!owner.stop)
            await this.dependencies.waitForPublication(transition.snapshot.committedRevision)
        }
      }
      if (!owner.stop) await this.restoreTransport(owner, transition.previous)
    }
    this.release(owner)
  }

  private async finishCommit(owner: Reservation): Promise<void> {
    const transition = owner.transition
    if (transition && !owner.stop) {
      await this.dependencies.waitForPublication(owner.graphRevision)
      this.assertCurrent(owner)
      await this.restoreTransport(owner, {
        ...transition.previous,
        sampleRate: transition.sampleRate,
        positionFrames: Math.max(
          0,
          Math.round(
            (transition.previous.positionFrames * transition.sampleRate) /
              transition.previous.sampleRate
          )
        )
      })
    }
    this.release(owner)
  }

  private async restoreTransport(owner: Reservation, transport: TransportSnapshot): Promise<void> {
    this.assertCurrent(owner)
    if (owner.stop) return
    await this.dependencies.transport({
      type: "set-loop",
      enabled: transport.loopEnabled,
      range: transport.loopRange
    })
    this.assertCurrent(owner)
    if (owner.stop) return
    await this.dependencies.transport({ type: "seek", positionFrames: transport.positionFrames })
    this.assertCurrent(owner)
    if (owner.stop) return
    if (transport.state === "playing") await this.dependencies.transport({ type: "play" })
  }

  private runAction(owner: Reservation, action: () => Promise<RpcResult<GraphTransactionValue>>) {
    const pending = action().catch((error: unknown) => this.quarantined(owner, error))
    owner.action = pending
    void pending.finally(() => {
      if (owner.action === pending) owner.action = undefined
    })
    return pending
  }

  private matches(
    owner: Reservation,
    meta: RpcRequestMeta,
    graph: ProjectGraphRef,
    revision: number
  ): boolean {
    return (
      owner.epoch === this.dependencies.epoch() &&
      owner.graphRevision === revision &&
      (owner.meta.mutation?.operationId ?? owner.meta.requestId) ===
        (meta.mutation?.operationId ?? meta.requestId) &&
      owner.meta.mutation?.idempotencyKey === meta.mutation?.idempotencyKey &&
      owner.projectGraph.id === graph.id &&
      owner.projectGraph.epoch === graph.epoch &&
      owner.projectGraph.generation === graph.generation
    )
  }

  private owner(deployment: PreparedGraphDeployment): Reservation | null {
    return this.active &&
      deployment.meta.target?.epoch === this.active.epoch &&
      this.matches(this.active, deployment.meta, deployment.projectGraph, deployment.graphRevision)
      ? this.active
      : null
  }

  private isCurrent(owner: Reservation): boolean {
    return this.active === owner && owner.epoch === this.dependencies.epoch()
  }

  private pendingStop(owner: Reservation): Promise<AudioRuntimeSnapshot> | undefined {
    // Another main-thread task may request a stop while a native call is awaited.
    return owner.stop
  }

  private assertCurrent(owner: Reservation): void {
    if (!this.isCurrent(owner)) throw new Error("Audio graph session belongs to a retired runtime")
  }

  private release(owner: Reservation): void {
    if (this.isCurrent(owner)) this.active = null
  }

  private busy(meta: RpcRequestMeta, resource: ProjectGraphRef) {
    return rpcFailure(meta, {
      code: "resource-busy",
      category: "busy",
      outcome: "not-committed",
      retry: "safe",
      correlationId: randomUUID(),
      userMessageKey: "errors.resourceBusy",
      resource,
      details: { type: "resource-busy", activeOperationId: this.active?.meta.mutation?.operationId }
    })
  }

  private stale(deployment: PreparedGraphDeployment) {
    return rpcFailure(deployment.meta, {
      code: "stale-resource",
      category: "stale-resource",
      outcome: "not-committed",
      retry: "after-reconcile",
      correlationId: randomUUID(),
      userMessageKey: "errors.audioEngineUnavailable",
      resource: deployment.projectGraph,
      details: { type: "stale-resource", reason: "epoch-mismatch" }
    })
  }

  private quarantined(owner: Reservation, error: unknown) {
    console.error("Could not reconcile audio graph session rate", {
      operationId: owner.meta.mutation?.operationId,
      error
    })
    return rpcFailure(owner.meta, {
      code: "invariant-violation",
      category: "invariant-violation",
      outcome: "quarantined",
      retry: "after-reconcile",
      correlationId: randomUUID(),
      userMessageKey: "errors.audioEngineUnavailable",
      resource: owner.projectGraph,
      details: { type: "invariant-violation", component: "audio-host" }
    })
  }
}
