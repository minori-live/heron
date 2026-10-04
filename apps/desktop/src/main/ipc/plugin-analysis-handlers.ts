import { IPC_CHANNELS, validPluginAnalysisSettings, rpcFailure } from "@heron/contracts"
import { randomUUID } from "node:crypto"
import type { PluginAnalysisCommand } from "@heron/contracts"
import type { IpcHandlerContext } from "./context"
import { registerRpcHandler } from "./rpc"
import {
  validateMutationTarget,
  validateReadTarget,
  validationFailure
} from "./resource-validation"
import { PluginAnalysisWindow } from "../plugin-analysis/plugin-analysis-window"

function isCommand(value: unknown): value is PluginAnalysisCommand {
  if (!value || typeof value !== "object") return false
  const v = value as PluginAnalysisCommand
  switch (v.type) {
    case "insert":
      return (
        typeof v.pluginKey === "string" &&
        (v.chain === undefined || v.chain === 0 || v.chain === 1) &&
        ["mono", "mono-to-stereo", "stereo", "dual-mono"].includes(v.audioMode) &&
        Number.isSafeInteger(v.slotOrder) &&
        v.slotOrder >= 0 &&
        v.slotOrder <= 16
      )
    case "remove":
    case "editor":
      return typeof v.instanceId === "string"
    case "move":
      return (
        typeof v.instanceId === "string" &&
        Number.isSafeInteger(v.slotOrder) &&
        v.slotOrder >= 0 &&
        v.slotOrder <= 16
      )
    case "toggle":
      return typeof v.instanceId === "string" && typeof v.enabled === "boolean"
    case "configure":
      return validPluginAnalysisSettings(v.settings)
    case "comparison":
    case "repeat":
    case "automatic":
      return typeof v.enabled === "boolean"
    case "analyze":
    case "refresh-catalog":
    case "cancel":
      return true
    case "window":
      return ["minimize", "maximize", "close"].includes(v.action)
    default:
      return false
  }
}

export function registerPluginAnalysisHandlers(context: IpcHandlerContext): () => void {
  const pluginAnalysis = new PluginAnalysisWindow(context)
  let opening: Promise<boolean> | null = null
  let commands: Promise<void> = Promise.resolve()
  registerRpcHandler(IPC_CHANNELS.pluginAnalysisOpen, async ({ meta }) => {
    const invalid = validateMutationTarget(meta, context.lifecycle.applicationState.desktopSession)
    if (invalid) return invalid
    if (!opening)
      opening = pluginAnalysis
        .open()
        .catch(() => false)
        .finally(() => {
          opening = null
        })
    if (!(await opening))
      return rpcFailure(meta, {
        code: "resource-unavailable",
        category: "unavailable",
        outcome: "not-committed",
        retry: "safe",
        correlationId: randomUUID(),
        userMessageKey: "errors.audioEngineUnavailable",
        details: { type: "resource-unavailable", component: "main", dispatched: false }
      })
  })
  const authenticate = pluginAnalysis.authenticate.bind(pluginAnalysis)
  registerRpcHandler(
    IPC_CHANNELS.pluginAnalysisSnapshot,
    ({ meta }, acknowledge?: unknown, knownReportId?: unknown) => {
      const service = pluginAnalysis.service!
      if (meta.target) {
        const invalid = validateReadTarget(meta, service.ref)
        if (invalid) return invalid
      } else if (meta.mutation) return validationFailure(meta, "mutation")
      if (acknowledge !== undefined && (typeof acknowledge !== "string" || !meta.target))
        return validationFailure(meta, "acknowledge")
      if (knownReportId !== undefined && typeof knownReportId !== "string")
        return validationFailure(meta, "knownReportId")
      if (acknowledge !== undefined) service.acknowledge(acknowledge)
      return service.snapshot(knownReportId)
    },
    { authenticate }
  )
  registerRpcHandler(
    IPC_CHANNELS.pluginAnalysisCommand,
    ({ meta }, value: unknown) => {
      if (!isCommand(value)) return validationFailure(meta, "command")
      const result = commands.then(async () => {
        const service = pluginAnalysis.service
        if (!service) return validationFailure(meta, "closed-session")
        const snapshot = service.snapshot()
        const repeated =
          meta.mutation &&
          service.hasReceipt(meta.mutation.operationId, value, meta.mutation.idempotencyKey)
        if (meta.mutation && service.hasOperation(meta.mutation.operationId) && !repeated)
          return validationFailure(meta, "operation-id")
        if (meta.mutation && service.hasIdempotencyKey(meta.mutation.idempotencyKey) && !repeated)
          return validationFailure(meta, "idempotency-key")
        if (!repeated && !service.receiptCapacityAvailable)
          return validationFailure(meta, "receipt-capacity")
        const invalid = validateMutationTarget(
          meta,
          snapshot.ref,
          repeated ? undefined : snapshot.revision
        )
        if (invalid) return invalid
        const result = await service.command(
          value,
          meta.mutation!.operationId,
          meta.mutation!.idempotencyKey
        )
        if (value.type === "window" && !repeated) {
          if (value.action === "minimize") pluginAnalysis.window?.minimize()
          else if (value.action === "maximize") {
            if (pluginAnalysis.window?.isMaximized()) pluginAnalysis.window.unmaximize()
            else pluginAnalysis.window?.maximize()
          } else void pluginAnalysis.close()
        }
        return result
      })
      commands = result.then(
        () => {},
        () => {}
      )
      return result
    },
    { authenticate }
  )
  return () => pluginAnalysis.dispose()
}
