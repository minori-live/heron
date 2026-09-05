export type UiActionVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "plain"
  | "danger"
  | "danger-ghost"
export type UiControlSize = "sm" | "md" | "lg"
export type UiSelectSize = "compact" | UiControlSize
export type UiRotaryControlSize = "compact" | "standard" | "track"
export type UiRotaryControlRingWeight = "standard" | "emphasized"
export type UiMixerStateButtonTone = "neutral" | "mute" | "solo" | "record" | "input" | "bounce"
export type UiMixerStateButtonSize = "narrow" | "wide" | "standard"
export type UiJoinedPosition = "start" | "middle" | "end"
export type UiScaleSide = "left" | "right"
export type UiGesturePhase = "start" | "update" | "commit" | "cancel"
export type UiResizeAxis = "horizontal" | "vertical"
export type UiDragEffect =
  | "none"
  | "copy"
  | "copyLink"
  | "copyMove"
  | "link"
  | "linkMove"
  | "move"
  | "all"
  | "uninitialized"

export interface UiPoint {
  x: number
  y: number
}

export interface UiModifiers {
  alt: boolean
  control: boolean
  meta: boolean
  shift: boolean
}

export interface UiKeyboardIntent {
  key: string
  code: string
  repeat: boolean
  modifiers: UiModifiers
}

export interface UiWheelIntent {
  point: UiPoint
  delta: UiPoint
  modifiers: UiModifiers
}

export interface UiViewportState {
  scrollLeft: number
  scrollTop: number
  width: number
  height: number
}

export interface UiDropIntent {
  point: UiPoint
  targetId?: string
  targetKind?: string
  data: readonly UiDragData[]
}

export interface UiGestureIntent {
  phase: UiGesturePhase
  point: UiPoint
  delta: UiPoint
  modifiers: UiModifiers
}

export interface UiDragData {
  mime: string
  value: string
}

export interface UiNavigationItem {
  id: string
  label: string
  description?: string
  badge?: string
  disabled?: boolean
}

export interface UiNavigationCategory extends UiNavigationItem {
  items: readonly UiNavigationItem[]
}

export interface UiTimelineMark {
  id: string
  label?: string
  position: number
  emphasis?: boolean
}

export interface UiTimelineRegion {
  start: number
  end: number
}

export interface UiClipViewModel {
  id: string
  label: string
  start: number
  width: number
  selected?: boolean
  disabled?: boolean
  signalColor?: string
}

export interface UiLanePoint {
  id: string
  x: number
  y: number
  label: string
  selected?: boolean
}

export interface UiVelocityBar {
  id: string
  x: number
  height: number
  width?: number
  color?: string
  label: string
  selected?: boolean
  inactive?: boolean
}

export interface UiAutomationLanePoint {
  id: string
  x: number
  y: number
  label: string
  selected?: boolean
  segmentWidth?: number
  segmentLabel?: string
  removable?: boolean
}

export interface UiPianoKey {
  key: number
  label: string
  black: boolean
}

export interface UiPianoRollNoteViewModel {
  id: string
  label: string
  selected?: boolean
  inactive?: boolean
  previewing?: boolean
  erasing?: boolean
}

export interface UiGraphNode {
  id: string
  label: string
  x: number
  y: number
  tone?: "neutral" | "info" | "warning" | "danger"
  detail?: string
  disabled?: boolean
}

export interface UiGraphEdge {
  id?: string
  from: string
  to: string
  label?: string
  tone?: "neutral" | "info" | "warning" | "danger"
}

export interface UiTourStep {
  id: string
  target?: string
  title: string
  description: string
  placement?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
}

export interface UiScaleMark {
  value: number
  label: string
  position: number
  emphasis?: boolean
}

export interface UiCurvePoint {
  x: number
  y: number
}

export interface UiCurveStroke {
  id: string
  points: readonly UiCurvePoint[]
}

export interface UiCurveHandle extends UiCurvePoint {
  id: string
  label: string
  tone?: "primary" | "secondary"
  minX?: number
  maxX?: number
  minY?: number
  maxY?: number
}
export type UiCascadingSelectAppearance = "default" | "embedded" | "workspace"
export type UiCascadingSelectHoverTreatment = "surface" | "host-tint"
export type UiNoticeTone = "neutral" | "info" | "success" | "warning" | "danger"

export interface UiSelectOption {
  label: string
  value: string
  disabled?: boolean
}

export interface UiSegmentedOption extends UiSelectOption {
  ariaLabel?: string
}

export interface UiSelectGroup {
  label: string
  options: readonly UiSelectOption[]
  separatorBefore?: boolean
}

export interface UiCascadingSelectGroup {
  label: string
  options: readonly UiSelectOption[]
  disabled?: boolean
}

export interface UiCascadingMenuItem {
  label: string
  value?: string
  ariaLabel?: string
  title?: string
  leading?: string
  trailing?: string
  disabled?: boolean
  children?: readonly UiCascadingMenuItem[]
}

export interface UiRadioOption extends UiSelectOption {
  description?: string
}

export interface UiAlertAction {
  value: string
  label: string
  variant?: UiActionVariant
  cancel?: boolean
}

export interface UiMenubarItem {
  value: string
  label: string
  shortcut?: string
  disabled?: boolean
  separatorBefore?: boolean
}

export interface UiMenubarMenu {
  value: string
  label: string
  items: UiMenubarItem[]
}
