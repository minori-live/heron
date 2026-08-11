import { encode } from "@msgpack/msgpack"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AudioHostService, fakeHost, resetFakeHost } from "./audio-host-service.fixture"

describe("AudioHostService events", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetFakeHost()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("rejects a native side-chain request when its application handler fails", async () => {
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
    service.setPluginSidechainRouteRequestHandler(async () => {
      throw new Error("project command failed")
    })
    const error = vi.spyOn(console, "error").mockImplementation(() => {})

    ;(
      service as unknown as {
        events: {
          dispatchSidechain(request: {
            requestId: number
            instanceId: string
            inputPortKey: string
            sourceChannelId: string | null
          }): void
        }
      }
    ).events.dispatchSidechain({
      requestId: 41,
      instanceId: "sidechain-1",
      inputPortKey: "vst3:audio:input:2",
      sourceChannelId: "audio-1"
    })

    const client = fakeHost.Client.instances[0]!
    await vi.waitFor(() =>
      expect(client.commands).toContainEqual({
        type: "resolve-plugin-sidechain-route",
        request_id: 41,
        instance_id: "sidechain-1",
        accepted: false,
        warning: "Side-chain routing could not be committed."
      })
    )
    expect(error).toHaveBeenCalledWith(
      "Could not commit a VST3 side-chain route",
      expect.objectContaining({ message: "project command failed" })
    )

    error.mockRestore()
    await service.stop()
  })

  it("waits for pending application event handlers before stopping", async () => {
    const handler = new fakeHost.Deferred<void>()
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
    service.setPluginHostNotificationHandler(() => handler.promise)
    ;(
      service as unknown as {
        events: {
          dispatchPlugin(notification: { instanceId: string; kind: string; value: string }): void
        }
      }
    ).events.dispatchPlugin({
      instanceId: "plugin-1",
      kind: "dirty-changed",
      value: "true"
    })

    let stopped = false
    const stop = service.stop().then(() => {
      stopped = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(stopped).toBe(false)

    handler.resolve()
    await stop
    expect(stopped).toBe(true)
  })

  it("dispatches recovery and plug-in failure events while running and during shutdown", async () => {
    const service = new AudioHostService(
      {
        workerThreads: "auto",
        maxBlockingThreads: "auto"
      },
      undefined,
      () => {},
      async () => {}
    )
    const recoveries = vi.fn()
    const failures = vi.fn()
    service.setDeviceRecoveryHandler(recoveries)
    service.setPluginFailureHandler(failures)
    service.start()

    const events = [
      Buffer.from(encode({ type: "audio-device-recovery-changed", recovery: null })),
      Buffer.from(
        encode({
          type: "plugin-failure",
          failure: {
            instance_id: "fx-1",
            instance_generation: 3,
            graph_revision: 17,
            category: "invalid-output",
            stage: "process",
            outcome: "failed",
            recoverable: true,
            diagnostic_id: "plugin:fx-1:process",
            message: "the plug-in produced non-finite audio"
          }
        })
      )
    ]
    const client = fakeHost.Client.instances[0]!
    vi.spyOn(client, "drainEvents").mockImplementation(() => events)
    ;(
      service as unknown as {
        gateway: { drainEvents(client: InstanceType<typeof fakeHost.Client>): void }
      }
    ).gateway.drainEvents(client)

    await vi.waitFor(() => {
      expect(recoveries).toHaveBeenCalledWith(null)
      expect(failures).toHaveBeenCalledWith(
        expect.objectContaining({ instanceId: "fx-1", category: "invalid-output" })
      )
    })

    await service.stop()
    expect(recoveries.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(failures.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it("delegates plug-in retry to the owned runtime client", async () => {
    const service = new AudioHostService(
      {
        workerThreads: "auto",
        maxBlockingThreads: "auto"
      },
      undefined,
      () => {},
      async () => {}
    )
    const retryPlugin = vi.fn(async () => undefined)
    ;(
      service as unknown as {
        plugins: { retryPlugin(instanceId: string): Promise<void> }
      }
    ).plugins.retryPlugin = retryPlugin

    await service.retryPlugin("fx-1")

    expect(retryPlugin).toHaveBeenCalledWith("fx-1")
  })
})
