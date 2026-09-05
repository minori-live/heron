import type { UiTourStep } from "@heron/ui"

export const STUDIO_BASICS_VERSION = 1
type Translate = (key: string) => string

export function studioBasicsSteps(t: Translate): UiTourStep[] {
  const step = (
    id: string,
    target: string | undefined,
    placement: UiTourStep["placement"] = "bottom",
    align: UiTourStep["align"] = "center"
  ): UiTourStep => ({
    id,
    target,
    title: t(`tutorials.studioBasics.steps.${id}.title`),
    description: t(`tutorials.studioBasics.steps.${id}.description`),
    placement,
    align
  })
  return [
    step("welcome", undefined),
    step("arrangement", '[data-tutorial="studio-arrangement"]', "top"),
    step("transport", '[data-tutorial="studio-transport"]'),
    step("musicalDisplay", '[data-tutorial="studio-musical-display"]'),
    step("inspector", '[data-tutorial="studio-inspector"]', "bottom", "start"),
    step("lowerEditors", '[data-tutorial="studio-lower-editors"]'),
    step("rightPanels", '[data-tutorial="studio-right-panels"]', "bottom", "end")
  ]
}
