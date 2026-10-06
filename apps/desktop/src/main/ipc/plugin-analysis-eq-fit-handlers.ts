import { IPC_CHANNELS } from "@heron/contracts"
import type { PluginAnalysisWindow } from "../plugin-analysis/plugin-analysis-window"
import {
  validEqFitSelectionRequest,
  validEqFitWindowCommand
} from "../plugin-analysis/plugin-analysis-eq-fit-window"
import { registerRpcHandler } from "./rpc"
import { validateReadTarget, validationFailure } from "./resource-validation"

export function registerPluginAnalysisEqFitHandlers(owner: PluginAnalysisWindow): void {
  registerRpcHandler(
    IPC_CHANNELS.pluginAnalysisEqFitSelection,
    ({ meta }, request: unknown) => {
      if (!validEqFitSelectionRequest(request)) return validationFailure(meta, "selection-request")
      return owner.eqFit.apply(meta, request)
    },
    { authenticate: owner.authenticate.bind(owner) }
  )

  const authenticate = owner.eqFit.authenticate.bind(owner.eqFit)
  registerRpcHandler(
    IPC_CHANNELS.pluginAnalysisEqFitSnapshot,
    ({ meta }, knownReportId?: unknown, acknowledge?: unknown) => {
      const service = owner.service!
      if (meta.target) {
        const invalid = validateReadTarget(meta, service.ref)
        if (invalid) return invalid
      } else if (meta.mutation) return validationFailure(meta, "mutation")
      if (knownReportId !== undefined && typeof knownReportId !== "string")
        return validationFailure(meta, "knownReportId")
      if (acknowledge !== undefined && (typeof acknowledge !== "string" || !meta.target))
        return validationFailure(meta, "acknowledge")
      if (acknowledge !== undefined) owner.eqFit.acknowledge(acknowledge)
      return owner.eqFit.snapshot(knownReportId)
    },
    { authenticate }
  )

  registerRpcHandler(
    IPC_CHANNELS.pluginAnalysisEqFitWindow,
    ({ meta }, command: unknown) => {
      if (!validEqFitWindowCommand(command)) return validationFailure(meta, "window-command")
      return owner.eqFit.command(meta, command)
    },
    { authenticate }
  )
}
