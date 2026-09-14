import { randomUUID } from "node:crypto"
import { IPC_CHANNELS, rpcFailure, rpcSuccess } from "@heron/contracts"
import type {
  LowLatencyModeConfiguration,
  ResourceRef,
  RpcError,
  RpcRequestMeta,
  RpcResult
} from "@heron/contracts"
import type { IpcHandlerContext } from "./context"
import { exclusiveOfflineOperationFailure } from "./operation-guard"
import { registerRpcHandler } from "./rpc"

function sameRef(left: ResourceRef | undefined, right: ResourceRef | null): boolean {
  return Boolean(
    right &&
    left?.kind === right.kind &&
    left.id === right.id &&
    left.epoch === right.epoch &&
    left.generation === right.generation
  )
}

function failure(
  meta: RpcRequestMeta,
  kind: "validation" | "stale" | "conflict",
  actual = 0
): RpcError {
  if (kind === "conflict") {
    return {
      code: "revision-conflict",
      category: "conflict",
      outcome: "not-committed",
      retry: "after-reconcile",
      correlationId: randomUUID(),
      userMessageKey: "errors.revisionConflict",
      ...(meta.target ? { resource: meta.target } : {}),
      details: {
        type: "revision-conflict",
        expectedRevision: meta.expectedRevision ?? -1,
        actualRevision: actual
      }
    }
  }
  if (kind === "stale") {
    return {
      code: "stale-resource",
      category: "stale-resource",
      outcome: "not-committed",
      retry: "after-reconcile",
      correlationId: randomUUID(),
      userMessageKey: "errors.staleResource",
      ...(meta.target ? { resource: meta.target } : {}),
      details: { type: "stale-resource", reason: "generation-mismatch" }
    }
  }
  return {
    code: "validation-failed",
    category: "validation",
    outcome: "not-committed",
    retry: "never",
    correlationId: randomUUID(),
    userMessageKey: "errors.lowLatencyModeUnavailable",
    ...(meta.target ? { resource: meta.target } : {}),
    details: { type: "validation-failed", field: "lowLatencyMode" }
  }
}

function busy(meta: RpcRequestMeta, activeOperationId: string): RpcError {
  return {
    code: "resource-busy",
    category: "busy",
    outcome: "not-committed",
    retry: "safe",
    correlationId: randomUUID(),
    userMessageKey: "errors.resourceBusy",
    ...(meta.target ? { resource: meta.target } : {}),
    details: { type: "resource-busy", activeOperationId }
  }
}

function unknownOutcome(meta: RpcRequestMeta): RpcError {
  return {
    code: "operation-timeout-unknown",
    category: "timeout-unknown",
    outcome: "unknown",
    retry: "after-reconcile",
    correlationId: randomUUID(),
    userMessageKey: "errors.operationOutcomeUnknown",
    ...(meta.target ? { resource: meta.target } : {}),
    details: { type: "operation-timeout-unknown", dispatched: true }
  }
}

function valid(value: unknown): value is LowLatencyModeConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const input = value as LowLatencyModeConfiguration
  return (
    (input.enabled === undefined || typeof input.enabled === "boolean") &&
    (input.targetOutputChannelId === undefined ||
      (typeof input.targetOutputChannelId === "string" && Boolean(input.targetOutputChannelId))) &&
    (input.pluginBudgetMs === undefined ||
      (Number.isInteger(input.pluginBudgetMs) &&
        input.pluginBudgetMs >= 0 &&
        input.pluginBudgetMs <= 50))
  )
}

function rebind(meta: RpcRequestMeta, result: RpcResult<unknown>): RpcResult<unknown> {
  return { ...structuredClone(result), requestId: meta.requestId }
}

export function registerLowLatencyHandlers(context: IpcHandlerContext): void {
  registerRpcHandler(IPC_CHANNELS.lowLatencyModeSnapshot, async ({ meta }) => {
    const release = context.lifecycle.admitProjectWork()
    if (!release) return rpcFailure(meta, failure(meta, "stale"))
    try {
      const engine = context.lifecycle.applicationState.audioResourceSnapshot().engine
      if (!sameRef(meta.target, engine)) return rpcFailure(meta, failure(meta, "stale"))
      const resolved = context.lifecycle.applicationState.resources.resolve(engine!)
      if (!resolved.ok) return rpcFailure(meta, failure(meta, "stale"))
      return rpcSuccess(meta, await context.projectGraph.lowLatencySnapshot(), {
        resourceRevision: resolved.value.revision
      })
    } finally {
      release()
    }
  })

  registerRpcHandler(IPC_CHANNELS.lowLatencyModeConfigure, async ({ meta }, value: unknown) => {
    if (meta.mutation && meta.target) {
      const existing = context.operations.registry.find({ ...meta.mutation, target: meta.target })
      if (!existing.ok) return rpcFailure(meta, failure(meta, "validation"))
      if (existing.value) {
        return existing.value.result
          ? rebind(meta, existing.value.result)
          : rpcFailure(meta, busy(meta, existing.value.operationId))
      }
    }
    if (!meta.mutation || meta.expectedRevision === undefined || !valid(value)) {
      return rpcFailure(meta, failure(meta, "validation"))
    }
    const mutation = meta.mutation
    const expectedRevision = meta.expectedRevision
    const configuration = value

    const release = context.lifecycle.admitProjectWork()
    if (!release) return rpcFailure(meta, failure(meta, "stale"))
    try {
      const exclusive = exclusiveOfflineOperationFailure(context, meta)
      if (exclusive) return exclusive
      const state = context.lifecycle.applicationState
      const engine = state.audioResourceSnapshot().engine
      if (!sameRef(meta.target, engine)) return rpcFailure(meta, failure(meta, "stale"))
      const resolved = state.resources.resolve(engine!)
      if (!resolved.ok) return rpcFailure(meta, failure(meta, "stale"))
      const begun = context.operations.registry.begin({
        operationId: mutation.operationId,
        idempotencyKey: mutation.idempotencyKey,
        target: engine!
      })
      if (!begun.ok) return rpcFailure(meta, failure(meta, "validation"))
      if (begun.value.disposition !== "started") {
        return begun.value.operation.result
          ? rebind(meta, begun.value.operation.result)
          : rpcFailure(meta, busy(meta, begun.value.operation.operationId))
      }
      try {
        return await context.projectGraph.configureLowLatencyModeTransaction(async (configure) => {
          const currentEngine = state.audioResourceSnapshot().engine
          if (!sameRef(meta.target, currentEngine)) {
            const result = rpcFailure(meta, failure(meta, "stale"))
            context.operations.registry.finish(mutation.operationId, "not-committed", result)
            return result
          }
          const current = state.resources.resolve(currentEngine!)
          if (!current.ok) {
            const result = rpcFailure(meta, failure(meta, "stale"))
            context.operations.registry.finish(mutation.operationId, "not-committed", result)
            return result
          }
          if (current.value.revision !== expectedRevision) {
            const result = rpcFailure(meta, failure(meta, "conflict", current.value.revision))
            context.operations.registry.finish(mutation.operationId, "not-committed", result)
            return result
          }
          if ((await context.transport.snapshot()).state !== "stopped") {
            const result = rpcFailure(meta, failure(meta, "validation"))
            context.operations.registry.finish(mutation.operationId, "not-committed", result)
            return result
          }
          const snapshot = await configure(configuration)
          const revision = state.advanceAudioEngine(expectedRevision, {
            lowLatencyMode: snapshot
          })
          const result = rpcSuccess(meta, snapshot, { resourceRevision: revision })
          context.operations.registry.finish(mutation.operationId, "committed", result)
          return result
        })
      } catch (error) {
        const validation = error instanceof TypeError
        const result = rpcFailure(
          meta,
          validation ? failure(meta, "validation") : unknownOutcome(meta)
        )
        context.operations.registry.finish(
          mutation.operationId,
          validation ? "not-committed" : "quarantined",
          result
        )
        return result
      }
    } finally {
      release()
    }
  })
}
