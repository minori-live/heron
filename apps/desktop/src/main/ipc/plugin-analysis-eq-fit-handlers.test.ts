import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { IpcMainInvokeEvent } from "electron"
import { IPC_CHANNELS } from "@heron/contracts"
import type { RpcRequestMeta, RpcResult } from "@heron/contracts"
import { analysisSnapshot } from "../../renderer/src/test/plugin-analysis"

const fake = vi.hoisted(() => {
  class Window {
    destroyed = false
    maximized = false
    webContents = {
      mainFrame: { url: "" },
      getURL: () => this.webContents.mainFrame.url,
      setWindowOpenHandler: vi.fn(),
      on: vi.fn()
    }
    on = vi.fn()
    show = vi.fn()
    focus = vi.fn()
    restore = vi.fn()
    minimize = vi.fn()
    maximize = vi.fn(() => {
      this.maximized = true
    })
    unmaximize = vi.fn(() => {
      this.maximized = false
    })
    destroy = vi.fn(() => {
      this.destroyed = true
    })
    isDestroyed = () => this.destroyed
    isMaximized = () => this.maximized
    isMinimized = () => false
    async loadURL(url: string) {
      this.webContents.mainFrame.url = url
    }
  }
  return { Window, handle: vi.fn() }
})
vi.mock("electron", () => ({
  app: { isPackaged: true },
  BrowserWindow: fake.Window,
  ipcMain: { handle: fake.handle }
}))
import { PluginAnalysisEqFitWindow } from "../plugin-analysis/plugin-analysis-eq-fit-window"
import { registerPluginAnalysisEqFitHandlers } from "./plugin-analysis-eq-fit-handlers"

function request<Value = unknown>(
  channel: string,
  event: IpcMainInvokeEvent,
  meta: RpcRequestMeta,
  ...args: unknown[]
): Promise<RpcResult<Value>> {
  const handler = fake.handle.mock.calls.find(([name]) => name === channel)?.[1]
  if (!handler) throw new Error(`Missing handler: ${channel}`)
  return handler(event, meta, ...args)
}

const owners: PluginAnalysisEqFitWindow[] = []
function arrange() {
  const value = analysisSnapshot()
  const source = {
    ref: value.ref,
    snapshot: vi.fn((knownReportId?: string) => ({
      ...value,
      report: knownReportId === value.reportId ? null : value.report
    }))
  }
  const manager = new PluginAnalysisEqFitWindow(() => source as never)
  owners.push(manager)
  const parent = new fake.Window()
  parent.webContents.mainFrame.url = "heron-app://bundle/plugin-analysis.html"
  const parentEvent = {
    sender: parent.webContents,
    senderFrame: parent.webContents.mainFrame
  } as unknown as IpcMainInvokeEvent
  registerPluginAnalysisEqFitHandlers({
    service: source,
    eqFit: manager,
    authenticate(event: IpcMainInvokeEvent) {
      if (event.sender !== parentEvent.sender || event.senderFrame !== parentEvent.senderFrame)
        throw new Error("Untrusted parent")
    }
  } as never)
  const read = (extra: Partial<RpcRequestMeta> = {}): RpcRequestMeta => ({
    protocolVersion: 2,
    requestId: "read",
    ...extra
  })
  const mutation = (id: string, extra: Partial<RpcRequestMeta> = {}): RpcRequestMeta =>
    read({
      target: value.ref,
      expectedRevision: value.revision,
      mutation: { operationId: id, idempotencyKey: id },
      ...extra
    })
  const selection = { reportId: "run-1", reportRevision: 3, input: 0, output: 0, mode: "single" }
  const open = (sequence = 1) =>
    request(IPC_CHANNELS.pluginAnalysisEqFitSelection, parentEvent, mutation(`open-${sequence}`), {
      sequence,
      selection,
      open: true
    })
  const child = () =>
    ({
      sender: manager.window!.webContents,
      senderFrame: manager.window!.webContents.mainFrame
    }) as IpcMainInvokeEvent
  return { manager, parentEvent, source, value, read, mutation, selection, open, child }
}

describe("standalone EQ Fit RPC authority", () => {
  beforeEach(() => {
    fake.handle.mockReset()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => {
    for (const owner of owners.splice(0)) owner.resetOwner()
  })

  it("grants selection authority to Analysis and read/window authority only to its child", async () => {
    const { parentEvent, mutation, selection, open, child, read } = arrange()
    expect(await open()).toMatchObject({ ok: true, value: { opened: true, sequence: 1 } })
    expect(
      await request(IPC_CHANNELS.pluginAnalysisEqFitSelection, child(), mutation("forged"), {
        sequence: 2,
        selection,
        open: true
      })
    ).toMatchObject({ ok: false, error: { details: { field: "sender" } } })
    for (const channel of [
      IPC_CHANNELS.pluginAnalysisEqFitSnapshot,
      IPC_CHANNELS.pluginAnalysisEqFitWindow
    ]) {
      expect(await request(channel, parentEvent, read(), { type: "close" })).toMatchObject({
        ok: false,
        error: { details: { field: "sender" } }
      })
    }
    expect(await request(IPC_CHANNELS.pluginAnalysisEqFitSnapshot, child(), read())).toMatchObject({
      ok: true,
      value: { selection, reportId: "run-1", report: { responses: expect.any(Array) } }
    })
    expect(
      await request(IPC_CHANNELS.pluginAnalysisEqFitSnapshot, child(), read(), "run-1")
    ).toMatchObject({ ok: true, value: { reportId: "run-1", report: null } })
  })

  it("rejects invalid inputs/reads without consuming a selection sequence or changing the window", async () => {
    const { manager, parentEvent, mutation, selection, read, value, open, child } = arrange()
    expect(
      await request(IPC_CHANNELS.pluginAnalysisEqFitSelection, parentEvent, mutation("invalid"), {
        sequence: 1,
        selection: null,
        open: true
      })
    ).toMatchObject({ ok: false, error: { details: { field: "selection-request" } } })
    expect(manager.sequence).toBe(0)
    expect(
      await request(
        IPC_CHANNELS.pluginAnalysisEqFitSelection,
        parentEvent,
        read({ target: value.ref }),
        { sequence: 1, selection, open: true }
      )
    ).toMatchObject({ ok: false, error: { details: { field: "mutation" } } })
    await open()
    expect(
      await request(
        IPC_CHANNELS.pluginAnalysisEqFitSnapshot,
        child(),
        read({ target: { ...value.ref, generation: 2 } })
      )
    ).toMatchObject({ ok: false, error: { code: "stale-resource" } })
    expect(
      await request(IPC_CHANNELS.pluginAnalysisEqFitSnapshot, child(), mutation("read-mutation"))
    ).toMatchObject({ ok: false, error: { details: { field: "mutation" } } })
    expect(
      await request(
        IPC_CHANNELS.pluginAnalysisEqFitSnapshot,
        child(),
        read({ mutation: { operationId: "id", idempotencyKey: "key" } })
      )
    ).toMatchObject({ ok: false, error: { details: { field: "mutation" } } })
    expect(
      await request(IPC_CHANNELS.pluginAnalysisEqFitSnapshot, child(), read(), undefined, "ack")
    ).toMatchObject({ ok: false, error: { details: { field: "acknowledge" } } })
    expect(
      await request(IPC_CHANNELS.pluginAnalysisEqFitWindow, child(), mutation("bad-window"), {
        type: "maximize"
      })
    ).toMatchObject({ ok: false, error: { details: { field: "window-command" } } })
    expect(
      await request(IPC_CHANNELS.pluginAnalysisEqFitWindow, child(), read({ target: value.ref }), {
        type: "close"
      })
    ).toMatchObject({ ok: false, error: { details: { field: "mutation" } } })
    expect(manager.window).not.toBeNull()
  })

  it("validates the complete snapshot request before acknowledging window mutations", async () => {
    const { manager, mutation, open, child, read, value } = arrange()
    await open()
    const max = { type: "set-maximized", maximized: true }
    expect(
      await request(IPC_CHANNELS.pluginAnalysisEqFitWindow, child(), mutation("maximize"), max)
    ).toMatchObject({ ok: true, value: { maximized: true } })
    manager.window!.unmaximize()
    expect(
      await request(
        IPC_CHANNELS.pluginAnalysisEqFitSnapshot,
        child(),
        read({ target: value.ref }),
        42,
        "maximize"
      )
    ).toMatchObject({ ok: false, error: { details: { field: "knownReportId" } } })
    expect(
      await request(IPC_CHANNELS.pluginAnalysisEqFitWindow, child(), mutation("maximize"), max)
    ).toMatchObject({ ok: true, value: { maximized: true } })
    expect(manager.window!.isMaximized()).toBe(false)
    expect(
      await request(
        IPC_CHANNELS.pluginAnalysisEqFitSnapshot,
        child(),
        read({ target: value.ref }),
        "run-1",
        "maximize"
      )
    ).toMatchObject({ ok: true, value: { maximized: false } })
    expect(
      await request(IPC_CHANNELS.pluginAnalysisEqFitWindow, child(), mutation("maximize"), max)
    ).toMatchObject({ ok: true, value: { maximized: true } })
    expect(manager.window!.isMaximized()).toBe(true)
    expect(
      await request(IPC_CHANNELS.pluginAnalysisEqFitWindow, child(), mutation("close"), {
        type: "close"
      })
    ).toMatchObject({ ok: true, value: { maximized: false } })
    expect(manager.window).toBeNull()
  })
})
