import type { Meta, StoryObj } from "@storybook/vue3-vite"
import { expect, userEvent, within } from "storybook/test"

import UiButton from "./UiButton.vue"
import UiIconButton from "./UiIconButton.vue"
import UiTooltip from "./UiTooltip.vue"

const meta = {
  title: "Components/Actions/Button",
  component: UiButton,
  tags: ["autodocs"],
  args: {
    variant: "secondary",
    size: "md",
    disabled: false,
    loading: false
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["primary", "secondary", "ghost", "plain", "danger", "danger-ghost"]
    },
    size: {
      control: "select",
      options: ["sm", "md", "lg"]
    }
  },
  render: (args) => ({
    components: { UiButton },
    setup: () => ({ args }),
    template: `<UiButton v-bind="args">Save project</UiButton>`
  })
} satisfies Meta<typeof UiButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button", { name: "Save project" })
    await userEvent.tab()
    await expect(button).toHaveFocus()
    await userEvent.keyboard("{Enter}")
  }
}

export const Loading: Story = {
  args: {
    loading: true,
    loadingLabel: "Saving project"
  }
}

export const Disabled: Story = {
  args: {
    disabled: true
  }
}

export const Danger: Story = {
  args: {
    variant: "danger"
  },
  render: (args) => ({
    components: { UiButton },
    setup: () => ({ args }),
    template: `<UiButton v-bind="args">Delete recording permanently</UiButton>`
  })
}

export const AllVariantsAndSizes: Story = {
  render: () => ({
    components: { UiButton, UiIconButton, UiTooltip },
    data: () => ({ tooltipOpen: false }),
    template: `
      <div class="storybook-stack">
        <div v-for="size in ['sm', 'md', 'lg']" :key="size" style="display:flex;flex-wrap:wrap;gap:var(--ui-space-3);align-items:center">
          <UiButton v-for="variant in ['primary', 'secondary', 'ghost', 'plain', 'danger', 'danger-ghost']" :key="variant" :size="size" :variant="variant">
            {{ variant }}
          </UiButton>
        </div>
        <div style="display:flex;gap:var(--ui-space-3)">
          <UiIconButton label="Toggle metronome" :pressed="true" @click="tooltipOpen = true"><span aria-hidden="true">M</span></UiIconButton>
          <UiIconButton label="Remove insert" density="compact" variant="danger-ghost"><span aria-hidden="true">×</span></UiIconButton>
          <UiTooltip v-model:open="tooltipOpen" text="Arm track" shortcut="R" :delay-duration="0"><UiButton size="sm">Record arm</UiButton></UiTooltip>
        </div>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = canvas.getByRole("button", { name: "Toggle metronome" })
    const remove = canvas.getByRole("button", { name: "Remove insert" })
    const arm = canvas.getByRole("button", { name: "Record arm" })
    await expect(remove.getBoundingClientRect().height).toBeLessThanOrEqual(20)
    await expect(remove).toHaveAttribute("data-variant", "danger-ghost")
    await userEvent.click(toggle)
    await expect(toggle).toHaveAttribute("aria-pressed", "true")
    await expect(arm).toHaveAttribute("aria-describedby")
  }
}

export const LongText: Story = {
  render: (args) => ({
    components: { UiButton },
    setup: () => ({ args }),
    template: `
      <div style="max-width:20rem">
        <UiButton v-bind="args">Save this project and all referenced audio files</UiButton>
      </div>
    `
  })
}
