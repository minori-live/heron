import { describe, expect, it } from "vitest"
import { STUDIO_BASICS_VERSION, studioBasicsSteps } from "./studioBasics"

describe("studioBasicsSteps", () => {
  it("defines the versioned Studio tour around stable tutorial targets", () => {
    const steps = studioBasicsSteps((key) => key)

    expect(STUDIO_BASICS_VERSION).toBe(1)
    expect(steps).toHaveLength(7)
    expect(steps[0]?.element).toBeUndefined()
    expect(steps.slice(1).map((step) => step.element)).toEqual([
      '[data-tutorial="studio-arrangement"]',
      '[data-tutorial="studio-transport"]',
      '[data-tutorial="studio-musical-display"]',
      '[data-tutorial="studio-inspector"]',
      '[data-tutorial="studio-lower-editors"]',
      '[data-tutorial="studio-right-panels"]'
    ])
  })
})
