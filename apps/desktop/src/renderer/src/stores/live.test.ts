import { beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import type { LiveWorkspaceSnapshot, RpcResult } from "@heron/contracts"
import { useLiveStore } from "./live"
import { useProjectStore } from "./project"
import { useGlobalDialog } from "../composables/useGlobalDialog"

const desktop = { kind: "desktop-session" as const, id: "desktop", epoch: "epoch", generation: 1 }
const configuration = { name: "Stage", sampleRate: 48000, audio: null, enabledMidiDeviceIds: [] }
function workspace(dirty = false): LiveWorkspaceSnapshot {
  return {
    kind: "live",
    project: { ...desktop, kind: "project-session", id: "stage" },
    projectGraph: { ...desktop, kind: "project-graph", id: "graph" },
    revision: 4,
    mode: "edit",
    history: { canUndo: true, canRedo: false },
    bindings: [],
    graph: { sampleRate: 48000, channels: [], sends: [], plugins: [] },
    session: {
      kind: "live",
      id: "stage",
      path: "Stage.hrl",
      configuration,
      dirty,
      recoveredWorkingCopy: false
    }
  }
}
const success = <T>(value: T): RpcResult<T> => ({
  ok: true,
  requestId: "request",
  value,
  warnings: []
})
const failure = (): RpcResult<never> => ({
  ok: false,
  requestId: "request",
  error: {
    code: "resource-unavailable",
    category: "unavailable",
    outcome: "not-committed",
    retry: "safe",
    correlationId: "error",
    userMessageKey: "errors.projectUnavailable",
    details: { type: "resource-unavailable", component: "project-worker", dispatched: true }
  }
})
function fixture() {
  const api = {
    createLiveDocument: vi.fn(async () => success(workspace())),
    prepareOpenLiveDocument: vi.fn(async () =>
      success({ path: "Stage.hrl", recoverableWorkingCopy: true })
    ),
    openLiveDocument: vi.fn(async () => success(workspace())),
    saveLiveDocument: vi.fn(async () => success(workspace())),
    executeLiveEdit: vi.fn(async () => success(workspace(true))),
    undoLiveEdit: vi.fn(async () => success(workspace())),
    redoLiveEdit: vi.fn(async () => success(workspace(true))),
    configureLiveDocument: vi.fn(async () => success(workspace(true))),
    closeLiveDocument: vi.fn(async () => success(true))
  }
  Object.assign(window.heron, api)
  useProjectStore().applyDesktopSession(desktop)
  return { api, live: useLiveStore(), dialog: useGlobalDialog() }
}

describe("Live document store", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it("creates an isolated workspace and sends revisioned edits, history and baseline save", async () => {
    const { live, api } = fixture()
    expect(live.isOpen).toBe(false)
    expect(live.canUndo).toBe(false)
    expect(await live.create(configuration, "Stage.hrl")).toEqual(workspace())
    expect(live.session?.configuration.name).toBe("Stage")
    expect(live.canUndo).toBe(true)
    expect(live.canRedo).toBe(false)
    expect(await live.create(configuration)).toBeNull()
    expect(await live.open()).toBeNull()
    const command = { type: "set-midi-bindings" as const, bindings: [] }
    expect(await live.edit(command)).toBe(true)
    expect(api.executeLiveEdit).toHaveBeenCalledWith(
      expect.objectContaining({ target: workspace().project, expectedRevision: 4 }),
      command
    )
    expect(live.session?.dirty).toBe(true)
    expect(await live.edit("undo")).toBe(true)
    expect(live.session?.dirty).toBe(false)
    expect(await live.edit("redo")).toBe(true)
    expect(await live.configure(configuration)).toBe(true)
    expect(await live.save()).toBe(true)
    expect(live.session?.dirty).toBe(false)
    expect(await live.close()).toBe(true)
    expect(live.isOpen).toBe(false)
    expect(await live.close()).toBe(true)
    expect(await live.edit("undo")).toBe(false)
    expect(await live.configure(configuration)).toBe(false)
    expect(await live.save()).toBe(false)
  })

  it.each(["recover", "saved", "cancel"] as const)("honors recovery choice %s", async (choice) => {
    const { live, api, dialog } = fixture()
    const opening = live.open("Stage.hrl")
    await vi.waitFor(() => expect(dialog.activeDialog.value).not.toBeNull())
    expect(live.pending).toBe(true)
    expect(await live.open()).toBeNull()
    dialog.selectDialogAction(choice)
    const result = await opening
    expect(live.pending).toBe(false)
    if (choice === "cancel") {
      expect(result).toBeNull()
      expect(api.openLiveDocument).not.toHaveBeenCalled()
    } else {
      expect(result).toEqual(workspace())
      expect(api.openLiveDocument).toHaveBeenCalledWith(
        expect.objectContaining({ target: desktop }),
        "Stage.hrl",
        choice === "recover"
      )
    }
  })

  it.each(["save", "discard", "cancel"] as const)(
    "honors dirty close choice %s",
    async (choice) => {
      const { live, api, dialog } = fixture()
      live.applyWorkspace(workspace(true))
      const closing = live.close()
      expect(dialog.activeDialog.value?.actions.map((action) => action.value)).toEqual([
        "save",
        "discard",
        "cancel"
      ])
      dialog.selectDialogAction(choice)
      expect(await closing).toBe(choice !== "cancel")
      expect(live.isOpen).toBe(choice === "cancel")
      if (choice === "cancel") expect(api.closeLiveDocument).not.toHaveBeenCalled()
      else
        expect(api.closeLiveDocument).toHaveBeenCalledWith(
          expect.objectContaining({ target: workspace().project }),
          choice
        )
    }
  )

  it("retains the current baseline and reports failures for every mutating action", async () => {
    const { live, api } = fixture()
    live.applyWorkspace(workspace())
    api.executeLiveEdit.mockResolvedValueOnce(failure())
    api.saveLiveDocument.mockResolvedValueOnce(failure())
    api.configureLiveDocument.mockResolvedValueOnce(failure())
    api.closeLiveDocument.mockResolvedValueOnce(failure())
    for (const action of [
      () => live.edit({ type: "set-midi-bindings", bindings: [] }),
      () => live.save(),
      () => live.configure(configuration),
      () => live.close()
    ]) {
      expect(await action()).toBe(false)
      expect(live.workspace).toEqual(workspace())
      expect(live.error).not.toBe("")
      expect(live.pending).toBe(false)
    }
    api.closeLiveDocument.mockResolvedValueOnce(success(false))
    expect(await live.close()).toBe(false)
    expect(live.isOpen).toBe(true)
    live.pending = true
    expect(await live.save()).toBe(false)
    expect(await live.close()).toBe(false)
    live.pending = false
    live.applyWorkspace({ ...workspace(), mode: "perform" })
    expect(await live.edit("undo")).toBe(false)
    expect(await live.configure(configuration)).toBe(false)
  })

  it("handles create/open failure and cancelled preparation without retaining pending state", async () => {
    const { live, api } = fixture()
    api.createLiveDocument.mockResolvedValueOnce(failure())
    expect(await live.create(configuration)).toBeNull()
    expect(live.error).not.toBe("")
    api.prepareOpenLiveDocument.mockResolvedValueOnce(failure())
    expect(await live.open()).toBeNull()
    api.prepareOpenLiveDocument.mockResolvedValueOnce(success(null) as never)
    expect(await live.open()).toBeNull()
    api.prepareOpenLiveDocument.mockResolvedValueOnce(
      success({ path: "Stage.hrl", recoverableWorkingCopy: false })
    )
    api.openLiveDocument.mockResolvedValueOnce(failure())
    expect(await live.open()).toBeNull()
    expect(live.pending).toBe(false)
    expect(live.isOpen).toBe(false)
    useProjectStore().desktopSession = null
    expect(await live.create(configuration)).toBeNull()
    expect(await live.open()).toBeNull()
  })
})
