import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TrackFreezeState } from "@heron/contracts"

vi.mock("../large-object", () => ({ unlinkLargeObject: vi.fn(async () => undefined) }))

import { unlinkLargeObject } from "../large-object"
import {
  isChannelTrackRoutingCommand,
  persistChannelTrackRoutingCommand
} from "../internal/channel-track-routing-persistence"

const freeze: TrackFreezeState = {
  mode: "pre-fader",
  status: "frozen",
  assetId: "freeze-asset",
  fingerprint: "fingerprint",
  startFrame: 0,
  lengthFrames: 256,
  latencySamples: 32,
  tailFrames: 64,
  sampleRate: 48_000
}

function query(results: unknown[][]) {
  let index = 0
  const proxy: object = new Proxy(function () {}, {
    get(_target, property) {
      if (property === "then") {
        return (resolve: (value: unknown) => void) => {
          resolve(results[index++] ?? [])
        }
      }
      return () => proxy
    },
    apply() {
      return proxy
    }
  })
  return {
    insert: () => proxy,
    update: () => proxy,
    delete: () => proxy,
    select: () => proxy
  }
}

describe("track freeze persistence", () => {
  beforeEach(() => {
    vi.mocked(unlinkLargeObject).mockClear()
  })

  it("recognizes freeze commands and writes a freeze row with its track", async () => {
    expect(
      isChannelTrackRoutingCommand({ type: "set-track-freeze", trackId: "track", freeze })
    ).toBe(true)
    const tx = query([])
    await persistChannelTrackRoutingCommand(
      tx as never,
      {
        type: "create-track",
        track: { id: "track", channelId: "audio", sortOrder: 0, freeze },
        channel: { id: "audio" }
      } as never,
      "output"
    )
    await persistChannelTrackRoutingCommand(
      tx as never,
      {
        type: "create-track",
        track: { id: "plain", channelId: "audio", sortOrder: 1 },
        channel: { id: "audio" }
      } as never,
      "output"
    )
    await persistChannelTrackRoutingCommand(
      tx as never,
      { type: "update-track", trackId: "track", patch: { freezeMode: "source-only" } },
      "output"
    )
    await persistChannelTrackRoutingCommand(
      tx as never,
      { type: "update-track", trackId: "track", patch: {} },
      "output"
    )
  })

  it("replaces a freeze file and unlinks the previous asset when nothing else uses it", async () => {
    const tx = query([[{ assetId: "old-asset" }], [], [], [], [{ oid: 7 }], []])
    await persistChannelTrackRoutingCommand(
      tx as never,
      {
        type: "set-track-freeze",
        trackId: "track",
        freeze: { ...freeze, assetId: "new-asset" }
      },
      "output"
    )
    expect(unlinkLargeObject).toHaveBeenCalledOnce()
  })

  it("clears a freeze and deletes the track's freeze asset", async () => {
    const clear = query([[{ assetId: "old-asset" }], [], [{ id: "clip" }]])
    await persistChannelTrackRoutingCommand(
      clear as never,
      { type: "set-track-freeze", trackId: "track", freeze: null },
      "output"
    )
    expect(unlinkLargeObject).not.toHaveBeenCalled()

    const shared = query([[{ assetId: "old-asset" }], [], [], [{ trackId: "other" }]])
    await persistChannelTrackRoutingCommand(
      shared as never,
      { type: "set-track-freeze", trackId: "track", freeze: null },
      "output"
    )
    expect(unlinkLargeObject).not.toHaveBeenCalled()

    const removed = query([
      [{ channelId: "audio", assetId: "old-asset" }],
      [],
      [],
      [],
      [],
      [],
      [{ oid: 9 }],
      []
    ])
    await persistChannelTrackRoutingCommand(
      removed as never,
      { type: "delete-track", trackId: "track" },
      "output"
    )
    expect(unlinkLargeObject).toHaveBeenCalledOnce()

    const missing = query([[]])
    await expect(
      persistChannelTrackRoutingCommand(
        missing as never,
        { type: "delete-track", trackId: "missing" },
        "output"
      )
    ).rejects.toThrow("Project track 'missing' was not found")
  })
})
