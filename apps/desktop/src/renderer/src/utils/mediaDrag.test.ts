import { describe, expect, it } from "vitest"
import { parseProjectMediaDrag, serializeProjectMediaDrag } from "./mediaDrag"

describe("project media drag payload", () => {
  it("round-trips only the asset identity and kind", () => {
    const data = serializeProjectMediaDrag({
      id: "asset-1",
      kind: "audio",
      name: "Audio.wav",
      contentHash: "hash",
      sampleRate: 48_000,
      channels: 2,
      bitDepth: "float32",
      frameCount: 48_000n
    })

    expect(parseProjectMediaDrag(data)).toEqual({ assetId: "asset-1", kind: "audio" })
  })

  it("rejects malformed or unsupported payloads", () => {
    expect(parseProjectMediaDrag(JSON.stringify({ assetId: "asset-1", kind: "plugin" }))).toBeNull()
    expect(parseProjectMediaDrag("not json")).toBeNull()
  })
})
