import { decode, encode } from "@msgpack/msgpack"
import { IPC_PROTOCOL_VERSION, rpcFailure } from "@heron/contracts"
import type { RpcRequestMeta } from "@heron/contracts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  AudioHostService,
  fakeHost,
  graph,
  pluginInstance,
  resetFakeHost
} from "./audio-host-service.fixture"

describe("AudioHostService graph", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetFakeHost()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("uses graph transactions for publication and preserves recovery state after prepare failure", async () => {
    const service = new AudioHostService(
      { workerThreads: "auto", maxBlockingThreads: "auto" },
      undefined,
      () => {},
      async () => {}
    )
    service.start()
    const original = graph(48_000)
    await service.loadGraph(1, original.project, original.runtime)
    const client = fakeHost.Client.instances[0]!
    const request = client.request.bind(client)
    vi.spyOn(client, "request").mockImplementation(async (payload) => {
      const { decode } = await import("@msgpack/msgpack")
      const message = decode(payload) as { command: { type: string } }
      if (message.command.type === "prepare-graph") throw new Error("candidate rejected")
      return request(payload)
    })
    await expect(service.loadGraph(2, original.project, original.runtime)).rejects.toThrow(
      "candidate rejected"
    )
    expect((service as unknown as { lastGraph: { revision: number } }).lastGraph.revision).toBe(1)
    expect(client.commands.some((command) => command.type === "update-graph")).toBe(false)
    expect(client.commands.some((command) => command.type === "activate-graph")).toBe(true)
    await service.stop()
  })

  it("does not update the committed recovery graph until candidate activation", async () => {
    const service = new AudioHostService(
      {
        workerThreads: "auto",
        maxBlockingThreads: "auto"
      },
      undefined,
      () => {},
      async () => {}
    )
    service.start()
    const candidate = graph(48_000)
    const meta = {
      protocolVersion: IPC_PROTOCOL_VERSION,
      requestId: "open-project",
      mutation: {
        operationId: "open-project-operation",
        idempotencyKey: "open-project-idempotency"
      }
    }
    const projectGraph = {
      kind: "project-graph" as const,
      id: "project:graph",
      epoch: "main-epoch",
      generation: 1
    }

    const prepared = await service.prepareGraphDeployment(
      meta,
      projectGraph,
      1,
      candidate.project,
      candidate.runtime
    )
    expect(prepared.ok).toBe(true)
    expect(
      (
        service as unknown as {
          lastGraph: { revision: number } | null
        }
      ).lastGraph
    ).toBeNull()
    if (!prepared.ok) throw new Error("test setup failed")

    const activated = await service.activateGraphDeployment(prepared.value)
    expect(activated).toMatchObject({ ok: true, value: { type: "activated" } })
    expect(
      (
        service as unknown as {
          lastGraph: { revision: number } | null
        }
      ).lastGraph?.revision
    ).toBe(1)

    await service.stop()
  })

  it("releases a rejected explicit deployment so a later graph publication can activate", async () => {
    const service = new AudioHostService(
      { workerThreads: "auto", maxBlockingThreads: "auto" },
      undefined,
      () => {},
      async () => {}
    )
    service.start()
    const candidate = graph(48_000)
    const client = fakeHost.Client.instances[0]!
    const projectGraph = {
      kind: "project-graph" as const,
      id: "project:graph",
      epoch: "main-epoch",
      generation: 1
    }
    const prepared = await service.prepareGraphDeployment(
      {
        protocolVersion: IPC_PROTOCOL_VERSION,
        requestId: "edit-1",
        mutation: { operationId: "edit-1", idempotencyKey: "edit-1" }
      },
      projectGraph,
      1,
      candidate.project,
      candidate.runtime
    )
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) throw new Error("test setup failed")
    const request = client.request.bind(client)
    let failActivation = true
    vi.spyOn(client, "request").mockImplementation(async (payload, attachments) => {
      const message = decode(payload) as {
        request_id: number
        command: { type: string; meta: RpcRequestMeta }
      }
      if (message.command.type === "activate-graph" && failActivation) {
        failActivation = false
        // Model native plug-in activation failure: its prepared candidate remains owned.
        expect(client.graphCandidate?.operationId).toBe("edit-1")
        return {
          attachments: [],
          body: Buffer.from(
            encode({
              request_id: message.request_id,
              result: {
                type: "graph-transaction",
                result: rpcFailure(message.command.meta, {
                  code: "dependency-failed",
                  category: "dependency-failed",
                  outcome: "not-committed",
                  retry: "after-reconcile",
                  correlationId: "plugin-activate-failed",
                  userMessageKey: "errors.graphDependencyFailed",
                  details: { type: "dependency-failed", dependency: projectGraph }
                })
              }
            })
          )
        }
      }
      return request(payload, attachments)
    })
    try {
      await expect(service.activateGraphDeployment(prepared.value)).resolves.toMatchObject({
        ok: false,
        error: { correlationId: "plugin-activate-failed", outcome: "not-committed" }
      })
      expect(client.graphCandidate).toBeNull()
      expect(client.graphRevision).toBe(0)
      await service.loadGraph(2, candidate.project, candidate.runtime)
      expect(client.graphRevision).toBe(2)
      expect(client.graphCandidate).toBeNull()
      expect(client.commands.filter((command) => command.type === "abort-graph")).toHaveLength(1)
    } finally {
      await service.stop()
    }
  })

  it("does not unload removed plugins until graph activation", async () => {
    const service = new AudioHostService(
      {
        workerThreads: "auto",
        maxBlockingThreads: "auto"
      },
      undefined,
      () => {},
      async () => {}
    )
    service.start()
    const plugin = pluginInstance()
    await service.loadPlugin(plugin, 48_000)
    const candidate = graph(48_000)

    await service.commitDesiredGraph({
      meta: {
        protocolVersion: IPC_PROTOCOL_VERSION,
        requestId: "remove-plugin"
      },
      projectGraph: {
        kind: "project-graph",
        id: "project:graph",
        epoch: "main-epoch",
        generation: 1
      },
      baseRevision: 1,
      graphRevision: 2,
      project: candidate.project,
      runtime: candidate.runtime
    })

    const client = fakeHost.Client.instances[0]!
    expect(client.commands.filter((command) => command.type === "unload-plugin")).toEqual([])
    await service.stop()
  })

  it("unloads plugin instances removed from the committed graph after activation", async () => {
    const service = new AudioHostService(
      {
        workerThreads: "auto",
        maxBlockingThreads: "auto"
      },
      undefined,
      () => {},
      async () => {}
    )
    service.start()
    const plugin = pluginInstance()
    await service.loadPlugin(plugin, 48_000)
    const candidate = graph(48_000)
    const prepared = await service.prepareGraphDeployment(
      {
        protocolVersion: IPC_PROTOCOL_VERSION,
        requestId: "remove-plugin"
      },
      {
        kind: "project-graph",
        id: "project:graph",
        epoch: "main-epoch",
        generation: 1
      },
      2,
      candidate.project,
      candidate.runtime
    )
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) throw new Error("test setup failed")

    const activated = await service.activateGraphDeployment(prepared.value)
    expect(activated).toMatchObject({ ok: true, value: { type: "activated" } })

    const client = fakeHost.Client.instances[0]!
    expect(client.commands.filter((command) => command.type === "unload-plugin")).toEqual([
      { type: "unload-plugin", instance_id: plugin.id }
    ])
    await service.stop()
  })
})
