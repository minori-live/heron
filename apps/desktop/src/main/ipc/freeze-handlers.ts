import { randomUUID } from "node:crypto"
import { unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { IPC_CHANNELS, IPC_PROTOCOL_VERSION, rpcFailure } from "@heron/contracts"
import type {
  AudioRuntimeSnapshot,
  ProjectCommand,
  RpcError,
  RpcRequestMeta,
  TrackFreezeRequest,
  TransportSnapshot
} from "@heron/contracts"
import type { AudioHostTrackFreezeStatus } from "../audio-host"
import { publishExternalProjectCommand } from "../app/audio-host-application-events"
import {
  trackFreezeContentRange,
  trackFreezeFingerprint,
  trackFreezeMode
} from "@heron/project-model"
import type { IpcHandlerContext } from "./context"
import { registerRpcHandler } from "./rpc"
import { validateMutationTarget, validationFailure } from "./resource-validation"
import { t } from "../settings"

function operationFailure(meta: RpcRequestMeta): RpcError {
  return {
    code: "resource-unavailable",
    category: "unavailable",
    outcome: "not-committed",
    retry: "safe",
    correlationId: `freeze-${meta.requestId}`,
    userMessageKey: "errors.operationFailed",
    ...(meta.target ? { resource: meta.target } : {}),
    details: { type: "resource-unavailable", component: "audio-host", dispatched: true }
  }
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

function readRequest(value: unknown): TrackFreezeRequest | null {
  if (!value || typeof value !== "object") return null
  const trackId = (value as { trackId?: unknown }).trackId
  return typeof trackId === "string" && trackId.length > 0 ? { trackId } : null
}

export function registerFreezeHandlers(context: IpcHandlerContext): void {
  const {
    lifecycle,
    operations,
    audioHost,
    projectGraph,
    projectCommands,
    transport,
    audioImport,
    synchronizePluginStates
  } = context
  let activeOperationId: string | null = null

  registerRpcHandler(IPC_CHANNELS.trackFreezeStart, async ({ meta }, value: unknown) => {
    const workspace = lifecycle.applicationState.workspaceSnapshot()
    if (!workspace) return validationFailure(meta, "target")
    const invalidTarget = validateMutationTarget(meta, workspace.projectGraph, workspace.revision)
    if (invalidTarget) return invalidTarget
    const request = readRequest(value)
    if (!request) return validationFailure(meta, "request")
    const track = workspace.graph.tracks.find((candidate) => candidate.id === request.trackId)
    const channel = track
      ? workspace.graph.channels.find((candidate) => candidate.id === track.channelId)
      : undefined
    if (!track || !channel || channel.systemRole !== null) return validationFailure(meta, "trackId")
    if (!trackFreezeContentRange(workspace.graph, track.id)) {
      return validationFailure(meta, "trackId")
    }
    if (activeOperationId || operations.activeCount > 0) {
      return rpcFailure(meta, {
        code: "resource-busy",
        category: "busy",
        outcome: "not-committed",
        retry: "safe",
        correlationId: randomUUID(),
        userMessageKey: "errors.resourceBusy",
        resource: workspace.projectGraph,
        details: { type: "resource-busy", ...(activeOperationId ? { activeOperationId } : {}) }
      })
    }
    const operationId = meta.mutation!.operationId
    try {
      lifecycle.beginExclusiveOfflineOperation(operationId)
    } catch {
      return validationFailure(meta, "operation")
    }
    const begun = operations.registry.begin({
      operationId,
      idempotencyKey: meta.mutation!.idempotencyKey,
      target: workspace.projectGraph,
      cancellable: true
    })
    if (!begun.ok || begun.value.disposition !== "started") {
      lifecycle.endExclusiveOfflineOperation(operationId)
      return validationFailure(meta, "operation")
    }
    activeOperationId = operationId
    const outputPath = path.join(tmpdir(), `heron-freeze-${operationId}.wav`)
    operations.upsert(
      {
        id: operationId,
        title: t("operation.freezingTrack", { name: channel.name }),
        description: channel.name,
        phase: "preparing-bounce",
        state: "running",
        completedUnits: 0,
        totalUnits: null,
        cancellable: true,
        error: null,
        dropoutFrames: 0
      },
      true
    )
    let cancelRequested = false
    operations.setCancelHandler(operationId, async () => {
      cancelRequested = true
      try {
        const current = await audioHost.trackFreezeStatus(operationId)
        if (current.state === "running") await audioHost.cancelTrackFreeze(operationId)
      } catch {
        // The commit below still honors cancellation when the render already finished.
      }
    })

    void (async () => {
      let transportBefore: TransportSnapshot | null = null
      let audioBefore: AudioRuntimeSnapshot | null = null
      let restored = false
      let importedAssetId: string | null = null
      const restoreTransport = async (): Promise<void> => {
        if (!transportBefore || audioBefore?.state !== "running") return
        await transport.command({
          type: "set-loop",
          enabled: transportBefore.loopEnabled,
          range: transportBefore.loopRange
        })
        await transport.command({ type: "seek", positionFrames: transportBefore.positionFrames })
      }
      try {
        audioBefore = await audioHost.audioEngineSnapshot()
        transportBefore =
          audioBefore.state === "running"
            ? await transport.snapshot()
            : {
                state: "stopped",
                positionFrames: 0,
                sampleRate: workspace.graph.sampleRate,
                loopEnabled: false,
                loopRange: null
              }
        operations.patch(operationId, { phase: "synchronizing-plugin-state" }, true)
        await synchronizePluginStates()
        const synced = await projectGraph.snapshot()
        const syncedTrack = synced.tracks.find((candidate) => candidate.id === track.id)
        const syncedRange = syncedTrack ? trackFreezeContentRange(synced, syncedTrack.id) : null
        if (!syncedTrack || !syncedRange) throw new Error("track freeze source is unavailable")
        const mode = trackFreezeMode(syncedTrack)
        const fingerprint = trackFreezeFingerprint(synced, syncedTrack.id, mode)
        const renderGraph = await projectGraph.compileTrackFreezeSource(synced, syncedTrack.id)
        audioHost.refreshDesiredProjectGraph(synced)
        operations.patch(operationId, { phase: "stopping-playback" }, true)
        if (transportBefore.state !== "stopped") await transport.command({ type: "pause" })
        if (audioBefore.state === "running") await audioHost.stopAudioEngine()
        await audioHost.prepareOfflineBounce()
        await audioHost.startTrackFreeze(
          {
            operation_id: operationId,
            channel_id: channel.id,
            mode,
            start_frame: syncedRange.startFrame,
            end_frame: syncedRange.endFrame,
            output_path: outputPath
          },
          renderGraph
        )
        let status: AudioHostTrackFreezeStatus
        do {
          await delay(50)
          status = await audioHost.trackFreezeStatus(operationId)
          operations.patch(operationId, {
            phase: status.phase === "rendering" ? "rendering-offline" : "preparing-bounce",
            completedUnits: status.total_units > 0 ? status.completed_units : null,
            totalUnits: status.total_units > 0 ? status.total_units : null
          })
        } while (status.state === "running")
        operations.patch(
          operationId,
          { phase: "restoring-audio", completedUnits: null, totalUnits: null },
          true
        )
        await audioHost.restartAfterOfflineBounce(audioBefore.state === "running")
        restored = true
        await restoreTransport()
        if (status.state !== "completed" || cancelRequested) {
          throw new Error(status.error ?? "track freeze cancelled")
        }
        operations.setCancelHandler(operationId, null)
        const imported = await audioImport.import([outputPath], `${operationId}:import`)
        importedAssetId = imported.selectedAssetIds[0] ?? null
        if (!importedAssetId) throw new Error("track freeze asset was not imported")
        const current = projectCommands.currentWorkspace()
        if (!current) throw new Error("project is unavailable")
        const command: ProjectCommand = {
          type: "set-track-freeze",
          trackId: track.id,
          freeze: {
            mode,
            status: "frozen",
            assetId: importedAssetId,
            fingerprint,
            startFrame: syncedRange.startFrame,
            lengthFrames: Math.max(
              1,
              status.rendered_frames ?? syncedRange.endFrame - syncedRange.startFrame
            ),
            latencySamples: status.latency_samples ?? 0,
            tailFrames: status.tail_frames ?? 0,
            sampleRate: current.graph.sampleRate
          }
        }
        const commitId = `track-freeze-commit:${operationId}`
        const committed = await projectCommands.execute(
          {
            protocolVersion: IPC_PROTOCOL_VERSION,
            requestId: commitId,
            target: structuredClone(current.projectGraph),
            expectedRevision: current.revision,
            mutation: { operationId: commitId, idempotencyKey: commitId }
          },
          command
        )
        if (!committed.ok) throw new Error(committed.error.userMessageKey)
        publishExternalProjectCommand(
          committed.value,
          committed.resourceRevision ?? current.revision + 1
        )
        operations.patch(
          operationId,
          {
            state: "completed",
            description: status.tail_truncated
              ? `${channel.name} · ${t("operation.tailTruncated")}`
              : channel.name,
            completedUnits: 1,
            totalUnits: 1,
            cancellable: false
          },
          true
        )
      } catch (error) {
        if (importedAssetId) {
          await context.projects.deleteAssets([importedAssetId]).catch(() => undefined)
        }
        if (!restored && transportBefore && audioBefore) {
          try {
            await audioHost.restartAfterOfflineBounce(audioBefore.state === "running")
            restored = true
          } catch {
            operations.patch(operationId, { state: "failed", error: operationFailure(meta) }, true)
            return
          }
        }
        if (restored) {
          try {
            await restoreTransport()
          } catch {
            operations.patch(operationId, { state: "failed", error: operationFailure(meta) }, true)
            return
          }
        }
        const cancelled = String(error).includes("cancel") || cancelRequested
        operations.patch(
          operationId,
          {
            state: cancelled ? "cancelled" : "failed",
            error: cancelled ? null : operationFailure(meta)
          },
          true
        )
      } finally {
        activeOperationId = null
        lifecycle.endExclusiveOfflineOperation(operationId)
        await unlink(outputPath).catch(() => undefined)
      }
    })()

    return { operationId }
  })
}
