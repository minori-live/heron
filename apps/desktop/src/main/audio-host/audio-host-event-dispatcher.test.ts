import { describe, expect, it, vi } from "vitest"
import { AudioHostEventDispatcher } from "./audio-host-event-dispatcher"

describe("AudioHostEventDispatcher", () => {
  it("deduplicates ARA callbacks within a helper epoch", async () => {
    const handler = vi.fn()
    const dispatcher = new AudioHostEventDispatcher({
      helperEpoch: () => "epoch-1",
      rejectSidechainRoute: vi.fn()
    })
    dispatcher.setAraHandler(handler)
    const callback = {
      helperEpoch: "epoch-1",
      instanceId: "ara-1",
      sequence: 2,
      event: { kind: "archive-progress", direction: "store", progress: 1 }
    } as const

    dispatcher.dispatchAra(callback)
    dispatcher.dispatchAra(callback)
    await dispatcher.settle()

    expect(handler).toHaveBeenCalledOnce()
  })

  it("rejects synchronous side-chain handler failures and settles pending work", async () => {
    const rejectSidechainRoute = vi.fn(async () => {})
    const dispatcher = new AudioHostEventDispatcher({
      helperEpoch: () => "epoch-1",
      rejectSidechainRoute
    })
    dispatcher.setSidechainHandler(() => {
      throw new Error("command failed")
    })
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const request = {
      requestId: 4,
      instanceId: "plugin-1",
      inputPortKey: "vst3:audio:input:2",
      sourceChannelId: null
    }

    dispatcher.dispatchSidechain(request)
    await dispatcher.settle()

    expect(rejectSidechainRoute).toHaveBeenCalledWith(request)
    expect(error).toHaveBeenCalledWith(
      "Could not commit a VST3 side-chain route",
      expect.any(Error)
    )
    error.mockRestore()
  })

  it("dispatches plug-in failures and contains rejected reconciliation", async () => {
    const dispatcher = new AudioHostEventDispatcher({
      helperEpoch: () => "epoch-1",
      rejectSidechainRoute: vi.fn()
    })
    const failure = {
      instanceId: "plugin-1",
      instanceGeneration: 7,
      graphRevision: 11,
      category: "plugin-rejected",
      stage: "process",
      outcome: "failed",
      recoverable: true,
      diagnosticId: "plugin:plugin-1:process",
      message: "processing rejected"
    } as const
    const handler = vi.fn().mockRejectedValue(new Error("reconciliation failed"))
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    dispatcher.setPluginFailureHandler(handler)

    dispatcher.dispatchPluginFailure(failure)
    await dispatcher.settle()

    expect(handler).toHaveBeenCalledWith(failure)
    expect(error).toHaveBeenCalledWith(
      "Could not reconcile an audio plug-in failure",
      expect.any(Error)
    )
    error.mockRestore()
  })
})
