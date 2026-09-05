import { createPinia, setActivePinia } from "pinia"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ApplicationUpdateSnapshot, RpcEvent } from "@heron/contracts"
import { useApplicationUpdatesStore } from "./applicationUpdates"
import { useProjectStore } from "./project"
import { rpcSuccess, testBootstrap } from "../test/ipc"

const { closeProject } = vi.hoisted(() => ({ closeProject: vi.fn() }))
vi.mock("./studioWorkflow", () => ({ useStudioWorkflowStore: () => ({ closeProject }) }))
vi.mock("./transport", () => ({ useTransportStore: () => ({ snapshot: { state: "stopped" } }) }))
vi.mock("./recording", () => ({ useRecordingStore: () => ({ lifecycle: { status: "idle" } }) }))
vi.mock("./operations", () => ({ useOperationStore: () => ({ operations: [] }) }))

const ready: ApplicationUpdateSnapshot = {
  revision: 3,
  phase: "ready",
  currentVersion: "1.0.0",
  channel: "latest",
  availableVersion: "1.1.0",
  progress: 100,
  error: null
}

beforeEach(() => {
  setActivePinia(createPinia())
  useProjectStore().applyBootstrap(testBootstrap())
  closeProject.mockReset()
  Object.assign(window.heron, {
    updateSnapshot: vi.fn(async () => rpcSuccess(ready)),
    updateCommand: vi.fn(async () =>
      rpcSuccess({ accepted: true, snapshot: { ...ready, revision: 4, phase: "installing" } })
    ),
    subscribeUpdates: vi.fn(() => () => {})
  })
})

describe("application updates", () => {
  it("never requests installation when the save/close workflow is cancelled", async () => {
    useProjectStore().lifecycle = {
      status: "open",
      error: null,
      session: {
        id: "p",
        path: "p.heron",
        dirty: true,
        recoveredWorkingCopy: false,
        configuration: {
          name: "Song",
          sampleRate: 48000,
          timeSignatureNumerator: 4,
          timeSignatureDenominator: 4,
          waveformDisplayMode: "separate"
        }
      }
    }
    closeProject.mockResolvedValue(false)
    const store = useApplicationUpdatesStore()
    await store.connect()
    await store.install()
    expect(closeProject).toHaveBeenCalledOnce()
    expect(window.heron.updateCommand).not.toHaveBeenCalled()
    expect(store.snapshot?.phase).toBe("ready")
  })
  it("uses an explicit session, revision and mutation identity for installation", async () => {
    const store = useApplicationUpdatesStore()
    await store.connect()
    await store.install()
    expect(window.heron.updateCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        target: testBootstrap().desktopSession,
        expectedRevision: 3,
        mutation: expect.objectContaining({ idempotencyKey: expect.any(String) })
      }),
      "install"
    )
    expect(store.snapshot?.phase).toBe("installing")
  })
  it("subscribes once and ignores stale revisions and foreign epochs", async () => {
    let listener!: (event: RpcEvent<ApplicationUpdateSnapshot>) => void
    vi.mocked(window.heron.subscribeUpdates).mockImplementation((callback) => {
      listener = callback
      return () => {}
    })
    const store = useApplicationUpdatesStore()
    await store.connect()
    await store.connect()
    expect(window.heron.subscribeUpdates).toHaveBeenCalledOnce()
    listener({
      protocolVersion: 2,
      sourceEpoch: "foreign",
      sequence: 9,
      resourceRevision: 9,
      payload: { ...ready, revision: 9, phase: "idle" }
    })
    listener({
      protocolVersion: 2,
      sourceEpoch: testBootstrap().mainEpoch,
      sequence: 2,
      resourceRevision: 2,
      payload: { ...ready, revision: 2, phase: "downloading" }
    })
    expect(store.snapshot?.phase).toBe("ready")
  })
})
