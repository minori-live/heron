import { encode } from "@msgpack/msgpack"
import type { AudioHostRuntime } from "@heron/dsp-node"
import { describe, expect, it } from "vitest"
import { AudioHostGateway } from "./audio-host-gateway"

describe.each(["request", "priority"] as const)("AudioHostGateway.%s", (method) => {
  it("returns a valid native response", async () => {
    const response = { request_id: 1, result: { type: "accepted" } }
    const client = {
      [method === "priority" ? "heartbeat" : "request"]: async () => ({
        body: Buffer.from(encode(response)),
        attachments: []
      }),
      drainEvents: () => []
    } as unknown as AudioHostRuntime
    const gateway = new AudioHostGateway(
      () => client,
      () => null,
      async () => {},
      new Set()
    )

    await expect(gateway[method]({ type: "shutdown" })).resolves.toEqual(response)
  })

  it("preserves structured audio-host errors and request context", async () => {
    const client = {
      [method === "priority" ? "heartbeat" : "request"]: async () => ({
        body: Buffer.from(
          encode({
            request_id: 1,
            result: {
              type: "error",
              error: {
                code: "invariant-violation",
                category: "invariant-violation",
                outcome: "quarantined",
                retry: "after-reconcile",
                correlationId: "audio-host-42",
                userMessageKey: "errors.audioEngineUnavailable",
                details: { type: "invariant-violation", component: "audio-host" }
              }
            }
          })
        ),
        attachments: []
      })
    } as unknown as AudioHostRuntime
    const gateway = new AudioHostGateway(
      () => client,
      () => null,
      async () => {},
      new Set()
    )

    const request = gateway[method]({ type: "load-plugin" })

    await expect(request).rejects.toMatchObject({
      name: "AudioHostRequestError",
      commandType: "load-plugin",
      message: "errors.audioEngineUnavailable (load-plugin, invariant-violation, audio-host-42)",
      rpcError: {
        correlationId: "audio-host-42",
        details: { type: "invariant-violation", component: "audio-host" }
      }
    })
  })

  it("rejects a response whose envelope the native side could not have produced", async () => {
    const respondWith = (payload: unknown) =>
      ({
        [method === "priority" ? "heartbeat" : "request"]: async () => ({
          body: Buffer.from(encode(payload)),
          attachments: []
        })
      }) as unknown as AudioHostRuntime
    const gatewayFor = (payload: unknown) =>
      new AudioHostGateway(
        () => respondWith(payload),
        () => null,
        async () => {},
        new Set()
      )

    // A result that is not an object used to reach `response.result.type` and
    // surface as a TypeError from inside the caller.
    await expect(
      gatewayFor({ request_id: 1, result: null })[method]({ type: "ping" })
    ).rejects.toThrow("errors.audioEngineUnavailable")
    await expect(
      gatewayFor({ request_id: 1, result: { type: 7 } })[method]({ type: "ping" })
    ).rejects.toThrow("errors.audioEngineUnavailable")
    await expect(
      gatewayFor({ request_id: 1, result: "accepted" })[method]({ type: "ping" })
    ).rejects.toThrow("errors.audioEngineUnavailable")
    await expect(gatewayFor(null)[method]({ type: "ping" })).rejects.toThrow(
      "errors.audioEngineUnavailable"
    )
  })

  it("rejects a response that answers a different request", async () => {
    const client = {
      [method === "priority" ? "heartbeat" : "request"]: async () => ({
        body: Buffer.from(encode({ request_id: 99, result: { type: "accepted" } })),
        attachments: []
      })
    } as unknown as AudioHostRuntime
    const gateway = new AudioHostGateway(
      () => client,
      () => null,
      async () => {},
      new Set()
    )

    await expect(gateway[method]({ type: "ping" })).rejects.toThrow(/audio host returned/u)
  })
})
