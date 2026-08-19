import type { Meta, StoryObj } from "@storybook/vue3-vite"
import { shallowRef } from "vue"
import { expect, userEvent, within } from "storybook/test"
import type { UiMenuEntry } from "../menu"
import UiButton from "./UiButton.vue"
import UiCascadingMenu from "./UiCascadingMenu.vue"
import UiContextMenu from "./UiContextMenu.vue"
import UiDropdownMenu from "./UiDropdownMenu.vue"
import UiMenubar from "./UiMenubar.vue"

const effectEntries: readonly UiMenuEntry[] = [
  {
    kind: "group",
    id: "favorites",
    label: "Favorites",
    children: [
      {
        kind: "item",
        id: "favorite:compressor",
        label: "Compressor",
        metadata: "Built-in",
        keywords: ["dynamics", "gain"]
      }
    ]
  },
  { kind: "separator", id: "favorite-separator" },
  {
    kind: "submenu",
    id: "dynamics",
    label: "Dynamics",
    children: [
      {
        kind: "submenu",
        id: "compressors",
        label: "Compressors",
        children: [
          {
            kind: "item",
            id: "effect:pro-c",
            label: "Pro-C 2",
            leading: "2→2",
            metadata: "FabFilter",
            keywords: ["compressor", "dynamics"]
          },
          {
            kind: "item",
            id: "effect:ott",
            label: "OTT",
            leading: "2→2",
            metadata: "Xfer Records",
            keywords: ["compressor", "multiband"]
          }
        ]
      },
      {
        kind: "item",
        id: "effect:gate",
        label: "Gate",
        metadata: "Built-in"
      }
    ]
  },
  {
    kind: "submenu",
    id: "delay",
    label: "Delay and echo",
    children: [
      {
        kind: "item",
        id: "effect:stereo-delay",
        label: "Stereo delay",
        leading: "2→2",
        metadata: "Built-in"
      }
    ]
  }
]

const clipEntries: readonly UiMenuEntry[] = [
  { kind: "item", id: "open", label: "Open in piano roll", shortcut: "Enter" },
  { kind: "item", id: "rename", label: "Rename", shortcut: "F2" },
  { kind: "separator", id: "edit-separator" },
  {
    kind: "submenu",
    id: "transform",
    label: "Transform",
    children: [
      { kind: "item", id: "transpose-up", label: "Transpose up", shortcut: "↑" },
      { kind: "item", id: "transpose-down", label: "Transpose down", shortcut: "↓" }
    ]
  },
  { kind: "checkbox", id: "loop", label: "Loop clip", checked: true },
  { kind: "separator", id: "danger-separator" },
  { kind: "item", id: "delete", label: "Delete", shortcut: "Del", tone: "danger" }
]

const scrollEntries: readonly UiMenuEntry[] = Array.from({ length: 28 }, (_, index) => ({
  kind: "item",
  id: "command:" + String(index + 1),
  label: "Command " + String(index + 1).padStart(2, "0"),
  shortcut: index % 4 === 0 ? "⌘" + String(index + 1) : undefined
}))

const meta = {
  title: "Components/Menus",
  component: UiDropdownMenu,
  tags: ["autodocs"],
  args: {
    entries: effectEntries,
    menuLabel: "Menu"
  },
  parameters: {
    layout: "centered"
  }
} satisfies Meta<typeof UiDropdownMenu>

export default meta
type Story = StoryObj<typeof meta>

export const SearchableTaxonomy: Story = {
  render: () => ({
    components: { UiButton, UiDropdownMenu },
    setup() {
      const lastAction = shallowRef("No effect selected")
      return { effectEntries, lastAction }
    },
    template: `
      <div style="display:grid;gap:var(--ui-space-3);min-width:18rem">
        <UiDropdownMenu
          :entries="effectEntries"
          menu-label="Add audio effect"
          :search-options="{
            label: 'Search effects',
            placeholder: 'Plug-in, vendor, or category',
            emptyMessage: 'No effects match this search.',
            resultCountLabel: '{count} matching effects'
          }"
          @select="lastAction = $event"
        >
          <UiButton>Add audio effect</UiButton>
        </UiDropdownMenu>
        <output style="color:var(--ui-color-text-muted);font-size:var(--ui-font-size-xs)">
          {{ lastAction }}
        </output>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Add audio effect" }))
    const page = within(document.body)
    const search = await page.findByRole("textbox", { name: "Search effects" })
    await userEvent.type(search, "OTT")
    await userEvent.click(await page.findByText("OTT"))
    await expect(canvas.getByText("effect:ott")).toBeVisible()
  }
}

export const ClipContextMenu: Story = {
  render: () => ({
    components: { UiButton, UiContextMenu },
    setup() {
      const lastAction = shallowRef("Right-click the selected clip")
      return { clipEntries, lastAction }
    },
    template: `
      <div style="display:grid;gap:var(--ui-space-3)">
        <UiContextMenu
          :entries="clipEntries"
          menu-label="Verse clip commands"
          @select="lastAction = $event"
        >
          <UiButton
            variant="ghost"
            style="
              width:22rem;
              min-height:5rem;
              padding:var(--ui-space-3);
              border-left:var(--ui-signal-rail-width) solid var(--ui-signal-audio);
              border-radius:var(--ui-radius-sm);
              color:var(--ui-color-text);
              background:var(--ui-color-surface);
              box-shadow:var(--ui-shadow-selected-outline);
            "
          >
            <strong>Verse · guitar</strong>
            <div style="margin-top:var(--ui-space-2);font-family:var(--ui-type-family-data);font-size:var(--ui-font-size-xs)">
              17.1.1 — 25.1.1
            </div>
          </UiButton>
        </UiContextMenu>
        <output style="color:var(--ui-color-text-muted);font-size:var(--ui-font-size-xs)">
          {{ lastAction }}
        </output>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole("button", { name: /Verse/ })
    await userEvent.pointer({ keys: "[MouseRight]", target: trigger })
    await userEvent.click(await within(document.body).findByText("Rename"))
    await expect(canvas.getByText("rename")).toBeVisible()
  }
}

export const ScrollableContextMenu: Story = {
  render: () => ({
    components: { UiButton, UiContextMenu },
    setup() {
      return { scrollEntries }
    },
    template: `
      <UiContextMenu :entries="scrollEntries" menu-label="Scrollable clip commands">
        <UiButton
          variant="ghost"
          style="
            width:22rem;
            min-height:5rem;
            padding:var(--ui-space-3);
            border:1px solid var(--ui-color-border-strong);
            border-radius:var(--ui-radius-sm);
            color:var(--ui-color-text);
            background:var(--ui-color-surface);
          "
        >
          Right-click for a long command menu
        </UiButton>
      </UiContextMenu>
    `
  })
}

export const CascadingMenu: Story = {
  render: () => ({
    components: { UiButton, UiCascadingMenu },
    data: () => ({
      selected: "No destination selected",
      items: [
        {
          label: "Bus",
          children: [
            { label: "Bus 1", value: "bus:1", trailing: "Vocal verb" },
            { label: "Bus 2", value: "bus:2", trailing: "Drum crush" }
          ]
        },
        { label: "Stereo out", value: "output:stereo" }
      ]
    }),
    template: `
      <div class="storybook-stack">
        <UiCascadingMenu
          :items="items"
          search-label="Search destinations"
          empty-message="No destinations match."
          aria-label="Choose output"
          @select="selected = $event"
        ><UiButton>Choose output</UiButton></UiCascadingMenu>
        <output>{{ selected }}</output>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Choose output" }))
    await userEvent.hover(await within(document.body).findByText("Bus"))
    await userEvent.click(await within(document.body).findByText("Bus 1"))
    await expect(canvas.getByText("bus:1")).toBeVisible()
  }
}

export const ApplicationMenubar: Story = {
  render: () => ({
    components: { UiMenubar },
    data: () => ({
      selected: "No command selected",
      menus: [
        {
          value: "file",
          label: "File",
          items: [
            { value: "new", label: "New", shortcut: "Ctrl+N" },
            { value: "close", label: "Close", shortcut: "Ctrl+W", separatorBefore: true }
          ]
        }
      ]
    }),
    template: `<div class="storybook-stack"><UiMenubar :menus="menus" aria-label="Application menu" @select="selected = $event" /><output>{{ selected }}</output></div>`
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByText("File"))
    await userEvent.click(await within(document.body).findByText("New"))
    await expect(canvas.getByText("new")).toBeVisible()
  }
}
