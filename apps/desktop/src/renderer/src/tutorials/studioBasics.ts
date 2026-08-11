import type { DriveStep } from "driver.js"

export const STUDIO_BASICS_VERSION = 1

type Translate = (key: string) => string

export function studioBasicsSteps(t: Translate): DriveStep[] {
  return [
    {
      popover: {
        title: t("tutorials.studioBasics.steps.welcome.title"),
        description: t("tutorials.studioBasics.steps.welcome.description")
      }
    },
    {
      element: '[data-tutorial="studio-arrangement"]',
      popover: {
        title: t("tutorials.studioBasics.steps.arrangement.title"),
        description: t("tutorials.studioBasics.steps.arrangement.description"),
        side: "top",
        align: "center"
      }
    },
    {
      element: '[data-tutorial="studio-transport"]',
      popover: {
        title: t("tutorials.studioBasics.steps.transport.title"),
        description: t("tutorials.studioBasics.steps.transport.description"),
        side: "bottom",
        align: "center"
      }
    },
    {
      element: '[data-tutorial="studio-musical-display"]',
      popover: {
        title: t("tutorials.studioBasics.steps.musicalDisplay.title"),
        description: t("tutorials.studioBasics.steps.musicalDisplay.description"),
        side: "bottom",
        align: "center"
      }
    },
    {
      element: '[data-tutorial="studio-inspector"]',
      skipMissingElement: true,
      popover: {
        title: t("tutorials.studioBasics.steps.inspector.title"),
        description: t("tutorials.studioBasics.steps.inspector.description"),
        side: "bottom",
        align: "start"
      }
    },
    {
      element: '[data-tutorial="studio-lower-editors"]',
      popover: {
        title: t("tutorials.studioBasics.steps.lowerEditors.title"),
        description: t("tutorials.studioBasics.steps.lowerEditors.description"),
        side: "bottom",
        align: "center"
      }
    },
    {
      element: '[data-tutorial="studio-right-panels"]',
      popover: {
        title: t("tutorials.studioBasics.steps.rightPanels.title"),
        description: t("tutorials.studioBasics.steps.rightPanels.description"),
        side: "bottom",
        align: "end"
      }
    }
  ]
}
