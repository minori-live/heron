import { resolve } from "node:path"

const repositoryRoot = resolve(import.meta.dirname, "..").replaceAll("\\", "/")

const vdomComponents = [
  // These Reka adapters forward caller slots into as-child trigger/content roots.
  "packages/ui/src/components/UiAlertDialog.vue",
  "packages/ui/src/components/UiContextMenu.vue",
  "packages/ui/src/components/UiDialog.vue",
  "packages/ui/src/components/UiDropdownMenu.vue",
  "packages/ui/src/components/UiPopover.vue",
  "packages/ui/src/components/UiTabs.vue",
  "packages/ui/src/components/UiTooltip.vue",
  "packages/ui/src/components/internal/UiTooltipContent.vue",

  // These wrappers create or forward the slots consumed by Reka's as-child.
  "packages/ui/src/components/UiCascadingMenu.vue",
  "packages/ui/src/components/UiCascadingSelect.vue",
  "packages/ui/src/components/UiIconButton.vue",

  // Vapor-origin slots lose cloned attributes and handlers at as-child boundaries.
  // Preserve their owners too; an otherwise VDOM adapter cannot repair that slot.
  "apps/desktop/src/renderer/src/components/mixer/MixerChannelMenu.vue",
  "apps/desktop/src/renderer/src/components/mixer/MixerInstrumentInput.vue",
  "apps/desktop/src/renderer/src/components/mixer/MixerOutputSection.vue",
  "apps/desktop/src/renderer/src/components/mixer/MixerPluginPicker.vue",
  "apps/desktop/src/renderer/src/components/mixer/MixerPluginSection.vue",
  "apps/desktop/src/renderer/src/components/mixer/MixerSendSection.vue",
  "apps/desktop/src/renderer/src/components/performance/PerformanceMonitorPopover.vue",
  "apps/desktop/src/renderer/src/components/plugin-analysis/PluginAnalysisReport.vue",
  "apps/desktop/src/renderer/src/components/studio/AudioClipCard.vue",
  "apps/desktop/src/renderer/src/components/studio/MidiClipCard.vue"
]

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const vaporFilePattern =
  `${escapeRegExp(repositoryRoot)}/` +
  `(?!(?:${vdomComponents.map(escapeRegExp).join("|")})(?:\\?|$))` +
  "(?:apps/desktop/src/renderer/src|packages/ui/src)/[^?]*\\.vue"

// Include SFC subrequests so the two Vue plugins also agree on template/style transforms.
const vaporFiles = new RegExp(`^${vaporFilePattern}(?:\\?.*)?$`)
const vdomFiles = new RegExp(`^(?!${vaporFilePattern}(?:\\?|$)).*\\.vue(?:\\?.*)?$`)

export const vaporVueOptions = {
  include: vaporFiles,
  exclude: vdomFiles,
  features: { vapor: true }
}

export const vdomVueOptions = {
  include: vdomFiles,
  exclude: vaporFiles,
  features: { vapor: false }
}
