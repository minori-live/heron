import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LiveDocumentConfiguration, LiveSession, RpcResult } from "@heron/contracts"
vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => [] } }))
import { ApplicationStateStore, OperationRegistry, OperationService } from "../kernel"
import { LiveDocumentCoordinator } from "./live-document-coordinator"
import type { LiveDocumentService, ProjectService } from "../project"
import type { ApplicationSettingsStore } from "../settings"
import { meta, mutationMeta } from "./test-harness"

const configuration: LiveDocumentConfiguration = {
  name: "Stage",
  sampleRate: 48000,
  audio: null,
  enabledMidiDeviceIds: []
}
function fixture() {
  const stateResult = ApplicationStateStore.create({ project: null })
  if (!stateResult.ok) throw new Error("state creation failed")
  const state = stateResult.value
  const operations = new OperationService(new OperationRegistry(), state.desktopSession)
  const session: LiveSession = {
    kind: "live",
    id: "stage",
    path: "Stage.hrl",
    configuration,
    dirty: false,
    recoveredWorkingCopy: false
  }
  let revision = 0
  const graph = { sampleRate: 48000, channels: [], plugins: [], sends: [] }
  const baseline = () => ({ snapshot: { graph, parameterValues: [] }, bindings: [], revision })
  const documents = {
    current: null as LiveSession | null,
    history: { canUndo: false, canRedo: false },
    prepareCreate: vi.fn(async () => structuredClone(session)),
    prepareOpen: vi.fn(async () => structuredClone(session)),
    mixerSnapshot: vi.fn(async () => graph),
    midiBindings: vi.fn(async () => []),
    baseline: vi.fn(async () => baseline()),
    commitCandidate: vi.fn(() => (documents.current = structuredClone(session))),
    abortCandidate: vi.fn(async () => undefined),
    save: vi.fn(
      async (): Promise<LiveSession> => (documents.current = { ...session, dirty: false })
    ),
    executeEdit: vi.fn(async () => {
      revision++
      documents.current!.dirty = true
      return baseline()
    }),
    undoEdit: vi.fn(async () => {
      revision++
      return baseline()
    }),
    redoEdit: vi.fn(async () => {
      revision++
      return baseline()
    }),
    updateConfiguration: vi.fn(async (next: LiveDocumentConfiguration) => {
      revision++
      return (documents.current = { ...session, configuration: next, dirty: true })
    }),
    close: vi.fn(async (choice: string) => {
      if (choice === "cancel") return false
      documents.current = null
      return true
    })
  }
  const studio = { current: null }
  const settings = { addRecent: vi.fn(async () => undefined) }
  const coordinator = new LiveDocumentCoordinator(
    documents as unknown as LiveDocumentService,
    studio as unknown as ProjectService,
    state,
    operations,
    settings as unknown as ApplicationSettingsStore
  )
  let operation = 0
  const request = () => {
    const current = state.liveWorkspaceSnapshot()
    const id = `op-${++operation}`
    return mutationMeta(current?.project ?? state.desktopSession, {
      expectedRevision: current?.revision ?? 0,
      mutation: { operationId: id, idempotencyKey: id }
    })
  }
  const create = () => coordinator.create(request(), configuration, "Stage.hrl")
  return { coordinator, documents, state, operations, settings, studio, request, create }
}
function value<T>(result: RpcResult<T>): T {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined)
})

describe("Live document coordination", () => {
  it("publishes explicit resources and revisioned edits, undo/redo, configuration and save", async () => {
    const f = fixture()
    const opened = value(await f.create())
    expect(opened).toMatchObject({ kind: "live", mode: "edit", revision: 0 })
    expect(f.state.resources.resolve(opened.project).ok).toBe(true)
    expect(f.state.resources.resolve(opened.projectGraph).ok).toBe(true)
    expect(f.settings.addRecent).toHaveBeenCalledWith("Stage.hrl", "Stage", "live")
    expect(value(f.coordinator.snapshot(meta({ target: opened.project })))).toEqual(opened)
    const edited = value(
      await f.coordinator.edit(f.request(), { type: "set-midi-bindings", bindings: [] })
    )
    expect(edited.revision).toBe(1)
    expect(value(await f.coordinator.edit(f.request(), "undo")).revision).toBe(2)
    expect(value(await f.coordinator.edit(f.request(), "redo")).revision).toBe(3)
    const configured = value(
      await f.coordinator.configure(f.request(), { ...configuration, name: "Tour" })
    )
    expect(configured.session.configuration.name).toBe("Tour")
    expect(configured.revision).toBe(4)
    const saved = value(await f.coordinator.save(f.request()))
    expect(saved.session.dirty).toBe(false)
    expect(saved.revision).toBe(4)
    expect(value(await f.coordinator.close(f.request(), "cancel"))).toBe(false)
    expect(f.state.liveWorkspaceSnapshot()).not.toBeNull()
    expect(value(await f.coordinator.close(f.request(), "discard"))).toBe(true)
    expect(f.state.liveWorkspaceSnapshot()).toBeNull()
    expect(f.state.resources.resolve(opened.project).ok).toBe(false)
    expect(f.state.resources.resolve(opened.projectGraph).ok).toBe(false)
  })

  it("opens recovery candidates and treats recent-list failure as ancillary", async () => {
    const f = fixture()
    f.settings.addRecent.mockRejectedValueOnce(new Error("settings unavailable"))
    expect((await f.coordinator.open(f.request(), "Stage.hrl", true)).ok).toBe(true)
    expect(f.documents.prepareOpen).toHaveBeenCalledWith("Stage.hrl", true)
    expect(
      await f.coordinator.create(mutationMeta(f.state.desktopSession), configuration, "a.hrl")
    ).toMatchObject({ ok: false, error: { code: "resource-busy" } })
  })

  it("rejects stale targets, revisions and Perform structural edits before touching storage", async () => {
    const f = fixture()
    expect(f.coordinator.snapshot(meta())).toMatchObject({ ok: false })
    expect(await f.coordinator.save(f.request())).toMatchObject({ ok: false })
    expect(await f.coordinator.close(f.request(), "discard")).toMatchObject({ ok: false })
    expect(await f.coordinator.create(meta(), configuration, "a.hrl")).toMatchObject({ ok: false })
    const opened = value(await f.create())
    expect(f.coordinator.snapshot(meta())).toMatchObject({
      ok: false,
      error: { code: "stale-resource" }
    })
    expect(
      await f.coordinator.edit({ ...f.request(), expectedRevision: 99 }, "undo")
    ).toMatchObject({ ok: false, error: { code: "revision-conflict" } })
    f.state.setLiveWorkspace({ ...opened, mode: "perform" })
    expect(await f.coordinator.edit(f.request(), "undo")).toMatchObject({
      ok: false,
      error: { details: { field: "mode" } }
    })
    expect(await f.coordinator.configure(f.request(), configuration)).toMatchObject({ ok: false })
    expect(f.documents.undoEdit).not.toHaveBeenCalled()
    expect(f.documents.updateConfiguration).not.toHaveBeenCalled()
    expect(await f.coordinator.close(meta({ target: opened.project }), "discard")).toMatchObject({
      ok: false
    })
  })

  it("reconciles completed save operations and refuses overlapping duplicates", async () => {
    const f = fixture()
    await f.create()
    const request = f.request()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    f.documents.save.mockImplementationOnce(async () => {
      await gate
      return f.documents.current!
    })
    const pending = f.coordinator.save(request)
    expect(await f.coordinator.save(request)).toMatchObject({
      ok: false,
      error: { code: "resource-busy" }
    })
    release()
    const result = await pending
    expect(await f.coordinator.save(request)).toEqual(result)
    expect(f.documents.save).toHaveBeenCalledTimes(1)
  })

  it.each([
    [new TypeError("invalid"), "validation-failed"],
    [
      Object.assign(new Error("wrong kind"), { code: "format-mismatch" }),
      "document-format-mismatch"
    ],
    [
      Object.assign(new Error("newer"), { code: "unsupported-version" }),
      "unsupported-document-version"
    ],
    [Object.assign(new Error("stale"), { code: "revision-conflict" }), "revision-conflict"],
    [new Error("storage unavailable"), "resource-unavailable"]
  ])("aborts failed preparation and records its typed outcome: %s", async (error, code) => {
    const f = fixture()
    f.documents.prepareCreate.mockRejectedValueOnce(error)
    const request = f.request()
    expect(await f.coordinator.create(request, configuration, "a.hrl")).toMatchObject({
      ok: false,
      error: { code }
    })
    expect(f.documents.abortCandidate).toHaveBeenCalledOnce()
    expect(f.state.liveWorkspaceSnapshot()).toBeNull()
    expect(f.operations.registry.activeCount).toBe(0)
  })

  it("cleans up a committed candidate when baseline publication fails", async () => {
    const f = fixture()
    f.documents.baseline.mockRejectedValueOnce(new Error("read failed"))
    expect(await f.create()).toMatchObject({ ok: false })
    expect(f.documents.close).toHaveBeenCalledWith("discard")
    expect(f.documents.current).toBeNull()
    expect(f.state.liveWorkspaceSnapshot()).toBeNull()
  })

  it.each(["save", "configure", "edit"] as const)(
    "quarantines unknown %s outcomes until explicit close",
    async (action) => {
      const f = fixture()
      await f.create()
      const unknown = Object.assign(new Error("lost acknowledgement"), {
        code: "operation-outcome-unknown"
      })
      if (action === "save") f.documents.save.mockRejectedValueOnce(unknown)
      if (action === "configure") f.documents.updateConfiguration.mockRejectedValueOnce(unknown)
      if (action === "edit") f.documents.executeEdit.mockRejectedValueOnce(unknown)
      const result =
        action === "save"
          ? await f.coordinator.save(f.request())
          : action === "configure"
            ? await f.coordinator.configure(f.request(), configuration)
            : await f.coordinator.edit(f.request(), { type: "set-midi-bindings", bindings: [] })
      expect(result).toMatchObject({ ok: false, error: { outcome: "quarantined" } })
      expect(await f.coordinator.save(f.request())).toMatchObject({
        ok: false,
        error: { outcome: "quarantined" }
      })
      expect(value(await f.coordinator.close(f.request(), "discard"))).toBe(true)
      expect((await f.create()).ok).toBe(true)
      expect((await f.coordinator.save(f.request())).ok).toBe(true)
    }
  )

  it("detects stale resources after a successful disk commit", async () => {
    const f = fixture()
    const opened = value(await f.create())
    await f.state.resources.drop(opened.projectGraph)
    expect(await f.coordinator.save(f.request())).toMatchObject({
      ok: false,
      error: { outcome: "quarantined" }
    })
    expect(f.state.liveWorkspaceSnapshot()).toEqual(opened)
  })

  it("preserves the document on close failure", async () => {
    const f = fixture()
    await f.create()
    f.documents.close.mockRejectedValueOnce(new Error("archive failed"))
    expect(await f.coordinator.close(f.request(), "save")).toMatchObject({ ok: false })
    expect(f.state.liveWorkspaceSnapshot()).not.toBeNull()
  })
})
