import type { Meta, StoryObj } from "@storybook/vue3-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"

import UiCascadingSelect from "./UiCascadingSelect.vue"
import UiCheckbox from "./UiCheckbox.vue"
import UiField from "./UiField.vue"
import UiForm from "./UiForm.vue"
import UiNumberInput from "./UiNumberInput.vue"
import UiRadioGroup from "./UiRadioGroup.vue"
import UiSelect from "./UiSelect.vue"
import UiSlider from "./UiSlider.vue"
import UiTextInput from "./UiTextInput.vue"
import { shallowRef } from "vue"

const meta = {
  title: "Components/Forms/Field",
  component: UiField,
  tags: ["autodocs"],
  args: {
    label: "Field"
  },
  render: () => ({
    components: {
      UiCheckbox,
      UiField,
      UiForm,
      UiRadioGroup,
      UiSelect,
      UiSlider,
      UiTextInput
    },
    data: () => ({
      projectName: "Midnight session",
      driver: "shared",
      monitoring: true,
      mode: "balanced",
      bufferSize: 256,
      driverOptions: [
        { label: "Native shared", value: "shared" },
        { label: "Native exclusive", value: "exclusive" }
      ],
      modeOptions: [
        {
          label: "Low latency",
          value: "low",
          description: "Prioritizes live monitoring response."
        },
        {
          label: "Balanced",
          value: "balanced",
          description: "Recommended for editing and mixing."
        }
      ]
    }),
    template: `
      <UiForm class="storybook-stack" style="max-width:32rem">
        <UiField label="Project name" description="Shown in the project browser." required>
          <template #default="{ controlId, descriptionId }">
            <UiTextInput v-model="projectName" :id="controlId" :aria-describedby="descriptionId" />
          </template>
        </UiField>
        <UiField label="Audio driver">
          <template #default="{ controlId }">
            <UiSelect v-model="driver" :id="controlId" :options="driverOptions" />
          </template>
        </UiField>
        <UiCheckbox v-model="monitoring" label="Software monitoring" description="Hear armed inputs through Heron." />
        <UiRadioGroup v-model="mode" label="Performance profile" :options="modeOptions" />
        <UiField label="Buffer size" description="Lower values reduce latency and increase CPU demand.">
          <template #default="{ controlId, descriptionId }">
            <UiSlider v-model="bufferSize" :id="controlId" :aria-describedby="descriptionId" label="Buffer size" :min="32" :max="2048" :step="32" :value-text="bufferSize + ' samples'" />
          </template>
        </UiField>
      </UiForm>
    `
  })
} satisfies Meta<typeof UiField>

export default meta
type Story = StoryObj<typeof meta>

export const CompactBackend: Story = {
  render: () => ({
    components: { UiRadioGroup },
    setup: () => ({
      backend: shallowRef("wasapi"),
      options: [
        {
          value: "wasapi",
          label: "WASAPI · Windows",
          description: "Windows shared and exclusive audio"
        },
        {
          value: "asio",
          label: "ASIO · Windows",
          description: "Low-latency professional audio drivers"
        },
        { value: "unavailable", label: "Unavailable", disabled: true }
      ]
    }),
    template: `<UiRadioGroup v-model="backend" size="compact" label="Audio backend" :options="options" />`
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const wasapi = canvas.getByRole("radio", { name: /WASAPI/ })
    const asio = canvas.getByRole("radio", { name: /ASIO ·/ })
    await expect(wasapi).toBeChecked()
    await userEvent.tab()
    await expect(wasapi).toHaveFocus()
    await userEvent.keyboard("{ArrowDown}")
    await expect(asio).toBeChecked()
    await expect(canvas.getByRole("radio", { name: "Unavailable" })).toBeDisabled()
    await userEvent.click(wasapi)
    await expect(wasapi).toBeChecked()
    const title = canvas.getByText("WASAPI · Windows")
    const description = canvas.getByText("Windows shared and exclusive audio")
    await expect(getComputedStyle(title).fontSize).toBe("9px")
    await expect(getComputedStyle(description).fontSize).toBe("7px")
    await expect(description.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      title.getBoundingClientRect().bottom
    )
    await expect(wasapi.getBoundingClientRect().width).toBe(12)
  }
}

export const CompleteForm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole("textbox", { name: /Project name/ })
    await userEvent.clear(input)
    await userEvent.type(input, "Album session")
    await expect(input).toHaveValue("Album session")
    const checkbox = canvas.getByRole("checkbox", { name: /Software monitoring/ })
    await userEvent.click(checkbox)
    await expect(checkbox).not.toBeChecked()
  }
}

export const Error: Story = {
  render: () => ({
    components: { UiField, UiTextInput },
    data: () => ({ value: "" }),
    template: `
      <div style="max-width:28rem">
        <UiField label="Project name" error="Enter a project name before continuing." required>
          <template #default="{ controlId, errorId }">
            <UiTextInput v-model="value" :id="controlId" :aria-describedby="errorId" invalid />
          </template>
        </UiField>
      </div>
    `
  })
}

export const Disabled: Story = {
  render: () => ({
    components: { UiCheckbox, UiField, UiSelect, UiTextInput },
    data: () => ({
      value: "Unavailable device",
      selected: "offline",
      options: [{ label: "Device offline", value: "offline", disabled: true }]
    }),
    template: `
      <div class="storybook-stack" style="max-width:28rem">
        <UiField label="Device name"><template #default="{ controlId }"><UiTextInput v-model="value" :id="controlId" disabled /></template></UiField>
        <UiField label="Audio device">
          <template #default="{ controlId }">
            <UiSelect v-model="selected" :id="controlId" :options="options" disabled />
          </template>
        </UiField>
        <UiCheckbox label="Exclusive device access" disabled />
      </div>
    `
  })
}

export const PreferenceControls: Story = {
  render: () => ({
    components: { UiCheckbox, UiNumberInput, UiSelect },
    data: () => ({
      monitoring: true,
      bufferSize: "256",
      workerThreads: 4,
      options: [
        { label: "128 samples", value: "128" },
        { label: "256 samples", value: "256" },
        { label: "512 samples", value: "512" }
      ]
    }),
    template: `
      <div class="ui-preferences-surface" style="display:grid;max-width:34rem;gap:var(--ui-space-5);padding:var(--ui-space-5);background:var(--canvas)">
        <UiCheckbox
          v-model="monitoring"
          label="Software monitoring"
          description="Hear armed inputs through Heron. Long descriptions wrap without changing the control alignment."
        />
        <UiSelect
          v-model="bufferSize"
          :options="options"
          size="sm"
          aria-label="Buffer size"
        />
        <UiNumberInput
          v-model="workerThreads"
          :min="1"
          :max="16"
          size="sm"
          aria-label="Worker threads"
        />
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--ui-space-3)">
          <UiSelect v-model="bufferSize" :options="options" size="sm" aria-label="Invalid buffer size" invalid />
          <UiNumberInput v-model="workerThreads" size="sm" aria-label="Invalid worker threads" invalid />
          <UiNumberInput :model-value="8" size="sm" aria-label="Disabled worker threads" disabled />
        </div>
        <UiCheckbox label="Unavailable preference" description="The disabled state remains legible." disabled />
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const checkbox = canvas.getByRole("checkbox", { name: /^Software monitoring/ })
    await userEvent.click(checkbox)
    await expect(checkbox).not.toBeChecked()
    await userEvent.click(canvas.getByRole("spinbutton", { name: "Worker threads" }))
    await expect(canvas.getByRole("spinbutton", { name: "Worker threads" })).toHaveFocus()
  }
}

export const SelectSizesAndGroups: Story = {
  render: () => ({
    components: { UiCascadingSelect, UiField, UiSelect },
    data: () => ({
      compactValue: "post",
      standardValue: "shared",
      keyValue: "major:0",
      routeValue: "output",
      inputValue: "1",
      routingOptions: [
        { label: "Pre-fader", value: "pre" },
        { label: "Post-fader", value: "post" },
        { label: "Post-pan", value: "post-pan" }
      ],
      driverOptions: [
        { label: "Native shared", value: "shared" },
        { label: "Native exclusive", value: "exclusive" }
      ],
      keyGroups: [
        {
          label: "Major keys",
          options: [
            { label: "C♯ Major", value: "major:7" },
            { label: "C Major", value: "major:0" },
            { label: "C♭ Major", value: "major:-7" }
          ]
        },
        {
          label: "Minor keys",
          separatorBefore: true,
          options: [
            { label: "A♯ minor", value: "minor:7" },
            { label: "A minor", value: "minor:0" },
            { label: "A♭ minor", value: "minor:-7" }
          ]
        }
      ],
      routeGroups: [
        {
          label: "Outputs",
          options: [
            { label: "Output 1–2", value: "output" },
            { label: "Headphones 3–4", value: "headphones" }
          ]
        },
        {
          label: "Buses",
          options: [
            { label: "Reverb", value: "reverb" },
            { label: "Parallel compression", value: "parallel" }
          ]
        }
      ],
      inputOptions: [
        { label: "IN 1–2", value: "1" },
        { label: "IN 3–4", value: "3" },
        { label: "IN 5–6", value: "5" },
        { label: "IN 7–8", value: "7" }
      ]
    }),
    template: `
      <div class="storybook-stack" style="max-width:28rem">
        <UiField label="Compact · timeline and mixer">
          <template #default="{ controlId }">
            <UiSelect v-model="compactValue" :id="controlId" :options="routingOptions" size="compact" />
          </template>
        </UiField>
        <UiField label="Small · preference rows">
          <template #default="{ controlId }">
            <UiSelect v-model="standardValue" :id="controlId" :options="driverOptions" size="sm" />
          </template>
        </UiField>
        <UiField label="Medium · project forms">
          <template #default="{ controlId }">
            <UiSelect v-model="standardValue" :id="controlId" :options="driverOptions" size="md" />
          </template>
        </UiField>
        <UiField label="Large · spacious forms">
          <template #default="{ controlId }">
            <UiSelect v-model="standardValue" :id="controlId" :options="driverOptions" size="lg" />
          </template>
        </UiField>
        <UiField label="Grouped values">
          <template #default="{ controlId }">
            <UiSelect v-model="keyValue" :id="controlId" :groups="keyGroups" size="md" />
          </template>
        </UiField>
        <UiField label="Cascading route">
          <template #default="{ controlId }">
            <UiCascadingSelect v-model="routeValue" :id="controlId" :groups="routeGroups" size="compact" appearance="workspace" />
          </template>
        </UiField>
        <UiField label="Direct menu">
          <template #default="{ controlId }">
            <UiCascadingSelect v-model="inputValue" :id="controlId" :options="inputOptions" size="compact" />
          </template>
        </UiField>
      </div>
    `
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const route = canvas.getByLabelText(/Cascading route/)
    await userEvent.click(route)
    await within(document.body).findByText("Outputs")
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(route).toHaveFocus())
  }
}

export const EmbeddedHoverTreatments: Story = {
  render: () => ({
    components: { UiCascadingSelect },
    data: () => ({
      hostTintValue: "input:1",
      surfaceValue: "input:1",
      options: [
        { label: "IN 1–2", value: "input:1" },
        { label: "IN 3–4", value: "input:3" }
      ]
    }),
    template: `
      <div class="storybook-stack" style="max-width:28rem">
        <div style="overflow:hidden;border-radius:var(--ui-radius-sm);color:white;background:linear-gradient(var(--ui-domain-color-3f91d4),var(--ui-domain-color-2871ae))">
          <UiCascadingSelect v-model="hostTintValue" :options="options" size="compact" appearance="embedded" hover-treatment="host-tint" aria-label="Host tint embedded hover" />
        </div>
        <div style="overflow:hidden;border-radius:var(--ui-radius-sm);color:white;background:linear-gradient(var(--ui-domain-color-3f91d4),var(--ui-domain-color-2871ae))">
          <UiCascadingSelect v-model="surfaceValue" :options="options" size="compact" appearance="embedded" hover-treatment="surface" aria-label="Surface embedded hover" />
        </div>
      </div>
    `
  })
}
