import type { Meta, StoryObj } from "@storybook/vue3-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { shallowRef } from "vue"

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
      options: ["sm", "md", "lg", "compact", "status"]
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

export const WorkspaceSelection: Story = {
  render: () => ({
    components: { UiIconButton, UiButton },
    setup: () => ({ target: shallowRef(""), locked: shallowRef(false) }),
    template: `<div style="display:flex;gap:8px;align-items:center">
      <UiIconButton v-for="output in ['Output 1–2', 'Output 3–4']" :key="output"
        :label="output" appearance="workspace" pressed-tone="success"
        :pressed="target === output" :disabled="locked" @click="target = output">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m13 2-9 12h7l-1 8 10-12h-7z" /></svg>
      </UiIconButton>
      <UiButton @click="locked = !locked">Lock configuration</UiButton>
    </div>`
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const first = canvas.getByRole("button", { name: "Output 1–2" })
    const second = canvas.getByRole("button", { name: "Output 3–4" })
    const lock = canvas.getByRole("button", { name: "Lock configuration" })
    const idle = getComputedStyle(first).color
    await userEvent.click(first)
    await userEvent.unhover(first)
    await userEvent.tab()
    await expect(first).not.toHaveFocus()
    await expect(first).toHaveAttribute("aria-pressed", "true")
    await waitFor(() => expect(getComputedStyle(first).color).not.toBe(idle))
    await waitFor(() => expect(first.getAnimations()).toHaveLength(0))
    await expect(getComputedStyle(first).boxShadow).toContain("inset")
    const selectedBorder = getComputedStyle(first).borderColor
    const selectedBackground = getComputedStyle(first).backgroundColor
    await userEvent.hover(first)
    await expect(getComputedStyle(first).borderColor).toBe(selectedBorder)
    await expect(getComputedStyle(first).backgroundColor).toBe(selectedBackground)
    await userEvent.unhover(first)
    await userEvent.keyboard(" ")
    await expect(second).toHaveAttribute("aria-pressed", "true")
    await expect(first).toHaveAttribute("aria-pressed", "false")
    await userEvent.click(lock)
    await expect(second).toBeDisabled()
    await expect(getComputedStyle(second).boxShadow).toContain("inset")
    await expect(first.getBoundingClientRect().width).toBe(28)
    await expect(first.getBoundingClientRect().height).toBe(28)
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

export const DenseTypography: Story = {
  render: () => ({
    components: { UiButton },
    template: `<div style="display:flex;align-items:center;gap:8px">
      <UiButton size="compact">Global Tracks</UiButton>
      <UiButton size="compact">HW 1–2</UiButton>
      <UiButton size="status" variant="ghost">CPU 12% MEM 23%</UiButton>
    </div>`
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const name of ["Global Tracks", "HW 1–2", "CPU 12% MEM 23%"]) {
      const button = canvas.getByRole("button", { name })
      const status = name.startsWith("CPU")
      await expect(getComputedStyle(button).fontSize).toBe(status ? "7px" : "8px")
      await expect(getComputedStyle(button).fontFamily).toContain("Cascadia Mono")
      await expect(getComputedStyle(button).fontWeight).toBe("400")
      await expect(button.getBoundingClientRect().height).toBe(status ? 20 : 24)
    }
    await userEvent.tab()
    await expect(canvas.getByRole("button", { name: "Global Tracks" })).toHaveFocus()
    await userEvent.keyboard("{Enter}")
  }
}
