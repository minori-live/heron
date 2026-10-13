import type { Meta, StoryObj } from "@storybook/vue3-vite"

import HeronLogo from "./HeronLogo.vue"

const meta = {
  title: "Foundations/Brand/Logo",
  component: HeronLogo,
  tags: ["autodocs"],
  args: {
    variant: "lockup",
    decorative: false
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["lockup", "mark", "wordmark"]
    }
  },
  render: (args) => ({
    components: { HeronLogo },
    setup: () => ({ args }),
    template: `
      <HeronLogo
        v-bind="args"
        style="color:var(--ui-signal-audio);font-size:var(--ui-font-size-4xl)"
      />
    `
  })
} satisfies Meta<typeof HeronLogo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const OfficialVariants: Story = {
  render: () => ({
    components: { HeronLogo },
    template: `
      <div style="display:grid;gap:var(--ui-space-8)">
        <div v-for="variant in ['lockup', 'mark', 'wordmark']" :key="variant" style="display:grid;gap:var(--ui-space-2)">
          <span class="ui-eyebrow" style="color:var(--ui-color-text-subtle);font-size:var(--ui-font-size-xs)">{{ variant }}</span>
          <HeronLogo
            :variant="variant"
            style="color:var(--ui-signal-audio);font-size:var(--ui-font-size-4xl)"
          />
        </div>
      </div>
    `
  })
}
