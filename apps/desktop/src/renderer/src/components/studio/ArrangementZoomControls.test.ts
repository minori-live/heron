import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import ArrangementZoomControls from "./ArrangementZoomControls.vue"

describe("ArrangementZoomControls", () => {
  it("maps zoom controls into arrangement units and forwards reset intent", async () => {
    const wrapper = mount(ArrangementZoomControls, {
      props: {
        pixelsPerQuarter: 50,
        trackHeight: 104,
        amplitudeScale: 1
      }
    })

    const time = wrapper.get('input[aria-label="Time zoom"]')
    const track = wrapper.get('input[aria-label="Track height"]')
    const gain = wrapper.get('input[aria-label="Waveform gain"]')

    await time.setValue(100)
    await track.setValue(50)
    await gain.setValue(0)

    expect(wrapper.emitted("setTime")?.[0]?.[0]).toBeCloseTo(800)
    expect(wrapper.emitted("setTrack")?.[0]).toEqual([196])
    expect(wrapper.emitted("setAmplitude")?.[0]?.[0]).toBeCloseTo(0.5)

    await wrapper.get('button[aria-label="Double-click to reset time zoom"]').trigger("click")
    expect(wrapper.emitted("resetTime")).toHaveLength(1)
  })
})
