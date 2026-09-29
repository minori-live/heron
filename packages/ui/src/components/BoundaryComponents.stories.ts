import { expect, fireEvent, userEvent, within } from "storybook/test"
import type { Meta, StoryObj } from "@storybook/vue3-vite"
import { shallowRef } from "vue"

import {
  UiActionRow,
  UiButton,
  UiChoiceCard,
  UiColorInput,
  UiDraggableItem,
  UiDropZone,
  UiForm,
  UiInlineTextEdit,
  UiResizeHandle,
  UiSettingsNavigator,
  UiTabs,
  UiTextarea,
  UiTextInput,
  UiWindowControls,
  UiZoomControl
} from "../index"

const meta = {
  title: "Components/Boundary contracts",
  component: UiInlineTextEdit,
  tags: ["autodocs"],
  args: {
    value: "Bass",
    label: "Rename track"
  }
} satisfies Meta<typeof UiInlineTextEdit>

export default meta
type Story = StoryObj<typeof meta>

export const MidiPreferences: Story = {
  render: () => ({
    components: { UiActionRow, UiButton, UiChoiceCard, UiSettingsNavigator },
    setup: () => ({
      active: shallowRef("preferences"),
      centerC: shallowRef("roland-c4"),
      appearance: shallowRef("Dark appearance"),
      editing: shallowRef(""),
      standards: [
        {
          id: "yamaha-c3",
          label: "Yamaha (C3)",
          description:
            "Middle C is labeled C3, matching Yamaha keyboards and many Japanese products."
        },
        {
          id: "roland-c4",
          label: "Roland (C4)",
          description: "Middle C is labeled C4, matching Roland gear and scientific pitch notation."
        }
      ],
      profiles: [
        {
          name: "Soft takeover",
          description: "Absolute curve",
          origin: "Built in",
          action: "Duplicate"
        },
        {
          name: "Relative custom with a deliberately long controller profile name",
          description: "Relative acceleration",
          origin: "Custom",
          action: "Edit"
        }
      ]
    }),
    template: `
      <UiSettingsNavigator v-model="active" title="Settings" scope-label="Application"
        back-label="Back to studio" categories-label="Settings categories" pages-label="MIDI pages"
        :categories="[{ id: 'midi', label: 'MIDI', items: [{ id: 'preferences', label: 'Preferences' }] }]">
        <div style="padding:16px;display:grid;gap:16px;min-width:0">
          <section aria-label="Center C" style="display:grid;gap:9px;min-width:0">
            <h2 style="margin:0;font-size:var(--ui-type-size-section-title)">Center C</h2>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:9px">
              <UiChoiceCard v-for="standard in standards" :key="standard.id"
                :label="standard.label" :description="standard.description"
                :selected="centerC === standard.id" @select="centerC = standard.id">
                <template #icon><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12v10H2zM6 3v10M10 3v10" fill="none" stroke="currentColor" /></svg></template>
              </UiChoiceCard>
            </div>
          </section>
          <section aria-label="Transform profiles" style="display:grid;gap:8px;min-width:0">
            <h2 style="margin:0;font-size:var(--ui-type-size-section-title)">Transform profiles</h2>
            <UiActionRow v-for="profile in profiles" :key="profile.name"
              :label="profile.name" :description="profile.description" @activate="editing = profile.name">
              <template #leading><svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><path d="M7 5v18M14 5v18M21 5v18M4 10h6M11 18h6M18 12h6" stroke="currentColor" /></svg></template>
              <template #trailing><span>{{ profile.origin }}</span><span>{{ profile.action }}</span></template>
            </UiActionRow>
          </section>
          <section aria-label="Appearance" style="display:grid;gap:9px">
            <h2 style="margin:0;font-size:var(--ui-type-size-section-title)">Appearance</h2>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:9px">
              <UiChoiceCard v-for="label in ['Dark appearance', 'Light appearance']" :key="label"
                :label="label" description="Preview above, title and description below"
                :selected="appearance === label" @select="appearance = label">
                <template #preview><span style="height:72px;background:var(--ui-color-surface-raised);border:1px solid var(--ui-color-border)"></span></template>
                <template #icon><svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" /></svg></template>
              </UiChoiceCard>
            </div>
          </section>
          <div style="display:flex;gap:8px"><UiButton size="sm">Browse folder</UiButton><UiButton>Apply settings</UiButton></div>
          <output>{{ editing ? 'Editing ' + editing : 'Choose a profile' }}</output>
        </div>
      </UiSettingsNavigator>
    `
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const yamaha = canvas.getByRole("button", { name: /Yamaha/ })
    const roland = canvas.getByRole("button", { name: /Roland/ })
    await expect(roland).toHaveAttribute("aria-pressed", "true")
    await userEvent.click(yamaha)
    await expect(yamaha).toHaveAttribute("aria-pressed", "true")
    await expect(roland).toHaveAttribute("aria-pressed", "false")
    await userEvent.click(canvas.getByRole("button", { name: /Soft takeover/ }))
    await expect(canvas.getByText("Editing Soft takeover")).toBeVisible()
  }
}

export const OrdinaryControls: Story = {
  render: () => ({
    components: {
      UiActionRow,
      UiButton,
      UiChoiceCard,
      UiColorInput,
      UiForm,
      UiInlineTextEdit,
      UiTabs,
      UiTextarea
    },
    data: () => ({
      color: "var(--signal-cyan)",
      note: "Verse automation notes",
      tab: "project",
      submitted: false,
      renamed: "Bass"
    }),
    template: `
      <div class="storybook-stack" style="max-width:34rem">
        <UiTabs v-model="tab" label="Note scope" :items="[{ id: 'project', label: 'Project' }, { id: 'track', label: 'Track' }]">
          <template #project><p>Project notes</p></template>
          <template #track><p>Track notes</p></template>
        </UiTabs>
        <UiInlineTextEdit :value="renamed" label="Rename track" @commit="renamed = $event" />
        <UiChoiceCard label="Dark" description="Use the dark studio theme" selected @select="tab = 'project'" />
        <UiActionRow label="Midnight Session" description="Modified 12 minutes ago" @activate="tab = 'track'" />
        <UiActionRow label="Alchemy" description="Apple · Instrument" density="compact" appearance="plain">
          <template #trailing>VST3</template>
        </UiActionRow>
        <UiColorInput v-model="color" label="Track color" />
        <UiForm @submit="submitted = true">
          <UiTextarea v-model="note" aria-label="Session note" />
          <UiButton type="submit">Save note</UiButton>
        </UiForm>
        <output aria-live="polite">{{ submitted ? 'Submitted' : tab }}</output>
      </div>
    `
  }),
  async play({ canvasElement }) {
    const canvas = within(canvasElement)
    await userEvent.dblClick(canvas.getByRole("button", { name: "Rename track" }))
    const editor = canvas.getByRole("textbox", { name: "Rename track" })
    await userEvent.clear(editor)
    await userEvent.type(editor, "Bass DI{Enter}")
    await expect(canvas.getByRole("button", { name: "Rename track" })).toHaveTextContent("Bass DI")
    await userEvent.click(canvas.getByRole("button", { name: /Midnight Session/ }))
    await expect(canvas.getByText("Track notes")).toBeVisible()
    const compactPlugin = canvas.getByRole("button", { name: /Alchemy/ })
    await expect(compactPlugin.getBoundingClientRect().height).toBeLessThanOrEqual(40)
    await expect(
      Number.parseFloat(getComputedStyle(compactPlugin.querySelector("strong")!).fontSize)
    ).toBeLessThanOrEqual(9)
  }
}

export const InteractionSurfaces: Story = {
  render: () => ({
    components: {
      UiDraggableItem,
      UiDropZone,
      UiActionRow,
      UiResizeHandle,
      UiWindowControls,
      UiZoomControl
    },
    data: () => ({ zoom: 50, status: "idle", dropped: "" }),
    template: `
      <div class="storybook-stack" style="max-width:34rem">
      <UiWindowControls
        label="Window controls"
          minimize-label="Minimize"
          maximize-label="Maximize"
          close-label="Close"
          minimize-command="minimize"
          maximize-command="maximize"
          close-command="close"
          @command="status = $event"
        >
          <template #minimize>−</template><template #maximize>□</template><template #close>×</template>
        </UiWindowControls>
        <UiZoomControl v-model="zoom" label="Timeline zoom" reset-label="Reset zoom" visual="timeline" @reset="zoom = 50" />
        <UiResizeHandle axis="horizontal" label="Resize inspector" :value="320" :minimum="240" :maximum="600" @gesture="status = $event.phase" />
        <UiDraggableItem :data="[{ mime: 'text/plain', value: 'clip-1' }]">
          <UiActionRow label="Draggable clip" />
        </UiDraggableItem>
        <UiDropZone label="Arrangement drop zone" :mime-types="['text/plain']" @drop="dropped = $event[0]?.value ?? ''">
          <div style="min-height:5rem;border:1px dashed var(--ui-color-border);padding:var(--ui-space-3)">Drop target: {{ dropped || status }}</div>
        </UiDropZone>
      </div>
    `
  }),
  async play({ canvasElement }) {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Close" }))
    await expect(canvas.getByText(/Drop target: close/)).toBeVisible()
    const separator = canvas.getByRole("separator", { name: "Resize inspector" })
    await userEvent.type(separator, "{ArrowRight}")
    await expect(canvas.getByText(/Drop target: commit/)).toBeVisible()
    await expect(canvasElement.querySelector(".ui-zoom-control__visual")).not.toBeNull()
    const source = canvas.getByText("Draggable clip").closest('[draggable="true"]')
    const target = canvas.getByLabelText("Arrangement drop zone")
    const transfer = new DataTransfer()
    await fireEvent.dragStart(source!, { dataTransfer: transfer })
    transfer.setData("text/plain", "clip-1")
    const acceptsDrag = target.dispatchEvent(
      new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer })
    )
    const acceptsDrop = target.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer })
    )
    await expect(acceptsDrag).toBe(false)
    await expect(acceptsDrop).toBe(false)
  }
}

export const SettingsNavigation: Story = {
  render: () => ({
    components: { UiButton, UiSettingsNavigator, UiTextInput },
    data: () => ({ active: "audio", backed: false, device: "Studio interface" }),
    template: `
      <div style="height:32rem">
        <UiSettingsNavigator
          v-model="active"
          title="Settings"
          scope-label="Application"
          back-label="Back to studio"
          categories-label="Settings categories"
          pages-label="Audio pages"
          build-label="Heron 0.4.7"
          sidebar-label="Settings"
          :categories="[
            { id: 'system', label: 'System', description: 'Application behavior', items: [{ id: 'audio', label: 'Audio', description: 'Device and runtime' }, { id: 'display', label: 'Display', description: 'Theme and language' }] },
            { id: 'midi', label: 'MIDI', description: 'Controllers', items: [{ id: 'devices', label: 'Devices', description: 'MIDI ports' }] }
          ]"
          @back="backed = true"
        >
          <template #category-icon><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" /></svg></template>
          <template #item-icon><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M8 3v10" /></svg></template>
          <template #actions><UiButton size="sm">Apply</UiButton></template>
          <section style="min-width:0;overflow:auto;padding:var(--ui-space-6)"><h2>{{ active }}</h2><UiTextInput v-model="device" aria-label="Device name" /><output>{{ backed ? 'Back requested' : 'Ready' }}</output></section>
        </UiSettingsNavigator>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvasElement.querySelectorAll(".ui-settings-navigator__category-icon svg")
    ).toHaveLength(2)
    await expect(
      canvasElement.querySelectorAll(".ui-settings-navigator__page-icon svg")
    ).toHaveLength(2)
    const systemCategory = canvas.getByRole("button", { name: "System" })
    await expect(Number.parseFloat(getComputedStyle(systemCategory).fontSize)).toBeLessThanOrEqual(
      10
    )
    const categoryIcon = canvasElement.querySelector(".ui-settings-navigator__category-icon")
    if (!categoryIcon) throw new Error("Expected a settings category icon")
    const iconColor = getComputedStyle(categoryIcon).color
    const colorChannels =
      iconColor
        .match(/[\d.]+/g)
        ?.slice(0, 3)
        .map(Number) ?? []
    await expect(colorChannels).toHaveLength(3)
    await expect(Math.max(...colorChannels) - Math.min(...colorChannels)).toBeLessThanOrEqual(2)
    await userEvent.click(canvas.getByRole("button", { name: /Display/ }))
    await expect(canvas.getByRole("heading", { name: "display" })).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "Back to studio" }))
    await expect(canvas.getByText("Back requested")).toBeVisible()
  }
}
