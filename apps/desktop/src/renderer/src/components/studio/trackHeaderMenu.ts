import type { TrackFreezeMode } from "@heron/contracts"
import type { UiMenuEntry } from "@heron/ui"

export interface TrackHeaderMenuCopy {
  freeze: string
  unfreeze: string
  freezeMode: string
  preFader: string
  sourceOnly: string
  showFreezeButton: string
  modeLocked: string
  emptyTrack: string
  systemTrack: string
}

export interface TrackHeaderMenuState {
  mode: TrackFreezeMode
  frozen: boolean
  hasContent: boolean
  systemTrack: boolean
  buttonVisible: boolean
}

export function trackHeaderMenu(
  state: TrackHeaderMenuState,
  copy: TrackHeaderMenuCopy
): readonly UiMenuEntry[] {
  const modeLocked = state.frozen
  const freezeDisabled = state.systemTrack || (!state.frozen && !state.hasContent)
  return [
    {
      kind: "item",
      id: state.frozen ? "unfreeze" : "freeze",
      label: state.frozen ? copy.unfreeze : copy.freeze,
      disabled: freezeDisabled,
      disabledReason: state.systemTrack
        ? copy.systemTrack
        : freezeDisabled
          ? copy.emptyTrack
          : undefined
    },
    {
      kind: "radio-group",
      id: "freeze-mode",
      label: copy.freezeMode,
      value: state.mode,
      options: [
        {
          id: "pre-fader",
          label: copy.preFader,
          disabled: modeLocked,
          disabledReason: modeLocked ? copy.modeLocked : undefined
        },
        {
          id: "source-only",
          label: copy.sourceOnly,
          disabled: modeLocked,
          disabledReason: modeLocked ? copy.modeLocked : undefined
        }
      ]
    },
    { kind: "separator", id: "freeze-display" },
    {
      kind: "checkbox",
      id: "show-freeze-button",
      label: copy.showFreezeButton,
      checked: state.buttonVisible
    }
  ]
}
