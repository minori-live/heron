import { app, BrowserWindow } from "electron"
import type { IpcMainInvokeEvent } from "electron"
import { randomUUID } from "node:crypto"
import { rpcFailure } from "@heron/contracts"
import type {
  PluginAnalysisEqFitSelection,
  PluginAnalysisEqFitSelectionRequest,
  PluginAnalysisEqFitSelectionResult,
  PluginAnalysisEqFitSnapshot,
  PluginAnalysisEqFitWindowCommand,
  PluginAnalysisSnapshot,
  RpcRequestMeta,
  RpcResult
} from "@heron/contracts"
import { applicationIconPath } from "../app/runtime-paths"
import { mainWindowPlatformOptions, secureWebPreferences } from "../app/windows"
import {
  classifyRendererEntrypoint,
  resolveRendererEntrypoints
} from "../../shared/renderer-security"
import { validateMutationTarget, validationFailure } from "../ipc/resource-validation"
import type { PluginAnalysisService } from "./plugin-analysis-service"

type SelectionOutcome = PluginAnalysisEqFitSelectionResult | RpcResult<never>
type WindowOutcome = { maximized: boolean } | RpcResult<never>

export function validEqFitSelectionRequest(
  value: unknown
): value is PluginAnalysisEqFitSelectionRequest {
  if (!value || typeof value !== "object") return false
  const request = value as PluginAnalysisEqFitSelectionRequest
  if (
    !Number.isSafeInteger(request.sequence) ||
    request.sequence < 1 ||
    typeof request.open !== "boolean"
  )
    return false
  if (request.selection === null) return !request.open
  const selection = request.selection
  return (
    !!selection &&
    typeof selection === "object" &&
    typeof selection.reportId === "string" &&
    selection.reportId.length > 0 &&
    selection.reportId.length <= 256 &&
    Number.isSafeInteger(selection.reportRevision) &&
    selection.reportRevision >= 0 &&
    (selection.input === 0 || selection.input === 1) &&
    (selection.output === 0 || selection.output === 1) &&
    ["single", "primary", "comparison", "parallel"].includes(selection.mode)
  )
}

export function validEqFitWindowCommand(value: unknown): value is PluginAnalysisEqFitWindowCommand {
  if (!value || typeof value !== "object") return false
  const command = value as PluginAnalysisEqFitWindowCommand
  return (
    command.type === "close" ||
    command.type === "minimize" ||
    (command.type === "set-maximized" && typeof command.maximized === "boolean")
  )
}

function selectionKey(selection: PluginAnalysisEqFitSelection | null): string {
  return selection === null
    ? "none"
    : JSON.stringify([
        selection.reportId,
        selection.reportRevision,
        selection.input,
        selection.output,
        selection.mode
      ])
}

function currentSelection(
  selection: PluginAnalysisEqFitSelection,
  source: PluginAnalysisSnapshot
): boolean {
  return (
    selection.reportId === source.reportId &&
    selection.reportRevision === source.reportRevision &&
    source.revision === selection.reportRevision &&
    (selection.mode === "single" ? !source.comparisonEnabled : source.comparisonEnabled)
  )
}

function measuredSelection(
  selection: PluginAnalysisEqFitSelection,
  source: PluginAnalysisSnapshot
): boolean {
  if (!currentSelection(selection, source)) return false
  const reports =
    selection.mode === "comparison"
      ? [source.comparisonReport]
      : selection.mode === "parallel"
        ? [source.report, source.comparisonReport]
        : [source.report]
  return reports.every((report) =>
    report?.responses.some(
      (path) => path.input === selection.input && path.output === selection.output
    )
  )
}

/** Owns only the read-only EQ presentation. The Analysis owner retains all native resources. */
export class PluginAnalysisEqFitWindow {
  window: BrowserWindow | null = null
  sequence = 0
  private selection: PluginAnalysisEqFitSelection | null = null
  private selectionRevision = 0
  private generation = 0
  private opening: Promise<boolean> | null = null
  private observedReportId: string | undefined
  private latest: {
    signature: string
    operationId: string
    key: string
    result: Promise<SelectionOutcome>
  } | null = null
  private readonly windowReceipts = new Map<
    string,
    { signature: string; key: string; result: WindowOutcome }
  >()

  constructor(private readonly source: () => PluginAnalysisService | null) {}

  private setSelection(selection: PluginAnalysisEqFitSelection | null): void {
    if (selectionKey(this.selection) === selectionKey(selection)) return
    this.selection =
      selection === null
        ? null
        : {
            reportId: selection.reportId,
            reportRevision: selection.reportRevision,
            input: selection.input,
            output: selection.output,
            mode: selection.mode
          }
    this.selectionRevision++
    if (!selection && this.opening) this.closeChild()
  }

  /** Called before parent native cleanup, and before publishing a fresh Analysis owner. */
  resetOwner(): void {
    this.closeChild()
    this.selection = null
    this.selectionRevision = 0
    this.sequence = 0
    this.latest = null
    this.observedReportId = undefined
  }

  closeChild(): void {
    this.generation++
    this.opening = null
    const window = this.window
    this.window = null
    this.windowReceipts.clear()
    if (window && !window.isDestroyed()) window.destroy()
  }

  apply(
    meta: RpcRequestMeta,
    request: PluginAnalysisEqFitSelectionRequest
  ): Promise<SelectionOutcome> {
    const service = this.source()
    if (!service) return Promise.resolve(validationFailure(meta, "closed-session"))
    const invalid = validateMutationTarget(meta, service.ref)
    if (invalid) return Promise.resolve(invalid)
    const signature = JSON.stringify([
      request.sequence,
      selectionKey(request.selection),
      request.open
    ])
    const mutation = meta.mutation!
    if (request.sequence === this.sequence && this.latest) {
      return this.latest.signature === signature &&
        this.latest.operationId === mutation.operationId &&
        this.latest.key === mutation.idempotencyKey
        ? this.latest.result
        : Promise.resolve(validationFailure(meta, "selection-sequence"))
    }
    if (request.sequence <= this.sequence)
      return Promise.resolve(validationFailure(meta, "selection-sequence"))
    if (
      this.latest &&
      (this.latest.operationId === mutation.operationId ||
        this.latest.key === mutation.idempotencyKey)
    )
      return Promise.resolve(validationFailure(meta, "mutation-identity"))
    // Selection changes are rare. Resolve only authoritative service data on admission;
    // later polls use knownReportId to avoid cloning unchanged measurement arrays.
    const source = service.snapshot(request.selection ? undefined : this.observedReportId)
    this.observedReportId = source.reportId ?? undefined
    const conflict = validateMutationTarget(meta, source.ref, source.revision)
    if (conflict) return Promise.resolve(conflict)
    if (request.selection && !measuredSelection(request.selection, source))
      return Promise.resolve(validationFailure(meta, "selection"))
    this.sequence = request.sequence
    this.setSelection(request.selection)
    const generation = this.generation
    const selectionRevision = this.selectionRevision
    const result = (async (): Promise<SelectionOutcome> => {
      if (request.open && !(await this.openWindow())) {
        return rpcFailure(meta, {
          code: "resource-unavailable",
          category: "unavailable",
          outcome: "not-committed",
          retry: "safe",
          correlationId: randomUUID(),
          userMessageKey: "pluginAnalysis.eqFit.openFailed",
          details: { type: "resource-unavailable", component: "main", dispatched: false }
        })
      }
      return {
        sequence: request.sequence,
        selectionRevision,
        opened: generation === this.generation && !!this.window && !this.window.isDestroyed()
      }
    })()
    this.latest = {
      signature,
      operationId: mutation.operationId,
      key: mutation.idempotencyKey,
      result
    }
    return result
  }

  private openWindow(): Promise<boolean> {
    if (this.opening) return this.opening
    if (!this.source() || !this.selection) return Promise.resolve(false)
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isMinimized()) this.window.restore()
      this.window.show()
      this.window.focus()
      return Promise.resolve(true)
    }
    const generation = this.generation
    let window: BrowserWindow
    try {
      window = new BrowserWindow({
        title: "EQ Fit",
        icon: applicationIconPath,
        width: 900,
        height: 740,
        minWidth: 320,
        minHeight: 360,
        show: false,
        backgroundColor: "#0b0e13",
        ...mainWindowPlatformOptions(process.platform),
        webPreferences: secureWebPreferences()
      })
      this.window = window
      this.windowReceipts.clear()
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
      window.webContents.on("will-navigate", (event) => event.preventDefault())
      window.webContents.on("render-process-gone", () => {
        if (this.window === window) this.closeChild()
      })
      window.on("close", (event) => {
        event.preventDefault()
        if (this.window === window) this.closeChild()
      })
    } catch {
      this.closeChild()
      return Promise.resolve(false)
    }
    const pending = (async () => {
      try {
        const renderer = resolveRendererEntrypoints(app.isPackaged, process.env.HERON_RENDERER_URL)
        await window.loadURL(new URL("plugin-analysis-eq-fit.html", renderer.main).toString())
        const service = this.source()
        const source = service?.snapshot(this.selection?.reportId)
        if (this.window !== window || generation !== this.generation || window.isDestroyed())
          return false
        if (!source || !this.selection || !currentSelection(this.selection, source)) {
          this.setSelection(null)
          if (this.window === window) this.closeChild()
          return false
        }
        window.show()
        window.focus()
        return true
      } catch {
        if (this.window === window) this.closeChild()
        else if (!window.isDestroyed()) window.destroy()
        return false
      }
    })().finally(() => {
      if (this.opening === pending) this.opening = null
    })
    this.opening = pending
    return pending
  }

  authenticate(event: IpcMainInvokeEvent): void {
    const url = event.senderFrame?.url ?? event.sender.getURL()
    const renderer = resolveRendererEntrypoints(app.isPackaged, process.env.HERON_RENDERER_URL)
    if (
      event.sender !== this.window?.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      classifyRendererEntrypoint(url) !== "plugin-analysis-eq-fit" ||
      new URL(url).origin !== new URL(renderer.main).origin ||
      !this.source()
    ) {
      throw new Error("Untrusted EQ Fit sender")
    }
  }

  snapshot(knownReportId?: string): PluginAnalysisEqFitSnapshot {
    const source = this.source()!.snapshot(this.selection ? knownReportId : this.observedReportId)
    this.observedReportId = source.reportId ?? undefined
    if (this.selection && !currentSelection(this.selection, source)) this.setSelection(null)
    return {
      ref: source.ref,
      revision: source.revision,
      selectionRevision: this.selectionRevision,
      selection: this.selection ? { ...this.selection } : null,
      reportId: this.selection ? source.reportId : null,
      reportRevision: this.selection ? source.reportRevision : null,
      report: this.selection ? source.report : null,
      comparisonReport: this.selection ? source.comparisonReport : null,
      locale: source.locale,
      theme: source.theme,
      maximized: this.window?.isMaximized() ?? false
    }
  }

  acknowledge(operationId: string): void {
    this.windowReceipts.delete(operationId)
  }

  command(meta: RpcRequestMeta, command: PluginAnalysisEqFitWindowCommand): WindowOutcome {
    const service = this.source()
    if (!service || !this.window) return validationFailure(meta, "closed-session")
    const invalid = validateMutationTarget(meta, service.ref)
    if (invalid) return invalid
    const mutation = meta.mutation!
    const signature =
      command.type === "set-maximized" ? `${command.type}:${command.maximized}` : command.type
    const existing = this.windowReceipts.get(mutation.operationId)
    if (existing)
      return existing.key === mutation.idempotencyKey && existing.signature === signature
        ? existing.result
        : validationFailure(meta, "mutation-identity")
    if (
      [...this.windowReceipts.values()].some((receipt) => receipt.key === mutation.idempotencyKey)
    )
      return validationFailure(meta, "mutation-identity")
    if (this.windowReceipts.size >= 128) return validationFailure(meta, "receipt-capacity")
    if (command.type === "close") {
      this.closeChild()
      return { maximized: false }
    }
    if (command.type === "minimize") this.window.minimize()
    else if (command.maximized) {
      if (!this.window.isMaximized()) this.window.maximize()
    } else if (this.window.isMaximized()) this.window.unmaximize()
    const result = { maximized: this.window.isMaximized() }
    this.windowReceipts.set(mutation.operationId, {
      signature,
      key: mutation.idempotencyKey,
      result
    })
    return result
  }
}
