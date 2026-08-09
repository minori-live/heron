import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import type { MidiControlBinding } from "@heron/contracts"
import MidiControlMappingList from "./MidiControlMappingList.vue"

const address = {
  portId: "controller",
  portName: "Studio Controller",
  channel: 0,
  type: "control-change" as const,
  number: 7
}

function binding(
  id: string,
  command: "project.save" | "transport.toggle-playback"
): MidiControlBinding {
  return {
    id,
    address,
    input: { type: "absolute" },
    target: { type: "application-command", command }
  }
}

describe("MidiControlMappingList", () => {
  it("invites the user to learn the first mapping from the empty state", async () => {
    const wrapper = mount(MidiControlMappingList, { props: { groups: [], ports: [] } })

    expect(wrapper.text()).toContain("No control mappings")
    await wrapper.get("button").trigger("click")
    expect(wrapper.emitted("add")).toHaveLength(1)
  })

  it("shows connection state and a non-error notice for address fan-out", async () => {
    const bindings = [binding("save", "project.save"), binding("play", "transport.toggle-playback")]
    const wrapper = mount(MidiControlMappingList, {
      props: {
        groups: [["controller-address", bindings]],
        ports: [{ id: "controller", name: "Studio Controller", connected: false }]
      }
    })

    expect(wrapper.text()).toContain("Studio Controller")
    expect(wrapper.text()).toContain("Disconnected")
    expect(wrapper.text()).toContain("2 operations share this control")
    expect(wrapper.get('[data-tone="info"]').attributes("role")).toBeUndefined()

    const removeButton = wrapper
      .findAll("button")
      .find((button) => button.attributes("aria-label")?.includes("project.save"))!
    await removeButton.trigger("click")
    expect(wrapper.emitted("remove")?.[0]).toEqual(["save"])
  })
})
