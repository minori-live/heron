import { decode, encode } from "@msgpack/msgpack"
import { IPC_PROTOCOL_VERSION, rpcFailure } from "@heron/contracts"
import type { RpcError, RpcRequestMeta, ProjectGraphRef } from "@heron/contracts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AudioHostService, fakeHost, graph, resetFakeHost } from "./audio-host-service.fixture"

interface NativeRequest {
  request_id: number
  command: {
    type: string
    meta: RpcRequestMeta
    config?: { session_sample_rate: number }
    request: { projectGraph: ProjectGraphRef; graph?: { sample_rate: number } }
  }
}

const preferences = {
  backend: "asio" as const,
  inputDeviceId: "input",
  outputDeviceId: "output",
  bufferSize: 128
}

function projectRequest(id = "new-project") {
  return {
    meta: {
      protocolVersion: IPC_PROTOCOL_VERSION,
      requestId: id,
      mutation: { operationId: id, idempotencyKey: id }
    },
    projectGraph: {
      kind: "project-graph" as const,
      id: `${id}:graph`,
      epoch: "main-epoch",
      generation: 1
    }
  }
}

function nativeFailure(message: NativeRequest, failure?: RpcError) {
  return {
    attachments: [],
    body: Buffer.from(
      encode({
        request_id: message.request_id,
        result: {
          type: "graph-transaction",
          result: rpcFailure(
            message.command.meta,
            failure ?? {
              code: "dependency-failed",
              category: "dependency-failed",
              outcome: "not-committed",
              retry: "after-reconcile",
              correlationId: "native-graph-begin",
              userMessageKey: "errors.graphDependencyFailed",
              details: {
                type: "dependency-failed",
                dependency: message.command.request.projectGraph
              }
            }
          )
        }
      })
    )
  }
}

async function runningSession(sampleRate = 44_100) {
  const service = new AudioHostService(
    { workerThreads: "auto", maxBlockingThreads: "auto" },
    undefined,
    () => {},
    async () => {}
  )
  service.start()
  const client = fakeHost.Client.instances[0]!
  client.outputSampleRate = 44_100
  await service.startAudioEngine(preferences, sampleRate)
  const request = client.request.bind(client)
  const controls = {
    rejectPrepare: false,
    rejectActivation: false,
    unknownPrepare: false,
    throwAfterPrepare: false,
    unknownActivation: false,
    failedStartRates: new Set<number>(),
    prepareEntered: new fakeHost.Deferred<void>(),
    prepareGate: null as InstanceType<typeof fakeHost.Deferred<void>> | null,
    activationEntered: new fakeHost.Deferred<void>(),
    activationGate: null as InstanceType<typeof fakeHost.Deferred<void>> | null
  }
  vi.spyOn(client, "request").mockImplementation(async (payload, attachments) => {
    const message = decode(payload) as NativeRequest
    const command = message.command
    if (
      command.type === "start-audio-engine" &&
      command.config &&
      controls.failedStartRates.has(command.config.session_sample_rate)
    ) {
      // Native stream replacement drops the old streams before opening the new
      // device session. Exercise failure after that destructive runtime step.
      client.commands.push(command)
      client.engineState = "stopped"
      throw new Error("native stream replacement failed")
    }
    if (command.type === "prepare-graph") {
      controls.prepareEntered.resolve()
      if (controls.prepareGate) await controls.prepareGate.promise
      // This is Heron's native engine contract, not a synthetic plug-in failure:
      // publication.rs::engine_transport_handles rejects a running session with
      // another graph rate, and command_dispatch wraps it as dependency-failed.
      if (
        controls.rejectPrepare ||
        (client.engineState === "running" &&
          command.request.graph?.sample_rate !== client.sessionSampleRate)
      ) {
        client.commands.push(command)
        return nativeFailure(message)
      }
      if (controls.throwAfterPrepare || controls.unknownPrepare) {
        await request(payload, attachments)
        if (controls.throwAfterPrepare) throw new Error("native preparation reply was lost")
        return nativeFailure(message, {
          code: "operation-timeout-unknown",
          category: "timeout-unknown",
          outcome: "unknown",
          retry: "after-reconcile",
          correlationId: "native-preparation-unknown",
          userMessageKey: "errors.operationTimeout",
          details: { type: "operation-timeout-unknown", dispatched: true }
        })
      }
    }
    if (command.type === "activate-graph" && controls.rejectActivation) {
      client.commands.push(command)
      return nativeFailure(message)
    }
    if (command.type === "activate-graph" && controls.unknownActivation) {
      client.commands.push(command)
      return nativeFailure(message, {
        code: "operation-timeout-unknown",
        category: "timeout-unknown",
        outcome: "unknown",
        retry: "after-reconcile",
        correlationId: "native-activation-unknown",
        userMessageKey: "errors.operationTimeout",
        details: { type: "operation-timeout-unknown", dispatched: true }
      })
    }
    if (command.type === "activate-graph" && controls.activationGate) {
      const result = await request(payload, attachments)
      controls.activationEntered.resolve()
      await controls.activationGate.promise
      return result
    }
    return request(payload, attachments)
  })
  const prepare = (rate = 48_000, id = "new-project") => {
    const candidate = graph(rate)
    const { meta, projectGraph } = projectRequest(id)
    return service.prepareGraphDeployment(
      meta,
      projectGraph,
      client.graphRevision + 1,
      candidate.project,
      candidate.runtime
    )
  }
  return { service, client, controls, prepare }
}

describe("AudioHostService transactional session sample rate", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetFakeHost()
  })

  afterEach(() => vi.useRealTimers())

  it("restores the original session after replacement streams fail to start", async () => {
    const { service, client, controls, prepare } = await runningSession()
    client.transportState = 1
    client.positionFrames = 44_100
    controls.failedStartRates.add(48_000)
    try {
      await expect(prepare()).rejects.toThrow("native stream replacement failed")
      expect(client.engineState).toBe("running")
      expect(client.sessionSampleRate).toBe(44_100)
      expect(client.transportState).toBe(1)
      expect(client.positionFrames).toBe(44_100)
      expect(client.graphCandidate).toBeNull()
      controls.failedStartRates.clear()
      const retry = await prepare()
      expect(retry.ok).toBe(true)
      if (retry.ok) await service.abortGraphDeployment(retry.value)
    } finally {
      await service.stop()
    }
  })

  it("quarantines failed rollback until a snapshot can restore the previous session", async () => {
    const { service, client, controls, prepare } = await runningSession()
    try {
      const prepared = await prepare()
      if (!prepared.ok) throw new Error("candidate should prepare")
      controls.failedStartRates.add(44_100)
      await expect(service.abortGraphDeployment(prepared.value)).resolves.toMatchObject({
        ok: false,
        error: { outcome: "quarantined", retry: "after-reconcile" }
      })
      expect(client.graphCandidate).toBeNull()
      await expect(prepare(96_000, "competing-recovery")).resolves.toMatchObject({
        ok: false,
        error: { code: "resource-busy" }
      })
      controls.failedStartRates.clear()
      await expect(service.graphDeploymentSnapshot(projectRequest().meta)).resolves.toMatchObject({
        ok: true
      })
      expect(client.sessionSampleRate).toBe(44_100)
      const retry = await prepare()
      expect(retry.ok).toBe(true)
      if (retry.ok) await service.abortGraphDeployment(retry.value)
    } finally {
      await service.stop()
    }
  })

  it("prepares and activates a 48 kHz project with an existing 44.1 kHz device session", async () => {
    const { service, client, prepare } = await runningSession()
    try {
      const prepared = await prepare()
      expect(prepared.ok).toBe(true)
      if (!prepared.ok) throw new Error("project should prepare at its own session rate")
      expect(client.sessionSampleRate).toBe(48_000)
      expect(client.outputSampleRate).toBe(44_100)
      expect(client.graphRevision).toBe(0)
      await expect(service.activateGraphDeployment(prepared.value)).resolves.toMatchObject({
        ok: true
      })
      expect(client.graphRevision).toBe(1)
      expect(client.sessionSampleRate).toBe(48_000)
      const following = await prepare(48_000, "following-operation")
      expect(following.ok).toBe(true)
      if (following.ok) await service.abortGraphDeployment(following.value)
    } finally {
      await service.stop()
    }
  })

  it("keeps a matching running session without restarting its streams", async () => {
    const { service, client, prepare } = await runningSession(48_000)
    try {
      const prepared = await prepare()
      expect(prepared.ok).toBe(true)
      if (!prepared.ok) throw new Error("matching session should prepare")
      await expect(service.activateGraphDeployment(prepared.value)).resolves.toMatchObject({
        ok: true
      })
      expect(client.graphRevision).toBe(1)
      expect(
        client.commands.filter((command) => command.type === "start-audio-engine")
      ).toHaveLength(1)
    } finally {
      await service.stop()
    }
  })

  it("restores the previous session and transport when native preparation fails", async () => {
    const { service, client, controls, prepare } = await runningSession()
    client.transportState = 1
    client.positionFrames = 44_100
    client.loopEnabled = true
    client.loopStartTick = 960
    client.loopEndTick = 1920
    controls.rejectPrepare = true
    try {
      await expect(prepare()).resolves.toMatchObject({
        ok: false,
        error: {
          code: "dependency-failed",
          outcome: "not-committed"
        }
      })
      expect(client.sessionSampleRate).toBe(44_100)
      expect(client.graphRevision).toBe(0)
      expect(client.transportState).toBe(1)
      expect(client.positionFrames).toBe(44_100)
      expect(client.loopEnabled).toBe(true)
      expect([client.loopStartTick, client.loopEndTick]).toEqual([960, 1920])
      // The rejection must not retain rate-transition ownership.
      controls.rejectPrepare = false
      const retry = await prepare(48_000, "retry")
      expect(retry.ok).toBe(true)
      if (retry.ok) await service.abortGraphDeployment(retry.value)
    } finally {
      await service.stop()
    }
  })

  it.each(["abort", "cancel", "activation-failure"] as const)(
    "restores the previous session after %s and allows another preparation",
    async (outcome) => {
      const { service, client, controls, prepare } = await runningSession()
      client.transportState = 1
      client.positionFrames = 44_100
      try {
        const prepared = await prepare()
        expect(prepared.ok).toBe(true)
        if (!prepared.ok) throw new Error("candidate should prepare before rollback")
        expect(client.sessionSampleRate).toBe(48_000)
        if (outcome === "abort") {
          await expect(service.abortGraphDeployment(prepared.value)).resolves.toMatchObject({
            ok: true
          })
        } else if (outcome === "cancel") {
          await expect(
            service.activateGraphDeployment(prepared.value, { isCurrent: () => false })
          ).resolves.toMatchObject({ ok: false, error: { code: "operation-cancelled" } })
        } else {
          controls.rejectActivation = true
          await expect(service.activateGraphDeployment(prepared.value)).resolves.toMatchObject({
            ok: false,
            error: { code: "dependency-failed", outcome: "not-committed" }
          })
        }
        expect(client.graphRevision).toBe(0)
        expect(client.graphCandidate).toBeNull()
        expect(client.sessionSampleRate).toBe(44_100)
        expect(client.outputSampleRate).toBe(44_100)
        expect(client.transportState).toBe(1)
        expect(client.positionFrames).toBe(44_100)
        controls.rejectActivation = false
        const retry = await prepare(48_000, "after-rollback")
        expect(retry.ok).toBe(true)
        if (retry.ok) await service.abortGraphDeployment(retry.value)
      } finally {
        await service.stop()
      }
    }
  )

  it.each(["prepare-failure", "abort", "activation-failure"] as const)(
    "restores the committed graph before resuming playback after %s",
    async (outcome) => {
      const { service, client, controls, prepare } = await runningSession()
      try {
        const previous = await prepare(44_100, "previous-project")
        expect(previous.ok).toBe(true)
        if (!previous.ok) throw new Error("previous project should prepare")
        await expect(service.activateGraphDeployment(previous.value)).resolves.toMatchObject({
          ok: true
        })
        expect(client.activeGraphRevision).toBe(1)
        client.transportState = 1
        client.positionFrames = 44_100
        client.commands.length = 0
        if (outcome === "prepare-failure") {
          controls.rejectPrepare = true
          await expect(prepare()).resolves.toMatchObject({
            ok: false,
            error: { outcome: "not-committed" }
          })
        } else {
          const next = await prepare()
          expect(next.ok).toBe(true)
          if (!next.ok) throw new Error("next project should prepare")
          expect(client.activeGraphRevision).toBeNull()
          if (outcome === "abort") {
            await expect(service.abortGraphDeployment(next.value)).resolves.toMatchObject({
              ok: true
            })
          } else {
            controls.rejectActivation = true
            await expect(service.activateGraphDeployment(next.value)).resolves.toMatchObject({
              ok: false,
              error: { outcome: "not-committed" }
            })
          }
        }
        expect(client.graphCandidate).toBeNull()
        expect(client.graphRevision).toBe(1)
        expect(client.activeGraphRevision).toBe(1)
        expect(client.committedProjectGraph).toEqual(previous.value.projectGraph)
        expect(client.sessionSampleRate).toBe(44_100)
        expect(client.transportState).toBe(1)
        expect(client.positionFrames).toBe(44_100)
        const restarted = client.commands.findIndex(
          (command) =>
            command.type === "start-audio-engine" &&
            (command.config as { session_sample_rate: number }).session_sample_rate === 44_100
        )
        const restored = client.commands.findIndex(
          (command) => command.type === "restore-committed-graph"
        )
        const resumed = client.commands.findIndex(
          (command) =>
            command.type === "transport" && (command.command as { kind: string }).kind === "play"
        )
        expect(restarted).toBeGreaterThanOrEqual(0)
        expect(restored).toBeGreaterThan(restarted)
        expect(resumed).toBeGreaterThan(restored)
        expect(client.commands[restored]).toMatchObject({
          request: {
            projectGraph: previous.value.projectGraph,
            baseRevision: 1
          }
        })
      } finally {
        await service.stop()
      }
    }
  )

  it("retains the new session and operation ownership while activation is unknown", async () => {
    const { service, client, controls, prepare } = await runningSession()
    try {
      const prepared = await prepare()
      expect(prepared.ok).toBe(true)
      if (!prepared.ok) throw new Error("candidate should prepare")
      controls.unknownActivation = true
      await expect(service.activateGraphDeployment(prepared.value)).resolves.toMatchObject({
        ok: false,
        error: { code: "operation-timeout-unknown", outcome: "unknown" }
      })
      expect(client.sessionSampleRate).toBe(48_000)
      expect(client.graphCandidate?.operationId).toBe("new-project")
      await expect(prepare(96_000, "overlap-unknown")).resolves.toMatchObject({
        ok: false,
        error: { code: "resource-busy", outcome: "not-committed" }
      })
      expect(client.commands.filter((command) => command.type === "abort-graph")).toHaveLength(0)
      expect(
        client.commands.filter((command) => command.type === "start-audio-engine")
      ).toHaveLength(2)
      controls.unknownActivation = false
      await expect(service.activateGraphDeployment(prepared.value)).resolves.toMatchObject({
        ok: true
      })
      expect(client.graphRevision).toBe(1)
      expect(client.sessionSampleRate).toBe(48_000)
    } finally {
      await service.stop()
    }
  })

  it("keeps an explicitly stopped engine stopped when its candidate is aborted", async () => {
    const { service, client, prepare } = await runningSession()
    client.transportState = 1
    try {
      const prepared = await prepare()
      expect(prepared.ok).toBe(true)
      if (!prepared.ok) throw new Error("candidate should prepare")
      await service.stopAudioEngine()
      client.commands.length = 0
      await expect(service.abortGraphDeployment(prepared.value)).resolves.toMatchObject({
        ok: true
      })
      expect(client.engineState).toBe("stopped")
      expect(client.graphCandidate).toBeNull()
      expect(client.commands.filter((command) => command.type === "start-audio-engine")).toEqual([])
      expect(
        client.commands.filter(
          (command) =>
            command.type === "transport" && (command.command as { kind: string }).kind === "play"
        )
      ).toEqual([])
    } finally {
      await service.stop()
    }
  })

  it("allows identical preparation to recover after an unknown reply and snapshot", async () => {
    const { service, client, controls, prepare } = await runningSession()
    try {
      controls.unknownPrepare = true
      await expect(prepare()).resolves.toMatchObject({
        ok: false,
        error: { outcome: "unknown" }
      })
      expect(client.sessionSampleRate).toBe(48_000)
      expect(client.graphCandidate?.operationId).toBe("new-project")
      controls.unknownPrepare = false
      await expect(service.graphDeploymentSnapshot(projectRequest().meta)).resolves.toMatchObject({
        ok: true
      })
      const retry = await prepare()
      expect(retry.ok).toBe(true)
      if (!retry.ok) throw new Error("identical preparation should reconcile its candidate")
      await expect(service.activateGraphDeployment(retry.value)).resolves.toMatchObject({
        ok: true
      })
      expect(client.graphRevision).toBe(1)
      expect(client.sessionSampleRate).toBe(48_000)
    } finally {
      await service.stop()
    }
  })

  it("aborts a dispatched preparation with native authority when its reply throws", async () => {
    const { service, client, controls, prepare } = await runningSession()
    client.transportState = 1
    controls.throwAfterPrepare = true
    try {
      const result = await prepare().catch(() => null)
      expect(result?.ok).not.toBe(true)
      expect(client.graphCandidate).toBeNull()
      expect(client.sessionSampleRate).toBe(44_100)
      expect(client.transportState).toBe(1)
      expect(client.commands.find((command) => command.type === "abort-graph")).toMatchObject({
        meta: {
          target: {
            kind: "audio-engine",
            id: "engine",
            epoch: client.runtimeEpoch,
            generation: 1
          },
          expectedRevision: 0,
          mutation: { operationId: "new-project", idempotencyKey: "new-project" }
        },
        request: { helperEpoch: client.runtimeEpoch, baseRevision: 0 }
      })
    } finally {
      await service.stop()
    }
  })

  it("does not commit a delayed activation reply from a retired runtime", async () => {
    const { service, client, controls, prepare } = await runningSession()
    controls.activationGate = new fakeHost.Deferred<void>()
    let activation: ReturnType<typeof service.activateGraphDeployment> | undefined
    let stopping: Promise<void> | undefined
    try {
      const prepared = await prepare()
      expect(prepared.ok).toBe(true)
      if (!prepared.ok) throw new Error("candidate should prepare")
      activation = service.activateGraphDeployment(prepared.value)
      await controls.activationEntered.promise
      stopping = service.stop()
      await vi.waitFor(() => expect(client.closed).toBe(true))
      controls.activationGate.resolve()
      await expect(activation).resolves.toMatchObject({ ok: false })
      await stopping
      await expect(
        service.startBounceOutput({
          operation_id: "retired-runtime-check",
          output_channel_id: "output",
          start_frame: 0,
          end_frame: 1,
          target_sample_rate: 48_000,
          channel_mode: "stereo",
          include_tail: false,
          encoding: { type: "wav-float" },
          normalization: { mode: "off" },
          scratch_path: "unused.scratch",
          encoded_path: "unused.wav"
        })
      ).rejects.toThrow("project audio graph is unavailable")
    } finally {
      controls.activationGate.resolve()
      await activation
      await stopping
      await service.stop()
    }
  })

  it("does not let an old runtime deployment abort an identically named new reservation", async () => {
    const { service, prepare } = await runningSession()
    try {
      const old = await prepare()
      expect(old.ok).toBe(true)
      if (!old.ok) throw new Error("old candidate should prepare")
      await service.restartAfterOfflineBounce(false)
      const replacement = fakeHost.Client.instances[1]!
      const next = await prepare()
      expect(next.ok).toBe(true)
      if (!next.ok) throw new Error("replacement runtime should prepare")
      expect(next.value.meta.target?.epoch).not.toBe(old.value.meta.target?.epoch)
      replacement.commands.length = 0
      await service.abortGraphDeployment(old.value)
      expect(replacement.graphCandidate?.operationId).toBe("new-project")
      expect(replacement.commands.filter((command) => command.type === "abort-graph")).toEqual([])
      await expect(prepare(96_000, "overlap-new-runtime")).resolves.toMatchObject({
        ok: false,
        error: { code: "resource-busy" }
      })
      await expect(service.activateGraphDeployment(next.value)).resolves.toMatchObject({
        ok: true
      })
      expect(replacement.graphRevision).toBe(1)
    } finally {
      await service.stop()
    }
  })

  it("does not roll back a committed session when a stale caller aborts its preparation", async () => {
    const { service, client, prepare } = await runningSession()
    try {
      const prepared = await prepare()
      expect(prepared.ok).toBe(true)
      if (!prepared.ok) throw new Error("candidate should prepare")
      await expect(service.activateGraphDeployment(prepared.value)).resolves.toMatchObject({
        ok: true
      })
      await service.abortGraphDeployment(prepared.value)
      expect(client.sessionSampleRate).toBe(48_000)
      expect(client.graphRevision).toBe(1)
      expect(client.activeGraphRevision).toBe(1)
      expect(
        client.commands.filter((command) => command.type === "start-audio-engine")
      ).toHaveLength(2)
    } finally {
      await service.stop()
    }
  })

  it("rejects an overlapping rate change without invalidating the in-flight candidate", async () => {
    const { service, client, controls, prepare } = await runningSession()
    controls.prepareGate = new fakeHost.Deferred<void>()
    const first = prepare()
    const sameOperationRetry = prepare()
    try {
      const overlapping = await prepare(96_000, "overlapping-project")
      expect(overlapping).toMatchObject({
        ok: false,
        error: {
          code: "resource-busy",
          outcome: "not-committed"
        }
      })
      await controls.prepareEntered.promise
      expect(client.sessionSampleRate).toBe(48_000)
      controls.prepareGate.resolve()
      const prepared = await first
      expect(prepared.ok).toBe(true)
      if (!prepared.ok) throw new Error("the first preparation must remain usable")
      await expect(sameOperationRetry).resolves.toMatchObject({ ok: true })
      await expect(prepare()).resolves.toMatchObject({ ok: true })
      await expect(prepare(96_000, "overlap-after-prepare")).resolves.toMatchObject({
        ok: false,
        error: { code: "resource-busy", outcome: "not-committed" }
      })
      await expect(service.activateGraphDeployment(prepared.value)).resolves.toMatchObject({
        ok: true
      })
      expect(client.graphRevision).toBe(1)
      expect(client.sessionSampleRate).toBe(48_000)
      const startedRates = client.commands
        .filter((command) => command.type === "start-audio-engine")
        .map((command) => (command.config as { session_sample_rate: number }).session_sample_rate)
      expect(startedRates).toEqual([44_100, 48_000])
    } finally {
      controls.prepareGate.resolve()
      await first
      await sameOperationRetry
      await service.stop()
    }
  })
})
