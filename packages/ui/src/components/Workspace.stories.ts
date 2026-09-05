import type { Meta, StoryObj } from "@storybook/vue3-vite"
import { expect, userEvent, within } from "storybook/test"

import UiButton from "./UiButton.vue"
import UiChoiceChip from "./UiChoiceChip.vue"
import UiField from "./UiField.vue"
import UiNumberInput from "./UiNumberInput.vue"
import UiSegmentedControl from "./UiSegmentedControl.vue"
import UiSelect from "./UiSelect.vue"
import UiToolbar from "./UiToolbar.vue"
import UiSearchInput from "./UiSearchInput.vue"
import { shallowRef } from "vue"

const meta = {
  title: "Components/Workspace/Command surfaces",
  component: UiToolbar,
  tags: ["autodocs"],
  args: {
    label: "Workspace commands"
  },
  parameters: {
    layout: "fullscreen"
  }
} satisfies Meta<typeof UiToolbar>

export default meta
type Story = StoryObj<typeof meta>

export const MediaFilters: Story = {
  render: () => ({
    components: { UiSearchInput, UiSegmentedControl, UiButton },
    setup: () => ({
      query: shallowRef(""),
      filter: shallowRef("all"),
      options: [
        { value: "all", label: "全部" },
        { value: "audio", label: "音频" },
        { value: "midi", label: "MIDI" }
      ]
    }),
    template: `<section style="display:grid;gap:6px;width:300px;max-width:100%;padding:10px">
      <UiSearchInput v-model="query" label="搜索工程资产" />
      <UiSegmentedControl v-model="filter" :options="options" label="资产类型" size="compact" appearance="separated" required />
      <UiSearchInput label="Unavailable search" disabled />
      <p role="status">{{query}} / {{filter}}</p>
    </section>`
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const search = canvas.getByRole("searchbox", { name: "搜索工程资产" })
    await userEvent.type(search, "Bass")
    await expect(canvas.getByRole("status")).toHaveTextContent("Bass / all")
    await expect(search.parentElement!.getBoundingClientRect().height).toBe(27)
    await expect(getComputedStyle(search).boxShadow).toBe("none")
    await expect(getComputedStyle(search).outlineStyle).toBe("none")
    await expect(getComputedStyle(search.parentElement!).boxShadow).toContain("inset")
    const midi = canvas.getByRole("button", { name: "MIDI" })
    await userEvent.click(midi)
    await userEvent.click(midi)
    await expect(midi).toHaveAttribute("aria-pressed", "true")
    await expect(canvas.getByRole("status")).toHaveTextContent("Bass / midi")
    await userEvent.keyboard("{ArrowLeft} ")
    await expect(canvas.getByRole("button", { name: "音频" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    await expect(canvas.getByRole("searchbox", { name: "Unavailable search" })).toBeDisabled()
  }
}

export const EditorToolbar: Story = {
  render: () => ({
    components: {
      UiButton,
      UiChoiceChip,
      UiSegmentedControl,
      UiSelect,
      UiToolbar
    },
    data: () => ({
      tool: "select",
      snap: "1/16",
      tools: [
        { label: "Select", value: "select" },
        { label: "Draw", value: "draw" },
        { label: "Erase", value: "erase" }
      ],
      snapOptions: [
        { label: "1/8", value: "1/8" },
        { label: "1/16", value: "1/16" },
        { label: "1/32", value: "1/32" }
      ],
      clips: [
        { name: "Verse", color: "var(--ui-signal-midi)" },
        { name: "Counter melody", color: "var(--ui-signal-audio)" }
      ],
      activeClip: "Verse"
    }),
    template: `
      <UiToolbar density="compact" label="Piano roll commands">
        <template #start>
          <UiSegmentedControl v-model="tool" size="compact" label="Editing tool" :options="tools" />
          <label class="workspace-story-field">
            <span>Snap</span>
            <UiSelect v-model="snap" size="compact" :options="snapOptions" aria-label="Snap resolution" />
          </label>
        </template>
        <div class="workspace-story-clips" aria-label="Open clips">
          <UiChoiceChip
            v-for="clip in clips"
            :key="clip.name"
            :label="clip.name"
            :selected="activeClip === clip.name"
            :signal-color="clip.color"
            @select="activeClip = clip.name"
          />
        </div>
        <template #end><UiButton size="sm" variant="ghost">Close editor</UiButton></template>
      </UiToolbar>
    `
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const draw = canvas.getByRole("button", { name: "Draw" })
    await userEvent.click(draw)
    await expect(draw).toHaveAttribute("aria-pressed", "true")
    const clip = canvas.getByRole("button", { name: "Counter melody" })
    await userEvent.click(clip)
    await expect(clip).toHaveAttribute("aria-pressed", "true")
    await userEvent.click(canvas.getByRole("button", { name: "Select" }))
    await userEvent.click(canvas.getByRole("button", { name: "Verse" }))
  }
}

export const InspectorFields: Story = {
  render: () => ({
    components: { UiField, UiNumberInput },
    data: () => ({ pitch: 60, velocity: 96 }),
    template: `
      <aside class="workspace-story-inspector" aria-label="Selected note properties">
        <strong>1 note selected</strong>
        <UiField label="Pitch" layout="inline">
          <template #default="{ controlId }">
            <UiNumberInput v-model="pitch" :id="controlId" size="compact" :min="0" :max="127" />
          </template>
        </UiField>
        <UiField label="Velocity" layout="inline">
          <template #default="{ controlId }">
            <UiNumberInput v-model="velocity" :id="controlId" size="compact" :min="1" :max="127" />
          </template>
        </UiField>
      </aside>
    `
  }),
  play: async ({ canvasElement }) => {
    const pitch = within(canvasElement).getByRole("spinbutton", { name: /Pitch/ })
    await userEvent.click(pitch)
    await userEvent.keyboard("{ArrowUp}")
    await expect(pitch).toHaveValue("61")
  }
}

export const GlobalTrackFields: Story = {
  render: () => ({
    components: { UiNumberInput, UiSelect },
    data: () => ({ tempo: 120, numerator: 4, denominator: "4" }),
    template: `
      <aside aria-label="Global track controls" style="width: 220px; max-width: 100%; padding: 10px; display: grid; gap: 12px">
        <label style="display: grid; min-width: 0; gap: 4px">
          <span>Tempo</span>
          <UiNumberInput v-model="tempo" size="compact" appearance="workspace"
            suffix="BPM" accent-color="var(--ui-domain-color-65a8ff)"
            :format-options="{ minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }"
            :min="20" :max="300" :step="0.01" aria-label="Tempo" />
        </label>
        <div role="group" aria-label="Time signature" style="display: flex; align-items: center; gap: 4px; min-width: 0">
          <div style="flex: 1 1 0; min-width: 0; display: grid">
            <UiNumberInput v-model="numerator" size="compact" appearance="workspace"
              accent-color="var(--ui-domain-color-f2a65a)" :min="1" :max="32" aria-label="Numerator" />
          </div>
          <span aria-hidden="true">/</span>
          <div style="flex: 1 1 0; min-width: 0; display: grid">
            <UiSelect v-model="denominator" size="compact" aria-label="Denominator"
              :options="[{ label: '4', value: '4' }, { label: '8', value: '8' }]" />
          </div>
        </div>
      </aside>
    `
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const tempo = canvas.getByRole("spinbutton", { name: "Tempo" })
    await expect(tempo).toHaveValue("120.00")
    await userEvent.click(tempo)
    await userEvent.keyboard("{ArrowUp}")
    await expect(tempo).toHaveValue("120.01")
    await userEvent.keyboard("{ArrowDown}")
    const numerator = canvas.getByRole("spinbutton", { name: "Numerator" })
    await userEvent.clear(numerator)
    await userEvent.type(numerator, "7{Enter}")
    await expect(numerator).toHaveValue("7")
    await userEvent.selectOptions(canvas.getByRole("combobox", { name: "Denominator" }), "8")
  }
}
