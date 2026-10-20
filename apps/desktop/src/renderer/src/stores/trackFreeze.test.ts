import { beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import type { ProjectGraphRef } from "@heron/contracts"
import { useProjectStore } from "./project"
import { useTrackFreezeStore } from "./trackFreeze"

const graph: ProjectGraphRef = { kind: "project-graph", id: "graph", epoch: "test", generation: 1 }

describe("track freeze store", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const project = useProjectStore()
    project.projectGraphRef = graph
    project.projectRevision = 4
    Object.assign(window.heron, { startTrackFreeze: vi.fn() })
  })

  it("starts a freeze for the open project graph", async () => {
    vi.mocked(window.heron.startTrackFreeze).mockResolvedValue({
      ok: true,
      requestId: "request",
      operationId: "operation",
      warnings: [],
      value: { operationId: "freeze-1" }
    })
    await expect(useTrackFreezeStore().start("track:vocal")).resolves.toEqual({
      operationId: "freeze-1"
    })
    expect(window.heron.startTrackFreeze).toHaveBeenCalledWith(
      expect.objectContaining({
        target: graph,
        expectedRevision: 4,
        mutation: expect.objectContaining({ operationId: expect.stringContaining("track-freeze") })
      }),
      { trackId: "track:vocal" }
    )
  })

  it("returns nothing when the project is closed or the host refuses the start", async () => {
    useProjectStore().projectGraphRef = null
    await expect(useTrackFreezeStore().start("track:vocal")).resolves.toBeNull()
    expect(window.heron.startTrackFreeze).not.toHaveBeenCalled()

    useProjectStore().projectGraphRef = graph
    vi.mocked(window.heron.startTrackFreeze).mockResolvedValue({
      ok: true,
      requestId: "request",
      operationId: "operation",
      warnings: [],
      value: null
    })
    await expect(useTrackFreezeStore().start("track:vocal")).resolves.toBeNull()
  })
})
