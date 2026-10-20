import type { TrackFreezeMode } from "@heron/contracts"
import type { UiMenuEntry } from "@heron/ui"

export interface TrackHeaderMenuCopy {
  freeze: string
  unfreeze: string
  cancelFreeze: string
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
  rendering: boolean
  hasContent: boolean
  systemTrack: boolean
  buttonVisible: boolean
}

export function trackHeaderMenu(
  state: TrackHeaderMenuState,
  copy: TrackHeaderMenuCopy
): readonly UiMenuEntry[] {
  const modeLocked = state.frozen || state.rendering
  const freezeDisabled =
    state.systemTrack || (!state.frozen && !state.rendering && !state.hasContent)
  return [
    {
      kind: "item",
      id: state.rendering ? "cancel-freeze" : state.frozen ? "unfreeze" : "freeze",
      label: state.rendering ? copy.cancelFreeze : state.frozen ? copy.unfreeze : copy.freeze,
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
