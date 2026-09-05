import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import TrackHeightResizeHandle from "./TrackHeightResizeHandle.vue"

describe("TrackHeightResizeHandle", () => {
  it("resizes repeatedly from the current scale and restores the drag origin on Escape", async () => {
    const wrapper = mount(TrackHeightResizeHandle, {
      props: { baseHeight: 100, scale: 1, trackName: "Vocal" }
    })
    await wrapper.trigger("keydown", { key: "ArrowDown" })
    expect(wrapper.emitted("setScale")?.at(-1)).toEqual([1.25])
    await wrapper.setProps({ scale: 1.25 })
    await wrapper.trigger("keydown", { key: "ArrowDown" })
    expect(wrapper.emitted("setScale")?.at(-1)).toEqual([1.5])
    await wrapper.setProps({ scale: 2 })
    await wrapper.trigger("pointerdown", { button: 0, pointerId: 1, clientY: 100 })
    await wrapper.trigger("pointermove", { pointerId: 1, clientY: 150 })
    expect(wrapper.emitted("setScale")?.at(-1)).toEqual([2.5])
    await wrapper.setProps({ scale: 2.5 })
    await wrapper.trigger("keydown", { key: "Escape" })
    expect(wrapper.emitted("setScale")?.at(-1)).toEqual([2])
    const count = wrapper.emitted("setScale")?.length
    await wrapper.trigger("pointerup", { pointerId: 1, clientY: 150 })
    expect(wrapper.emitted("setScale")).toHaveLength(count!)
  })
})
