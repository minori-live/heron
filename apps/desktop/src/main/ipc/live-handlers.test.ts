import { beforeEach, describe, expect, it, vi } from "vitest"
import { IPC_CHANNELS, rpcSuccess } from "@heron/contracts"
import type { LiveEditCommand } from "@heron/contracts"

const electron = vi.hoisted(() => ({
  handle: vi.fn(),
  showSaveDialog: vi.fn(),
  showOpenDialog: vi.fn(),
  getAllWindows: vi.fn(() => []),
  fromWebContents: vi.fn(),
  shellOpenPath: vi.fn(),
  quit: vi.fn(),
  showAboutPanel: vi.fn(),
  getPath: vi.fn(() => "/tmp/heron-test")
}))
vi.mock("electron", () => ({
  app: { getPath: electron.getPath },
  ipcMain: { handle: electron.handle },
  dialog: electron,
  BrowserWindow: electron
}))
vi.mock("../settings", () => ({ t: (key: string) => key }))
import { registerLiveHandlers } from "./live-handlers"
import { invoke, meta, mutationMeta, ref } from "./test-harness"
import type { LiveDocumentCoordinator } from "./live-document-coordinator"
import type { LiveDocumentService } from "../project"
import type { ApplicationStateStore } from "../kernel"

const configuration = { name: "Stage", sampleRate: 48000, audio: null, enabledMidiDeviceIds: [] }
const desktop = ref("desktop-session", "desktop")
const project = ref("project-session", "stage")
function fixture() {
  const coordinator = Object.fromEntries(
    ["create", "open", "snapshot", "save", "close", "edit", "configure"].map((name) => [
      name,
      vi.fn(async (request) => rpcSuccess(request, { accepted: true }))
    ])
  ) as unknown as LiveDocumentCoordinator
  const documents = { hasRecoverableWorkingCopy: vi.fn(async () => true) }
  registerLiveHandlers(
    coordinator,
    documents as unknown as LiveDocumentService,
    { desktopSession: desktop } as ApplicationStateStore
  )
  return { coordinator, documents }
}

describe("Live document RPC boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.HERON_TEST_LIVE_PATH
  })

  it("admits every typed Edit command, including insert, move and replacement", async () => {
    const { coordinator } = fixture()
    // This exhaustiveness check catches future additions forgotten at the IPC boundary.
    const commands = {
      "create-channel": { type: "create-channel", channel: { id: "audio" } },
      "update-channel": { type: "update-channel", channelId: "audio", patch: { gainDb: -6 } },
      "delete-channel": { type: "delete-channel", channelId: "audio" },
      "create-send": { type: "create-send", send: { id: "send" } },
      "update-send": { type: "update-send", sendId: "send", patch: { enabled: true } },
      "delete-send": { type: "delete-send", sendId: "send" },
      "create-plugin": { type: "create-plugin", plugin: { id: "fx" } },
      "insert-plugin": { type: "insert-plugin", plugin: { id: "fx", slotOrder: 0 } },
      "update-plugin": { type: "update-plugin", pluginId: "fx", patch: { enabled: false } },
      "delete-plugin": { type: "delete-plugin", pluginId: "fx" },
      "move-plugin": { type: "move-plugin", pluginId: "fx", channelId: "audio", slotOrder: 1 },
      "replace-plugin": { type: "replace-plugin", pluginId: "fx", plugin: { id: "fx" } },
      "set-midi-bindings": { type: "set-midi-bindings", bindings: [] }
    } satisfies Record<LiveEditCommand["type"], unknown>
    for (const command of Object.values(commands)) {
      const request = mutationMeta(project)
      expect(await invoke(electron, IPC_CHANNELS.liveEdit, request, command)).toMatchObject({
        ok: true
      })
      expect(coordinator.edit).toHaveBeenLastCalledWith(request, command)
    }
    for (const command of [
      null,
      "insert-plugin",
      {},
      { type: "toString" },
      { type: "drop-table" }
    ]) {
      expect(
        await invoke(electron, IPC_CHANNELS.liveEdit, mutationMeta(project), command)
      ).toMatchObject({ ok: false, error: { code: "validation-failed" } })
    }
    expect(coordinator.edit).toHaveBeenCalledTimes(Object.keys(commands).length)
  })

  it("dispatches document kinds, validates handles and preserves cancelled open dialogs", async () => {
    const { documents } = fixture()
    const request = meta({ target: desktop })
    for (const [path, kind] of [
      ["a.hrl", "live"],
      ["a.hrs", "studio"],
      ["a.heron", "studio"]
    ]) {
      expect(await invoke(electron, IPC_CHANNELS.documentPrepareOpen, request, path)).toMatchObject(
        { ok: true, value: { kind, path } }
      )
    }
    expect(
      await invoke(electron, IPC_CHANNELS.documentPrepareOpen, request, "a.wav")
    ).toMatchObject({ ok: false })
    expect(await invoke(electron, IPC_CHANNELS.documentPrepareOpen, meta(), "a.hrl")).toMatchObject(
      { ok: false, error: { code: "stale-resource" } }
    )
    electron.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await invoke(electron, IPC_CHANNELS.documentPrepareOpen, request)).toMatchObject({
      value: null
    })
    expect(await invoke(electron, IPC_CHANNELS.livePrepareOpen, request)).toMatchObject({
      value: null
    })
    electron.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["a.hrl"] })
    expect(await invoke(electron, IPC_CHANNELS.documentPrepareOpen, request)).toMatchObject({
      value: { kind: "live" }
    })
    expect(await invoke(electron, IPC_CHANNELS.livePrepareOpen, request)).toMatchObject({
      value: { path: "a.hrl", recoverableWorkingCopy: true }
    })
    expect(documents.hasRecoverableWorkingCopy).toHaveBeenCalledWith("a.hrl")
    expect(await invoke(electron, IPC_CHANNELS.livePrepareOpen, request, "a.hrs")).toMatchObject({
      ok: false
    })
    expect(await invoke(electron, IPC_CHANNELS.livePrepareOpen, meta(), "a.hrl")).toMatchObject({
      ok: false
    })
  })

  it("creates with explicit or selected paths and validates configuration", async () => {
    const { coordinator } = fixture()
    const request = mutationMeta(desktop)
    expect(
      await invoke(electron, IPC_CHANNELS.liveCreate, request, configuration, "a.hrl")
    ).toMatchObject({ ok: true })
    expect(coordinator.create).toHaveBeenLastCalledWith(request, configuration, "a.hrl")
    electron.showSaveDialog.mockResolvedValue({ canceled: false, filePath: "chosen.hrl" })
    expect(await invoke(electron, IPC_CHANNELS.liveCreate, request, configuration)).toMatchObject({
      ok: true
    })
    expect(coordinator.create).toHaveBeenLastCalledWith(request, configuration, "chosen.hrl")
    electron.showSaveDialog.mockResolvedValue({ canceled: true })
    expect(await invoke(electron, IPC_CHANNELS.liveCreate, request, configuration)).toMatchObject({
      ok: false
    })
    for (const value of [
      null,
      {},
      { ...configuration, name: " " },
      { ...configuration, sampleRate: 1 },
      { ...configuration, enabledMidiDeviceIds: [""] },
      { ...configuration, audio: {} }
    ]) {
      expect(
        await invoke(electron, IPC_CHANNELS.liveCreate, request, value, "a.hrl")
      ).toMatchObject({ ok: false })
      expect(await invoke(electron, IPC_CHANNELS.liveConfigure, request, value)).toMatchObject({
        ok: false
      })
    }
    const configured = {
      ...configuration,
      audio: { backend: "mock", inputDeviceId: "input", outputDeviceId: "output", bufferSize: 256 }
    }
    expect(
      await invoke(electron, IPC_CHANNELS.liveConfigure, mutationMeta(project), configured)
    ).toMatchObject({ ok: true })
    expect(
      await invoke(electron, IPC_CHANNELS.liveCreate, request, configuration, 123)
    ).toMatchObject({ ok: false })
  })

  it("routes recovery, history, save, snapshot and explicit close dispositions", async () => {
    const { coordinator } = fixture()
    const request = mutationMeta(project)
    expect(
      await invoke(electron, IPC_CHANNELS.liveOpen, mutationMeta(desktop), "a.hrl", true)
    ).toMatchObject({ ok: true })
    expect(coordinator.open).toHaveBeenCalledWith(expect.anything(), "a.hrl", true)
    for (const [path, recover] of [
      ["a.wav", true],
      ["a.hrl", "yes"],
      [4, false]
    ]) {
      expect(await invoke(electron, IPC_CHANNELS.liveOpen, request, path, recover)).toMatchObject({
        ok: false
      })
    }
    for (const channel of [IPC_CHANNELS.liveUndo, IPC_CHANNELS.liveRedo, IPC_CHANNELS.liveSave]) {
      expect(await invoke(electron, channel, request)).toMatchObject({ ok: true })
    }
    expect(coordinator.edit).toHaveBeenCalledWith(request, "undo")
    expect(coordinator.edit).toHaveBeenCalledWith(request, "redo")
    expect(
      await invoke(electron, IPC_CHANNELS.liveSnapshot, meta({ target: project }))
    ).toMatchObject({ ok: true })
    for (const choice of ["save", "discard", "cancel"]) {
      expect(await invoke(electron, IPC_CHANNELS.liveClose, request, choice)).toMatchObject({
        ok: true
      })
    }
    expect(await invoke(electron, IPC_CHANNELS.liveClose, request, "quit")).toMatchObject({
      ok: false
    })
  })
})
