import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { bindSnapshotPoll, resetSnapshotPollForTests } from "./snapshot-poll"

describe("bindSnapshotPoll", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetSnapshotPollForTests()
  })

  afterEach(() => {
    resetSnapshotPollForTests()
    vi.useRealTimers()
  })

  it("runs mixer and transport jobs from one 33 ms interval", async () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval")
    const meters = vi.fn()
    const transport = vi.fn()
    const meterPoll = bindSnapshotPoll(meters)
    const transportPoll = bindSnapshotPoll(transport)

    meterPoll.start()
    transportPoll.start()

    expect(meters).toHaveBeenCalledTimes(1)
    expect(transport).toHaveBeenCalledTimes(1)
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 33)

    await vi.advanceTimersByTimeAsync(33)
    expect(meters).toHaveBeenCalledTimes(2)
    expect(transport).toHaveBeenCalledTimes(2)

    meterPoll.stop()
    await vi.advanceTimersByTimeAsync(33)
    expect(meters).toHaveBeenCalledTimes(2)
    expect(transport).toHaveBeenCalledTimes(3)

    transportPoll.stop()
    await vi.advanceTimersByTimeAsync(66)
    expect(transport).toHaveBeenCalledTimes(3)
  })
})
