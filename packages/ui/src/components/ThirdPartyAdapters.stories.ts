import type { Meta, StoryObj } from "@storybook/vue3-vite"
import { expect, userEvent, within } from "storybook/test"
import UiButton from "./UiButton.vue"
import UiGuidedTour from "./UiGuidedTour.vue"
import UiNodeGraph from "./UiNodeGraph.vue"
import UiSurface from "./UiSurface.vue"

const meta = {
  title: "Components/Adapters",
  component: UiNodeGraph,
  tags: ["autodocs"]
} satisfies Meta<typeof UiNodeGraph>

export default meta
type Story = StoryObj<typeof meta>

export const NodeGraph: Story = {
  args: {
    label: "Audio routing graph",
    nodes: [
      { id: "input", label: "Input", x: 0, y: 0, tone: "info", detail: "Stereo input" },
      {
        id: "effect",
        label: "Compressor",
        x: 140,
        y: 0,
        tone: "warning",
        detail: "2.4 ms latency"
      },
      { id: "output", label: "Output", x: 280, y: 0, tone: "neutral" }
    ],
    edges: [
      { from: "input", to: "effect", tone: "info" },
      { from: "effect", to: "output", tone: "warning" }
    ]
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("img", { name: "Audio routing graph" })
    ).toBeVisible()
  }
}

export const GuidedTour: Story = {
  args: { nodes: [], edges: [], label: "Guided tour adapter" },
  render: () => ({
    components: { UiButton, UiGuidedTour, UiSurface },
    data: () => ({ active: false, status: "idle" }),
    template: `
      <UiSurface id="tour-fixture" class="storybook-stack">
        <strong>Arrangement toolbar</strong>
        <UiButton @click="active = true">Start tour</UiButton>
        <UiGuidedTour
          :active="active"
          :steps="[{ id: 'toolbar', target: '#tour-fixture', title: 'Arrange your session', description: 'The toolbar keeps editing commands together.', placement: 'bottom' }]"
          progress-label="{{current}} of {{total}}"
          next-label="Next"
          previous-label="Previous"
          done-label="Done"
          @complete="status = 'complete'; active = false"
          @cancel="status = 'cancel'; active = false"
        />
        <output>{{ status }}</output>
      </UiSurface>
    `
  }),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Start tour" }))
    const titles = await within(document.body).findAllByText("Arrange your session", {
      selector: ".driver-popover-title"
    })
    await expect(titles.length).toBeGreaterThan(0)
    await userEvent.keyboard("{Escape}")
  }
}
