import { describe, expect, it } from "vitest"
import { trackHeaderMenu, type TrackHeaderMenuCopy } from "./trackHeaderMenu"

const copy: TrackHeaderMenuCopy = {
  freeze: "Freeze",
  unfreeze: "Unfreeze",
  freezeMode: "Freeze mode",
  preFader: "Pre-fader",
  sourceOnly: "Source only",
  showFreezeButton: "Show freeze button",
  modeLocked: "locked",
  emptyTrack: "empty",
  systemTrack: "system"
}

describe("trackHeaderMenu", () => {
  it("offers the freeze tap as radios and the button as a checkbox", () => {
    const entries = trackHeaderMenu(
      {
        mode: "source-only",
        frozen: false,
        hasContent: true,
        systemTrack: false,
        buttonVisible: true
      },
      copy
    )

    expect(entries[0]).toMatchObject({ kind: "item", id: "freeze", disabled: false })
    expect(entries[1]).toMatchObject({
      kind: "radio-group",
      id: "freeze-mode",
      value: "source-only",
      options: [
        expect.objectContaining({ id: "pre-fader", disabled: false }),
        expect.objectContaining({ id: "source-only", disabled: false })
      ]
    })
    expect(entries[2]).toMatchObject({ kind: "separator" })
    expect(entries[3]).toMatchObject({
      kind: "checkbox",
      id: "show-freeze-button",
      checked: true
    })
  })

  it("locks the tap while frozen and disables freeze without regions", () => {
    const frozen = trackHeaderMenu(
      {
        mode: "pre-fader",
        frozen: true,
        hasContent: true,
        systemTrack: false,
        buttonVisible: false
      },
      copy
    )
    expect(frozen[0]).toMatchObject({ id: "unfreeze", disabled: false })
    expect(frozen[1]).toMatchObject({
      options: [
        expect.objectContaining({ disabled: true, disabledReason: "locked" }),
        expect.objectContaining({ disabled: true, disabledReason: "locked" })
      ]
    })

    const empty = trackHeaderMenu(
      {
        mode: "pre-fader",
        frozen: false,
        hasContent: false,
        systemTrack: false,
        buttonVisible: true
      },
      copy
    )
    expect(empty[0]).toMatchObject({ id: "freeze", disabled: true, disabledReason: "empty" })

    const system = trackHeaderMenu(
      {
        mode: "pre-fader",
        frozen: false,
        hasContent: true,
        systemTrack: true,
        buttonVisible: true
      },
      copy
    )
    expect(system[0]).toMatchObject({ id: "freeze", disabled: true, disabledReason: "system" })
    expect(system[1]).toMatchObject({
      options: [
        expect.objectContaining({ disabled: false }),
        expect.objectContaining({ disabled: false })
      ]
    })
  })
})
