export type UiComponentOwner =
  | "action"
  | "brand"
  | "feedback"
  | "form"
  | "menu"
  | "mixer"
  | "overlay"
  | "structure"
  | "workspace"

export type UiComponentState =
  | "default"
  | "disabled"
  | "busy"
  | "invalid"
  | "selected"
  | "long-text"
  | "keyboard"
  | "pointer"
  | "drag"
  | "cancel"

export interface UiComponentCatalogEntry {
  storyFile: string
  stories: readonly string[]
  interactive: boolean
  states: readonly UiComponentState[]
  owner: UiComponentOwner
}

export const UI_COMPONENT_CATALOG = {
  AsioCompatibleLogo: entry("AsioCompatibleLogo.stories.ts", ["Default"], false, [], "brand"),
  HeronLogo: entry("Brand.stories.ts", ["Default", "OfficialVariants"], false, [], "brand"),
  UiActionRow: boundary(["OrdinaryControls"], ["default", "keyboard"]),
  UiAutomationLane: entry(
    "TimelineComponents.stories.ts",
    ["AutomationEditing"],
    true,
    ["default", "selected", "keyboard", "pointer", "drag", "cancel"],
    "workspace"
  ),
  UiArrangementTrackSurface: entry(
    "TimelineComponents.stories.ts",
    ["ArrangementSurfaces"],
    true,
    ["default", "selected", "keyboard", "pointer"],
    "workspace"
  ),
  UiArrangementViewport: entry(
    "TimelineComponents.stories.ts",
    ["ArrangementSurfaces"],
    true,
    ["default", "pointer", "drag"],
    "workspace"
  ),
  UiAlertDialog: entry(
    "Overlays.stories.ts",
    ["DestructiveConfirmation"],
    true,
    ["default", "keyboard", "cancel"],
    "overlay"
  ),
  UiButton: entry(
    "Actions.stories.ts",
    ["Default", "Loading", "Disabled", "LongText"],
    true,
    ["default", "disabled", "busy", "long-text", "keyboard"],
    "action"
  ),
  UiCascadingMenu: entry(
    "Menus.stories.ts",
    ["CascadingMenu"],
    true,
    ["default", "keyboard"],
    "menu"
  ),
  UiCascadingSelect: entry(
    "Forms.stories.ts",
    ["SelectSizesAndGroups"],
    true,
    ["default", "disabled", "keyboard"],
    "form"
  ),
  UiCheckbox: entry(
    "Forms.stories.ts",
    ["CompleteForm", "Disabled"],
    true,
    ["default", "disabled", "keyboard"],
    "form"
  ),
  UiChoiceCard: boundary(["OrdinaryControls"], ["default", "selected", "keyboard"]),
  UiChoiceChip: entry(
    "Workspace.stories.ts",
    ["EditorToolbar"],
    true,
    ["default", "selected", "keyboard"],
    "workspace"
  ),
  UiColorInput: boundary(["OrdinaryControls"], ["default", "keyboard"]),
  UiContextMenu: entry(
    "Menus.stories.ts",
    ["ClipContextMenu", "ScrollableContextMenu"],
    true,
    ["default", "keyboard"],
    "menu"
  ),
  UiCurveEditor: entry(
    "MixerControls.stories.ts",
    ["CurveEditor"],
    true,
    ["default", "keyboard", "pointer", "cancel"],
    "workspace"
  ),
  UiDbScale: entry("MixerControls.stories.ts", ["DbScale"], false, ["default"], "workspace"),
  UiDialog: entry(
    "Overlays.stories.ts",
    ["Interactive", "ScrollableContent"],
    true,
    ["default", "keyboard", "long-text", "cancel"],
    "overlay"
  ),
  UiDraggableItem: boundary(["InteractionSurfaces"], ["default", "drag"]),
  UiDropdownMenu: entry(
    "Menus.stories.ts",
    ["SearchableTaxonomy"],
    true,
    ["default", "keyboard"],
    "menu"
  ),
  UiDropZone: boundary(["InteractionSurfaces"], ["default", "drag"]),
  UiEmptyState: entry(
    "Feedback.stories.ts",
    ["Empty"],
    false,
    ["default", "long-text"],
    "feedback"
  ),
  UiField: entry(
    "Forms.stories.ts",
    ["CompleteForm", "Error"],
    false,
    ["default", "invalid", "long-text"],
    "form"
  ),
  UiForm: boundary(["OrdinaryControls"], ["default", "keyboard"]),
  UiGuidedTour: entry(
    "ThirdPartyAdapters.stories.ts",
    ["GuidedTour"],
    true,
    ["default", "keyboard", "cancel"],
    "overlay"
  ),
  UiHorizontalFader: entry(
    "MixerControls.stories.ts",
    ["HorizontalFader", "TrackParameters"],
    true,
    ["default", "disabled", "keyboard", "pointer", "cancel"],
    "workspace"
  ),
  UiIconButton: entry(
    "Actions.stories.ts",
    ["AllVariantsAndSizes"],
    true,
    ["default", "disabled", "keyboard"],
    "action"
  ),
  UiInlineTextEdit: boundary(["OrdinaryControls"], ["default", "keyboard", "cancel"]),
  UiLevelMeter: entry(
    "MixerControls.stories.ts",
    ["ChannelFaderAndMeter"],
    false,
    ["default"],
    "workspace"
  ),
  UiLoadingState: entry(
    "Feedback.stories.ts",
    ["Loading"],
    false,
    ["default", "long-text"],
    "feedback"
  ),
  UiMenubar: entry(
    "Menus.stories.ts",
    ["ApplicationMenubar"],
    true,
    ["default", "keyboard"],
    "menu"
  ),
  UiMixerInsert: entry(
    "MixerControls.stories.ts",
    ["MixerInsert"],
    true,
    ["default", "pointer", "keyboard"],
    "mixer"
  ),
  UiMixerStateButton: entry(
    "MixerControls.stories.ts",
    ["ChannelStateButtons"],
    true,
    ["default", "disabled", "selected", "keyboard"],
    "workspace"
  ),
  UiMixerSlot: entry(
    "MixerControls.stories.ts",
    ["MixerSlot"],
    true,
    ["default", "selected", "pointer"],
    "mixer"
  ),
  UiNumberInput: entry(
    "Workspace.stories.ts",
    ["InspectorFields"],
    true,
    ["default", "disabled", "invalid", "keyboard"],
    "form"
  ),
  UiNodeGraph: entry(
    "ThirdPartyAdapters.stories.ts",
    ["NodeGraph"],
    true,
    ["default", "pointer"],
    "workspace"
  ),
  UiPopover: entry(
    "Overlays.stories.ts",
    ["Popover"],
    true,
    ["default", "keyboard", "cancel"],
    "overlay"
  ),
  UiPianoKeyboard: entry(
    "PianoRollComponents.stories.ts",
    ["KeyboardAndNotes"],
    true,
    ["default", "keyboard"],
    "workspace"
  ),
  UiPianoRollGrid: entry(
    "PianoRollComponents.stories.ts",
    ["KeyboardAndNotes"],
    true,
    ["default", "pointer", "cancel"],
    "workspace"
  ),
  UiPianoRollNote: entry(
    "PianoRollComponents.stories.ts",
    ["KeyboardAndNotes"],
    true,
    ["default", "selected", "keyboard", "pointer", "cancel"],
    "workspace"
  ),
  UiPianoRollViewport: entry(
    "PianoRollComponents.stories.ts",
    ["PianoViewport"],
    true,
    ["default", "keyboard", "pointer"],
    "workspace"
  ),
  UiProgress: entry("Feedback.stories.ts", ["StatusAndProgress"], false, ["default"], "feedback"),
  UiProvider: entry("Structure.stories.ts", ["Provider"], false, ["default"], "structure"),
  UiRadioGroup: entry(
    "Forms.stories.ts",
    ["PreferenceControls"],
    true,
    ["default", "disabled", "keyboard"],
    "form"
  ),
  UiResizeHandle: boundary(["InteractionSurfaces"], ["default", "keyboard", "pointer", "cancel"]),
  UiRotaryControl: entry(
    "MixerControls.stories.ts",
    ["Pan", "LogicSendPositions", "TrackParameters"],
    true,
    ["default", "disabled", "keyboard", "pointer", "cancel"],
    "workspace"
  ),
  UiSectionHeading: entry(
    "Structure.stories.ts",
    ["Levels"],
    false,
    ["default", "long-text"],
    "structure"
  ),
  UiSegmentedControl: entry(
    "Workspace.stories.ts",
    ["EditorToolbar"],
    true,
    ["default", "disabled", "selected", "keyboard"],
    "workspace"
  ),
  UiSettingsNavigator: boundary(
    ["SettingsNavigation"],
    ["default", "selected", "keyboard", "long-text"]
  ),
  UiSelect: entry(
    "Forms.stories.ts",
    ["CompleteForm", "SelectSizesAndGroups"],
    true,
    ["default", "disabled", "invalid", "keyboard"],
    "form"
  ),
  UiSlider: entry(
    "Forms.stories.ts",
    ["PreferenceControls"],
    true,
    ["default", "disabled", "keyboard", "pointer"],
    "form"
  ),
  UiSpinner: entry("Feedback.stories.ts", ["StatusAndProgress"], false, ["default"], "feedback"),
  UiStatusNotice: entry(
    "Feedback.stories.ts",
    ["StatusAndProgress"],
    false,
    ["default", "long-text"],
    "feedback"
  ),
  UiSurface: entry(
    "Structure.stories.ts",
    ["Levels", "LongTextAtNarrowWidth"],
    false,
    ["default", "long-text"],
    "structure"
  ),
  UiTabs: boundary(["OrdinaryControls"], ["default", "selected", "keyboard"]),
  UiTextInput: entry(
    "Forms.stories.ts",
    ["CompleteForm", "Error", "Disabled"],
    true,
    ["default", "disabled", "invalid", "keyboard"],
    "form"
  ),
  UiTimelineClip: entry(
    "TimelineComponents.stories.ts",
    ["ClipEditing"],
    true,
    ["default", "selected", "keyboard", "pointer", "drag", "cancel"],
    "workspace"
  ),
  UiTimelineRuler: entry(
    "TimelineComponents.stories.ts",
    ["RulerInteractions"],
    true,
    ["default", "keyboard", "pointer", "drag", "cancel"],
    "workspace"
  ),
  UiVelocityLane: entry(
    "PianoRollComponents.stories.ts",
    ["VelocityEditing"],
    true,
    ["default", "selected", "pointer", "drag", "cancel"],
    "workspace"
  ),
  UiTextarea: boundary(["OrdinaryControls"], ["default", "disabled", "invalid", "keyboard"]),
  UiToolbar: entry(
    "Workspace.stories.ts",
    ["EditorToolbar"],
    false,
    ["default", "long-text"],
    "workspace"
  ),
  UiTooltip: entry(
    "Actions.stories.ts",
    ["AllVariantsAndSizes"],
    true,
    ["default", "keyboard"],
    "overlay"
  ),
  UiVerticalFader: entry(
    "MixerControls.stories.ts",
    ["ChannelFaderAndMeter"],
    true,
    ["default", "disabled", "keyboard", "pointer", "cancel"],
    "workspace"
  ),
  UiWindowControls: boundary(["InteractionSurfaces"], ["default", "keyboard"]),
  UiZoomControl: boundary(["InteractionSurfaces"], ["default", "keyboard", "pointer"]),
  VstCompatibleLogo: entry("VstCompatibleLogo.stories.ts", ["Default"], false, [], "brand")
} as const satisfies Record<string, UiComponentCatalogEntry>

export type UiCatalogComponentName = keyof typeof UI_COMPONENT_CATALOG

function entry(
  storyFile: string,
  stories: readonly string[],
  interactive: boolean,
  states: readonly UiComponentState[],
  owner: UiComponentOwner
): UiComponentCatalogEntry {
  return { storyFile, stories, interactive, states, owner }
}

function boundary(
  stories: readonly string[],
  states: readonly UiComponentState[]
): UiComponentCatalogEntry {
  return entry("BoundaryComponents.stories.ts", stories, true, states, "workspace")
}
