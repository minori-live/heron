import { describe, expect, it } from "vitest"
import type { MixerChannelState } from "@heron/contracts"
import { midiControlChannels } from "./selectors"

function channel(
  id: string,
  kind: MixerChannelState["kind"],
  sortOrder: number,
  systemRole: MixerChannelState["systemRole"] = null
): MixerChannelState {
  return { id, kind, sortOrder, systemRole } as MixerChannelState
}

describe("midiControlChannels", () => {
  it("uses canonical kind order and excludes system channels", () => {
    const channels = [
      channel("output", "output", 0),
      channel("instrument-b", "instrument", 1),
      channel("metronome", "instrument", 0, "metronome"),
      channel("master", "master", 0),
      channel("bus", "aux", 0),
      channel("audio", "audio", 0),
      channel("instrument-a", "instrument", 0)
    ]
    expect(midiControlChannels(channels).map((candidate) => candidate.id)).toEqual([
      "audio",
      "instrument-a",
      "instrument-b",
      "bus",
      "master",
      "output"
    ])
  })
})
