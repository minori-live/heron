import { beforeEach, describe, expect, it, vi } from "vitest"
import type { IpcMainInvokeEvent } from "electron"
import type {
  PluginAnalysisEqFitSelection,
  PluginAnalysisEqFitSelectionRequest,
  RpcRequestMeta
} from "@heron/contracts"
import { analysisReport, analysisSnapshot } from "../../renderer/src/test/plugin-analysis"

const fake = vi.hoisted(() => {
  const load = vi.fn(async () => {})
  const allocate = vi.fn()
  class Window {
    static instances: Window[] = []
    destroyed = false
    maximized = false
    minimized = false
    readonly events = new Map<string, (...args: unknown[]) => void>()
    readonly webContents = {
      mainFrame: { url: "" },
      getURL: () => this.webContents.mainFrame.url,
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((name, listener) => this.events.set(name, listener))
    }
    constructor(readonly options: Record<string, unknown>) {
      allocate()
      Window.instances.push(this)
    }
    loadURL = vi.fn(async (url: string) => {
      this.webContents.mainFrame.url = url
      await load()
    })
    show = vi.fn()
    focus = vi.fn()
    restore = vi.fn(() => {
      this.minimized = false
    })
    minimize = vi.fn(() => {
      this.minimized = true
    })
    maximize = vi.fn(() => {
      this.maximized = true
    })
    unmaximize = vi.fn(() => {
      this.maximized = false
    })
    on = vi.fn((name, listener) => this.events.set(name, listener))
    destroy = vi.fn(() => {
      this.destroyed = true
    })
    isDestroyed = () => this.destroyed
    isMaximized = () => this.maximized
    isMinimized = () => this.minimized
  }
  return { Window, load, allocate }
})
vi.mock("electron", () => ({ app: { isPackaged: true }, BrowserWindow: fake.Window }))
vi.mock("../app/windows", () => ({
  mainWindowPlatformOptions: () => ({}),
  secureWebPreferences: () => ({ sandbox: true, contextIsolation: true })
}))

import {
  PluginAnalysisEqFitWindow,
  validEqFitSelectionRequest,
  validEqFitWindowCommand
} from "./plugin-analysis-eq-fit-window"

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function arrange() {
  const value = analysisSnapshot()
  let available = true
  const snapshot = vi.fn((knownReportId?: string) => ({
    ...value,
    report: knownReportId === value.reportId ? null : value.report,
    comparisonReport: knownReportId === value.reportId ? null : value.comparisonReport
  }))
  const service = { ref: value.ref, snapshot }
  const manager = new PluginAnalysisEqFitWindow(() => (available ? (service as never) : null))
  const selection: PluginAnalysisEqFitSelection = {
    reportId: "run-1",
    reportRevision: 3,
    input: 0,
    output: 0,
    mode: "single"
  }
  const meta = (operation = "operation", expectedRevision = value.revision): RpcRequestMeta => ({
    protocolVersion: 2,
    requestId: `request-${operation}`,
    target: value.ref,
    expectedRevision,
    mutation: { operationId: operation, idempotencyKey: `key-${operation}` }
  })
  const apply = (sequence: number, options: Partial<PluginAnalysisEqFitSelectionRequest> = {}) =>
    manager.apply(meta(`select-${sequence}`), { sequence, selection, open: true, ...options })
  return {
    manager,
    selection,
    value,
    snapshot,
    meta,
    apply,
    retire: () => {
      available = false
    }
  }
}

describe("EQ Fit window ownership and authoritative selection", () => {
  beforeEach(() => {
    fake.Window.instances = []
    fake.load.mockReset()
    fake.allocate.mockReset()
  })

  it("opens one independent secure entry, reuses the fit context, and restores minimized windows", async () => {
    const { manager, apply } = arrange()
    expect(await apply(1)).toEqual({ sequence: 1, selectionRevision: 1, opened: true })
    const window = fake.Window.instances[0]!
    expect(window.loadURL).toHaveBeenCalledWith("heron-app://bundle/plugin-analysis-eq-fit.html")
    expect(window.options).toMatchObject({
      minWidth: 320,
      webPreferences: { sandbox: true, contextIsolation: true }
    })
    expect(window.options.parent).toBeUndefined()
    window.minimized = true
    expect(await apply(2)).toEqual({ sequence: 2, selectionRevision: 1, opened: true })
    expect(window.restore).toHaveBeenCalledOnce()
    expect(fake.Window.instances).toHaveLength(1)
    expect(window.focus).toHaveBeenCalledTimes(2)
    expect(await apply(3, { open: false })).toMatchObject({ selectionRevision: 1 })
    expect(window.focus).toHaveBeenCalledTimes(2)
    manager.closeChild()
  })

  it("ignores delayed/replayed opens after manual close but accepts a new user open", async () => {
    const { manager, apply, meta, selection } = arrange()
    const first = await apply(1)
    manager.closeChild()
    expect(await apply(1)).toEqual(first)
    expect(fake.Window.instances).toHaveLength(1)
    expect(
      await manager.apply(meta("conflict"), { sequence: 1, selection, open: true })
    ).toMatchObject({ ok: false })
    expect(await apply(2)).toMatchObject({ opened: true })
    expect(fake.Window.instances).toHaveLength(2)
    expect(await apply(1, { selection: null, open: false })).toMatchObject({ ok: false })
    expect(manager.snapshot().selection).toEqual(selection)
    manager.closeChild()
  })

  it("coalesces pending opens and lets immediate invalidation cancel the candidate", async () => {
    const { manager, apply } = arrange()
    const loading = deferred()
    fake.load.mockReturnValueOnce(loading.promise)
    const first = apply(1)
    const second = apply(2)
    expect(fake.Window.instances).toHaveLength(1)
    const window = fake.Window.instances[0]!
    expect(await apply(3, { selection: null, open: false })).toMatchObject({
      opened: false,
      selectionRevision: 2
    })
    expect(window.destroyed).toBe(true)
    loading.resolve()
    expect(await first).toMatchObject({ ok: false, error: { code: "resource-unavailable" } })
    expect(await second).toMatchObject({ ok: false })
    expect(window.show).not.toHaveBeenCalled()
    expect(manager.snapshot().selection).toBeNull()
    expect(await apply(4)).toMatchObject({ opened: true })
    manager.closeChild()
  })

  it("resets sequence only with a new owner and cannot publish late load into that owner", async () => {
    const { manager, apply, value, retire } = arrange()
    const loading = deferred()
    fake.load.mockReturnValueOnce(loading.promise)
    const pending = apply(10)
    const old = fake.Window.instances[0]!
    manager.resetOwner()
    expect(old.destroyed).toBe(true)
    expect(manager.sequence).toBe(0)
    expect(await apply(1)).toMatchObject({ opened: true })
    loading.reject(new Error("old load failed"))
    expect(await pending).toMatchObject({ ok: false })
    expect(fake.Window.instances[1]!.destroyed).toBe(false)
    value.revision++
    expect(manager.snapshot().selection).toBeNull()
    retire()
    expect(await apply(2)).toMatchObject({
      ok: false,
      error: { details: { field: "closed-session" } }
    })
    manager.resetOwner()
  })

  it("recovers allocation/load failures without retaining the failed candidate", async () => {
    const { manager, apply } = arrange()
    fake.allocate.mockImplementationOnce(() => {
      throw new Error("allocation failed")
    })
    expect(await apply(1)).toMatchObject({ ok: false, error: { code: "resource-unavailable" } })
    expect(manager.window).toBeNull()
    fake.load.mockRejectedValueOnce(new Error("load failed"))
    expect(await apply(2)).toMatchObject({ ok: false })
    expect(fake.Window.instances[0]!.destroyed).toBe(true)
    expect(await apply(3)).toMatchObject({ opened: true })
    manager.resetOwner()
  })

  it("abandons an opening whose source was changed or retired while loading", async () => {
    const { manager, apply, value } = arrange()
    const loading = deferred()
    fake.load.mockReturnValueOnce(loading.promise)
    const opening = apply(1)
    value.reportId = "new-run"
    loading.resolve()
    expect(await opening).toMatchObject({ ok: false })
    expect(manager.window).toBeNull()
    expect(manager.snapshot().selection).toBeNull()
  })

  it("uses only canonical measured coordinates and rejects stale resources/revisions", async () => {
    const { manager, apply, meta, selection, value } = arrange()
    expect(
      await manager.apply(
        { ...meta(), mutation: undefined },
        { sequence: 1, selection, open: true }
      )
    ).toMatchObject({ ok: false, error: { details: { field: "mutation" } } })
    expect(
      await manager.apply(
        { ...meta(), target: { ...value.ref, generation: 99 } },
        { sequence: 1, selection, open: true }
      )
    ).toMatchObject({ ok: false, error: { code: "stale-resource" } })
    expect(
      await manager.apply(meta("old", 2), { sequence: 1, selection, open: true })
    ).toMatchObject({ ok: false, error: { code: "revision-conflict" } })
    for (const invalid of [
      { ...selection, reportId: "forged" },
      { ...selection, input: 1, output: 0 },
      { ...selection, mode: "comparison" as const }
    ]) {
      expect(await apply(1, { selection: invalid })).toMatchObject({
        ok: false,
        error: { details: { field: "selection" } }
      })
    }
    expect(fake.Window.instances).toHaveLength(0)
    const payload = { ...selection, injectedReport: ["untrusted"] }
    expect(await apply(1, { selection: payload, open: false })).toMatchObject({ opened: false })
    expect(manager.snapshot().selection).toEqual(selection)
    expect(
      await manager.apply(meta("select-1"), { sequence: 2, selection, open: false })
    ).toMatchObject({ ok: false, error: { details: { field: "mutation-identity" } } })
  })

  it("provides canonical comparison candidates and omits stable measurement bodies even after invalidation", async () => {
    const { manager, apply, value, selection, snapshot } = arrange()
    value.comparisonEnabled = true
    value.comparisonReport = analysisReport()
    expect(await apply(1, { selection: { ...selection, mode: "parallel" } })).toMatchObject({
      opened: true
    })
    expect(manager.snapshot()).toMatchObject({
      report: value.report,
      comparisonReport: value.comparisonReport
    })
    expect(manager.snapshot("run-1")).toMatchObject({
      reportId: "run-1",
      report: null,
      comparisonReport: null
    })
    expect(
      await apply(2, { selection: { ...selection, mode: "comparison" }, open: false })
    ).toMatchObject({ selectionRevision: 2 })
    value.comparisonReport = null
    expect(await apply(3, { selection: { ...selection, mode: "parallel" } })).toMatchObject({
      ok: false
    })
    value.revision++
    expect(manager.snapshot("run-1")).toMatchObject({
      selection: null,
      reportId: null,
      report: null
    })
    manager.snapshot()
    expect(snapshot).toHaveBeenLastCalledWith("run-1")
    manager.closeChild()
  })

  it("authenticates only the live child main frame and closes crashed renderers", async () => {
    const { manager, apply } = arrange()
    await apply(1)
    const window = fake.Window.instances[0]!
    const event = {
      sender: window.webContents,
      senderFrame: window.webContents.mainFrame
    } as unknown as IpcMainInvokeEvent
    expect(() => manager.authenticate(event)).not.toThrow()
    expect(() =>
      manager.authenticate({
        ...event,
        senderFrame: { url: event.senderFrame!.url }
      } as IpcMainInvokeEvent)
    ).toThrow()
    expect(() =>
      manager.authenticate({
        ...event,
        sender: { ...window.webContents }
      } as unknown as IpcMainInvokeEvent)
    ).toThrow()
    window.webContents.mainFrame.url = "heron-app://bundle/plugin-analysis.html"
    expect(() => manager.authenticate(event)).toThrow()
    const navigation = { preventDefault: vi.fn() }
    window.events.get("will-navigate")!(navigation)
    expect(navigation.preventDefault).toHaveBeenCalledOnce()
    expect(window.webContents.setWindowOpenHandler.mock.calls[0]![0]()).toEqual({ action: "deny" })
    window.events.get("render-process-gone")!()
    expect(manager.window).toBeNull()
    expect(() => manager.authenticate(event)).toThrow()
    await apply(2)
    const close = { preventDefault: vi.fn() }
    fake.Window.instances[1]!.events.get("close")!(close)
    expect(close.preventDefault).toHaveBeenCalledOnce()
    expect(manager.window).toBeNull()
  })

  it("applies explicit window state once per receipt and bounds/acknowledges retained identities", async () => {
    const { manager, apply, meta } = arrange()
    await apply(1)
    const window = fake.Window.instances[0]!
    expect(manager.command(meta("max"), { type: "set-maximized", maximized: true })).toEqual({
      maximized: true
    })
    expect(manager.command(meta("max"), { type: "set-maximized", maximized: true })).toEqual({
      maximized: true
    })
    expect(window.maximize).toHaveBeenCalledOnce()
    expect(manager.command(meta("max"), { type: "minimize" })).toMatchObject({ ok: false })
    expect(
      manager.command(
        { ...meta("other"), mutation: { operationId: "other", idempotencyKey: "key-max" } },
        { type: "minimize" }
      )
    ).toMatchObject({ ok: false })
    expect(manager.command(meta("restore"), { type: "set-maximized", maximized: false })).toEqual({
      maximized: false
    })
    expect(manager.snapshot().maximized).toBe(false)
    for (let index = 0; index < 126; index++)
      manager.command(meta(`min-${index}`), { type: "minimize" })
    expect(manager.command(meta("overflow"), { type: "minimize" })).toMatchObject({
      ok: false,
      error: { details: { field: "receipt-capacity" } }
    })
    manager.acknowledge("max")
    expect(manager.command(meta("overflow"), { type: "minimize" })).toEqual({ maximized: false })
    manager.acknowledge("restore")
    expect(manager.command(meta("close"), { type: "close" })).toEqual({ maximized: false })
    expect(manager.command(meta("closed"), { type: "minimize" })).toMatchObject({ ok: false })
    expect(window.destroyed).toBe(true)
  })
})

describe("EQ Fit IPC input validation", () => {
  it("rejects unbounded sequences, implicit paths and malformed window state", () => {
    const selection = { reportId: "run", reportRevision: 1, input: 0, output: 1, mode: "single" }
    expect(validEqFitSelectionRequest({ sequence: 1, selection, open: true })).toBe(true)
    expect(validEqFitSelectionRequest({ sequence: 1, selection: null, open: false })).toBe(true)
    for (const invalid of [
      null,
      1,
      {},
      { sequence: 0, selection, open: true },
      { sequence: Number.MAX_SAFE_INTEGER + 1, selection, open: true },
      { sequence: 1, selection: null, open: true },
      { sequence: 1, selection: { ...selection, mode: "difference" }, open: true },
      { sequence: 1, selection: { ...selection, output: 2 }, open: true }
    ])
      expect(validEqFitSelectionRequest(invalid)).toBe(false)
    expect(validEqFitWindowCommand({ type: "minimize" })).toBe(true)
    expect(validEqFitWindowCommand({ type: "set-maximized", maximized: true })).toBe(true)
    for (const invalid of [
      null,
      {},
      { type: "maximize" },
      { type: "set-maximized", maximized: "true" }
    ])
      expect(validEqFitWindowCommand(invalid)).toBe(false)
  })
})
