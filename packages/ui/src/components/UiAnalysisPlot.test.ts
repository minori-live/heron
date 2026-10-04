import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import UiAnalysisPlot from "./UiAnalysisPlot.vue"

const series = [{ label: "L", x: [20, 20000], y: [0, -6, -12, -24] }]

function mountPlot() {
  const wrapper = mount(UiAnalysisPlot, {
    props: { label: "Plot", xLabel: "Hz", yLabel: "dB", series, logarithmic: true }
  })
  const svg = wrapper.get("svg")
  Object.defineProperty(svg.element, "getBoundingClientRect", {
    value: () => ({ left: 0, top: 0, width: 900, height: 440 })
  })
  return wrapper
}

describe("UiAnalysisPlot", () => {
  it("zooms into a dragged region and restores the auto domain on double click", async () => {
    const wrapper = mountPlot()
    const host = wrapper.get(".ui-analysis-plot")
    const before = wrapper.get("svg").text()

    await host.trigger("pointerdown", { button: 0, pointerId: 1, clientX: 200, clientY: 100 })
    await host.trigger("pointermove", { pointerId: 1, clientX: 420, clientY: 220 })
    await host.trigger("pointerup", { pointerId: 1, clientX: 420, clientY: 220 })
    const zoomed = wrapper.get("svg").text()
    expect(zoomed).not.toBe(before)

    await host.trigger("dblclick")
    expect(wrapper.get("svg").text()).toBe(before)
  })

  it("resets when the requested domain changes", async () => {
    const wrapper = mountPlot()
    const host = wrapper.get(".ui-analysis-plot")
    await host.trigger("pointerdown", { button: 0, pointerId: 2, clientX: 200, clientY: 100 })
    await host.trigger("pointermove", { pointerId: 2, clientX: 420, clientY: 220 })
    await host.trigger("pointerup", { pointerId: 2, clientX: 420, clientY: 220 })

    await wrapper.setProps({ xDomain: [100, 1000] })
    const labels = wrapper.get("svg").text()
    expect(labels).toContain("100")
    expect(labels).toContain("1k")
  })
})
