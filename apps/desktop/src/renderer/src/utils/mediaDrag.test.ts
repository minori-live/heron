import { describe, expect, it } from "vitest"
import { parseProjectMediaDrag } from "./mediaDrag"

describe("project media drag payload", () => {
  it("keeps only the asset identity and supported kind", () => {
    const data = JSON.stringify({ assetId: "asset-1", kind: "audio", name: "Audio.wav" })

    expect(parseProjectMediaDrag(data)).toEqual({ assetId: "asset-1", kind: "audio" })
  })

  it("rejects malformed or unsupported payloads", () => {
    expect(parseProjectMediaDrag(JSON.stringify({ assetId: "asset-1", kind: "plugin" }))).toBeNull()
    expect(parseProjectMediaDrag("not json")).toBeNull()
  })
})
